"""
退货管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from typing import Optional, List
from collections import defaultdict
import json
import logging

from ..database import get_db
from ..timezone_utils import china_now, to_china_time
from ..models import ReturnOrder, ReturnOrderDetail, Location, Supplier, InboundOrder, LocationInventory
from ..schemas import (
    ReturnOrderCreate,
    ReturnItemCreate,
    ReturnItemResponse,
    ReturnOrderResponse
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/returns", tags=["退货管理"])

# 退货原因选项
RETURN_REASONS = ["质量问题", "款式不符", "数量差异", "工艺瑕疵", "其他"]


def format_time_china(dt):
    """转换时间为中国时区（数据库存储的是 UTC 时间，需要加 8 小时）"""
    if dt is None:
        return None
    from datetime import timedelta
    china_dt = dt + timedelta(hours=8)
    return china_dt.isoformat()


def build_return_response_from_maps(
    return_order: ReturnOrder,
    location_map: dict,
    supplier_map: dict,
    inbound_map: dict,
    details_list: List
) -> dict:
    """使用预加载的映射数据构建退货单响应（避免 N+1 查询）"""
    # 从映射中获取关联数据
    from_location_name = location_map.get(return_order.from_location_id)
    supplier_name = supplier_map.get(return_order.supplier_id)
    inbound_order_no = inbound_map.get(return_order.inbound_order_id)
    
    # 构建明细列表（兼容旧数据：如果没有明细记录，使用主表字段构建）
    items = []
    if details_list:
        for d in details_list:
            items.append({
                "id": d.id,
                "product_name": d.product_name,
                "return_weight": d.return_weight,
                "labor_cost": d.labor_cost or 0.0,
                "piece_count": d.piece_count,
                "piece_labor_cost": d.piece_labor_cost,
                "total_labor_cost": d.total_labor_cost or 0.0,
                "remark": d.remark
            })
    else:
        # 兼容旧数据：使用主表的单商品字段
        items.append({
            "id": 0,
            "product_name": return_order.product_name,
            "return_weight": return_order.return_weight,
            "labor_cost": 0.0,
            "piece_count": None,
            "piece_labor_cost": None,
            "total_labor_cost": 0.0,
            "remark": None
        })
    
    # 计算汇总（优先使用主表字段，如果没有则从明细计算）
    total_weight = return_order.total_weight if return_order.total_weight else return_order.return_weight
    total_labor_cost = return_order.total_labor_cost if return_order.total_labor_cost else 0.0
    item_count = return_order.item_count if return_order.item_count else 1
    
    return {
        "id": return_order.id,
        "return_no": return_order.return_no,
        "return_type": return_order.return_type,
        "product_name": return_order.product_name,
        "return_weight": return_order.return_weight,
        "total_weight": total_weight,
        "total_labor_cost": total_labor_cost,
        "item_count": item_count,
        "items": items,
        "from_location_id": return_order.from_location_id,
        "from_location_name": from_location_name,
        "supplier_id": return_order.supplier_id,
        "supplier_name": supplier_name,
        "inbound_order_id": return_order.inbound_order_id,
        "inbound_order_no": inbound_order_no,
        "return_reason": return_order.return_reason,
        "reason_detail": return_order.reason_detail,
        "status": return_order.status,
        "created_by": return_order.created_by,
        "created_at": format_time_china(return_order.created_at),
        "approved_by": return_order.approved_by,
        "approved_at": format_time_china(return_order.approved_at),
        "reject_reason": return_order.reject_reason,
        "completed_by": return_order.completed_by,
        "completed_at": format_time_china(return_order.completed_at),
        "images": return_order.images,
        "remark": return_order.remark,
        # 财务审核字段
        "is_audited": bool(return_order.is_audited) if return_order.is_audited is not None else False,
        "audited_by": return_order.audited_by,
        "audited_at": format_time_china(return_order.audited_at)
    }


def build_return_response(return_order: ReturnOrder, db: Session) -> dict:
    """构建退货单响应对象（支持多商品）- 兼容单条查询场景"""
    # 获取关联信息
    from_location_name = None
    supplier_name = None
    inbound_order_no = None
    
    if return_order.from_location_id:
        location = db.query(Location).filter(Location.id == return_order.from_location_id).first()
        if location:
            from_location_name = location.name
    
    if return_order.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
        if supplier:
            supplier_name = supplier.name
    
    if return_order.inbound_order_id:
        inbound = db.query(InboundOrder).filter(InboundOrder.id == return_order.inbound_order_id).first()
        if inbound:
            inbound_order_no = inbound.order_no
    
    # 获取明细列表
    details = db.query(ReturnOrderDetail).filter(
        ReturnOrderDetail.order_id == return_order.id
    ).all()
    
    # 使用映射版本构建响应
    location_map = {return_order.from_location_id: from_location_name} if from_location_name else {}
    supplier_map = {return_order.supplier_id: supplier_name} if supplier_name else {}
    inbound_map = {return_order.inbound_order_id: inbound_order_no} if inbound_order_no else {}
    
    return build_return_response_from_maps(
        return_order, location_map, supplier_map, inbound_map, details
    )


@router.get("/reasons")
async def get_return_reasons():
    """获取退货原因列表"""
    return {
        "success": True,
        "reasons": RETURN_REASONS
    }


@router.get("")
async def get_return_orders(
    return_type: Optional[str] = Query(None, description="退货类型: to_supplier/to_warehouse"),
    status: Optional[str] = Query(None, description="状态: draft/confirmed/cancelled"),
    keyword: Optional[str] = Query(None, description="搜索关键词（商品名称）"),
    start_date: Optional[str] = Query(None, description="开始日期"),
    end_date: Optional[str] = Query(None, description="结束日期"),
    limit: int = Query(100, ge=1, le=500, description="返回数量限制"),
    db: Session = Depends(get_db)
):
    """获取退货单列表（已优化：批量预加载避免 N+1 查询）"""
    try:
        query = db.query(ReturnOrder)
        
        if return_type:
            query = query.filter(ReturnOrder.return_type == return_type)
        if status:
            query = query.filter(ReturnOrder.status == status)
        if keyword:
            query = query.filter(ReturnOrder.product_name.contains(keyword))
        if start_date:
            query = query.filter(ReturnOrder.created_at >= start_date)
        if end_date:
            query = query.filter(ReturnOrder.created_at <= end_date + " 23:59:59")
        
        # 添加分页限制
        returns = query.order_by(desc(ReturnOrder.created_at)).limit(limit).all()
        
        if not returns:
            return {"success": True, "returns": [], "total": 0}
        
        # ========== 批量预加载关联数据（避免 N+1 查询）==========
        # 收集所有关联 ID
        location_ids = {r.from_location_id for r in returns if r.from_location_id}
        supplier_ids = {r.supplier_id for r in returns if r.supplier_id}
        inbound_ids = {r.inbound_order_id for r in returns if r.inbound_order_id}
        return_ids = [r.id for r in returns]
        
        # 批量查询（仅 4 次查询，而不是 N*4 次）
        locations = db.query(Location).filter(Location.id.in_(location_ids)).all() if location_ids else []
        suppliers = db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all() if supplier_ids else []
        inbounds = db.query(InboundOrder).filter(InboundOrder.id.in_(inbound_ids)).all() if inbound_ids else []
        details = db.query(ReturnOrderDetail).filter(ReturnOrderDetail.order_id.in_(return_ids)).all() if return_ids else []
        
        # 构建映射字典
        location_map = {loc.id: loc.name for loc in locations}
        supplier_map = {sup.id: sup.name for sup in suppliers}
        inbound_map = {inb.id: inb.order_no for inb in inbounds}
        details_map = defaultdict(list)
        for d in details:
            details_map[d.order_id].append(d)
        
        # 使用预加载数据批量构建响应
        result = [
            build_return_response_from_maps(r, location_map, supplier_map, inbound_map, details_map.get(r.id, []))
            for r in returns
        ]
        
        return {
            "success": True,
            "returns": result,
            "total": len(result)
        }
    except Exception as e:
        logger.error(f"获取退货单列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "returns": []}


@router.post("")
async def create_return_order(
    data: ReturnOrderCreate,
    created_by: str = Query("系统管理员", description="创建人"),
    user_role: str = Query("manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """创建退货单（支持多商品）"""
    # 权限检查
    from ..middleware.permissions import has_permission
    if data.return_type == "to_supplier" and not has_permission(user_role, 'can_return_to_supplier'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【退货给供应商】的权限")
    if data.return_type == "to_warehouse" and not has_permission(user_role, 'can_return_to_warehouse'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【退货给商品部】的权限")
    
    try:
        # 验证退货类型
        if data.return_type not in ["to_supplier", "to_warehouse"]:
            return {"success": False, "message": "无效的退货类型，应为 to_supplier 或 to_warehouse"}
        
        # 验证商品列表
        if not data.items or len(data.items) == 0:
            return {"success": False, "message": "至少需要一个退货商品"}
        
        # 验证退货原因
        if data.return_reason not in RETURN_REASONS:
            return {"success": False, "message": f"无效的退货原因，可选值: {', '.join(RETURN_REASONS)}"}
        
        # 退给供应商时验证供应商
        supplier = None
        if data.return_type == "to_supplier":
            if not data.supplier_id:
                return {"success": False, "message": "退给供应商时必须选择供应商"}
            supplier = db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
            if not supplier:
                return {"success": False, "message": "供应商不存在"}
        
        # 验证发起位置
        location = None
        if data.from_location_id:
            location = db.query(Location).filter(Location.id == data.from_location_id).first()
            if not location:
                return {"success": False, "message": "发起位置不存在"}
        
        # 生成退货单号
        now = china_now()
        count = db.query(ReturnOrder).filter(
            ReturnOrder.return_no.like(f"TH{now.strftime('%Y%m%d')}%")
        ).count()
        return_no = f"TH{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 计算汇总
        total_weight = sum(item.return_weight for item in data.items)
        total_labor_cost = 0.0
        
        # 处理图片
        images_json = json.dumps(data.images) if data.images else None
        
        # 创建退货单主表（兼容旧字段：使用第一个商品的名称和克重）
        first_item = data.items[0]
        return_order = ReturnOrder(
            return_no=return_no,
            return_type=data.return_type,
            product_name=first_item.product_name,  # 兼容旧字段
            return_weight=first_item.return_weight,  # 兼容旧字段
            total_weight=total_weight,  # 汇总字段
            item_count=len(data.items),  # 商品数量
            from_location_id=data.from_location_id,
            supplier_id=data.supplier_id,
            inbound_order_id=data.inbound_order_id,
            return_reason=data.return_reason,
            reason_detail=data.reason_detail,
            status="draft",  # 创建为未确认状态
            created_by=created_by,
            images=images_json,
            remark=data.remark
        )
        
        db.add(return_order)
        db.flush()  # 获取 return_order.id
        
        # 创建明细记录并扣减库存
        for item in data.items:
            # 计算单个商品的总工费
            gram_cost = item.return_weight * item.labor_cost
            piece_cost = (item.piece_count or 0) * (item.piece_labor_cost or 0)
            item_total_labor_cost = gram_cost + piece_cost
            total_labor_cost += item_total_labor_cost
            
            # 创建明细
            detail = ReturnOrderDetail(
                order_id=return_order.id,
                product_name=item.product_name,
                return_weight=item.return_weight,
                labor_cost=item.labor_cost,
                piece_count=item.piece_count,
                piece_labor_cost=item.piece_labor_cost,
                total_labor_cost=item_total_labor_cost,
                remark=item.remark
            )
            db.add(detail)
        
        # 库存将在确认(confirm)时更新，创建时不影响库存
        
        # 更新主表的总工费
        return_order.total_labor_cost = total_labor_cost
        
        db.commit()
        db.refresh(return_order)
        
        logger.info(f"退货单创建: {return_no}, 类型: {data.return_type}, 商品数: {len(data.items)}, 总克重: {total_weight}g, 总工费: {total_labor_cost}元, 状态: draft")
        
        return {
            "success": True,
            "message": f"退货单 {return_no} 创建成功（未确认），共 {len(data.items)} 个商品，总退货 {total_weight:.2f}g，总工费 {total_labor_cost:.2f}元",
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"创建退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": f"创建退货单失败: {str(e)}"}


@router.post("/{return_id}/confirm")
async def confirm_return_order(
    return_id: int,
    confirmed_by: str = Query(default="系统管理员", description="确认人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """确认退货单（库存生效）"""
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'canDelete'):
        raise HTTPException(status_code=403, detail="权限不足：无法确认退货单")
    
    return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
    if not return_order:
        return {"success": False, "message": "退货单不存在"}
    if return_order.status != "draft":
        return {"success": False, "message": f"退货单状态为 {return_order.status}，只有未确认的退货单才能确认"}
    
    # 获取明细
    details = db.query(ReturnOrderDetail).filter(ReturnOrderDetail.order_id == return_id).all()
    
    # 验证并扣减发起位置库存
    if return_order.from_location_id:
        location = db.query(Location).filter(Location.id == return_order.from_location_id).first()
        for detail in details:
            inventory = db.query(LocationInventory).filter(
                LocationInventory.location_id == return_order.from_location_id,
                LocationInventory.product_name == detail.product_name
            ).first()
            if not inventory or inventory.weight < detail.return_weight:
                available = inventory.weight if inventory else 0
                return {"success": False, "message": f"库存不足：{location.name if location else ''} 的 {detail.product_name} 仅有 {available:.2f}g"}
            inventory.weight -= detail.return_weight
            logger.info(f"扣减库存: {detail.product_name} -{detail.return_weight}g")
    
    # 如果是退给商品部，增加商品部库存
    if return_order.return_type == "to_warehouse":
        warehouse_location = db.query(Location).filter(Location.code == "warehouse", Location.is_active == 1).first()
        if warehouse_location:
            for detail in details:
                target_inv = db.query(LocationInventory).filter(
                    LocationInventory.location_id == warehouse_location.id,
                    LocationInventory.product_name == detail.product_name
                ).first()
                if target_inv:
                    target_inv.weight += detail.return_weight
                else:
                    target_inv = LocationInventory(product_name=detail.product_name, location_id=warehouse_location.id, weight=detail.return_weight)
                    db.add(target_inv)
    
    # 如果是退给供应商，更新供应商统计和金料账户
    if return_order.return_type == "to_supplier" and return_order.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
        if supplier:
            total_weight = sum(d.return_weight for d in details)
            supplier.total_supply_weight = round(supplier.total_supply_weight - total_weight, 3)
            if supplier.total_supply_count > 0:
                supplier.total_supply_count -= len(details)
            
            from ..models import SupplierGoldAccount, SupplierGoldTransaction
            supplier_gold_account = db.query(SupplierGoldAccount).filter(SupplierGoldAccount.supplier_id == return_order.supplier_id).first()
            if not supplier_gold_account:
                supplier_gold_account = SupplierGoldAccount(supplier_id=return_order.supplier_id, supplier_name=supplier.name, current_balance=0.0, total_received=0.0, total_paid=0.0)
                db.add(supplier_gold_account)
                db.flush()
            
            balance_before = supplier_gold_account.current_balance
            supplier_gold_account.current_balance = round(supplier_gold_account.current_balance - total_weight, 3)
            supplier_gold_account.total_received = round(supplier_gold_account.total_received - total_weight, 3)
            supplier_gold_account.last_transaction_at = china_now()
            
            supplier_gold_tx = SupplierGoldTransaction(supplier_id=return_order.supplier_id, supplier_name=supplier.name, transaction_type='return', gold_weight=total_weight, balance_before=balance_before, balance_after=supplier_gold_account.current_balance, status='active', created_by=confirmed_by, remark=f"退货单确认：{return_order.return_no}")
            db.add(supplier_gold_tx)
    
    # 更新状态
    return_order.status = "confirmed"
    return_order.completed_by = confirmed_by
    return_order.completed_at = china_now()
    
    # 写操作日志
    from ..models import OrderStatusLog
    status_log = OrderStatusLog(order_type="return", order_id=return_id, action="confirm", old_status="draft", new_status="confirmed", operated_by=confirmed_by)
    db.add(status_log)
    
    db.commit()
    logger.info(f"退货单已确认: {return_order.return_no}, 确认人: {confirmed_by}")
    
    return {"success": True, "message": f"退货单 {return_order.return_no} 已确认，库存已更新", "return_order": build_return_response(return_order, db)}


@router.post("/{return_id}/unconfirm")
async def unconfirm_return_order(
    return_id: int,
    operated_by: str = Query(default="系统管理员", description="操作人"),
    user_role: str = Query(default="manager", description="用户角色"),
    remark: str = Query(default="", description="反确认原因"),
    db: Session = Depends(get_db)
):
    """反确认退货单（回滚库存）"""
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'canDelete'):
        raise HTTPException(status_code=403, detail="权限不足：无法反确认退货单")
    
    return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
    if not return_order:
        return {"success": False, "message": "退货单不存在"}
    if return_order.status != "confirmed":
        return {"success": False, "message": f"退货单状态为 {return_order.status}，只有已确认的退货单才能反确认"}
    if return_order.is_audited:
        return {"success": False, "message": "退货单已审核，请先反审后再反确认"}
    
    details = db.query(ReturnOrderDetail).filter(ReturnOrderDetail.order_id == return_id).all()
    
    # 回滚发起位置库存（加回去）
    if return_order.from_location_id:
        for detail in details:
            inventory = db.query(LocationInventory).filter(
                LocationInventory.location_id == return_order.from_location_id,
                LocationInventory.product_name == detail.product_name
            ).first()
            if inventory:
                inventory.weight += detail.return_weight
    
    # 回滚商品部库存（扣回去）
    if return_order.return_type == "to_warehouse":
        warehouse_location = db.query(Location).filter(Location.code == "warehouse", Location.is_active == 1).first()
        if warehouse_location:
            for detail in details:
                target_inv = db.query(LocationInventory).filter(
                    LocationInventory.location_id == warehouse_location.id,
                    LocationInventory.product_name == detail.product_name
                ).first()
                if target_inv:
                    target_inv.weight -= detail.return_weight
    
    # 回滚供应商统计和金料账户
    if return_order.return_type == "to_supplier" and return_order.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
        if supplier:
            total_weight = sum(d.return_weight for d in details)
            supplier.total_supply_weight = round(supplier.total_supply_weight + total_weight, 3)
            supplier.total_supply_count += len(details)
            
            from ..models import SupplierGoldAccount, SupplierGoldTransaction
            supplier_gold_account = db.query(SupplierGoldAccount).filter(SupplierGoldAccount.supplier_id == return_order.supplier_id).first()
            if supplier_gold_account:
                balance_before = supplier_gold_account.current_balance
                supplier_gold_account.current_balance = round(supplier_gold_account.current_balance + total_weight, 3)
                supplier_gold_account.total_received = round(supplier_gold_account.total_received + total_weight, 3)
                supplier_gold_account.last_transaction_at = china_now()
                
                supplier_gold_tx = SupplierGoldTransaction(supplier_id=return_order.supplier_id, supplier_name=supplier.name, transaction_type='receive', gold_weight=total_weight, balance_before=balance_before, balance_after=supplier_gold_account.current_balance, status='active', created_by=operated_by, remark=f"退货单反确认：{return_order.return_no}")
                db.add(supplier_gold_tx)
    
    return_order.status = "draft"
    return_order.completed_by = None
    return_order.completed_at = None
    
    from ..models import OrderStatusLog
    status_log = OrderStatusLog(order_type="return", order_id=return_id, action="unconfirm", old_status="confirmed", new_status="draft", operated_by=operated_by, remark=remark or None)
    db.add(status_log)
    
    db.commit()
    logger.info(f"退货单已反确认: {return_order.return_no}, 操作人: {operated_by}")
    
    return {"success": True, "message": f"退货单 {return_order.return_no} 已反确认，库存已回滚"}


@router.put("/{return_id}")
async def update_return_order(
    return_id: int,
    updates: dict,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """编辑退货单（仅未确认状态可编辑）"""
    return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
    if not return_order:
        return {"success": False, "message": "退货单不存在"}
    if return_order.status != "draft":
        return {"success": False, "message": "只有未确认的退货单才能编辑"}
    
    # 更新基本字段
    if "return_reason" in updates:
        return_order.return_reason = updates["return_reason"]
    if "reason_detail" in updates:
        return_order.reason_detail = updates["reason_detail"]
    if "remark" in updates:
        return_order.remark = updates["remark"]
    
    db.commit()
    db.refresh(return_order)
    return {"success": True, "message": "退货单已更新", "return_order": build_return_response(return_order, db)}


@router.get("/stats/summary")
async def get_return_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取退货统计"""
    try:
        query = db.query(ReturnOrder)
        
        if start_date:
            query = query.filter(ReturnOrder.created_at >= start_date)
        if end_date:
            query = query.filter(ReturnOrder.created_at <= end_date + " 23:59:59")
        
        returns = query.all()
        
        # 统计
        total_count = len(returns)
        pending_count = len([r for r in returns if r.status == "draft"])
        approved_count = len([r for r in returns if r.status == "approved"])
        completed_count = len([r for r in returns if r.status in ("completed", "confirmed")])
        rejected_count = len([r for r in returns if r.status == "rejected"])
        
        to_supplier_count = len([r for r in returns if r.return_type == "to_supplier"])
        to_warehouse_count = len([r for r in returns if r.return_type == "to_warehouse"])
        
        total_weight = sum(r.return_weight for r in returns if r.status in ("completed", "confirmed"))
        
        # 按原因统计
        reason_stats = {}
        for r in returns:
            if r.return_reason not in reason_stats:
                reason_stats[r.return_reason] = {"count": 0, "weight": 0}
            reason_stats[r.return_reason]["count"] += 1
            if r.status in ("completed", "confirmed"):
                reason_stats[r.return_reason]["weight"] += r.return_weight
        
        return {
            "success": True,
            "stats": {
                "total_count": total_count,
                "pending_count": pending_count,
                "approved_count": approved_count,
                "completed_count": completed_count,
                "rejected_count": rejected_count,
                "to_supplier_count": to_supplier_count,
                "to_warehouse_count": to_warehouse_count,
                "total_completed_weight": total_weight,
                "reason_stats": reason_stats
            }
        }
    except Exception as e:
        logger.error(f"获取退货统计失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/{return_id}")
