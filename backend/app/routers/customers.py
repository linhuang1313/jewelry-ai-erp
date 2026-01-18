"""
客户管理路由
"""
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from ..timezone_utils import china_now
from typing import Optional, List, Dict, Any
import logging
import io
import csv
import time

from ..database import get_db
from ..models import (
    Customer, SalesOrder, SalesDetail, ReturnOrder,
    AccountReceivable, CustomerTransaction, CustomerGoldDeposit,
    CustomerGoldDepositTransaction
)
from ..schemas import CustomerCreate, CustomerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/customers", tags=["客户管理"])


@router.post("")
async def create_customer(
    customer_data: CustomerCreate,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """创建客户"""
    # 权限检查 - 需要 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限（创建/编辑/删除）")
    
    try:
        # 检查客户是否已存在
        existing = db.query(Customer).filter(
            Customer.name == customer_data.name,
            Customer.status == "active"
        ).first()
        
        if existing:
            return {
                "success": False,
                "message": f"客户 {customer_data.name} 已存在",
                "customer": CustomerResponse.model_validate(existing).model_dump(mode='json')
            }
        
        # 生成客户编号
        customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
        
        customer = Customer(
            customer_no=customer_no,
            **customer_data.model_dump()
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        
        return {
            "success": True,
            "message": f"客户创建成功：{customer.name}",
            "customer": CustomerResponse.model_validate(customer).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建客户失败: {str(e)}"
        }


@router.get("")
async def get_customers(
    name: Optional[str] = None,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户列表"""
    # 权限检查 - 需要 can_view_customers 或 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_view_customers') and not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看客户】的权限")
    
    try:
        query = db.query(Customer).filter(Customer.status == "active")
        
        if name:
            query = query.filter(Customer.name.contains(name))
        
        customers = query.order_by(desc(Customer.create_time)).all()
        
        return {
            "success": True,
            "customers": [CustomerResponse.model_validate(c).model_dump(mode='json') for c in customers]
        }
    except Exception as e:
        logger.error(f"查询客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询客户失败: {str(e)}"
        }


@router.get("/suggest-salesperson")
async def suggest_salesperson(customer_name: str, db: Session = Depends(get_db)):
    """根据客户名智能推荐业务员（基于历史销售记录）"""
    try:
        if not customer_name or not customer_name.strip():
            return {"success": True, "salesperson": None, "hint": "请输入客户名"}
        
        customer_name = customer_name.strip()
        
        # 查找该客户最近一次的销售单
        latest_order = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer_name,
            SalesOrder.status != "已取消"
        ).order_by(SalesOrder.create_time.desc()).first()
        
        if latest_order and latest_order.salesperson:
            last_date = latest_order.create_time.strftime('%Y-%m-%d') if latest_order.create_time else "未知"
            return {
                "success": True,
                "salesperson": latest_order.salesperson,
                "hint": f"已自动匹配业务员（上次服务：{last_date}）",
                "is_new_customer": False
            }
        
        # 如果没有历史记录，返回空
        return {
            "success": True,
            "salesperson": None,
            "hint": "新客户，请手动输入业务员",
            "is_new_customer": True
        }
    
    except Exception as e:
        logger.error(f"查询业务员推荐失败: {e}", exc_info=True)
        return {"success": False, "salesperson": None, "error": str(e)}


# ============= 客户欠款查询 API =============
# 注意：此路由必须在 /{customer_id} 之前定义，否则会被错误匹配

@router.get("/debt-summary")
async def get_customer_debt_summary(
    search: Optional[str] = Query(None, description="搜索客户名称"),
    sort_by: str = Query("total_debt", description="排序字段: cash_debt/gold_debt/total_debt/name"),
    sort_order: str = Query("desc", description="排序方向: asc/desc"),
    hide_zero: bool = Query(True, description="隐藏无欠款客户"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户欠款汇总列表
    
    返回所有客户的现金欠款和金料欠款情况，支持搜索和排序。
    业务员和结算专员都可以查询所有客户。
    """
    from ..middleware.permissions import has_permission
    # 业务员和结算专员都可以查询
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_query_customer_sales') or
        has_permission(user_role, 'can_create_settlement')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足：您没有查看客户欠款的权限")
    
    try:
        # 查询所有活跃客户
        query = db.query(Customer).filter(Customer.status == "active")
        
        if search:
            query = query.filter(Customer.name.contains(search))
        
        customers = query.all()
        
        # 构建欠款数据
        debt_list = []
        total_cash_debt = 0.0
        total_gold_debt = 0.0
        
        for customer in customers:
            # 现金欠款 - 从应收账款表汇总
            cash_debt = 0.0
            try:
                receivables = db.query(AccountReceivable).filter(
                    AccountReceivable.customer_id == customer.id,
                    AccountReceivable.status.in_(["unpaid", "overdue"])
                ).all()
                cash_debt = sum(r.unpaid_amount or 0 for r in receivables)
            except Exception as e:
                logger.warning(f"查询客户 {customer.id} 现金欠款出错: {e}")
            
            # 金料欠款 - 从客户往来账获取最新记录
            gold_debt = 0.0
            try:
                latest_tx = db.query(CustomerTransaction).filter(
                    CustomerTransaction.customer_id == customer.id,
                    CustomerTransaction.status == "active"
                ).order_by(desc(CustomerTransaction.created_at)).first()
                if latest_tx:
                    gold_debt = latest_tx.gold_due_after or 0.0
            except Exception as e:
                logger.warning(f"查询客户 {customer.id} 金料欠款出错: {e}")
            
            # 存料余额
            gold_deposit = 0.0
            try:
                deposit = db.query(CustomerGoldDeposit).filter(
                    CustomerGoldDeposit.customer_id == customer.id
                ).first()
                if deposit:
                    gold_deposit = deposit.current_balance or 0.0
            except Exception as e:
                logger.warning(f"查询客户 {customer.id} 存料余额出错: {e}")
            
            # 最后交易时间
            last_transaction_date = None
            try:
                last_order = db.query(SalesOrder).filter(
                    SalesOrder.customer_name == customer.name
                ).order_by(desc(SalesOrder.create_time)).first()
                if last_order and last_order.create_time:
                    last_transaction_date = last_order.create_time.strftime("%Y-%m-%d")
            except Exception as e:
                logger.warning(f"查询客户 {customer.id} 最后交易时间出错: {e}")
            
            # 如果隐藏无欠款客户
            if hide_zero and cash_debt <= 0 and gold_debt <= 0:
                continue
            
            debt_list.append({
                "customer_id": customer.id,
                "customer_no": customer.customer_no,
                "customer_name": customer.name,
                "phone": customer.phone,
                "cash_debt": round(cash_debt, 2),
                "gold_debt": round(gold_debt, 3),
                "gold_deposit": round(gold_deposit, 3),
                "total_debt": round(cash_debt, 2),  # 用于排序（现金欠款）
                "last_transaction_date": last_transaction_date
            })
            
            total_cash_debt += cash_debt
            total_gold_debt += gold_debt
        
        # 排序
        reverse = sort_order == "desc"
        if sort_by == "cash_debt":
            debt_list.sort(key=lambda x: x["cash_debt"], reverse=reverse)
        elif sort_by == "gold_debt":
            debt_list.sort(key=lambda x: x["gold_debt"], reverse=reverse)
        elif sort_by == "name":
            debt_list.sort(key=lambda x: x["customer_name"], reverse=reverse)
        else:  # total_debt
            debt_list.sort(key=lambda x: (x["cash_debt"], x["gold_debt"]), reverse=reverse)
        
        # 分页
        total = len(debt_list)
        debt_list = debt_list[skip:skip + limit]
        
        return {
            "success": True,
            "items": debt_list,
            "total": total,
            "summary": {
                "total_cash_debt": round(total_cash_debt, 2),
                "total_gold_debt": round(total_gold_debt, 3),
                "customer_count": total
            }
        }
        
    except Exception as e:
        logger.error(f"查询客户欠款汇总失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询失败: {str(e)}",
            "items": [],
            "total": 0
        }


@router.get("/{customer_id}")
async def get_customer(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户详情"""
    # 权限检查 - 需要 can_view_customers 或 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_view_customers') and not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看客户】的权限")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        
        if not customer:
            return {
                "success": False,
                "message": "客户不存在"
            }
        
        return {
            "success": True,
            "customer": CustomerResponse.model_validate(customer).model_dump(mode='json')
        }
    except Exception as e:
        logger.error(f"查询客户详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询客户详情失败: {str(e)}"
        }


@router.put("/{customer_id}")
async def update_customer(
    customer_id: int,
    data: CustomerCreate,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """更新客户信息"""
    # 权限检查 - 需要 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限（创建/编辑/删除）")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        # 更新字段
        if data.name:
            customer.name = data.name
        if data.phone is not None:
            customer.phone = data.phone
        if data.wechat is not None:
            customer.wechat = data.wechat
        if data.address is not None:
            customer.address = data.address
        if data.remark is not None:
            customer.remark = data.remark
        
        db.commit()
        db.refresh(customer)
        
        return {
            "success": True,
            "message": f"客户【{customer.name}】信息已更新",
            "customer": CustomerResponse.model_validate(customer).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新客户失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """删除客户（软删除）"""
    # 权限检查 - 只有管理层可以删除
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_delete'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【删除数据】的权限")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        customer.status = "inactive"
        db.commit()
        
        return {
            "success": True,
            "message": f"客户【{customer.name}】已删除"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"删除客户失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/{customer_id}/detail")
async def get_customer_detail(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户详情（销售记录、退货记录、欠款/存料余额、往来账目）
    业务员角色可以查看客户的完整往来信息
    """
    # 权限检查 - 需要查看客户或查询客户销售权限
    from ..middleware.permissions import has_permission
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_manage_customers') or
        has_permission(user_role, 'can_query_customer_sales')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足：您没有查看客户详情的权限")
    
    try:
        # 获取客户基本信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        # 获取销售记录
        sales_orders = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.status != "已取消"
        ).order_by(desc(SalesOrder.create_time)).limit(50).all()
        
        sales_list = []
        for order in sales_orders:
            # 获取销售单明细
            details = db.query(SalesDetail).filter(
                SalesDetail.order_id == order.id
            ).all()
            
            for detail in details:
                sales_list.append({
                    "id": detail.id,
                    "order_no": order.order_no,
                    "product_name": detail.product_name,
                    "weight": detail.weight,
                    "labor_cost": detail.labor_cost,
                    "total_amount": detail.total_labor_cost,  # 使用 total_labor_cost 字段
                    "status": order.status,
                    "created_at": order.create_time.isoformat() if order.create_time else None
                })
        
        # 获取退货记录（客户相关的退货，通常是从展厅退回的）
        # 注意：这里假设有客户相关的退货逻辑，如果没有则返回空列表
        returns_list = []
        try:
            # 查询与客户关联的销售单的退货
            for order in sales_orders:
                related_returns = db.query(ReturnOrder).filter(
                    ReturnOrder.remark.contains(order.order_no) if hasattr(ReturnOrder, 'remark') else False
                ).all()
                for ret in related_returns:
                    returns_list.append({
                        "id": ret.id,
                        "return_no": ret.return_no,
                        "product_name": ret.product_name,
                        "return_weight": ret.return_weight,
                        "return_reason": ret.return_reason or "未知",
                        "status": ret.status,
                        "created_at": ret.created_at.isoformat() if ret.created_at else None
                    })
        except Exception as e:
            logger.warning(f"查询客户退货记录时出错: {e}")
            returns_list = []
        
        # 获取欠款/存料余额
        # 现金欠款 - 从应收账款表获取
        cash_debt = 0.0
        try:
            latest_receivable = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id
            ).order_by(desc(AccountReceivable.credit_start_date)).first()
            if latest_receivable:
                cash_debt = latest_receivable.closing_balance or 0.0
        except Exception as e:
            logger.warning(f"查询现金欠款时出错: {e}")
        
        # 金料欠款 - 从客户交易记录获取
        gold_debt = 0.0
        try:
            latest_transaction = db.query(CustomerTransaction).filter(
                CustomerTransaction.customer_id == customer_id
            ).order_by(desc(CustomerTransaction.created_at)).first()
            if latest_transaction:
                gold_debt = latest_transaction.gold_due_after or 0.0
        except Exception as e:
            logger.warning(f"查询金料欠款时出错: {e}")
        
        # 存料余额
        gold_deposit = 0.0
        try:
            deposit_record = db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == customer_id
            ).first()
            if deposit_record:
                gold_deposit = deposit_record.current_balance or 0.0
        except Exception as e:
            logger.warning(f"查询存料余额时出错: {e}")
        
        balance = {
            "cash_debt": cash_debt,
            "gold_debt": gold_debt,
            "gold_deposit": gold_deposit
        }
        
        # 获取往来账目
        transactions_list = []
        
        # 销售交易
        for order in sales_orders[:20]:  # 限制数量
            transactions_list.append({
                "id": order.id,
                "type": "sale",
                "description": f"销售：{order.order_no}",
                "amount": order.total_labor_cost,
                "gold_weight": None,
                "created_at": order.create_time.isoformat() if order.create_time else None
            })
        
        # 金料存取记录
        try:
            deposit_transactions = db.query(CustomerGoldDepositTransaction).filter(
                CustomerGoldDepositTransaction.customer_id == customer_id
            ).order_by(desc(CustomerGoldDepositTransaction.created_at)).limit(20).all()
            
            for tx in deposit_transactions:
                tx_type = "gold_receipt" if tx.transaction_type == "deposit" else "gold_receipt"
                amount_sign = 1 if tx.transaction_type == "deposit" else -1
                transactions_list.append({
                    "id": tx.id,
                    "type": tx_type,
                    "description": tx.remark or f"金料{tx.transaction_type}",
                    "amount": None,
                    "gold_weight": tx.amount * amount_sign if tx.amount else 0,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None
                })
        except Exception as e:
            logger.warning(f"查询金料交易记录时出错: {e}")
        
        # 按时间排序
        transactions_list.sort(key=lambda x: x["created_at"] or "", reverse=True)
        
        return {
            "success": True,
            "detail": {
                "customer": CustomerResponse.model_validate(customer).model_dump(mode='json'),
                "sales": sales_list,
                "returns": returns_list,
                "balance": balance,
                "transactions": transactions_list[:30]  # 限制返回数量
            }
        }
    except Exception as e:
        logger.error(f"查询客户详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询客户详情失败: {str(e)}"
        }


@router.post("/batch-import")
async def batch_import_customers(
    file: UploadFile = File(...),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    批量导入客户（支持2000+条数据）
    支持格式：
    1. Excel (.xlsx, .xls) - 第一列必须是姓名，其他列可选（电话、微信、地址、类型、备注）
    2. CSV (.csv) - 第一列必须是姓名，其他列可选
    3. 纯文本 (.txt) - 每行一个姓名
    """
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限")
    
    results = {
        "success": True,
        "total": 0,
        "created": 0,
        "skipped": 0,
        "errors": [],
        "details": []
    }
    
    try:
        # 读取文件内容
        content = await file.read()
        file_extension = file.filename.split('.')[-1].lower() if '.' in file.filename else ''
        
        customers_data = []
        
        if file_extension in ['xlsx', 'xls']:
            # Excel 文件处理
            try:
                from openpyxl import load_workbook
                wb = load_workbook(io.BytesIO(content), read_only=True)
                ws = wb.active
                
                # 跳过表头（第一行）
                for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                    if row and row[0]:
                        name = str(row[0]).strip()
                        if name:
                            customers_data.append({
                                "name": name,
                                "phone": str(row[1]).strip() if len(row) > 1 and row[1] else None,
                                "wechat": str(row[2]).strip() if len(row) > 2 and row[2] else None,
                                "address": str(row[3]).strip() if len(row) > 3 and row[3] else None,
                                "customer_type": str(row[4]).strip() if len(row) > 4 and row[4] else "个人",
                                "remark": str(row[5]).strip() if len(row) > 5 and row[5] else None,
                            })
                wb.close()
            except Exception as e:
                error_msg = str(e).lower()
                # 检测是否是 .xls 格式导致的错误
                if "zip file" in error_msg or "not a zip file" in error_msg or file_extension == 'xls':
                    return {
                        "success": False,
                        "message": "不支持旧版 Excel (.xls) 格式，请将文件另存为 .xlsx 格式或转换为 CSV 格式后重试"
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Excel 文件解析失败: {str(e)[:200]}\n\n提示：请确保文件格式正确，或尝试转换为 CSV 格式上传"
                    }
        
        elif file_extension == 'csv':
            # CSV 文件处理
            try:
                content_str = content.decode('utf-8-sig')  # 处理 BOM
            except:
                try:
                    content_str = content.decode('gbk')  # 尝试 GBK 编码
                except:
                    content_str = content.decode('utf-8', errors='ignore')
            
            csv_reader = csv.reader(io.StringIO(content_str))
            
            # 跳过表头
            next(csv_reader, None)
            
            for row in csv_reader:
                if row and row[0]:
                    name = str(row[0]).strip()
                    if name:
                        customers_data.append({
                            "name": name,
                            "phone": row[1].strip() if len(row) > 1 and row[1] else None,
                            "wechat": row[2].strip() if len(row) > 2 and row[2] else None,
                            "address": row[3].strip() if len(row) > 3 and row[3] else None,
                            "customer_type": row[4].strip() if len(row) > 4 and row[4] else "个人",
                            "remark": row[5].strip() if len(row) > 5 and row[5] else None,
                        })
        
        elif file_extension == 'txt':
            # 纯文本文件（每行一个姓名）
            try:
                content_str = content.decode('utf-8')
            except:
                try:
                    content_str = content.decode('gbk')
                except:
                    content_str = content.decode('utf-8', errors='ignore')
            
            for line in content_str.split('\n'):
                name = line.strip()
                if name:
                    customers_data.append({
                        "name": name,
                        "phone": None,
                        "wechat": None,
                        "address": None,
                        "customer_type": "个人",
                        "remark": None,
                    })
        else:
            return {
                "success": False,
                "message": f"不支持的文件格式：{file_extension}。支持格式：.xlsx, .xls, .csv, .txt"
            }
        
        results["total"] = len(customers_data)
        
        if results["total"] == 0:
            return {
                "success": False,
                "message": "文件中没有找到有效的客户数据"
            }
        
        # 批量创建客户（性能优化：批量提交）
        start_time = time.time()
        batch_size = 100  # 每100条提交一次
        
        # 先批量查询已存在的客户（避免重复查询）
        existing_names = set()
        existing_customers = db.query(Customer.name).filter(
            Customer.status == "active"
        ).all()
        existing_names = {c[0] for c in existing_customers}
        
        for idx, customer_data in enumerate(customers_data, 1):
            try:
                # 检查是否已存在
                if customer_data["name"] in existing_names:
                    results["skipped"] += 1
                    if idx <= 10:  # 只记录前10个跳过的详情
                        results["details"].append({
                            "row": idx,
                            "name": customer_data["name"],
                            "status": "skipped",
                            "message": "客户已存在"
                        })
                    continue
                
                # 生成客户编号（使用时间戳+序号，确保唯一）
                timestamp = china_now().strftime('%Y%m%d%H%M%S')
                customer_no = f"KH{timestamp}{idx:06d}"
                
                # 创建客户对象
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_data["name"],
                    phone=customer_data.get("phone"),
                    wechat=customer_data.get("wechat"),
                    address=customer_data.get("address"),
                    customer_type=customer_data.get("customer_type", "个人"),
                    remark=customer_data.get("remark"),
                    status="active"
                )
                db.add(customer)
                existing_names.add(customer_data["name"])  # 添加到已存在集合
                results["created"] += 1
                
                # 每 batch_size 条提交一次（提高性能）
                if idx % batch_size == 0:
                    db.commit()
                    logger.info(f"已导入 {idx}/{results['total']} 条客户数据")
                
                # 只记录前10个成功的详情
                if results["created"] <= 10:
                    results["details"].append({
                        "row": idx,
                        "name": customer_data["name"],
                        "status": "created",
                        "customer_no": customer_no
                    })
                    
            except Exception as e:
                results["errors"].append({
                    "row": idx,
                    "name": customer_data.get("name", "未知"),
                    "error": str(e)[:100]  # 限制错误信息长度
                })
                logger.error(f"导入第 {idx} 行失败: {e}")
                # 如果错误太多，停止导入
                if len(results["errors"]) > 100:
                    db.rollback()
                    return {
                        "success": False,
                        "message": f"导入过程中错误过多（超过100个），已停止导入。已成功导入 {results['created']} 条",
                        "results": results
                    }
        
        # 最终提交
        db.commit()
        
        elapsed_time = time.time() - start_time
        results["message"] = f"导入完成！成功创建 {results['created']} 个客户，跳过 {results['skipped']} 个已存在客户"
        if results["errors"]:
            results["message"] += f"，失败 {len(results['errors'])} 个"
        results["message"] += f"。耗时 {elapsed_time:.2f} 秒"
        results["elapsed_time"] = elapsed_time
        
        return results
        
    except Exception as e:
        db.rollback()
        logger.error(f"批量导入客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"批量导入失败: {str(e)}",
            "results": results
        }


@router.get("/{customer_id}/debt-history")
async def get_customer_debt_history(
    customer_id: int,
    limit: int = Query(50, ge=1, le=200),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户欠款交易历史
    
    返回该客户的所有交易记录，包括销售、结算、收款、金料收付等。
    """
    from ..middleware.permissions import has_permission
    from ..models import SettlementOrder, PaymentRecord
    
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_query_customer_sales') or
        has_permission(user_role, 'can_create_settlement')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足")
    
    try:
        # 获取客户信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        transactions = []
        
        # 1. 销售记录
        sales_orders = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.status != "已取消"
        ).order_by(desc(SalesOrder.create_time)).limit(limit).all()
        
        for order in sales_orders:
            transactions.append({
                "id": f"sale_{order.id}",
                "type": "sale",
                "type_label": "销售",
                "order_no": order.order_no,
                "description": f"销售单 {order.order_no}",
                "cash_amount": order.total_labor_cost or 0,
                "gold_amount": order.total_weight or 0,
                "status": order.status,
                "created_at": order.create_time.isoformat() if order.create_time else None,
                "operator": order.salesperson
            })
        
        # 2. 结算记录
        try:
            for order in sales_orders:
                settlements = db.query(SettlementOrder).filter(
                    SettlementOrder.sales_order_id == order.id
                ).all()
                for s in settlements:
                    payment_method_label = {
                        "cash_price": "结价",
                        "physical_gold": "结料",
                        "mixed": "混合支付"
                    }.get(s.payment_method, s.payment_method)
                    
                    transactions.append({
                        "id": f"settlement_{s.id}",
                        "type": "settlement",
                        "type_label": "结算",
                        "order_no": s.settlement_no,
                        "description": f"结算单 {s.settlement_no}（{payment_method_label}）",
                        "cash_amount": s.total_amount or 0,
                        "gold_amount": s.physical_gold_weight or 0,
                        "status": s.status,
                        "created_at": s.created_at.isoformat() if s.created_at else None,
                        "operator": s.created_by
                    })
        except Exception as e:
            logger.warning(f"查询结算记录出错: {e}")
        
        # 3. 收款记录
        try:
            payments = db.query(PaymentRecord).filter(
                PaymentRecord.customer_id == customer_id
            ).order_by(desc(PaymentRecord.create_time)).limit(limit).all()
            
            for p in payments:
                transactions.append({
                    "id": f"payment_{p.id}",
                    "type": "payment",
                    "type_label": "收款",
                    "order_no": f"PY{p.id:06d}",
                    "description": f"收款 ¥{p.amount:.2f}",
                    "cash_amount": -(p.amount or 0),  # 负数表示减少欠款
                    "gold_amount": 0,
                    "status": "completed",
                    "created_at": p.create_time.isoformat() if p.create_time else None,
                    "operator": p.operator
                })
        except Exception as e:
            logger.warning(f"查询收款记录出错: {e}")
        
        # 4. 金料存取记录
        try:
            gold_txs = db.query(CustomerGoldDepositTransaction).filter(
                CustomerGoldDepositTransaction.customer_id == customer_id
            ).order_by(desc(CustomerGoldDepositTransaction.created_at)).limit(limit).all()
            
            for tx in gold_txs:
                tx_type_label = {
                    "deposit": "存料",
                    "use": "用料",
                    "refund": "退料"
                }.get(tx.transaction_type, tx.transaction_type)
                
                amount = tx.amount or 0
                if tx.transaction_type == "use":
                    amount = -amount  # 用料为负数
                
                transactions.append({
                    "id": f"gold_deposit_{tx.id}",
                    "type": "gold_deposit",
                    "type_label": tx_type_label,
                    "order_no": f"GD{tx.id:06d}",
                    "description": tx.remark or f"金料{tx_type_label} {abs(tx.amount):.2f}克",
                    "cash_amount": 0,
                    "gold_amount": amount,
                    "status": tx.status,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                    "operator": tx.created_by
                })
        except Exception as e:
            logger.warning(f"查询金料交易记录出错: {e}")
        
        # 5. 客户往来账记录
        try:
            customer_txs = db.query(CustomerTransaction).filter(
                CustomerTransaction.customer_id == customer_id,
                CustomerTransaction.status == "active"
            ).order_by(desc(CustomerTransaction.created_at)).limit(limit).all()
            
            for tx in customer_txs:
                tx_type_label = {
                    "sales": "销售",
                    "settlement": "结算",
                    "gold_receipt": "收料",
                    "payment": "付款"
                }.get(tx.transaction_type, tx.transaction_type)
                
                transactions.append({
                    "id": f"tx_{tx.id}",
                    "type": "transaction",
                    "type_label": tx_type_label,
                    "order_no": f"TX{tx.id:06d}",
                    "description": tx.remark or f"往来账：{tx_type_label}",
                    "cash_amount": tx.amount or 0,
                    "gold_amount": tx.gold_weight or 0,
                    "gold_debt_before": tx.gold_due_before or 0,
                    "gold_debt_after": tx.gold_due_after or 0,
                    "status": tx.status,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                    "operator": None
                })
        except Exception as e:
            logger.warning(f"查询往来账记录出错: {e}")
        
        # 按时间排序（去重）
        seen_ids = set()
        unique_transactions = []
        for tx in transactions:
            if tx["id"] not in seen_ids:
                seen_ids.add(tx["id"])
                unique_transactions.append(tx)
        
        unique_transactions.sort(key=lambda x: x["created_at"] or "", reverse=True)
        
        # 获取当前欠款余额
        current_balance = {
            "cash_debt": 0.0,
            "gold_debt": 0.0,
            "gold_deposit": 0.0
        }
        
        try:
            receivables = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id,
                AccountReceivable.status.in_(["unpaid", "overdue"])
            ).all()
            current_balance["cash_debt"] = sum(r.unpaid_amount or 0 for r in receivables)
        except:
            pass
        
        try:
            latest_tx = db.query(CustomerTransaction).filter(
                CustomerTransaction.customer_id == customer_id,
                CustomerTransaction.status == "active"
            ).order_by(desc(CustomerTransaction.created_at)).first()
            if latest_tx:
                current_balance["gold_debt"] = latest_tx.gold_due_after or 0
        except:
            pass
        
        try:
            deposit = db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == customer_id
            ).first()
            if deposit:
                current_balance["gold_deposit"] = deposit.current_balance or 0
        except:
            pass
        
        return {
            "success": True,
            "customer": {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "customer_no": customer.customer_no
            },
            "current_balance": current_balance,
            "transactions": unique_transactions[:limit]
        }
        
    except Exception as e:
        logger.error(f"查询客户欠款历史失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询失败: {str(e)}"
        }


