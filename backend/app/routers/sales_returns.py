"""
销退管理路由 - 客户退货模块
流程：销退单（确认后恢复库存）→ 销退结算单（确认后退款到客户账户）
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging

from ..database import get_db
from ..models import (
    SalesReturnOrder, SalesReturnDetail, SalesReturnSettlement,
    SalesOrder, SalesDetail, SettlementOrder,
    Customer, Inventory, LocationInventory, Location, OrderStatusLog,
    CustomerGoldDeposit, CustomerGoldDepositTransaction, CustomerTransaction
)
from ..schemas import SalesReturnOrderCreate, SalesReturnSettlementCreate
from ..middleware.permissions import has_permission, check_permission
from ..timezone_utils import china_now
from ..utils.response import success_response, error_response
from ..dependencies.auth import get_current_role, require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sales-returns", tags=["销退管理"])


# ============= 客户可退库存 =============

@router.get("/customer-inventory/{customer_id}")
async def get_customer_inventory(
    customer_id: int,
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户可退库存 = 已结算购买量 - 已有销退量"""
    if not has_permission(user_role, 'can_sales_return'):
        raise HTTPException(status_code=403, detail="权限不足")
    # 1. 查询该客户所有已结算的销售单（有 confirmed/printed 状态的结算单）
    settled_order_ids = db.query(SettlementOrder.sales_order_id).filter(
        SettlementOrder.status.in_(["confirmed", "printed"])
    ).subquery()
    
    settled_sales_orders = db.query(SalesOrder).filter(
        SalesOrder.customer_id == customer_id,
        SalesOrder.id.in_(settled_order_ids)
    ).all()
    
    # 2. 汇总 SalesDetail 按 product_name 分组
    purchased = {}  # key: product_name -> {weight, labor_cost, piece_count, product_code}
    for order in settled_sales_orders:
        for detail in order.details:
            name = detail.product_name
            code = getattr(detail, 'product_code', None) or ''
            if name not in purchased:
                purchased[name] = {
                    'product_name': name,
                    'product_code': code,
                    'total_purchased_weight': 0.0,
                    'total_labor_cost': 0.0,
                    'piece_count': 0,
                }
            purchased[name]['total_purchased_weight'] += float(detail.weight or 0)
            purchased[name]['total_labor_cost'] += float(detail.total_labor_cost or 0)
            purchased[name]['piece_count'] += int(detail.piece_count or 0)
            # 优先使用有值的 product_code
            if code and not purchased[name]['product_code']:
                purchased[name]['product_code'] = code
    
    # 3. 查询该客户已有的销退单（非 cancelled 状态），按 product_name 汇总已退克重
    existing_returns = db.query(SalesReturnOrder).filter(
        SalesReturnOrder.customer_id == customer_id,
        SalesReturnOrder.status != "cancelled"
    ).all()
    
    returned = {}  # key: product_name -> total_weight
    for ret_order in existing_returns:
        for detail in ret_order.details:
            name = detail.product_name
            if name not in returned:
                returned[name] = 0.0
            returned[name] += float(detail.weight or 0)
    
    # 4. 计算可退库存
    items = []
    for name, data in purchased.items():
        returned_weight = returned.get(name, 0.0)
        available = round(data['total_purchased_weight'] - returned_weight, 3)
        if available > 0:
            items.append({
                'product_name': name,
                'product_code': data['product_code'],
                'total_purchased_weight': round(data['total_purchased_weight'], 3),
                'total_returned_weight': round(returned_weight, 3),
                'available_weight': available,
                'total_labor_cost': round(data['total_labor_cost'], 2),
                'piece_count': data['piece_count'],
            })
    
    return success_response(data={"items": items})


# ============= 销退单 CRUD =============

