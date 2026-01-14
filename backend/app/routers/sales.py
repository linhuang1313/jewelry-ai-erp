"""
销售单管理路由
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging

from ..database import get_db
from ..models import SalesOrder, SalesDetail, Customer, Inventory
from ..schemas import SalesOrderCreate, SalesOrderResponse, SalesDetailResponse

logger = logging.getLogger(__name__)

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)

router = APIRouter(prefix="/api/sales", tags=["销售单管理"])


@router.post("/orders")
async def create_sales_order(order_data: SalesOrderCreate, db: Session = Depends(get_db)):
    """创建销售单"""
    try:
        # ==================== 数据验证 ====================
        # 验证商品明细数据
        for item in order_data.items:
            if item.weight <= 0:
                return {
                    "success": False,
                    "message": f"商品 {item.product_name} 的重量必须大于0",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "weight",
                        "value": item.weight
                    }
                }
            if item.labor_cost < 0:
                return {
                    "success": False,
                    "message": f"商品 {item.product_name} 的工费不能为负数",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "labor_cost",
                        "value": item.labor_cost
                    }
                }
        # ==================== 数据验证结束 ====================
        
        # ==================== 库存检查 ====================
        # 在创建客户之前先检查库存，避免创建了客户但销售单创建失败
        inventory_errors = []
        for item in order_data.items:
            # 查询库存（精确匹配商品名称）
            inventory = db.query(Inventory).filter(
                Inventory.product_name == item.product_name
            ).first()
            
            if not inventory:
                # 商品不存在于库存中
                inventory_errors.append({
                    "product_name": item.product_name,
                    "error": "商品不存在于库存中",
                    "required_weight": item.weight,
                    "available_weight": 0.0
                })
            else:
                # 计算可用库存：总库存 - 待结算销售单占用的库存
                # 查询该商品在待结算销售单中的总重量
                reserved_weight = db.query(func.sum(SalesDetail.weight)).join(
                    SalesOrder
                ).filter(
                    SalesDetail.product_name == item.product_name,
                    SalesOrder.status == "待结算"
                ).scalar() or 0.0
                
                available_weight = inventory.total_weight - reserved_weight
                
                if available_weight < item.weight:
                    # 库存不足（考虑待结算的销售单）
                    inventory_errors.append({
                        "product_name": item.product_name,
                        "error": "库存不足",
                        "required_weight": item.weight,
                        "available_weight": available_weight,
                        "total_weight": inventory.total_weight,
                        "reserved_weight": reserved_weight
                    })
        
        # 如果有任何商品库存不足，拒绝创建销售单
        if inventory_errors:
            return {
                "success": False,
                "message": "库存检查失败，无法创建销售单",
                "inventory_errors": inventory_errors
            }
        # ==================== 库存检查结束 ====================
        
        # 处理客户（在库存检查通过后）
        customer_id = order_data.customer_id
        customer_name = order_data.customer_name
        
        # 如果没有提供customer_id，尝试根据姓名查找
        if not customer_id:
            customer = db.query(Customer).filter(
                Customer.name == customer_name,
                Customer.status == "active"
            ).first()
            if customer:
                customer_id = customer.id
            else:
                # 客户不存在，自动创建
                customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_name,
                    customer_type="个人"
                )
                db.add(customer)
                db.flush()
                customer_id = customer.id
        
        # 计算总工费和总克重
        total_labor_cost = sum(item.labor_cost * item.weight for item in order_data.items)
        total_weight = sum(item.weight for item in order_data.items)
        
        # 生成销售单号（使用中国时间）
        order_no = f"XS{china_now().strftime('%Y%m%d%H%M%S')}"
        
        # 创建销售单
        sales_order = SalesOrder(
            order_no=order_no,
            order_date=order_data.order_date or datetime.now(),
            customer_id=customer_id,
            customer_name=customer_name,
            salesperson=order_data.salesperson,
            store_code=order_data.store_code,
            remark=order_data.remark,
            total_labor_cost=total_labor_cost,
            total_weight=total_weight,
            status="待结算"
        )
        db.add(sales_order)
        db.flush()
        
        # 创建销售明细
        details = []
        for item in order_data.items:
            detail = SalesDetail(
                order_id=sales_order.id,
                product_name=item.product_name,
                weight=item.weight,
                labor_cost=item.labor_cost,
                total_labor_cost=item.labor_cost * item.weight
            )
            db.add(detail)
            details.append(detail)
        
        # 更新客户统计信息
        if customer_id:
            customer = db.query(Customer).filter(Customer.id == customer_id).first()
            if customer:
                customer.total_purchase_amount += total_labor_cost
                customer.total_purchase_count += 1
                customer.last_purchase_time = sales_order.order_date
        
        db.commit()
        db.refresh(sales_order)
        for detail in details:
            db.refresh(detail)
        
        # 构建响应
        order_response = SalesOrderResponse.model_validate(sales_order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "message": f"销售单创建成功：{order_no}",
            "order": order_response.model_dump(mode='json')
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"创建销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建销售单失败: {str(e)}"
        }


@router.get("/orders")
async def get_sales_orders(
    customer_name: Optional[str] = None,
    salesperson: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取销售单列表"""
    try:
        query = db.query(SalesOrder)
        
        if customer_name:
            query = query.filter(SalesOrder.customer_name.contains(customer_name))
        if salesperson:
            query = query.filter(SalesOrder.salesperson == salesperson)
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                query = query.filter(SalesOrder.order_date >= start_dt)
            except:
                pass
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                query = query.filter(SalesOrder.order_date <= end_dt)
            except:
                pass
        
        orders = query.order_by(desc(SalesOrder.order_date)).limit(100).all()
        
        # 加载明细
        result = []
        for order in orders:
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            order_response = SalesOrderResponse.model_validate(order)
            order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
            result.append(order_response.model_dump(mode='json'))
        
        return {
            "success": True,
            "orders": result
        }
    except Exception as e:
        logger.error(f"查询销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询销售单失败: {str(e)}"
        }


@router.get("/orders/{order_id}")
async def get_sales_order(order_id: int, db: Session = Depends(get_db)):
    """获取销售单详情"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        
        if not order:
            return {
                "success": False,
                "message": "销售单不存在"
            }
        
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
        order_response = SalesOrderResponse.model_validate(order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "order": order_response.model_dump(mode='json')
        }
    except Exception as e:
        logger.error(f"查询销售单详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询销售单详情失败: {str(e)}"
        }