@router.get("/chat-debt-query")
async def chat_debt_query(
    customer_name: str = Query(..., description="客户名称（支持模糊匹配）"),
    query_type: str = Query(default="all", description="查询类型：all/cash_debt/gold_debt/gold_deposit"),
    date_start: Optional[str] = Query(default=None, description="开始日期 YYYY-MM-DD"),
    date_end: Optional[str] = Query(default=None, description="结束日期 YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    聊天查询客户账务（供AI聊天使用）
    返回客户的欠款、欠料、存料等财务信息
    """
    try:
        # 1. 通过名称模糊查找客户
        customer = db.query(Customer).filter(
            Customer.name.contains(customer_name),
            Customer.status == "active"
        ).first()
        
        if not customer:
            # 尝试精确匹配
            customer = db.query(Customer).filter(
                Customer.name == customer_name,
                Customer.status == "active"
            ).first()
        
        if not customer:
            return {
                "success": False,
                "message": f"未找到客户：{customer_name}",
                "customer_name": customer_name
            }
        
        customer_id = customer.id
        
        # 2. 解析日期范围
        start_date = None
        end_date = None
        if date_start:
            try:
                start_date = datetime.strptime(date_start, "%Y-%m-%d")
            except:
                pass
        if date_end:
            try:
                end_date = datetime.strptime(date_end, "%Y-%m-%d")
                # 设置为当天结束时间
                end_date = end_date.replace(hour=23, minute=59, second=59)
            except:
                pass
        
        result = {
            "success": True,
            "customer": {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "customer_no": customer.customer_no
            },
            "query_period": {
                "start": date_start,
                "end": date_end
            }
        }
        
        # 3. 查询现金欠款
        if query_type in ["all", "cash_debt"]:
            cash_debt = 0.0
            cash_transactions = []
            try:
                receivables_query = db.query(AccountReceivable).filter(
                    AccountReceivable.customer_id == customer_id,
                    AccountReceivable.status.in_(["unpaid", "overdue"])
                )
                
                if start_date:
                    receivables_query = receivables_query.filter(
                        AccountReceivable.credit_start_date >= start_date.date()
                    )
                if end_date:
                    receivables_query = receivables_query.filter(
                        AccountReceivable.credit_start_date <= end_date.date()
                    )
                
                receivables = receivables_query.all()
                cash_debt = sum(r.unpaid_amount or 0 for r in receivables)
                
                for r in receivables[:20]:
                    cash_transactions.append({
                        "id": r.id,
                        "type": "receivable",
                        "description": f"应收账款（销售单ID: {r.sales_order_id}）",
                        "total_amount": r.total_amount,
                        "received_amount": r.received_amount,
                        "unpaid_amount": r.unpaid_amount,
                        "due_date": r.due_date.isoformat() if r.due_date else None,
                        "status": r.status,
                        "created_at": r.credit_start_date.isoformat() if r.credit_start_date else None
                    })
            except Exception as e:
                logger.warning(f"查询现金欠款出错: {e}")
            
            result["cash_debt"] = cash_debt
            result["cash_transactions"] = cash_transactions
        
        # 4. 查询金料欠款
        if query_type in ["all", "gold_debt"]:
            gold_debt = 0.0
            gold_transactions = []
            try:
                tx_query = db.query(CustomerTransaction).filter(
                    CustomerTransaction.customer_id == customer_id
                )
                
                if start_date:
                    tx_query = tx_query.filter(CustomerTransaction.created_at >= start_date)
                if end_date:
                    tx_query = tx_query.filter(CustomerTransaction.created_at <= end_date)
                
                transactions = tx_query.order_by(desc(CustomerTransaction.created_at)).limit(50).all()
                
                # 获取最新的金料欠款余额
                if transactions:
                    gold_debt = transactions[0].gold_due_after or 0
                
                for tx in transactions[:20]:
                    tx_type_label = {
                        "sales": "销售",
                        "settlement": "结算",
                        "gold_receipt": "收料",
                        "payment": "付款"
                    }.get(tx.transaction_type, tx.transaction_type)
                    
                    gold_transactions.append({
                        "id": tx.id,
                        "type": tx.transaction_type,
                        "type_label": tx_type_label,
                        "amount": tx.amount,
                        "gold_weight": tx.gold_weight,
                        "gold_due_before": tx.gold_due_before,
                        "gold_due_after": tx.gold_due_after,
                        "remark": tx.remark,
                        "created_at": tx.created_at.isoformat() if tx.created_at else None
                    })
            except Exception as e:
                logger.warning(f"查询金料欠款出错: {e}")
            
            result["gold_debt"] = gold_debt
            result["gold_transactions"] = gold_transactions
        
        # 5. 查询存料余额
        if query_type in ["all", "gold_deposit"]:
            gold_deposit = 0.0
            deposit_transactions = []
            try:
                deposit = db.query(CustomerGoldDeposit).filter(
                    CustomerGoldDeposit.customer_id == customer_id
                ).first()
                
                if deposit:
                    gold_deposit = deposit.current_balance or 0
                
                # 查询存料交易记录
                dep_tx_query = db.query(CustomerGoldDepositTransaction).filter(
                    CustomerGoldDepositTransaction.customer_id == customer_id,
                    CustomerGoldDepositTransaction.status == "active"
                )
                
                if start_date:
                    dep_tx_query = dep_tx_query.filter(CustomerGoldDepositTransaction.created_at >= start_date)
                if end_date:
                    dep_tx_query = dep_tx_query.filter(CustomerGoldDepositTransaction.created_at <= end_date)
                
                dep_txs = dep_tx_query.order_by(desc(CustomerGoldDepositTransaction.created_at)).limit(20).all()
                
                for tx in dep_txs:
                    tx_type_label = {
                        "deposit": "存入",
                        "use": "使用",
                        "refund": "退还"
                    }.get(tx.transaction_type, tx.transaction_type)
                    
                    deposit_transactions.append({
                        "id": tx.id,
                        "type": tx.transaction_type,
                        "type_label": tx_type_label,
                        "amount": tx.amount,
                        "balance_before": tx.balance_before,
                        "balance_after": tx.balance_after,
                        "remark": tx.remark,
                        "created_at": tx.created_at.isoformat() if tx.created_at else None
                    })
            except Exception as e:
                logger.warning(f"查询存料余额出错: {e}")
            
            result["gold_deposit"] = gold_deposit
            result["deposit_transactions"] = deposit_transactions
        
        return result
        
    except Exception as e:
        logger.error(f"聊天查询客户账务失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询失败: {str(e)}"
        }