@router.post("/orders")
async def create_sales_return_order(
    order_data: SalesReturnOrderCreate,
    user_role: str = Query(default="sales", description="用户角色"),
    created_by: str = Query(default="系统管理员", description="创建人"),
    db: Session = Depends(get_db)
):
    """创建销退单"""
    try:
        # 权限检查
        if not has_permission(user_role, 'can_sales_return'):
            return error_response(message="权限不足：您没有【销退管理】的权限")

        # ==================== 数据验证 ====================
        if not order_data.items:
            return error_response(message="销退单必须包含至少一项商品明细")

        for item in order_data.items:
            if item.weight <= 0:
                return error_response(
                    message=f"商品 {item.product_name} 的重量必须大于0",
                    data={
                        "validation_error": {
                            "product_name": item.product_name,
                            "field": "weight",
                            "value": item.weight
                        }
                    }
                )
            if item.labor_cost < 0:
                return error_response(
                    message=f"商品 {item.product_name} 的工费不能为负数",
                    data={
                        "validation_error": {
                            "product_name": item.product_name,
                            "field": "labor_cost",
                            "value": item.labor_cost
                        }
                    }
                )
        # ==================== 数据验证结束 ====================

        # ==================== 客户可退库存校验 ====================
        # 先确定 customer_id
        customer_id = order_data.customer_id
        customer_name = order_data.customer_name

        if not customer_id:
            customer = db.query(Customer).filter(
                Customer.name == customer_name,
                Customer.status == "active"
            ).first()
            if customer:
                customer_id = customer.id

        if customer_id:
            # 查询已结算的销售单
            settled_order_ids = db.query(SettlementOrder.sales_order_id).filter(
                SettlementOrder.status.in_(["confirmed", "printed"])
            ).subquery()
            
            settled_sales_orders = db.query(SalesOrder).filter(
                SalesOrder.customer_id == customer_id,
                SalesOrder.id.in_(settled_order_ids)
            ).all()
            
            # 汇总购买量
            purchased = {}
            for so in settled_sales_orders:
                for d in so.details:
                    name = d.product_name
                    if name not in purchased:
                        purchased[name] = 0.0
                    purchased[name] += float(d.weight or 0)
            
            # 汇总已退量（排除当前创建中的单据，只看已存在的非cancelled销退单）
            existing_returns = db.query(SalesReturnOrder).filter(
                SalesReturnOrder.customer_id == customer_id,
                SalesReturnOrder.status != "cancelled"
            ).all()
            
            returned = {}
            for ret_order in existing_returns:
                for d in ret_order.details:
                    name = d.product_name
                    if name not in returned:
                        returned[name] = 0.0
                    returned[name] += float(d.weight or 0)
            
            # 校验每一项
            errors = []
            for item in order_data.items:
                name = item.product_name
                if name not in purchased:
                    errors.append(f"商品「{name}」不在客户已结算购买记录中，无法退货")
                    continue
                available = round(purchased.get(name, 0) - returned.get(name, 0), 3)
                if item.weight > available:
                    errors.append(
                        f"商品「{name}」可退克重为 {available}g，"
                        f"但本次退货申请 {item.weight}g，超出可退范围"
                    )
            
            if errors:
                return error_response(
                    message="库存校验失败：" + "；".join(errors),
                    data={"validation_errors": errors}
                )
        # ==================== 客户可退库存校验结束 ====================

        # 计算总工费和总克重
        # 总工费 = (克重 × 克工费) + (件数 × 件工费)
        def calc_item_total(item):
            gram_cost = item.labor_cost * item.weight
            piece_cost = (item.piece_count or 0) * (item.piece_labor_cost or 0)
            return gram_cost + piece_cost

        total_labor_cost = sum(calc_item_total(item) for item in order_data.items)
        total_weight = sum(item.weight for item in order_data.items)

        # 生成销退单号（使用中国时间）
        return_no = f"XT{china_now().strftime('%Y%m%d%H%M%S')}"

        # 创建销退单
        sales_return = SalesReturnOrder(
            return_no=return_no,
            order_date=order_data.order_date or china_now(),
            customer_id=customer_id,
            customer_name=customer_name,
            salesperson=order_data.salesperson,
            return_to=order_data.return_to or "showroom",
            return_reason=order_data.return_reason,
            reason_detail=order_data.reason_detail,
            total_weight=total_weight,
            total_labor_cost=total_labor_cost,
            remark=order_data.remark,
            status="draft",
            created_by=created_by
        )
        db.add(sales_return)
        db.flush()

        # 创建销退明细
        details = []
        for item in order_data.items:
            gram_cost = item.labor_cost * item.weight
            piece_cost = (item.piece_count or 0) * (item.piece_labor_cost or 0)
            item_total_cost = gram_cost + piece_cost

            detail = SalesReturnDetail(
                order_id=sales_return.id,
                product_code=item.product_code,
                product_name=item.product_name,
                weight=item.weight,
                labor_cost=item.labor_cost,
                piece_count=item.piece_count,
                piece_labor_cost=item.piece_labor_cost,
                total_labor_cost=item_total_cost
            )
            db.add(detail)
            details.append(detail)

        db.commit()
        db.refresh(sales_return)
        for detail in details:
            db.refresh(detail)

        # 构建响应
        return success_response(
            message=f"销退单创建成功：{return_no}",
            data={
                "id": sales_return.id,
                "return_no": sales_return.return_no,
                "order_date": sales_return.order_date.isoformat() if sales_return.order_date else None,
                "customer_name": sales_return.customer_name,
                "customer_id": sales_return.customer_id,
                "salesperson": sales_return.salesperson,
                "return_to": sales_return.return_to,
                "return_reason": sales_return.return_reason,
                "reason_detail": sales_return.reason_detail,
                "total_weight": float(sales_return.total_weight or 0),
                "total_labor_cost": float(sales_return.total_labor_cost or 0),
                "remark": sales_return.remark,
                "status": sales_return.status,
                "created_by": sales_return.created_by,
                "create_time": sales_return.create_time.isoformat() if sales_return.create_time else None,
                "details": [
                    {
                        "id": d.id,
                        "product_code": getattr(d, 'product_code', None),
                        "product_name": d.product_name,
                        "weight": float(d.weight or 0),
                        "labor_cost": float(d.labor_cost or 0),
                        "piece_count": d.piece_count,
                        "piece_labor_cost": float(d.piece_labor_cost) if d.piece_labor_cost else None,
                        "total_labor_cost": float(d.total_labor_cost or 0)
                    }
                    for d in details
                ]
            }
        )

    except Exception as e:
        db.rollback()
        logger.error(f"创建销退单失败: {e}", exc_info=True)
        return error_response(message=f"创建销退单失败: {str(e)}")