async def get_return_order(
    return_id: int,
    db: Session = Depends(get_db)
):
    """获取退货单详情"""
    try:
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "message": "退货单不存在"}
        
        return {
            "success": True,
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"获取退货单详情失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.options("/{return_id}/download")
async def download_return_order_options(return_id: int):
    """处理CORS预检请求"""
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/{return_id}/download")
async def download_return_order(
    return_id: int,
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    doc_type: str = Query("return", pattern="^(return|stock_out|purchase_return)$", 
                          description="单据类型：return=退货单（柜台/结算用），stock_out=退库单（商品部内部用），purchase_return=采购退货单（财务对账用）"),
    db: Session = Depends(get_db)
):
    """下载或打印退货单/退库单/采购退货单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载退货单请求: return_id={return_id}, format={format}, doc_type={doc_type}")
        
        # 查询退货单
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            raise HTTPException(status_code=404, detail="退货单不存在")
        
        # 获取关联信息
        from_location_name = None
        supplier_name = None
        inbound_order_no = None
        
        if return_order.from_location_id:
            location = db.query(Location).filter(Location.id == return_order.from_location_id).first()
            if location:
                from_location_name = location.name
        
        if return_order.supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
            if supplier:
                supplier_name = supplier.name
        
        if return_order.inbound_order_id:
            inbound = db.query(InboundOrder).filter(InboundOrder.id == return_order.inbound_order_id).first()
            if inbound:
                inbound_order_no = inbound.order_no
        
        # 根据doc_type设置标题和文件名前缀
        if doc_type == "stock_out":
            doc_title = "退库单"
            file_prefix = "stock_out"
        elif doc_type == "purchase_return":
            doc_title = "采购退货单"
            file_prefix = "purchase_return"
        else:
            doc_title = "退货单"
            file_prefix = "return_order"
        
        # 获取退货明细用于计算动态高度
        details = db.query(ReturnOrderDetail).filter(
            ReturnOrderDetail.order_id == return_id
        ).all()
        detail_count = len(details) if details else 1
        
        if format == "pdf":
            try:
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                import io
                import math
                from ..timezone_utils import to_china_time, format_china_time
                
                # ========== 动态高度计算 ==========
                PAGE_WIDTH = 241 * mm
                base_height = 80 * mm   # 页头页尾固定部分
                row_height = 12 * mm    # 每行明细高度
                content_height = base_height + (row_height * detail_count)
                
                # 按140mm的倍数向上取整（最小140mm）
                min_unit = 140 * mm
                PAGE_HEIGHT = max(min_unit, math.ceil(content_height / min_unit) * min_unit)
                # ========== 动态高度计算完成 ==========
                
                buffer = io.BytesIO()
                p = canvas.Canvas(buffer, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
                width, height = PAGE_WIDTH, PAGE_HEIGHT
                
                # 使用 CID 字体
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    chinese_font = 'STSong-Light'
                except Exception as cid_error:
                    logger.warning(f"注册CID字体失败: {cid_error}")
                    chinese_font = None
                
                # 页边距
                left_margin = 8 * mm
                right_margin = width - 8 * mm
                top_margin = height - 6 * mm
                
                # 标题（居中）
                if chinese_font:
                    p.setFont(chinese_font, 12)
                else:
                    p.setFont("Helvetica-Bold", 12)
                p.drawCentredString(width / 2, top_margin, doc_title)
                
                # 退货类型
                return_type_str = "退给供应商" if return_order.return_type == "to_supplier" else "退给商品部"
                status_map = {
                    "draft": "未确认",
                    "confirmed": "已确认",
                    "cancelled": "已取消",
                    "completed": "已完成",
                    "pending": "待审批",
                    "approved": "已批准",
                    "rejected": "已驳回"
                }
                status_str = status_map.get(return_order.status, return_order.status)
                
                # 创建时间
                if return_order.created_at:
                    china_time = to_china_time(return_order.created_at)
                    create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M')
                else:
                    create_time_str = "未知"
                
                # 基本信息（紧凑两列布局）
                y = top_margin - 14
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica", 8)
                
                p.drawString(left_margin, y, f"单号：{return_order.return_no}")
                p.drawString(width/2, y, f"时间：{create_time_str}")
                y -= 10
                p.drawString(left_margin, y, f"类型：{return_type_str}  状态：{status_str}")
                if return_order.created_by:
                    p.drawString(width/2, y, f"创建人：{return_order.created_by}")
                y -= 12
                
                # 分隔线
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 商品信息
                product_name = return_order.product_name[:15] if len(return_order.product_name) > 15 else return_order.product_name
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica", 8)
                p.drawString(left_margin, y, f"商品：{product_name}")
                p.drawString(width/2, y, f"克重：{return_order.return_weight:.2f}g")
                y -= 10
                
                # 供应商/位置信息
                if return_order.return_type == "to_supplier" and supplier_name:
                    supplier_short = supplier_name[:10] if len(supplier_name) > 10 else supplier_name
                    if chinese_font:
                        p.setFont(chinese_font, 8)
                    p.drawString(left_margin, y, f"供应商：{supplier_short}")
                if from_location_name:
                    p.drawString(width/2, y, f"发起位置：{from_location_name}")
                y -= 10
                
                # 退货原因
                reason_short = return_order.return_reason[:20] if len(return_order.return_reason) > 20 else return_order.return_reason
                if chinese_font:
                    p.setFont(chinese_font, 8)
                p.drawString(left_margin, y, f"原因：{reason_short}")
                y -= 12
                
                # 分隔线
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 审批信息
                if return_order.approved_by:
                    if chinese_font:
                        p.setFont(chinese_font, 8)
                    p.drawString(left_margin, y, f"审批人：{return_order.approved_by}")
                    if return_order.approved_at:
                        approved_time = to_china_time(return_order.approved_at)
                        approved_time_str = format_china_time(approved_time, '%Y-%m-%d %H:%M')
                        p.drawString(width/2, y, f"审批时间：{approved_time_str}")
                    y -= 10
                
                # 备注
                if return_order.remark:
                    remark_short = return_order.remark[:30] if len(return_order.remark) > 30 else return_order.remark
                    if chinese_font:
                        p.setFont(chinese_font, 7)
                    p.drawString(left_margin, y, f"备注：{remark_short}")
                
                p.save()
                buffer.seek(0)
                
                from fastapi.responses import Response
                filename = f"{file_prefix}_{return_order.return_no}.pdf"
                return Response(
                    content=buffer.getvalue(),
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{filename}"',
                        "Access-Control-Allow-Origin": "*",
                    }
                )
            except Exception as pdf_error:
                logger.error(f"生成PDF失败: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
        
        elif format == "html":
            # 生成HTML（用于打印）
            from fastapi.responses import HTMLResponse
            from ..timezone_utils import to_china_time, format_china_time
            
            return_type_str = "退给供应商" if return_order.return_type == "to_supplier" else "退给商品部"
            status_map = {
                "draft": "未确认",
                "confirmed": "已确认",
                "cancelled": "已取消",
                "completed": "已完成",
                "pending": "待审批",
                "approved": "已批准",
                "rejected": "已驳回"
            }
            status_str = status_map.get(return_order.status, return_order.status)
            
            create_time_str = "未知"
            if return_order.created_at:
                china_time = to_china_time(return_order.created_at)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            
            approved_time_str = ""
            if return_order.approved_at:
                approved_time = to_china_time(return_order.approved_at)
                approved_time_str = format_china_time(approved_time, '%Y-%m-%d %H:%M:%S')
            
            html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>退货单 - {return_order.return_no}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: 'Microsoft YaHei', 'SimHei', Arial, sans-serif;
            padding: 40px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        .header {{
            text-align: center;
            border-bottom: 3px solid #ef4444;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }}
        .header h1 {{
            font-size: 32px;
            color: #ef4444;
            margin-bottom: 10px;
        }}
        .info-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }}
        .info-item {{
            padding: 15px;
            background: #f9fafb;
            border-radius: 8px;
        }}
        .info-label {{
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 5px;
        }}
        .info-value {{
            font-size: 16px;
            font-weight: 600;
            color: #111827;
        }}
        .full-width {{
            grid-column: 1 / -1;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 12px;
        }}
        @media print {{
            body {{
                background: white;
                padding: 0;
            }}
            .container {{
                box-shadow: none;
                padding: 20px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{doc_title}</h1>
        </div>
        
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">退货单号</div>
                <div class="info-value">{return_order.return_no}</div>
            </div>
            <div class="info-item">
                <div class="info-label">退货类型</div>
                <div class="info-value">{return_type_str}</div>
            </div>
            <div class="info-item">
                <div class="info-label">商品名称</div>
                <div class="info-value">{return_order.product_name}</div>
            </div>
            <div class="info-item">
                <div class="info-label">退货克重</div>
                <div class="info-value">{return_order.return_weight:.2f} 克</div>
            </div>
            {f'<div class="info-item"><div class="info-label">供应商</div><div class="info-value">{supplier_name or "-"}</div></div>' if return_order.return_type == "to_supplier" else ''}
            {f'<div class="info-item"><div class="info-label">发起位置</div><div class="info-value">{from_location_name or "-"}</div></div>' if from_location_name else ''}
            <div class="info-item">
                <div class="info-label">退货原因</div>
                <div class="info-value">{return_order.return_reason}</div>
            </div>
            <div class="info-item">
                <div class="info-label">状态</div>
                <div class="info-value">{status_str}</div>
            </div>
            {f'<div class="info-item full-width"><div class="info-label">详细说明</div><div class="info-value">{return_order.reason_detail or "-"}</div></div>' if return_order.reason_detail else ''}
            <div class="info-item">
                <div class="info-label">创建时间</div>
                <div class="info-value">{create_time_str}</div>
            </div>
            {f'<div class="info-item"><div class="info-label">创建人</div><div class="info-value">{return_order.created_by or "-"}</div></div>' if return_order.created_by else ''}
            {f'<div class="info-item"><div class="info-label">审批人</div><div class="info-value">{return_order.approved_by or "-"}</div></div>' if return_order.approved_by else ''}
            {f'<div class="info-item"><div class="info-label">审批时间</div><div class="info-value">{approved_time_str}</div></div>' if approved_time_str else ''}
            {f'<div class="info-item full-width"><div class="info-label">备注</div><div class="info-value">{return_order.remark or "-"}</div></div>' if return_order.remark else ''}
        </div>
        
        <div class="footer">
            <p>打印时间：{format_china_time(to_china_time(datetime.now()), '%Y-%m-%d %H:%M:%S')}</p>
        </div>
    </div>
</body>
</html>
"""
            
            return HTMLResponse(
                content=html_content,
                headers={
                    "Access-Control-Allow-Origin": "*",
                }
            )
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式，请使用 pdf 或 html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成退货单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成退货单失败: {str(e)}")


# ============= 财务审核相关端点 =============

# 权限检查函数
def has_audit_permission(user_role: str) -> bool:
    """检查是否有审核退货单的权限"""
    # 财务和管理层可以审核
    return user_role in ['finance', 'manager']


@router.post("/{return_id}/audit")
async def audit_return(
    return_id: int,
    user_role: str = Query(..., description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    审核退货单（财务审核）
    - 仅财务和管理层可以审核
    - 审核后不影响退货单的业务状态
    """
    try:
        # 权限检查
        if not has_audit_permission(user_role):
            return {"success": False, "error": "权限不足：只有财务和管理层可以审核退货单"}
        
        # 查询退货单
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "error": "退货单不存在"}
        
        # 检查是否已审核
        if return_order.is_audited:
            return {"success": False, "error": "退货单已审核"}
        
        # 执行审核
        return_order.is_audited = True
        return_order.audited_by = user_role
        return_order.audited_at = china_now()
        db.commit()
        
        logger.info(f"退货单 {return_order.return_no} 已审核，审核人: {user_role}")
        
        return {
            "success": True,
            "message": "审核成功",
            "return_id": return_id,
            "return_no": return_order.return_no
        }
    
    except Exception as e:
        logger.error(f"审核退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "error": f"审核失败: {str(e)}"}


@router.post("/{return_id}/unaudit")
async def unaudit_return(
    return_id: int,
    user_role: str = Query(..., description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    反审退货单（取消财务审核）
    - 仅财务和管理层可以反审
    """
    try:
        # 权限检查
        if not has_audit_permission(user_role):
            return {"success": False, "error": "权限不足：只有财务和管理层可以反审退货单"}
        
        # 查询退货单
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "error": "退货单不存在"}
        
        # 检查是否已审核
        if not return_order.is_audited:
            return {"success": False, "error": "退货单未审核"}
        
        # 执行反审
        return_order.is_audited = False
        return_order.audited_by = None
        return_order.audited_at = None
        db.commit()
        
        logger.info(f"退货单 {return_order.return_no} 已反审，操作人: {user_role}")
        
        return {
            "success": True,
            "message": "反审成功",
            "return_id": return_id,
            "return_no": return_order.return_no
        }
    
    except Exception as e:
        logger.error(f"反审退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "error": f"反审失败: {str(e)}"}

