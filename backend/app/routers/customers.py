"""
客户管理路由
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from ..timezone_utils import china_now
from typing import Optional, List, Dict, Any
import logging

from ..database import get_db
from ..models import (
    Customer, SalesOrder, SalesOrderDetail, ReturnOrder,
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
            details = db.query(SalesOrderDetail).filter(
                SalesOrderDetail.order_id == order.id
            ).all()
            
            for detail in details:
                sales_list.append({
                    "id": detail.id,
                    "order_no": order.order_no,
                    "product_name": detail.product_name,
                    "weight": detail.weight,
                    "labor_cost": detail.labor_cost,
                    "total_amount": detail.total_price,
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
            ).order_by(desc(AccountReceivable.created_at)).first()
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
                "amount": order.total_amount,
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