@router.get("/orders")
async def get_sales_return_orders(
    status: Optional[str] = Query(None, description="状态筛选：draft/confirmed/待结算/已结算"),
    keyword: Optional[str] = Query(None, description="关键词（搜索客户名/销退单号）"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=200, description="每页数量"),
    db: Session = Depends(get_db)
):
    """获取销退单列表（分页）"""
    from collections import defaultdict
    import math

    try:
        query = db.query(SalesReturnOrder)

        if status:
            query = query.filter(SalesReturnOrder.status == status)
        if keyword:
            query = query.filter(
                (SalesReturnOrder.customer_name.contains(keyword)) |
                (SalesReturnOrder.return_no.contains(keyword))
            )
        if start_date:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query = query.filter(SalesReturnOrder.order_date >= start_dt)
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                query = query.filter(SalesReturnOrder.order_date <= end_dt)
            except (ValueError, TypeError):
                pass

        total = query.count()
        total_pages = math.ceil(total / page_size) if total > 0 else 0
        offset = (page - 1) * page_size

        orders = query.order_by(desc(SalesReturnOrder.create_time)).offset(offset).limit(page_size).all()

        if not orders:
            return success_response(data={
                "orders": [],
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })

        # ========== 批量查询优化：避免 N+1 问题 ==========
        order_ids = [o.id for o in orders]

        all_details = db.query(SalesReturnDetail).filter(
            SalesReturnDetail.order_id.in_(order_ids)
        ).all()

        details_map = defaultdict(list)
        for d in all_details:
            details_map[d.order_id].append(d)

        # 构建结果
        result = []
        for order in orders:
            details = details_map.get(order.id, [])
            order_dict = {
                "id": order.id,
                "return_no": order.return_no,
                "order_date": order.order_date.isoformat() if order.order_date else None,
                "customer_name": order.customer_name,
                "customer_id": order.customer_id,
                "salesperson": order.salesperson,
                "return_to": order.return_to,
                "return_reason": order.return_reason,
                "reason_detail": order.reason_detail,
                "total_weight": float(order.total_weight or 0),
                "total_labor_cost": float(order.total_labor_cost or 0),
                "remark": order.remark,
                "status": order.status,
                "created_by": order.created_by,
                "create_time": order.create_time.isoformat() if order.create_time else None,
                "details": [
                    {
                        "id": d.id,
                        "product_code": getattr(d, 'product_code', None),
                        "product_name": d.product_name,
                        "weight": float(d.weight or 0),
                        "labor_cost": float(d.labor_cost or 0),
                        "piece_count": d.piece_count,
                        "piece_labor_cost": float(d.piece_labor_cost) if d.piece_labor_cost else None,
                        "total_labor_cost": float(d.total_labor_cost or 0)
                    }
                    for d in details
                ]
            }
            result.append(order_dict)

        return success_response(data={
            "orders": result,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        })
    except Exception as e:
        logger.error(f"查询销退单失败: {e}", exc_info=True)
        return error_response(message=f"查询销退单失败: {str(e)}")


# 静态路由必须在动态路由之前（Bug #28）
@router.get("/pending-returns")
async def get_pending_returns(
    limit: int = Query(100, ge=1, le=500, description="返回数量限制"),
    db: Session = Depends(get_db)
):
    """获取待结算的销退单列表（已确认但尚未创建结算单的销退单）"""
    from collections import defaultdict

    try:
        # 查找状态为 confirmed 的销退单
        orders = db.query(SalesReturnOrder).filter(
            SalesReturnOrder.status == "confirmed"
        ).order_by(SalesReturnOrder.create_time.desc()).limit(limit).all()

        if not orders:
            return success_response(data=[])

        # 批量查询：排除已有结算单的销退单
        order_ids = [o.id for o in orders]

        existing_settlements = db.query(SalesReturnSettlement).filter(
            SalesReturnSettlement.sales_return_order_id.in_(order_ids),
            SalesReturnSettlement.status != "cancelled"
        ).all()
        settlement_set = {s.sales_return_order_id for s in existing_settlements}

        # 批量查询销退明细
        all_details = db.query(SalesReturnDetail).filter(
            SalesReturnDetail.order_id.in_(order_ids)
        ).all()
        details_map = defaultdict(list)
        for d in all_details:
            details_map[d.order_id].append(d)

        # 构建结果
        result = []
        for order in orders:
            if order.id not in settlement_set:
                details = details_map.get(order.id, [])
                order_dict = {
                    "id": order.id,
                    "return_no": order.return_no,
                    "order_date": order.order_date.isoformat() if order.order_date else None,
                    "customer_name": order.customer_name,
                    "customer_id": order.customer_id,
                    "salesperson": order.salesperson,
                    "return_to": order.return_to,
                    "return_reason": order.return_reason,
                    "total_weight": float(order.total_weight or 0),
                    "total_labor_cost": float(order.total_labor_cost or 0),
                    "remark": order.remark,
                    "status": order.status,
                    "created_by": order.created_by,
                    "create_time": order.create_time.isoformat() if order.create_time else None,
                    "details": [
                        {
                            "id": d.id,
                            "product_name": d.product_name,
                            "weight": float(d.weight or 0),
                            "labor_cost": float(d.labor_cost or 0),
                            "total_labor_cost": float(d.total_labor_cost or 0)
                        }
                        for d in details
                    ]
                }
                result.append(order_dict)

        return success_response(data=result)
    except Exception as e:
        logger.error(f"查询待结算销退单失败: {e}", exc_info=True)
        return error_response(message=f"查询待结算销退单失败: {str(e)}")


@router.get("/orders/{order_id}")
async def get_sales_return_order(order_id: int, db: Session = Depends(get_db)):
    """获取销退单详情"""
    try:
        order = db.query(SalesReturnOrder).filter(SalesReturnOrder.id == order_id).first()

        if not order:
            return error_response(message="销退单不存在")

        details = db.query(SalesReturnDetail).filter(SalesReturnDetail.order_id == order.id).all()

        return success_response(data={
            "id": order.id,
            "return_no": order.return_no,
            "order_date": order.order_date.isoformat() if order.order_date else None,
            "customer_name": order.customer_name,
            "customer_id": order.customer_id,
            "salesperson": order.salesperson,
            "return_to": order.return_to,
            "return_reason": order.return_reason,
            "reason_detail": order.reason_detail,
            "total_weight": float(order.total_weight or 0),
            "total_labor_cost": float(order.total_labor_cost or 0),
            "remark": order.remark,
            "status": order.status,
            "created_by": order.created_by,
            "create_time": order.create_time.isoformat() if order.create_time else None,
            "details": [
                {
                    "id": d.id,
                    "product_code": getattr(d, 'product_code', None),
                    "product_name": d.product_name,
                    "weight": float(d.weight or 0),
                    "labor_cost": float(d.labor_cost or 0),
                    "piece_count": d.piece_count,
                    "piece_labor_cost": float(d.piece_labor_cost) if d.piece_labor_cost else None,
                    "total_labor_cost": float(d.total_labor_cost or 0)
                }
                for d in details
            ]
        })
    except Exception as e:
        logger.error(f"查询销退单详情失败: {e}", exc_info=True)
        return error_response(message=f"查询销退单详情失败: {str(e)}")


