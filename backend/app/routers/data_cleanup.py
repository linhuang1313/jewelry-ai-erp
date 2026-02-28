"""
数据清理工具 - 用于清理测试数据和诊断问题
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from ..database import get_db
from ..models import (
    Customer, SalesOrder, CustomerGoldDeposit, CustomerGoldDepositTransaction,
    CustomerWithdrawal, CustomerTransfer, SettlementOrder
)
from ..models.finance import GoldReceipt, AccountReceivable
from ..dependencies.auth import get_current_role, require_permission
import logging
import os

logger = logging.getLogger(__name__)
router = APIRouter(tags=["数据清理"])


@router.get("/api/debug/customer-gold")
async def debug_customer_gold(
    customer_name: str = Query(..., description="客户名称"),
    role: str = Depends(require_permission("can_delete")),
    db: Session = Depends(get_db)
):
    """
    诊断客户金料账户数据
    """
    # 查找客户
    customers = db.query(Customer).filter(
        Customer.name.contains(customer_name)
    ).all()
    
    if not customers:
        return {"success": False, "message": f"未找到包含 '{customer_name}' 的客户"}
    
    result = []
    for customer in customers:
        customer_id = customer.id
        
        # 查询收料单
        receipts = db.query(GoldReceipt).filter(
            GoldReceipt.customer_id == customer_id
        ).all()
        
        # 使用统一计算函数（保证全系统口径一致）
        from ..gold_balance import calculate_customer_net_gold
        net_gold = calculate_customer_net_gold(customer_id, db)  # 正数=存料，负数=欠料
        
        result.append({
            "customer_id": customer_id,
            "customer_name": customer.name,
            "customer_no": customer.customer_no,
            "receipts_count": len(receipts),
            "receipts": [
                {
                    "id": r.id,
                    "receipt_no": r.receipt_no,
                    "gold_weight": r.gold_weight,
                    "status": r.status,
                    "created_at": r.created_at.isoformat() if r.created_at else None
                }
                for r in receipts
            ],
            "balance_calculation": {
                "net_gold": net_gold
            }
        })
    
    return {"success": True, "data": result}


@router.get("/api/cleanup/preview")
async def preview_cleanup(
    customer_name: str = Query(..., description="要清理的客户名称（支持模糊匹配）"),
    role: str = Depends(require_permission("can_delete")),
    db: Session = Depends(get_db)
):
    """
    预览要清理的数据（不会实际删除）
    """
    # 查找匹配的客户
    customers = db.query(Customer).filter(
        Customer.name.contains(customer_name)
    ).all()
    
    if not customers:
        return {
            "success": False,
            "message": f"未找到包含 '{customer_name}' 的客户"
        }
    
    result = []
    for customer in customers:
        customer_id = customer.id
        
        # 统计各表的记录数
        stats = {
            "customer_id": customer_id,
            "customer_name": customer.name,
            "customer_no": customer.customer_no,
            "records": {
                "gold_receipts": db.query(GoldReceipt).filter(
                    GoldReceipt.customer_id == customer_id
                ).count(),
                "customer_gold_deposits": db.query(CustomerGoldDeposit).filter(
                    CustomerGoldDeposit.customer_id == customer_id
                ).count(),
                "customer_gold_deposit_transactions": db.query(CustomerGoldDepositTransaction).filter(
                    CustomerGoldDepositTransaction.customer_id == customer_id
                ).count(),
                "customer_withdrawals": db.query(CustomerWithdrawal).filter(
                    CustomerWithdrawal.customer_id == customer_id
                ).count(),
                "sales_orders": db.query(SalesOrder).filter(
                    SalesOrder.customer_id == customer_id
                ).count(),
                "settlement_orders": db.query(SettlementOrder).join(SalesOrder).filter(
                    SalesOrder.customer_id == customer_id
                ).count(),
                "account_receivables": db.query(AccountReceivable).filter(
                    AccountReceivable.customer_id == customer_id
                ).count(),
            }
        }
        result.append(stats)
    
    return {
        "success": True,
        "message": f"找到 {len(customers)} 个匹配的客户",
        "data": result
    }


@router.delete("/api/cleanup/customer")
async def cleanup_customer_data(
    customer_id: int = Query(..., description="要清理的客户ID"),
    confirm: bool = Query(False, description="确认删除（必须设为true才会执行）"),
    user_role: str = Query(default="viewer", description="用户角色"),
    role: str = Depends(require_permission("can_delete")),
    db: Session = Depends(get_db)
):
    """
    清理指定客户的所有相关数据
    
    删除顺序（按外键依赖）：
    1. customer_gold_deposit_transactions
    2. customer_gold_deposits
    3. gold_receipts
    4. customer_withdrawals
    5. account_receivables
    6. settlement_orders
    7. sales_orders
    8. customer
    """
    if user_role != "manager":
        return {"success": False, "message": "权限不足：仅管理员可执行数据清理操作"}
    
    if not confirm:
        return {
            "success": False,
            "message": "请设置 confirm=true 确认删除操作"
        }
    
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    
    customer_name = customer.name
    deleted_counts = {}
    
    try:
        # 1. 删除客户存料交易记录
        count = db.query(CustomerGoldDepositTransaction).filter(
            CustomerGoldDepositTransaction.customer_id == customer_id
        ).delete(synchronize_session=False)
        deleted_counts["customer_gold_deposit_transactions"] = count
        
        # 2. 删除客户存料账户
        count = db.query(CustomerGoldDeposit).filter(
            CustomerGoldDeposit.customer_id == customer_id
        ).delete(synchronize_session=False)
        deleted_counts["customer_gold_deposits"] = count
        
        # 3. 删除收料单
        count = db.query(GoldReceipt).filter(
            GoldReceipt.customer_id == customer_id
        ).delete(synchronize_session=False)
        deleted_counts["gold_receipts"] = count
        
        # 4. 删除提料单
        count = db.query(CustomerWithdrawal).filter(
            CustomerWithdrawal.customer_id == customer_id
        ).delete(synchronize_session=False)
        deleted_counts["customer_withdrawals"] = count
        
        # 5. 删除应收账款
        count = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer_id
        ).delete(synchronize_session=False)
        deleted_counts["account_receivables"] = count
        
        # 6. 获取销售单ID列表
        sales_order_ids = [so.id for so in db.query(SalesOrder).filter(
            SalesOrder.customer_id == customer_id
        ).all()]
        
        # 7. 删除结算单（通过销售单关联）
        if sales_order_ids:
            count = db.query(SettlementOrder).filter(
                SettlementOrder.sales_order_id.in_(sales_order_ids)
            ).delete(synchronize_session=False)
            deleted_counts["settlement_orders"] = count
        else:
            deleted_counts["settlement_orders"] = 0
        
        # 8. 删除销售单
        count = db.query(SalesOrder).filter(
            SalesOrder.customer_id == customer_id
        ).delete(synchronize_session=False)
        deleted_counts["sales_orders"] = count
        
        # 9. 删除客户
        db.query(Customer).filter(Customer.id == customer_id).delete(synchronize_session=False)
        deleted_counts["customer"] = 1
        
        db.commit()
        
        logger.info(f"[数据清理] 已删除客户 {customer_name} (ID:{customer_id}) 及其所有相关数据: {deleted_counts}")
        
        return {
            "success": True,
            "message": f"已成功删除客户 '{customer_name}' 及其所有相关数据",
            "deleted_counts": deleted_counts
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"[数据清理] 删除客户数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.delete("/api/cleanup/all-test-customers")
async def cleanup_all_test_customers(
    name_pattern: str = Query("测试", description="客户名称匹配模式"),
    confirm: bool = Query(False, description="确认删除（必须设为true才会执行）"),
    user_role: str = Query(default="viewer", description="用户角色"),
    role: str = Depends(require_permission("can_delete")),
    db: Session = Depends(get_db)
):
    """
    批量清理所有测试客户数据
    """
    if user_role != "manager":
        return {"success": False, "message": "权限不足：仅管理员可执行数据清理操作"}
    
    if not confirm:
        # 预览模式
        customers = db.query(Customer).filter(
            Customer.name.contains(name_pattern)
        ).all()
        
        return {
            "success": True,
            "message": f"找到 {len(customers)} 个包含 '{name_pattern}' 的客户",
            "preview": [{"id": c.id, "name": c.name, "customer_no": c.customer_no} for c in customers],
            "hint": "设置 confirm=true 来执行删除"
        }
    
    # 执行删除
    customers = db.query(Customer).filter(
        Customer.name.contains(name_pattern)
    ).all()
    
    if not customers:
        return {
            "success": False,
            "message": f"未找到包含 '{name_pattern}' 的客户"
        }
    
    total_deleted = {
        "customers": 0,
        "gold_receipts": 0,
        "customer_gold_deposits": 0,
        "customer_gold_deposit_transactions": 0,
        "customer_withdrawals": 0,
        "sales_orders": 0,
        "settlement_orders": 0,
        "account_receivables": 0
    }
    
    deleted_customer_names = []
    
    for customer in customers:
        customer_id = customer.id
        customer_name = customer.name
        
        try:
            # 按顺序删除关联数据
            total_deleted["customer_gold_deposit_transactions"] += db.query(CustomerGoldDepositTransaction).filter(
                CustomerGoldDepositTransaction.customer_id == customer_id
            ).delete(synchronize_session=False)
            
            total_deleted["customer_gold_deposits"] += db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == customer_id
            ).delete(synchronize_session=False)
            
            total_deleted["gold_receipts"] += db.query(GoldReceipt).filter(
                GoldReceipt.customer_id == customer_id
            ).delete(synchronize_session=False)
            
            total_deleted["customer_withdrawals"] += db.query(CustomerWithdrawal).filter(
                CustomerWithdrawal.customer_id == customer_id
            ).delete(synchronize_session=False)
            
            total_deleted["account_receivables"] += db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id
            ).delete(synchronize_session=False)
            
            # 获取销售单ID列表
            sales_order_ids = [so.id for so in db.query(SalesOrder).filter(
                SalesOrder.customer_id == customer_id
            ).all()]
            
            if sales_order_ids:
                total_deleted["settlement_orders"] += db.query(SettlementOrder).filter(
                    SettlementOrder.sales_order_id.in_(sales_order_ids)
                ).delete(synchronize_session=False)
            
            total_deleted["sales_orders"] += db.query(SalesOrder).filter(
                SalesOrder.customer_id == customer_id
            ).delete(synchronize_session=False)
            
            db.query(Customer).filter(Customer.id == customer_id).delete(synchronize_session=False)
            total_deleted["customers"] += 1
            deleted_customer_names.append(customer_name)
            
        except Exception as e:
            logger.error(f"[数据清理] 删除客户 {customer_name} 失败: {e}")
            continue
    
    db.commit()
    
    logger.info(f"[数据清理] 批量删除完成: {total_deleted}")
    
    return {
        "success": True,
        "message": f"已成功删除 {total_deleted['customers']} 个测试客户及其相关数据",
        "deleted_customers": deleted_customer_names,
        "total_deleted": total_deleted
    }


@router.delete("/api/cleanup/empty-customers")
async def cleanup_empty_customers(
    confirm: bool = Query(False, description="确认删除（必须设为true才会执行）"),
    user_role: str = Query(default="viewer", description="用户角色"),
    role: str = Depends(require_permission("can_delete")),
    db: Session = Depends(get_db)
):
    """
    清理名字为空或仅含空白字符的客户记录及其关联数据
    """
    if user_role != "manager":
        return {"success": False, "message": "权限不足：仅管理员可执行数据清理操作"}
    
    from sqlalchemy import or_
    empty_customers = db.query(Customer).filter(
        or_(
            Customer.name == None,
            Customer.name == "",
            func.length(Customer.name) == 0,
            func.trim(Customer.name) == "",
            func.length(func.trim(Customer.name)) == 0,
            func.regexp_replace(Customer.name, r'[\s\u200b\u200c\u200d\ufeff\u00a0]', '', 'g') == "",
        )
    ).all()
    
    if not confirm:
        return {
            "success": True,
            "message": f"找到 {len(empty_customers)} 个空名字客户",
            "preview": [
                {"id": c.id, "customer_no": c.customer_no, "name": repr(c.name), "phone": c.phone, "create_time": str(c.create_time)}
                for c in empty_customers
            ],
            "hint": "设置 confirm=true 来执行删除"
        }
    
    if not empty_customers:
        return {"success": True, "message": "没有找到空名字的客户"}
    
    total_deleted = {
        "customers": 0,
        "customer_gold_deposit_transactions": 0,
        "customer_gold_deposits": 0,
        "gold_receipts": 0,
        "customer_withdrawals": 0,
        "account_receivables": 0,
        "sales_orders": 0,
        "settlement_orders": 0
    }
    deleted_ids = []
    
    for customer in empty_customers:
        cid = customer.id
        try:
            total_deleted["customer_gold_deposit_transactions"] += db.query(CustomerGoldDepositTransaction).filter(
                CustomerGoldDepositTransaction.customer_id == cid
            ).delete(synchronize_session=False)
            
            total_deleted["customer_gold_deposits"] += db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == cid
            ).delete(synchronize_session=False)
            
            total_deleted["gold_receipts"] += db.query(GoldReceipt).filter(
                GoldReceipt.customer_id == cid
            ).delete(synchronize_session=False)
            
            total_deleted["customer_withdrawals"] += db.query(CustomerWithdrawal).filter(
                CustomerWithdrawal.customer_id == cid
            ).delete(synchronize_session=False)
            
            total_deleted["account_receivables"] += db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == cid
            ).delete(synchronize_session=False)
            
            sales_order_ids = [so.id for so in db.query(SalesOrder).filter(
                SalesOrder.customer_id == cid
            ).all()]
            if sales_order_ids:
                total_deleted["settlement_orders"] += db.query(SettlementOrder).filter(
                    SettlementOrder.sales_order_id.in_(sales_order_ids)
                ).delete(synchronize_session=False)
            
            total_deleted["sales_orders"] += db.query(SalesOrder).filter(
                SalesOrder.customer_id == cid
            ).delete(synchronize_session=False)
            
            db.query(Customer).filter(Customer.id == cid).delete(synchronize_session=False)
            total_deleted["customers"] += 1
            deleted_ids.append(cid)
        except Exception as e:
            logger.error(f"[数据清理] 删除空客户 ID={cid} 失败: {e}")
            continue
    
    db.commit()
    logger.info(f"[数据清理] 清理空客户完成: 删除 {total_deleted['customers']} 个")
    
    return {
        "success": True,
        "message": f"已成功删除 {total_deleted['customers']} 个空名字客户及其关联数据",
        "deleted_ids": deleted_ids,
        "total_deleted": total_deleted
    }


@router.get("/api/cleanup/diagnose-customers")
async def diagnose_customers(
    role: str = Depends(require_permission("can_delete")),
    db: Session = Depends(get_db)
):
    """
    诊断客户表中 name 字段的存储情况，用于排查空客户清理失败的原因。
    使用原始 SQL 避免 ORM 层干扰。
    """
    raw_db_url = os.getenv("DATABASE_URL", "unknown")
    masked_url = raw_db_url[:20] + "***" + raw_db_url[-15:] if len(raw_db_url) > 40 else raw_db_url

    results = {}

    results["database_url_masked"] = masked_url

    row = db.execute(text("SELECT count(*) FROM customers WHERE status='active'")).fetchone()
    results["total_active"] = row[0]

    row = db.execute(text("SELECT count(*) FROM customers WHERE name IS NULL AND status='active'")).fetchone()
    results["name_is_null"] = row[0]

    row = db.execute(text("SELECT count(*) FROM customers WHERE name = '' AND status='active'")).fetchone()
    results["name_eq_empty_string"] = row[0]

    row = db.execute(text("SELECT count(*) FROM customers WHERE trim(name) = '' AND status='active'")).fetchone()
    results["name_trim_eq_empty"] = row[0]

    row = db.execute(text("SELECT count(*) FROM customers WHERE length(name) = 0 AND status='active'")).fetchone()
    results["name_length_zero"] = row[0]

    row = db.execute(text("SELECT count(*) FROM customers WHERE length(name) <= 2 AND status='active'")).fetchone()
    results["name_length_lte_2"] = row[0]

    samples = db.execute(text(
        "SELECT id, customer_no, name, length(name) as name_len, encode(name::bytea, 'hex') as name_hex "
        "FROM customers WHERE status='active' AND (name IS NULL OR length(trim(name)) <= 2) "
        "ORDER BY id DESC LIMIT 10"
    )).fetchall()

    results["samples"] = [
        {
            "id": s[0],
            "customer_no": s[1],
            "name_repr": repr(s[2]),
            "name_length": s[3],
            "name_hex": s[4],
        }
        for s in samples
    ]

    return {"success": True, "diagnosis": results}
