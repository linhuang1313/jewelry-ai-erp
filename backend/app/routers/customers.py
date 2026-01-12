"""
客户管理路由
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from ..timezone_utils import china_now
from typing import Optional
import logging

from ..database import get_db
from ..models import Customer, SalesOrder
from ..schemas import CustomerCreate, CustomerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/customers", tags=["客户管理"])


@router.post("")
async def create_customer(customer_data: CustomerCreate, db: Session = Depends(get_db)):
    """创建客户"""
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
async def get_customers(name: Optional[str] = None, db: Session = Depends(get_db)):
    """获取客户列表"""
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
async def get_customer(customer_id: int, db: Session = Depends(get_db)):
    """获取客户详情"""
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
async def update_customer(customer_id: int, data: CustomerCreate, db: Session = Depends(get_db)):
    """更新客户信息"""
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