@router.post("/orders/{order_id}/confirm")
async def confirm_sales_return_order(
    order_id: int,
    confirmed_by: str = Query(default="系统管理员", description="确认人"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """确认销退单（库存恢复）"""
    try:
        # 权限检查
        if not has_permission(user_role, 'can_sales_return'):
            return error_response(message="权限不足：您没有【销退管理】的权限")

        order = db.query(SalesReturnOrder).filter(SalesReturnOrder.id == order_id).first()
        if not order:
            return error_response(message="销退单不存在")
        if order.status != "draft":
            return error_response(message=f"销退单状态为 {order.status}，只有未确认的销退单才能确认")

        details = db.query(SalesReturnDetail).filter(SalesReturnDetail.order_id == order_id).all()
        if not details:
            return error_response(message="销退单没有商品明细")

        # ==================== 恢复库存（与销售确认的扣减相反）====================
        # 根据 return_to 字段确定退回的库位
        if order.return_to == "warehouse":
            target_location = db.query(Location).filter(
                Location.location_type == "warehouse",
                Location.is_active == 1
            ).first()
        else:
            target_location = db.query(Location).filter(
                Location.location_type == "showroom",
                Location.is_active == 1
            ).first()

        for detail in details:
            # 恢复总库存
            inventory = db.query(Inventory).filter(
                Inventory.product_name == detail.product_name
            ).first()
            if inventory:
                inventory.total_weight = round(inventory.total_weight + detail.weight, 3)
            else:
                # 库存记录不存在，创建新记录
                inventory = Inventory(
                    product_name=detail.product_name,
                    total_weight=detail.weight
                )
                db.add(inventory)

            # 恢复库位库存
            if target_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == detail.product_name,
                    LocationInventory.location_id == target_location.id
                ).first()
                if location_inv:
                    location_inv.weight = round(location_inv.weight + detail.weight, 3)
                else:
                    location_inv = LocationInventory(
                        product_name=detail.product_name,
                        location_id=target_location.id,
                        weight=detail.weight
                    )
                    db.add(location_inv)
        # ==================== 库存恢复结束 ====================

        order.status = "confirmed"

        status_log = OrderStatusLog(
            order_type="sales_return",
            order_id=order_id,
            action="confirm",
            old_status="draft",
            new_status="confirmed",
            operated_by=confirmed_by,
            operated_at=china_now()
        )
        db.add(status_log)

        db.commit()
        logger.info(f"销退单已确认: {order.return_no}, 确认人: {confirmed_by}, 库存已恢复至{order.return_to}")

        return success_response(message=f"销退单 {order.return_no} 已确认，库存已恢复")

    except Exception as e:
        db.rollback()
        logger.error(f"确认销退单失败: {e}", exc_info=True)
        return error_response(message=f"确认销退单失败: {str(e)}")


@router.post("/orders/{order_id}/unconfirm")
async def unconfirm_sales_return_order(
    order_id: int,
    operated_by: str = Query(default="系统管理员", description="操作人"),
    user_role: str = Query(default="sales", description="用户角色"),
    remark: str = Query(default="", description="反确认原因"),
    db: Session = Depends(get_db)
):
    """反确认销退单（回滚库存恢复）"""
    try:
        # 权限检查
        if not has_permission(user_role, 'can_sales_return'):
            return error_response(message="权限不足：您没有【销退管理】的权限")

        order = db.query(SalesReturnOrder).filter(SalesReturnOrder.id == order_id).first()
        if not order:
            return error_response(message="销退单不存在")
        if order.status != "confirmed":
            return error_response(message=f"销退单状态为 {order.status}，只有已确认的销退单才能反确认")

        # 检查是否已关联结算单（待结算或已结算的不能反确认）
        existing_settlement = db.query(SalesReturnSettlement).filter(
            SalesReturnSettlement.sales_return_order_id == order_id,
            SalesReturnSettlement.status != "cancelled"
        ).first()
        if existing_settlement:
            return error_response(message="该销退单已关联结算单，请先取消或撤销结算单后再反确认")

        details = db.query(SalesReturnDetail).filter(SalesReturnDetail.order_id == order_id).all()

        # ==================== 回滚库存恢复（扣减回去）====================
        if order.return_to == "warehouse":
            target_location = db.query(Location).filter(
                Location.location_type == "warehouse",
                Location.is_active == 1
            ).first()
        else:
            target_location = db.query(Location).filter(
                Location.location_type == "showroom",
                Location.is_active == 1
            ).first()

        for detail in details:
            # 扣减总库存
            inventory = db.query(Inventory).filter(
                Inventory.product_name == detail.product_name
            ).first()
            if inventory:
                inventory.total_weight = round(inventory.total_weight - detail.weight, 3)

            # 扣减库位库存
            if target_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == detail.product_name,
                    LocationInventory.location_id == target_location.id
                ).first()
                if location_inv:
                    location_inv.weight = round(float(location_inv.weight or 0) - float(detail.weight or 0), 3)
        # ==================== 库存回滚结束 ====================

        order.status = "draft"

        status_log = OrderStatusLog(
            order_type="sales_return",
            order_id=order_id,
            action="unconfirm",
            old_status="confirmed",
            new_status="draft",
            operated_by=operated_by,
            operated_at=china_now(),
            remark=remark or None
        )
        db.add(status_log)

        db.commit()
        logger.info(f"销退单已反确认: {order.return_no}, 操作人: {operated_by}")

        return success_response(message=f"销退单 {order.return_no} 已反确认，库存已回滚")

    except Exception as e:
        db.rollback()
        logger.error(f"反确认销退单失败: {e}", exc_info=True)
        return error_response(message=f"反确认销退单失败: {str(e)}")


