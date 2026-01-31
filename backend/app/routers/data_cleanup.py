"""
数据清理工具 - 用于清理测试数据
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import (
    Customer, SalesOrder, CustomerGoldDeposit, CustomerGoldDepositTransaction,
    CustomerWithdrawal, CustomerTransfer, SettlementOrder
)
from ..models.finance import GoldReceipt, AccountReceivable
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["数据清理"])


@router.get("/api/cleanup/preview")
async def preview_cleanup(
    customer_name: str = Query(..., description="要清理的客户名称（支持模糊匹配）"),
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
    db: Session = Depends(get_db)
):
    """
    批量清理所有测试客户数据
    """
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