# ============= 销退结算单 =============

@router.post("/settlements")
async def create_sales_return_settlement(
    data: SalesReturnSettlementCreate,
    user_role: str = Query(default="sales", description="用户角色"),
    created_by: str = Query(default="系统管理员", description="创建人"),
    db: Session = Depends(get_db)
):
    """创建销退结算单"""
    try:
        # 权限检查
        if not has_permission(user_role, 'can_sales_return'):
            return error_response(message="权限不足：您没有【销退管理】的权限")

        # ==================== 业务验证 ====================
        # 查找销退单
        sales_return = db.query(SalesReturnOrder).filter(
            SalesReturnOrder.id == data.sales_return_order_id
        ).first()
        if not sales_return:
            return error_response(message="销退单不存在")

        if sales_return.status != "confirmed":
            return error_response(message=f"销退单状态为 {sales_return.status}，只有已确认的销退单才能创建结算单")

        # 检查是否已有结算单
        existing = db.query(SalesReturnSettlement).filter(
            SalesReturnSettlement.sales_return_order_id == data.sales_return_order_id,
            SalesReturnSettlement.status != "cancelled"
        ).first()
        if existing:
            return error_response(message="该销退单已有结算单，不能重复创建")

        # 验证支付方式并计算金额
        total_weight = sales_return.total_weight or 0
        labor_amount = sales_return.total_labor_cost or 0
        material_amount = 0.0
        total_amount = 0.0

        if data.payment_method == "cash_price":
            # 退价：原料金额 = 金价 × 总克重
            if not data.gold_price or data.gold_price <= 0:
                return error_response(message="退价方式需要填写当日金价")
            try:
                material_amount = float(data.gold_price) * float(total_weight)
            except (ValueError, TypeError) as e:
                return error_response(message=f"金额计算失败: {str(e)}")
            total_amount = material_amount + labor_amount

        elif data.payment_method == "physical_gold":
            # 退料：原料金额为0，只退工费
            material_amount = 0.0
            total_amount = labor_amount

        elif data.payment_method == "mixed":
            # 混合退款：退料部分 + 退价部分
            if not data.gold_price or data.gold_price <= 0:
                return error_response(message="混合退款需要填写当日金价")
            if data.cash_payment_weight is None or data.cash_payment_weight < 0:
                return error_response(message="混合退款需要填写退价部分的克重")
            if data.gold_payment_weight is None or data.gold_payment_weight < 0:
                return error_response(message="混合退款需要填写退料部分的克重")
            try:
                material_amount = float(data.gold_price) * float(data.cash_payment_weight)
            except (ValueError, TypeError) as e:
                return error_response(message=f"金额计算失败: {str(e)}")
            total_amount = material_amount + labor_amount

        else:
            return error_response(message="无效的退款方式，请选择：cash_price(退价)、physical_gold(退料)或 mixed(混合退款)")
        # ==================== 业务验证结束 ====================

        # 生成销退结算单号
        now = china_now()
        count = db.query(SalesReturnSettlement).filter(
            SalesReturnSettlement.settlement_no.like(f"XTJS{now.strftime('%Y%m%d')}%")
        ).count()
        settlement_no = f"XTJS{now.strftime('%Y%m%d')}{count + 1:03d}"

        # 确定退还金料重量
        physical_gold_weight = None
        if data.payment_method == "physical_gold":
            physical_gold_weight = data.physical_gold_weight or total_weight
        elif data.payment_method == "mixed":
            physical_gold_weight = data.gold_payment_weight or 0

        # 创建销退结算单
        settlement = SalesReturnSettlement(
            settlement_no=settlement_no,
            sales_return_order_id=data.sales_return_order_id,
            payment_method=data.payment_method,
            gold_price=data.gold_price,
            physical_gold_weight=physical_gold_weight,
            gold_payment_weight=data.gold_payment_weight if data.payment_method == "mixed" else None,
            cash_payment_weight=data.cash_payment_weight if data.payment_method == "mixed" else None,
            total_weight=total_weight,
            material_amount=material_amount,
            labor_amount=labor_amount,
            total_amount=total_amount,
            status="draft",
            created_by=created_by,
            remark=data.remark
        )
        db.add(settlement)

        # 更新销退单状态
        sales_return.status = "待结算"

        db.commit()
        db.refresh(settlement)

        logger.info(f"创建销退结算单: {settlement_no}, 销退单: {sales_return.return_no}, "
                    f"退款方式: {data.payment_method}, 退款总额: ¥{total_amount:.2f}")

        return success_response(
            message=f"销退结算单创建成功：{settlement_no}",
            data={
                "id": settlement.id,
                "settlement_no": settlement.settlement_no,
                "sales_return_order_id": settlement.sales_return_order_id,
                "payment_method": settlement.payment_method,
                "gold_price": settlement.gold_price,
                "physical_gold_weight": settlement.physical_gold_weight,
                "gold_payment_weight": settlement.gold_payment_weight,
                "cash_payment_weight": settlement.cash_payment_weight,
                "total_weight": float(settlement.total_weight or 0),
                "material_amount": float(settlement.material_amount or 0),
                "labor_amount": float(settlement.labor_amount or 0),
                "total_amount": float(settlement.total_amount or 0),
                "status": settlement.status,
                "created_by": settlement.created_by,
                "remark": settlement.remark,
                "created_at": settlement.created_at.isoformat() if settlement.created_at else None
            }
        )

    except Exception as e:
        db.rollback()
        logger.error(f"创建销退结算单失败: {e}", exc_info=True)
        return error_response(message=f"创建销退结算单失败: {str(e)}")


@router.get("/settlements")
async def get_sales_return_settlements(
    status: Optional[str] = Query(None, description="状态筛选：draft/confirmed"),
    keyword: Optional[str] = Query(None, description="关键词（搜索结算单号/客户名）"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    limit: int = Query(100, ge=1, le=500, description="返回数量限制"),
    db: Session = Depends(get_db)
):
    """获取销退结算单列表"""
    try:
        query = db.query(SalesReturnSettlement)

        if status:
            query = query.filter(SalesReturnSettlement.status == status)

        # 关键词搜索（结算单号 或 关联销退单的客户名）
        if keyword:
            query = query.outerjoin(
                SalesReturnOrder,
                SalesReturnSettlement.sales_return_order_id == SalesReturnOrder.id
            ).filter(
                (SalesReturnSettlement.settlement_no.contains(keyword)) |
                (SalesReturnOrder.customer_name.contains(keyword))
            )

        if start_date:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query = query.filter(SalesReturnSettlement.created_at >= start_dt)
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                query = query.filter(SalesReturnSettlement.created_at <= end_dt)
            except (ValueError, TypeError):
                pass

        settlements = query.order_by(desc(SalesReturnSettlement.created_at)).limit(limit).all()

        if not settlements:
            return success_response(data=[])

        # 批量查询关联的销退单
        return_order_ids = [s.sales_return_order_id for s in settlements if s.sales_return_order_id]
        return_orders = db.query(SalesReturnOrder).filter(
            SalesReturnOrder.id.in_(return_order_ids)
        ).all() if return_order_ids else []
        return_order_map = {ro.id: ro for ro in return_orders}

        result = []
        for s in settlements:
            return_order = return_order_map.get(s.sales_return_order_id)
            result.append({
                "id": s.id,
                "settlement_no": s.settlement_no,
                "sales_return_order_id": s.sales_return_order_id,
                "return_no": return_order.return_no if return_order else None,
                "customer_name": return_order.customer_name if return_order else None,
                "payment_method": s.payment_method,
                "gold_price": s.gold_price,
                "physical_gold_weight": s.physical_gold_weight,
                "gold_payment_weight": s.gold_payment_weight,
                "cash_payment_weight": s.cash_payment_weight,
                "total_weight": float(s.total_weight or 0),
                "material_amount": float(s.material_amount or 0),
                "labor_amount": float(s.labor_amount or 0),
                "total_amount": float(s.total_amount or 0),
                "status": s.status,
                "created_by": s.created_by,
                "confirmed_by": s.confirmed_by,
                "confirmed_at": s.confirmed_at.isoformat() if s.confirmed_at else None,
                "remark": s.remark,
                "created_at": s.created_at.isoformat() if s.created_at else None
            })

        return success_response(data=result)

    except Exception as e:
        logger.error(f"查询销退结算单失败: {e}", exc_info=True)
        return error_response(message=f"查询销退结算单失败: {str(e)}")


@router.post("/settlements/{settlement_id}/confirm")
async def confirm_sales_return_settlement(
    settlement_id: int,
    confirmed_by: str = Query(default="系统管理员", description="确认人"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """确认销退结算单（执行退款）"""
    try:
        # 权限检查
        if not has_permission(user_role, 'can_sales_return'):
            return error_response(message="权限不足：您没有【销退管理】的权限")

        settlement = db.query(SalesReturnSettlement).filter(
            SalesReturnSettlement.id == settlement_id
        ).first()
        if not settlement:
            return error_response(message="销退结算单不存在")
        if settlement.status != "draft":
            return error_response(message=f"结算单状态为 {settlement.status}，只有待确认的结算单才能确认")

        # 获取关联的销退单
        sales_return = db.query(SalesReturnOrder).filter(
            SalesReturnOrder.id == settlement.sales_return_order_id
        ).first()
        if not sales_return:
            return error_response(message="关联的销退单不存在")

        customer_id = sales_return.customer_id
        customer_name = sales_return.customer_name
        now = china_now()

        # ==================== 根据退款方式处理财务退款 ====================
        if settlement.payment_method == "cash_price":
            # 退价：退还现金（创建退款类型的客户往来账）
            if customer_id:
                refund_tx = CustomerTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='sales_refund',
                    amount=settlement.total_amount or 0,
                    gold_weight=0,
                    status='active',
                    remark=f"销退退价：结算单 {settlement.settlement_no}，退款 ¥{settlement.total_amount:.2f}"
                )
                db.add(refund_tx)

        elif settlement.payment_method == "physical_gold":
            # 退料：退还金料到客户金料账户 + 工费部分退现金
            refund_gold_weight = settlement.physical_gold_weight or settlement.total_weight or 0

            if customer_id and refund_gold_weight > 0:
                from .gold_material import get_or_create_customer_deposit
                customer_deposit = get_or_create_customer_deposit(customer_id, customer_name, db)

                balance_before = customer_deposit.current_balance
                customer_deposit.current_balance = round(customer_deposit.current_balance + refund_gold_weight, 3)
                customer_deposit.last_transaction_at = now

                # 创建金料账户变动记录
                deposit_tx = CustomerGoldDepositTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='refund',
                    amount=refund_gold_weight,
                    balance_before=balance_before,
                    balance_after=customer_deposit.current_balance,
                    created_by=confirmed_by,
                    remark=f"销退退料：结算单 {settlement.settlement_no}，退还金料 {refund_gold_weight:.2f}克"
                )
                db.add(deposit_tx)

                logger.info(f"销退退料：客户={customer_name}, 退还金料={refund_gold_weight:.2f}克, "
                            f"余额 {balance_before:.2f} -> {customer_deposit.current_balance:.2f}")

            # 工费部分退现金
            if customer_id:
                refund_tx = CustomerTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='sales_refund',
                    amount=settlement.labor_amount or 0,
                    gold_weight=refund_gold_weight,
                    status='active',
                    remark=f"销退退料：结算单 {settlement.settlement_no}，退还金料 {refund_gold_weight:.2f}克 + 退工费 ¥{settlement.labor_amount:.2f}"
                )
                db.add(refund_tx)

        elif settlement.payment_method == "mixed":
            # 混合退款：退料部分退还金料 + 退价部分退还现金
            gold_refund_weight = settlement.gold_payment_weight or 0
            cash_refund_weight = settlement.cash_payment_weight or 0

            # 退料部分：退还金料到客户金料账户
            if customer_id and gold_refund_weight > 0:
                from .gold_material import get_or_create_customer_deposit
                customer_deposit = get_or_create_customer_deposit(customer_id, customer_name, db)

                balance_before = customer_deposit.current_balance
                customer_deposit.current_balance = round(customer_deposit.current_balance + gold_refund_weight, 3)
                customer_deposit.last_transaction_at = now

                deposit_tx = CustomerGoldDepositTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='refund',
                    amount=gold_refund_weight,
                    balance_before=balance_before,
                    balance_after=customer_deposit.current_balance,
                    created_by=confirmed_by,
                    remark=f"销退混合退款（退料部分）：结算单 {settlement.settlement_no}，退还金料 {gold_refund_weight:.2f}克"
                )
                db.add(deposit_tx)

                logger.info(f"销退混合退款（退料）：客户={customer_name}, 退还金料={gold_refund_weight:.2f}克, "
                            f"余额 {balance_before:.2f} -> {customer_deposit.current_balance:.2f}")

            # 退价部分 + 工费：退还现金
            if customer_id:
                cash_refund_amount = (settlement.material_amount or 0) + (settlement.labor_amount or 0)
                refund_tx = CustomerTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='sales_refund',
                    amount=cash_refund_amount,
                    gold_weight=gold_refund_weight,
                    status='active',
                    remark=f"销退混合退款：结算单 {settlement.settlement_no}，退料 {gold_refund_weight:.2f}克 + 退价 ¥{settlement.material_amount:.2f} + 退工费 ¥{settlement.labor_amount:.2f}"
                )
                db.add(refund_tx)
        # ==================== 财务退款处理结束 ====================

        # ==================== 冲减客户应收账款（FIFO） ====================
        # 根据退款方式计算现金退款部分
        refund_cash_for_ar = 0.0
        if settlement.payment_method == "cash_price":
            refund_cash_for_ar = settlement.total_amount or 0
        elif settlement.payment_method == "physical_gold":
            refund_cash_for_ar = settlement.labor_amount or 0
        elif settlement.payment_method == "mixed":
            refund_cash_for_ar = (settlement.material_amount or 0) + (settlement.labor_amount or 0)

        if refund_cash_for_ar > 0 and customer_id:
            from ..models.finance import AccountReceivable
            unpaid_receivables = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id,
                AccountReceivable.status.in_(["unpaid", "overdue"]),
                AccountReceivable.unpaid_amount > 0
            ).order_by(AccountReceivable.credit_start_date.asc()).all()

            remaining_refund = refund_cash_for_ar
            for receivable in unpaid_receivables:
                if remaining_refund <= 0:
                    break
                offset = min(remaining_refund, receivable.unpaid_amount)
                receivable.received_amount += offset
                receivable.unpaid_amount = receivable.total_amount - receivable.received_amount
                if receivable.unpaid_amount <= 0:
                    receivable.status = "paid"
                receivable.remark = (receivable.remark or "") + f" | 销退冲减 {offset:.2f}元 ({settlement.settlement_no})"
                remaining_refund -= offset

            if refund_cash_for_ar > remaining_refund:
                logger.info(f"销退冲减应收账款：{refund_cash_for_ar - remaining_refund:.2f}元")
        # ==================== 冲减应收账款结束 ====================

        # 更新结算单状态
        settlement.status = "confirmed"
        settlement.confirmed_by = confirmed_by
        settlement.confirmed_at = now

        # 更新销退单状态
        sales_return.status = "已结算"

        # 记录状态变更日志
        status_log = OrderStatusLog(
            order_type="sales_return_settlement",
            order_id=settlement_id,
            action="confirm",
            old_status="draft",
            new_status="confirmed",
            operated_by=confirmed_by,
            operated_at=now
        )
        db.add(status_log)

        db.commit()
        logger.info(f"销退结算单已确认: {settlement.settlement_no}, 确认人: {confirmed_by}")

        return success_response(message=f"销退结算单 {settlement.settlement_no} 已确认，退款已处理")

    except Exception as e:
        db.rollback()
        logger.error(f"确认销退结算单失败: {e}", exc_info=True)
        return error_response(message=f"确认销退结算单失败: {str(e)}")


@router.post("/settlements/{settlement_id}/revert")
async def revert_sales_return_settlement(
    settlement_id: int,
    operated_by: str = Query(default="系统管理员", description="操作人"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """撤销销退结算单确认（回滚退款）"""
    try:
        # 权限检查
        if not has_permission(user_role, 'can_sales_return'):
            return error_response(message="权限不足：您没有【销退管理】的权限")

        settlement = db.query(SalesReturnSettlement).filter(
            SalesReturnSettlement.id == settlement_id
        ).first()
        if not settlement:
            return error_response(message="销退结算单不存在")
        if settlement.status != "confirmed":
            return error_response(message=f"结算单状态为 {settlement.status}，只有已确认的结算单才能撤销")

        # 获取关联的销退单
        sales_return = db.query(SalesReturnOrder).filter(
            SalesReturnOrder.id == settlement.sales_return_order_id
        ).first()
        if not sales_return:
            return error_response(message="关联的销退单不存在")

        customer_id = sales_return.customer_id
        customer_name = sales_return.customer_name
        now = china_now()

        rolled_back_gold = 0.0
        rolled_back_cash = 0.0

        # ==================== 回滚退款（与确认操作相反）====================
        if settlement.payment_method == "cash_price":
            # 回滚现金退款：创建反向往来账记录
            rolled_back_cash = settlement.total_amount or 0

        elif settlement.payment_method == "physical_gold":
            # 回滚金料退还：从客户金料账户扣回
            refund_gold_weight = settlement.physical_gold_weight or settlement.total_weight or 0

            if customer_id and refund_gold_weight > 0:
                from .gold_material import get_or_create_customer_deposit
                customer_deposit = get_or_create_customer_deposit(customer_id, customer_name, db)

                balance_before = customer_deposit.current_balance
                customer_deposit.current_balance = round(customer_deposit.current_balance - refund_gold_weight, 3)
                customer_deposit.last_transaction_at = now

                rollback_tx = CustomerGoldDepositTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='use',
                    amount=refund_gold_weight,
                    balance_before=balance_before,
                    balance_after=customer_deposit.current_balance,
                    created_by=operated_by,
                    remark=f"撤销销退结算回滚：结算单 {settlement.settlement_no}"
                )
                db.add(rollback_tx)

                rolled_back_gold = refund_gold_weight
                logger.info(f"撤销销退结算：回滚金料 {refund_gold_weight:.2f}克，"
                            f"余额 {balance_before:.2f} -> {customer_deposit.current_balance:.2f}")

            rolled_back_cash = settlement.labor_amount or 0

        elif settlement.payment_method == "mixed":
            # 回滚混合退款
            gold_refund_weight = settlement.gold_payment_weight or 0

            if customer_id and gold_refund_weight > 0:
                from .gold_material import get_or_create_customer_deposit
                customer_deposit = get_or_create_customer_deposit(customer_id, customer_name, db)

                balance_before = customer_deposit.current_balance
                customer_deposit.current_balance = round(customer_deposit.current_balance - gold_refund_weight, 3)
                customer_deposit.last_transaction_at = now

                rollback_tx = CustomerGoldDepositTransaction(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    transaction_type='use',
                    amount=gold_refund_weight,
                    balance_before=balance_before,
                    balance_after=customer_deposit.current_balance,
                    created_by=operated_by,
                    remark=f"撤销销退混合退款回滚：结算单 {settlement.settlement_no}"
                )
                db.add(rollback_tx)

                rolled_back_gold = gold_refund_weight
                logger.info(f"撤销销退混合退款：回滚金料 {gold_refund_weight:.2f}克，"
                            f"余额 {balance_before:.2f} -> {customer_deposit.current_balance:.2f}")

            rolled_back_cash = (settlement.material_amount or 0) + (settlement.labor_amount or 0)

        # 创建撤销的往来账记录
        if customer_id:
            revert_tx = CustomerTransaction(
                customer_id=customer_id,
                customer_name=customer_name,
                transaction_type='revert',
                amount=-rolled_back_cash,
                gold_weight=-rolled_back_gold,
                status='active',
                remark=f"撤销销退结算：结算单 {settlement.settlement_no}"
            )
            db.add(revert_tx)
        # ==================== 退款回滚结束 ====================

        # ==================== 恢复被冲减的应收账款 ====================
        # 计算确认时冲减了多少现金
        refund_cash_for_ar = 0.0
        if settlement.payment_method == "cash_price":
            refund_cash_for_ar = settlement.total_amount or 0
        elif settlement.payment_method == "physical_gold":
            refund_cash_for_ar = settlement.labor_amount or 0
        elif settlement.payment_method == "mixed":
            refund_cash_for_ar = (settlement.material_amount or 0) + (settlement.labor_amount or 0)

        if refund_cash_for_ar > 0 and customer_id:
            from ..models.finance import AccountReceivable
            # 倒序查找被冲减过的应收账款（最近被冲减的先恢复）
            paid_receivables = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id,
                AccountReceivable.status.in_(["paid", "unpaid", "overdue"]),
                AccountReceivable.received_amount > 0
            ).order_by(AccountReceivable.credit_start_date.desc()).all()

            remaining_restore = refund_cash_for_ar
            for receivable in paid_receivables:
                if remaining_restore <= 0:
                    break
                # 恢复金额不超过该笔已收金额
                restore_amount = min(remaining_restore, receivable.received_amount)
                receivable.received_amount -= restore_amount
                receivable.unpaid_amount = receivable.total_amount - receivable.received_amount
                if receivable.unpaid_amount > 0:
                    receivable.status = "unpaid"
                receivable.remark = (receivable.remark or "") + f" | 撤销销退恢复 {restore_amount:.2f}元"
                remaining_restore -= restore_amount

            if refund_cash_for_ar > remaining_restore:
                logger.info(f"撤销销退：恢复应收账款 {refund_cash_for_ar - remaining_restore:.2f}元")
        # ==================== 恢复应收账款结束 ====================

        # 更新结算单状态
        old_status = settlement.status
        settlement.status = "draft"
        settlement.confirmed_by = None
        settlement.confirmed_at = None

        # 销退单状态改回 confirmed（可重新开结算单）
        sales_return.status = "confirmed"

        # 记录状态变更日志
        status_log = OrderStatusLog(
            order_type="sales_return_settlement",
            order_id=settlement_id,
            action="unconfirm",
            old_status=old_status,
            new_status="draft",
            operated_by=operated_by,
            operated_at=now
        )
        db.add(status_log)

        db.commit()
        logger.info(f"销退结算单 {settlement.settlement_no} 撤销成功: {old_status} -> draft")

        return success_response(
            message=f"销退结算单 {settlement.settlement_no} 已撤销，可以重新确认或修改",
            data={
                "settlement_id": settlement.id,
                "settlement_no": settlement.settlement_no,
                "rolled_back_cash": rolled_back_cash,
                "rolled_back_gold": rolled_back_gold
            }
        )

    except Exception as e:
        db.rollback()
        logger.error(f"撤销销退结算单失败: {e}", exc_info=True)
        return error_response(message=f"撤销销退结算单失败: {str(e)}")
