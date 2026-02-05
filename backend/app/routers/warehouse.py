"""
仓库/分仓库存管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
import logging

from ..database import get_db
from ..timezone_utils import china_now
from ..models import Location, LocationInventory, InventoryTransfer, Inventory, InventoryTransferOrder, InventoryTransferItem
from ..utils.pinyin_utils import to_pinyin_initials
from ..schemas import (
    LocationCreate,
    LocationResponse,
    LocationInventoryResponse,
    LocationInventorySummary,
    InventoryTransferCreate,
    InventoryTransferReceive,
    InventoryTransferResponse,
    TransferOrderCreate,
    TransferOrderReceive,
    TransferOrderResponse,
    TransferItemResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/warehouse", tags=["仓库管理"])


# ============= 仓库/位置管理 =============

@router.get("/locations", response_model=List[LocationResponse])
async def get_locations(
    location_type: Optional[str] = None,
    is_active: Optional[int] = 1,
    db: Session = Depends(get_db)
):
    """获取仓库/位置列表"""
    query = db.query(Location)
    
    if location_type:
        query = query.filter(Location.location_type == location_type)
    if is_active is not None:
        query = query.filter(Location.is_active == is_active)
    
    locations = query.order_by(Location.id).all()
    return locations


@router.post("/locations", response_model=LocationResponse)
async def create_location(
    location: LocationCreate,
    db: Session = Depends(get_db)
):
    """创建仓库/位置"""
    # 检查代码是否已存在
    existing = db.query(Location).filter(Location.code == location.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"位置代码 {location.code} 已存在")
    
    db_location = Location(
        code=location.code,
        name=location.name,
        location_type=location.location_type,
        description=location.description
    )
    db.add(db_location)
    db.commit()
    db.refresh(db_location)
    
    logger.info(f"创建位置: {db_location.name} ({db_location.code})")
    return db_location


@router.put("/locations/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: int,
    location: LocationCreate,
    db: Session = Depends(get_db)
):
    """更新仓库/位置"""
    db_location = db.query(Location).filter(Location.id == location_id).first()
    if not db_location:
        raise HTTPException(status_code=404, detail="位置不存在")
    
    db_location.name = location.name
    db_location.location_type = location.location_type
    db_location.description = location.description
    
    db.commit()
    db.refresh(db_location)
    return db_location


@router.delete("/locations/{location_id}")
async def delete_location(
    location_id: int,
    db: Session = Depends(get_db)
):
    """删除/停用仓库/位置"""
    db_location = db.query(Location).filter(Location.id == location_id).first()
    if not db_location:
        raise HTTPException(status_code=404, detail="位置不存在")
    
    # 检查是否有库存
    has_inventory = db.query(LocationInventory).filter(
        LocationInventory.location_id == location_id,
        LocationInventory.weight > 0
    ).first()
    
    if has_inventory:
        # 如果有库存，只能停用，不能删除
        db_location.is_active = 0
        db.commit()
        return {"message": "位置已停用（仍有库存，无法删除）"}
    
    db.delete(db_location)
    db.commit()
    return {"message": "位置已删除"}


# ============= 分仓库存管理 =============

@router.get("/inventory", response_model=List[LocationInventoryResponse])
async def get_location_inventory(
    location_id: Optional[int] = None,
    product_name: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000, description="返回数量限制"),
    db: Session = Depends(get_db)
):
    """获取分仓库存列表（已优化：joinedload 预加载避免 N+1）"""
    # 使用 joinedload 预加载关联的 Location 对象
    query = db.query(LocationInventory).options(
        joinedload(LocationInventory.location)
    )
    
    if location_id:
        query = query.filter(LocationInventory.location_id == location_id)
    if product_name:
        query = query.filter(LocationInventory.product_name.contains(product_name))
    
    # 只返回有库存的记录
    query = query.filter(LocationInventory.weight > 0)
    
    items = query.order_by(LocationInventory.location_id, LocationInventory.product_name).limit(limit).all()
    
    # 添加位置信息和拼音首字母（关联数据已预加载，无额外查询）
    result = []
    for item in items:
        item_dict = {
            "id": item.id,
            "product_name": item.product_name,
            "pinyin_initials": to_pinyin_initials(item.product_name),
            "location_id": item.location_id,
            "location_name": item.location.name if item.location else None,
            "location_code": item.location.code if item.location else None,
            "weight": item.weight,
            "last_update": item.last_update
        }
        result.append(LocationInventoryResponse(**item_dict))
    
    return result


@router.get("/inventory/summary", response_model=List[LocationInventorySummary])
async def get_inventory_summary(
    product_name: Optional[str] = None,
    limit: Optional[int] = Query(default=200, description="返回记录数限制"),
    db: Session = Depends(get_db)
):
    """获取库存汇总（按商品分组，显示各位置库存、件数、金额）"""
    from sqlalchemy import func
    from sqlalchemy.orm import joinedload
    from ..models import InboundDetail
    
    # 使用 joinedload 预加载 Location 避免 N+1 查询
    query = db.query(LocationInventory).options(
        joinedload(LocationInventory.location)
    ).filter(LocationInventory.weight > 0)
    
    if product_name:
        query = query.filter(LocationInventory.product_name.contains(product_name))
    
    # 添加 limit 限制返回数量，提升性能
    items = query.order_by(LocationInventory.product_name, LocationInventory.location_id).limit(limit).all()
    
    # 获取所有商品名称
    product_names = list(set(item.product_name for item in items))
    
    # 从入库明细表统计每个商品的件数和金额
    product_stats = {}
    if product_names:
        stats_query = db.query(
            InboundDetail.product_name,
            func.count(InboundDetail.id).label("quantity"),
            func.sum(InboundDetail.total_cost).label("total_amount")
        ).filter(
            InboundDetail.product_name.in_(product_names)
        ).group_by(InboundDetail.product_name).all()
        
        for stat in stats_query:
            product_stats[stat.product_name] = {
                "quantity": stat.quantity or 0,
                "total_amount": float(stat.total_amount or 0)
            }
    
    # 按商品分组
    summary = {}
    for item in items:
        if item.product_name not in summary:
            stats = product_stats.get(item.product_name, {"quantity": 0, "total_amount": 0})
            summary[item.product_name] = {
                "product_name": item.product_name,
                "total_weight": 0,
                "quantity": stats["quantity"],
                "total_amount": stats["total_amount"],
                "locations": []
            }
        summary[item.product_name]["total_weight"] += item.weight
        summary[item.product_name]["locations"].append(
            LocationInventoryResponse(
                id=item.id,
                product_name=item.product_name,
                location_id=item.location_id,
                location_name=item.location.name if item.location else None,
                location_code=item.location.code if item.location else None,
                weight=item.weight,
                last_update=item.last_update
            )
        )
    
    return list(summary.values())


# ============= 货品转移管理 =============

@router.get("/transfers", response_model=List[InventoryTransferResponse])
async def get_transfers(
    status: Optional[str] = None,
    from_location_id: Optional[int] = None,
    to_location_id: Optional[int] = None,
    limit: int = Query(100, ge=1, le=500, description="返回数量限制"),
    db: Session = Depends(get_db)
):
    """获取货品转移单列表（已优化：joinedload 预加载避免 N+1）"""
    # 使用 joinedload 预加载关联的 Location 对象
    query = db.query(InventoryTransfer).options(
        joinedload(InventoryTransfer.from_location),
        joinedload(InventoryTransfer.to_location)
    )
    
    if status:
        query = query.filter(InventoryTransfer.status == status)
    if from_location_id:
        query = query.filter(InventoryTransfer.from_location_id == from_location_id)
    if to_location_id:
        query = query.filter(InventoryTransfer.to_location_id == to_location_id)
    
    transfers = query.order_by(InventoryTransfer.created_at.desc()).limit(limit).all()
    
    # 添加位置名称（关联数据已预加载，无额外查询）
    result = []
    for t in transfers:
        t_dict = {
            "id": t.id,
            "transfer_no": t.transfer_no,
            "product_name": t.product_name,
            "weight": t.weight,
            "from_location_id": t.from_location_id,
            "to_location_id": t.to_location_id,
            "from_location_name": t.from_location.name if t.from_location else None,
            "to_location_name": t.to_location.name if t.to_location else None,
            "status": t.status,
            "created_by": t.created_by,
            "created_at": t.created_at,
            "remark": t.remark,
            "received_by": t.received_by,
            "received_at": t.received_at,
            "actual_weight": t.actual_weight,
            "weight_diff": t.weight_diff,
            "diff_reason": t.diff_reason
        }
        result.append(InventoryTransferResponse(**t_dict))
    
    return result


@router.post("/transfers", response_model=InventoryTransferResponse)
async def create_transfer(
    transfer: InventoryTransferCreate,
    created_by: str = "系统管理员",
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """创建货品转移单"""
    # 权限检查
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【发起库存转移】的权限")
    # 验证位置
    from_location = db.query(Location).filter(Location.id == transfer.from_location_id).first()
    to_location = db.query(Location).filter(Location.id == transfer.to_location_id).first()
    
    if not from_location:
        raise HTTPException(status_code=404, detail="发出位置不存在")
    if not to_location:
        raise HTTPException(status_code=404, detail="目标位置不存在")
    if transfer.from_location_id == transfer.to_location_id:
        raise HTTPException(status_code=400, detail="发出位置和目标位置不能相同")
    
    # 检查发出位置库存是否充足
    from_inventory = db.query(LocationInventory).filter(
        LocationInventory.location_id == transfer.from_location_id,
        LocationInventory.product_name == transfer.product_name
    ).first()
    
    if not from_inventory or from_inventory.weight < transfer.weight:
        available = from_inventory.weight if from_inventory else 0
        raise HTTPException(
            status_code=400, 
            detail=f"库存不足：{from_location.name} 的 {transfer.product_name} 仅有 {available}g，无法转移 {transfer.weight}g"
        )
    
    # 生成转移单号
    now = china_now()
    count = db.query(InventoryTransfer).filter(
        InventoryTransfer.transfer_no.like(f"TR{now.strftime('%Y%m%d')}%")
    ).count()
    transfer_no = f"TR{now.strftime('%Y%m%d')}{count + 1:03d}"
    
    # 创建转移单
    db_transfer = InventoryTransfer(
        transfer_no=transfer_no,
        product_name=transfer.product_name,
        weight=transfer.weight,
        from_location_id=transfer.from_location_id,
        to_location_id=transfer.to_location_id,
        status="pending",
        created_by=created_by,
        remark=transfer.remark,
        created_at=china_now()  # 显式设置中国时间
    )
    db.add(db_transfer)
    
    # 扣减发出位置库存
    from_inventory.weight -= transfer.weight
    
    # 创建"在途"记录（可选：直接加到目标位置的待接收中）
    # 这里我们先扣减发出位置，接收时再加到目标位置
    
    db.commit()
    db.refresh(db_transfer)
    
    logger.info(f"创建转移单: {transfer_no}, {transfer.product_name} {transfer.weight}g, "
                f"{from_location.name} -> {to_location.name}")
    
    return InventoryTransferResponse(
        id=db_transfer.id,
        transfer_no=db_transfer.transfer_no,
        product_name=db_transfer.product_name,
        weight=db_transfer.weight,
        from_location_id=db_transfer.from_location_id,
        to_location_id=db_transfer.to_location_id,
        from_location_name=from_location.name,
        to_location_name=to_location.name,
        status=db_transfer.status,
        created_by=db_transfer.created_by,
        created_at=db_transfer.created_at,
        remark=db_transfer.remark,
        received_by=None,
        received_at=None,
        actual_weight=None,
        weight_diff=None,
        diff_reason=None
    )


class BatchTransferItem(BaseModel):
    """批量转移单项"""
    product_name: str
    weight: float
    
class BatchTransferCreate(BaseModel):
    """批量创建转移单请求"""
    items: List[BatchTransferItem]
    from_location_id: int
    to_location_id: int
    remark: Optional[str] = None


@router.post("/transfers/batch")
async def create_batch_transfers(
    data: BatchTransferCreate,
    created_by: str = Query(default="系统管理员", description="创建人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """批量创建货品转移单"""
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【发起库存转移】的权限")
    
    # 验证位置
    from_location = db.query(Location).filter(Location.id == data.from_location_id).first()
    to_location = db.query(Location).filter(Location.id == data.to_location_id).first()
    
    if not from_location:
        raise HTTPException(status_code=404, detail="发出位置不存在")
    if not to_location:
        raise HTTPException(status_code=404, detail="目标位置不存在")
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="发出位置和目标位置不能相同")
    
    if not data.items or len(data.items) == 0:
        raise HTTPException(status_code=400, detail="转移商品列表不能为空")
    
    created_transfers = []
    errors = []
    
    for item in data.items:
        try:
            # 检查库存
            inventory = db.query(LocationInventory).filter(
                LocationInventory.location_id == data.from_location_id,
                LocationInventory.product_name == item.product_name
            ).first()
            
            if not inventory or inventory.weight < item.weight:
                errors.append(f"{item.product_name}: 库存不足")
                continue
            
            # 扣减库存
            inventory.weight -= item.weight
            inventory.updated_at = china_now()
            
            # 生成转移单号
            transfer_no = f"ZY{datetime.now().strftime('%Y%m%d%H%M%S')}{len(created_transfers):03d}"
            
            # 创建转移单
            new_transfer = InventoryTransfer(
                transfer_no=transfer_no,
                product_name=item.product_name,
                weight=item.weight,
                from_location_id=data.from_location_id,
                to_location_id=data.to_location_id,
                status="pending",
                created_by=created_by,
                created_at=china_now(),
                remark=data.remark
            )
            db.add(new_transfer)
            created_transfers.append({
                "product_name": item.product_name,
                "weight": item.weight,
                "transfer_no": transfer_no
            })
        except Exception as e:
            errors.append(f"{item.product_name}: {str(e)}")
    
    db.commit()
    
    total_weight = sum(t["weight"] for t in created_transfers)
    
    return {
        "success": True,
        "created_count": len(created_transfers),
        "total_weight": total_weight,
        "created_transfers": created_transfers,
        "errors": errors,
        "message": f"成功创建 {len(created_transfers)} 个转移单" + (f"，{len(errors)} 个失败" if errors else "")
    }


@router.post("/transfers/{transfer_id}/receive", response_model=InventoryTransferResponse)
async def receive_transfer(
    transfer_id: int,
    receive_data: InventoryTransferReceive,
    received_by: str = "系统管理员",
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """接收货品转移
    
    如果实际重量与预期重量一致（差异 < 0.01g），直接完成接收。
    如果重量不符，状态变为 pending_confirm，等待商品专员确认。
    """
    # 权限检查
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_receive_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【接收库存】的权限")
    transfer = db.query(InventoryTransfer).filter(InventoryTransfer.id == transfer_id).first()
    
    if not transfer:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if transfer.status != "pending":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {transfer.status}，无法接收")
    
    # 计算重量差异
    weight_diff = receive_data.actual_weight - transfer.weight
    
    # 更新基本信息
    transfer.received_by = received_by
    transfer.received_at = china_now()
    transfer.actual_weight = receive_data.actual_weight
    transfer.weight_diff = weight_diff
    transfer.diff_reason = receive_data.diff_reason
    
    # 判断是否需要审批：差异超过 0.01g 需要商品专员确认
    if abs(weight_diff) < 0.01:
        # 无差异，直接完成接收
        transfer.status = "received"
        
        # 增加目标位置库存
        to_inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == transfer.to_location_id,
            LocationInventory.product_name == transfer.product_name
        ).first()
        
        if to_inventory:
            to_inventory.weight += receive_data.actual_weight
        else:
            to_inventory = LocationInventory(
                product_name=transfer.product_name,
                location_id=transfer.to_location_id,
                weight=receive_data.actual_weight
            )
            db.add(to_inventory)
        
        logger.info(f"接收转移单: {transfer.transfer_no}, 无差异直接完成")
    else:
        # 有差异，需要商品专员确认
        if not receive_data.diff_reason:
            raise HTTPException(status_code=400, detail="重量不符时必须填写差异原因")
        transfer.status = "pending_confirm"
        logger.info(f"接收转移单待确认: {transfer.transfer_no}, 差异 {weight_diff}g, 原因: {receive_data.diff_reason}")
    
    db.commit()
    db.refresh(transfer)
    
    return InventoryTransferResponse(
        id=transfer.id,
        transfer_no=transfer.transfer_no,
        product_name=transfer.product_name,
        weight=transfer.weight,
        from_location_id=transfer.from_location_id,
        to_location_id=transfer.to_location_id,
        from_location_name=transfer.from_location.name if transfer.from_location else None,
        to_location_name=transfer.to_location.name if transfer.to_location else None,
        status=transfer.status,
        created_by=transfer.created_by,
        created_at=transfer.created_at,
        remark=transfer.remark,
        received_by=transfer.received_by,
        received_at=transfer.received_at,
        actual_weight=transfer.actual_weight,
        weight_diff=transfer.weight_diff,
        diff_reason=transfer.diff_reason
    )


@router.post("/transfers/{transfer_id}/confirm", response_model=InventoryTransferResponse)
async def confirm_transfer(
    transfer_id: int,
    confirmed_by: str = "系统管理员",
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """商品专员确认转移单（同意柜台填写的实际重量）"""
    # 权限检查：只有商品专员或管理员可以确认
    if user_role not in ['product', 'manager']:
        raise HTTPException(status_code=403, detail="权限不足：只有商品专员可以确认转移单")
    
    transfer = db.query(InventoryTransfer).filter(InventoryTransfer.id == transfer_id).first()
    
    if not transfer:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if transfer.status != "pending_confirm":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {transfer.status}，无法确认")
    
    # 更新状态为已接收
    transfer.status = "received"
    
    # 按实际重量增加目标位置库存
    to_inventory = db.query(LocationInventory).filter(
        LocationInventory.location_id == transfer.to_location_id,
        LocationInventory.product_name == transfer.product_name
    ).first()
    
    if to_inventory:
        to_inventory.weight += transfer.actual_weight
    else:
        to_inventory = LocationInventory(
            product_name=transfer.product_name,
            location_id=transfer.to_location_id,
            weight=transfer.actual_weight
        )
        db.add(to_inventory)
    
    db.commit()
    db.refresh(transfer)
    
    logger.info(f"确认转移单: {transfer.transfer_no}, 按实际重量 {transfer.actual_weight}g 入库, 确认人: {confirmed_by}")
    
    return InventoryTransferResponse(
        id=transfer.id,
        transfer_no=transfer.transfer_no,
        product_name=transfer.product_name,
        weight=transfer.weight,
        from_location_id=transfer.from_location_id,
        to_location_id=transfer.to_location_id,
        from_location_name=transfer.from_location.name if transfer.from_location else None,
        to_location_name=transfer.to_location.name if transfer.to_location else None,
        status=transfer.status,
        created_by=transfer.created_by,
        created_at=transfer.created_at,
        remark=transfer.remark,
        received_by=transfer.received_by,
        received_at=transfer.received_at,
        actual_weight=transfer.actual_weight,
        weight_diff=transfer.weight_diff,
        diff_reason=transfer.diff_reason
    )


@router.post("/transfers/{transfer_id}/reject-confirm")
async def reject_confirm_transfer(
    transfer_id: int,
    reason: str = Query(..., description="拒绝原因"),
    rejected_by: str = "系统管理员",
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """商品专员拒绝确认转移单（退回库存到商品部仓库）
    
    流程：
    1. 状态变为 returned（已退回，转移单结束）
    2. 保留接收信息用于历史记录
    3. 备注追加操作历史（留痕）
    4. 库存退回商品部
    5. 如需重新转移，商品专员新建转移单
    """
    # 权限检查：只有商品专员或管理员可以拒绝
    if user_role not in ['product', 'manager']:
        raise HTTPException(status_code=403, detail="权限不足：只有商品专员可以拒绝确认")
    
    transfer = db.query(InventoryTransfer).filter(InventoryTransfer.id == transfer_id).first()
    
    if not transfer:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if transfer.status != "pending_confirm":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {transfer.status}，无法拒绝")
    
    # 记录本次接收信息用于历史记录
    old_actual_weight = transfer.actual_weight
    old_weight_diff = transfer.weight_diff
    old_diff_reason = transfer.diff_reason
    old_received_by = transfer.received_by
    old_received_at = transfer.received_at
    
    # 追加操作历史到备注（留痕）
    now = china_now()
    history_entry = f"\n---\n[{now.strftime('%Y-%m-%d %H:%M')}] 商品部拒绝确认：\n"
    history_entry += f"  柜台接收: {old_received_by} 于 {old_received_at.strftime('%Y-%m-%d %H:%M') if old_received_at else '-'}\n"
    history_entry += f"  实际重量: {old_actual_weight}g, 差异: {old_weight_diff}g\n"
    history_entry += f"  差异原因: {old_diff_reason}\n"
    history_entry += f"  拒绝原因: {reason}\n"
    history_entry += f"  处理结果: 库存{transfer.weight}g已退回商品部仓库"
    
    transfer.remark = (transfer.remark or "") + history_entry
    
    # 状态变为 returned（已退回，转移单结束）
    transfer.status = "returned"
    
    # 保留接收信息用于历史记录（不清空）
    # 追加拒绝原因到 diff_reason
    transfer.diff_reason = f"{old_diff_reason} | [商品部拒绝] {reason}"
    
    # 退回库存到发出位置（商品部仓库）
    from_inventory = db.query(LocationInventory).filter(
        LocationInventory.location_id == transfer.from_location_id,
        LocationInventory.product_name == transfer.product_name
    ).first()
    
    if from_inventory:
        from_inventory.weight += transfer.weight  # 按原始重量退回
    else:
        from_inventory = LocationInventory(
            product_name=transfer.product_name,
            location_id=transfer.from_location_id,
            weight=transfer.weight
        )
        db.add(from_inventory)
    
    db.commit()
    db.refresh(transfer)
    
    logger.info(f"拒绝确认转移单: {transfer.transfer_no}, 原因: {reason}, "
                f"库存 {transfer.weight}g 退回发出位置, 状态变为 returned")
    
    return {
        "success": True,
        "message": f"已拒绝，{transfer.weight}g 库存已退回商品部仓库。如需重新转移请新建转移单。",
        "transfer_id": transfer.id,
        "transfer_no": transfer.transfer_no,
        "new_status": "returned"
    }


@router.post("/transfers/{transfer_id}/reject", response_model=InventoryTransferResponse)
async def reject_transfer(
    transfer_id: int,
    reason: str = "拒收",
    received_by: str = "系统管理员",
    db: Session = Depends(get_db)
):
    """拒收货品转移（退回发出位置）"""
    transfer = db.query(InventoryTransfer).filter(InventoryTransfer.id == transfer_id).first()
    
    if not transfer:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if transfer.status != "pending":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {transfer.status}，无法拒收")
    
    # 更新转移单状态
    transfer.status = "rejected"
    transfer.received_by = received_by
    transfer.received_at = china_now()
    transfer.diff_reason = reason
    
    # 退回发出位置库存
    from_inventory = db.query(LocationInventory).filter(
        LocationInventory.location_id == transfer.from_location_id,
        LocationInventory.product_name == transfer.product_name
    ).first()
    
    if from_inventory:
        from_inventory.weight += transfer.weight
    else:
        from_inventory = LocationInventory(
            product_name=transfer.product_name,
            location_id=transfer.from_location_id,
            weight=transfer.weight
        )
        db.add(from_inventory)
    
    db.commit()
    db.refresh(transfer)
    
    logger.info(f"拒收转移单: {transfer.transfer_no}, 原因: {reason}")
    
    return InventoryTransferResponse(
        id=transfer.id,
        transfer_no=transfer.transfer_no,
        product_name=transfer.product_name,
        weight=transfer.weight,
        from_location_id=transfer.from_location_id,
        to_location_id=transfer.to_location_id,
        from_location_name=transfer.from_location.name if transfer.from_location else None,
        to_location_name=transfer.to_location.name if transfer.to_location else None,
        status=transfer.status,
        created_by=transfer.created_by,
        created_at=transfer.created_at,
        remark=transfer.remark,
        received_by=transfer.received_by,
        received_at=transfer.received_at,
        actual_weight=None,
        weight_diff=None,
        diff_reason=transfer.diff_reason
    )


# ============= 初始化默认位置 =============

@router.post("/init-default-locations")
async def init_default_locations(db: Session = Depends(get_db)):
    """初始化默认位置（仅在没有位置时执行）"""
    existing = db.query(Location).first()
    if existing:
        return {"message": "位置已存在，无需初始化"}
    
    default_locations = [
        {"code": "warehouse", "name": "商品部仓库", "location_type": "warehouse", "description": "总仓库，入库货品存放处"},
        {"code": "showroom", "name": "展厅", "location_type": "showroom", "description": "销售展厅"},
    ]
    
    for loc in default_locations:
        db_location = Location(**loc)
        db.add(db_location)
    
    db.commit()
    
    return {"message": "默认位置初始化成功", "locations": default_locations}


# ============= 库存概览 API =============

@router.get("/overview")
async def get_inventory_overview(
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取库存概览数据（根据角色返回不同数据）
    - 商品专员：商品部仓库库存 + 转出待接收 + 展厅退货中
    - 柜台/结算：展厅库存 + 待接收 + 退货处理中
    - 管理层：全部数据
    """
    from sqlalchemy import func
    from ..models import ReturnOrder
    
    result = {
        "warehouse": None,  # 商品部仓库
        "showroom": None,   # 展厅
        "transfers": {
            "outgoing_pending": None,  # 转出待接收（商品部→展厅）
            "incoming_pending": None,  # 待接收（商品部→展厅）
            "return_to_warehouse": None,  # 展厅退回商品部
            "return_to_showroom": None,   # 商品部退货信息（展厅可看）
        }
    }
    
    # 获取位置ID
    warehouse_location = db.query(Location).filter(Location.code == "warehouse").first()
    showroom_location = db.query(Location).filter(Location.code == "showroom").first()
    
    warehouse_id = warehouse_location.id if warehouse_location else None
    showroom_id = showroom_location.id if showroom_location else None
    
    # 商品专员或管理层：可以看商品部仓库
    if user_role in ["product", "manager"]:
        if warehouse_id:
            # 商品部仓库库存统计
            warehouse_stats = db.query(
                func.sum(LocationInventory.weight).label("total_weight"),
                func.count(LocationInventory.id).label("product_count")
            ).filter(
                LocationInventory.location_id == warehouse_id,
                LocationInventory.weight > 0
            ).first()
            
            result["warehouse"] = {
                "location_id": warehouse_id,
                "location_name": warehouse_location.name if warehouse_location else "商品部仓库",
                "total_weight": float(warehouse_stats.total_weight or 0),
                "product_count": warehouse_stats.product_count or 0
            }
    
    # 柜台、结算或管理层：可以看展厅
    if user_role in ["counter", "settlement", "manager"]:
        if showroom_id:
            # 展厅库存统计
            showroom_stats = db.query(
                func.sum(LocationInventory.weight).label("total_weight"),
                func.count(LocationInventory.id).label("product_count")
            ).filter(
                LocationInventory.location_id == showroom_id,
                LocationInventory.weight > 0
            ).first()
            
            result["showroom"] = {
                "location_id": showroom_id,
                "location_name": showroom_location.name if showroom_location else "展厅",
                "total_weight": float(showroom_stats.total_weight or 0),
                "product_count": showroom_stats.product_count or 0
            }
    
    # 流转信息
    if warehouse_id and showroom_id:
        # 转出待接收（商品部→展厅，状态pending）- 商品专员和管理层可看
        if user_role in ["product", "manager"]:
            outgoing_pending = db.query(
                func.sum(InventoryTransfer.weight).label("total_weight"),
                func.count(InventoryTransfer.id).label("transfer_count")
            ).filter(
                InventoryTransfer.from_location_id == warehouse_id,
                InventoryTransfer.to_location_id == showroom_id,
                InventoryTransfer.status == "pending"
            ).first()
            
            result["transfers"]["outgoing_pending"] = {
                "total_weight": float(outgoing_pending.total_weight or 0),
                "count": outgoing_pending.transfer_count or 0,
                "description": "转出待接收（等待展厅接收）"
            }
        
        # 待接收（商品部→展厅，状态pending）- 柜台、结算和管理层可看
        if user_role in ["counter", "settlement", "manager"]:
            incoming_pending = db.query(
                func.sum(InventoryTransfer.weight).label("total_weight"),
                func.count(InventoryTransfer.id).label("transfer_count")
            ).filter(
                InventoryTransfer.from_location_id == warehouse_id,
                InventoryTransfer.to_location_id == showroom_id,
                InventoryTransfer.status == "pending"
            ).first()
            
            result["transfers"]["incoming_pending"] = {
                "total_weight": float(incoming_pending.total_weight or 0),
                "count": incoming_pending.transfer_count or 0,
                "description": "待接收（商品部转来）"
            }
        
        # 展厅退回商品部（退货类型to_warehouse，状态pending）- 商品专员和管理层可看
        if user_role in ["product", "manager"]:
            return_to_warehouse = db.query(
                func.sum(ReturnOrder.return_weight).label("total_weight"),
                func.count(ReturnOrder.id).label("return_count")
            ).filter(
                ReturnOrder.return_type == "to_warehouse",
                ReturnOrder.from_location_id == showroom_id,
                ReturnOrder.status == "pending"
            ).first()
            
            result["transfers"]["return_to_warehouse"] = {
                "total_weight": float(return_to_warehouse.total_weight or 0),
                "count": return_to_warehouse.return_count or 0,
                "description": "展厅退货中（等待确认）"
            }
        
        # 展厅退货状态 - 柜台、结算和管理层可看
        if user_role in ["counter", "settlement", "manager"]:
            return_from_showroom = db.query(
                func.sum(ReturnOrder.return_weight).label("total_weight"),
                func.count(ReturnOrder.id).label("return_count")
            ).filter(
                ReturnOrder.return_type == "to_warehouse",
                ReturnOrder.from_location_id == showroom_id,
                ReturnOrder.status == "pending"
            ).first()
            
            result["transfers"]["return_to_showroom"] = {
                "total_weight": float(return_from_showroom.total_weight or 0),
                "count": return_from_showroom.return_count or 0,
                "description": "退货处理中（已退回商品部）"
            }
    
    return {
        "success": True,
        "user_role": user_role,
        "overview": result
    }


# ============= 转移单（新版：主表+明细）API =============

@router.post("/transfer-orders", response_model=TransferOrderResponse)
async def create_transfer_order(
    data: TransferOrderCreate,
    created_by: str = Query(default="系统管理员", description="创建人"),
    user_role: str = Query(default="manager", description="用户角色"),
    initial_status: str = Query(default="pending", description="初始状态: pending(待接收) 或 pending_confirm(待确认)"),
    db: Session = Depends(get_db)
):
    """创建转移单（支持多商品）
    
    initial_status 参数:
    - pending: 默认状态，目标位置人员需要接收
    - pending_confirm: 待确认状态，直接出现在"待确认"标签页，用于批量转移场景
    """
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【发起库存转移】的权限")
    
    # 验证初始状态
    if initial_status not in ["pending", "pending_confirm"]:
        initial_status = "pending"
    
    # 验证位置
    from_location = db.query(Location).filter(Location.id == data.from_location_id).first()
    to_location = db.query(Location).filter(Location.id == data.to_location_id).first()
    
    if not from_location:
        raise HTTPException(status_code=404, detail="发出位置不存在")
    if not to_location:
        raise HTTPException(status_code=404, detail="目标位置不存在")
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="发出位置和目标位置不能相同")
    
    if not data.items or len(data.items) == 0:
        raise HTTPException(status_code=400, detail="转移商品列表不能为空")
    
    # 验证所有商品库存
    errors = []
    for item in data.items:
        inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == data.from_location_id,
            LocationInventory.product_name == item.product_name
        ).first()
        
        if not inventory or inventory.weight < item.weight:
            available = inventory.weight if inventory else 0
            errors.append(f"{item.product_name}: 库存不足（可用 {available}g，需要 {item.weight}g）")
    
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    
    # 生成转移单号
    now = china_now()
    count = db.query(InventoryTransferOrder).filter(
        InventoryTransferOrder.transfer_no.like(f"TR{now.strftime('%Y%m%d')}%")
    ).count()
    transfer_no = f"TR{now.strftime('%Y%m%d')}{count + 1:03d}"
    
    # 创建转移单主表
    order = InventoryTransferOrder(
        transfer_no=transfer_no,
        from_location_id=data.from_location_id,
        to_location_id=data.to_location_id,
        status=initial_status,
        created_by=created_by,
        created_at=china_now(),
        remark=data.remark
    )
    db.add(order)
    db.flush()  # 获取 order.id
    
    # 创建明细并扣减库存
    total_weight = 0
    for item in data.items:
        # 扣减库存
        inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == data.from_location_id,
            LocationInventory.product_name == item.product_name
        ).first()
        inventory.weight -= item.weight
        inventory.updated_at = china_now()
        
        # 创建明细
        transfer_item = InventoryTransferItem(
            order_id=order.id,
            product_name=item.product_name,
            weight=item.weight
        )
        db.add(transfer_item)
        total_weight += item.weight
    
    db.commit()
    db.refresh(order)
    
    logger.info(f"创建转移单: {transfer_no}, {len(data.items)}个商品, 共{total_weight}g, "
                f"{from_location.name} -> {to_location.name}")
    
    return TransferOrderResponse(
        id=order.id,
        transfer_no=order.transfer_no,
        from_location_id=order.from_location_id,
        to_location_id=order.to_location_id,
        from_location_name=from_location.name,
        to_location_name=to_location.name,
        status=order.status,
        created_by=order.created_by,
        created_at=order.created_at,
        remark=order.remark,
        items=[TransferItemResponse(
            id=item.id,
            product_name=item.product_name,
            weight=item.weight
        ) for item in order.items],
        total_weight=total_weight
    )


@router.get("/transfer-orders", response_model=List[TransferOrderResponse])
async def get_transfer_orders(
    status: Optional[str] = None,
    from_location_id: Optional[int] = None,
    to_location_id: Optional[int] = None,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取转移单列表"""
    query = db.query(InventoryTransferOrder)
    
    if status:
        query = query.filter(InventoryTransferOrder.status == status)
    if from_location_id:
        query = query.filter(InventoryTransferOrder.from_location_id == from_location_id)
    if to_location_id:
        query = query.filter(InventoryTransferOrder.to_location_id == to_location_id)
    
    orders = query.order_by(InventoryTransferOrder.created_at.desc()).all()
    
    result = []
    for order in orders:
        total_weight = sum(item.weight for item in order.items)
        total_actual_weight = sum(item.actual_weight or 0 for item in order.items) if order.status in ["received", "pending_confirm"] else None
        
        # 获取来源转移单信息（如果是重新发起的）
        source_transfer_no = None
        if order.source_order_id:
            source_order = db.query(InventoryTransferOrder).filter(
                InventoryTransferOrder.id == order.source_order_id
            ).first()
            if source_order:
                source_transfer_no = source_order.transfer_no
        
        # 获取关联的新转移单（如果被重新发起过）
        related_order = db.query(InventoryTransferOrder).filter(
            InventoryTransferOrder.source_order_id == order.id
        ).first()
        
        result.append(TransferOrderResponse(
            id=order.id,
            transfer_no=order.transfer_no,
            from_location_id=order.from_location_id,
            to_location_id=order.to_location_id,
            from_location_name=order.from_location.name if order.from_location else None,
            to_location_name=order.to_location.name if order.to_location else None,
            status=order.status,
            created_by=order.created_by,
            created_at=order.created_at,
            remark=order.remark,
            received_by=order.received_by,
            received_at=order.received_at,
            items=[TransferItemResponse(
                id=item.id,
                product_name=item.product_name,
                weight=item.weight,
                actual_weight=item.actual_weight,
                weight_diff=item.weight_diff,
                diff_reason=item.diff_reason
            ) for item in order.items],
            total_weight=total_weight,
            total_actual_weight=total_actual_weight,
            source_order_id=order.source_order_id,
            source_transfer_no=source_transfer_no,
            related_order_id=related_order.id if related_order else None,
            related_transfer_no=related_order.transfer_no if related_order else None
        ))
    
    return result


@router.get("/transfer-orders/{order_id}", response_model=TransferOrderResponse)
async def get_transfer_order(
    order_id: int,
    db: Session = Depends(get_db)
):
    """获取单个转移单详情"""
    order = db.query(InventoryTransferOrder).filter(InventoryTransferOrder.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="转移单不存在")
    
    total_weight = sum(item.weight for item in order.items)
    total_actual_weight = sum(item.actual_weight or 0 for item in order.items) if order.status in ["received", "pending_confirm"] else None
    
    # 获取来源转移单信息
    source_transfer_no = None
    if order.source_order_id:
        source_order = db.query(InventoryTransferOrder).filter(
            InventoryTransferOrder.id == order.source_order_id
        ).first()
        if source_order:
            source_transfer_no = source_order.transfer_no
    
    # 获取关联的新转移单
    related_order = db.query(InventoryTransferOrder).filter(
        InventoryTransferOrder.source_order_id == order.id
    ).first()
    
    return TransferOrderResponse(
        id=order.id,
        transfer_no=order.transfer_no,
        from_location_id=order.from_location_id,
        to_location_id=order.to_location_id,
        from_location_name=order.from_location.name if order.from_location else None,
        to_location_name=order.to_location.name if order.to_location else None,
        status=order.status,
        created_by=order.created_by,
        created_at=order.created_at,
        remark=order.remark,
        received_by=order.received_by,
        received_at=order.received_at,
        items=[TransferItemResponse(
            id=item.id,
            product_name=item.product_name,
            weight=item.weight,
            actual_weight=item.actual_weight,
            weight_diff=item.weight_diff,
            diff_reason=item.diff_reason
        ) for item in order.items],
        total_weight=total_weight,
        total_actual_weight=total_actual_weight,
        source_order_id=order.source_order_id,
        source_transfer_no=source_transfer_no,
        related_order_id=related_order.id if related_order else None,
        related_transfer_no=related_order.transfer_no if related_order else None
    )


@router.post("/transfer-orders/{order_id}/receive", response_model=TransferOrderResponse)
async def receive_transfer_order(
    order_id: int,
    receive_data: TransferOrderReceive,
    received_by: str = Query(default="系统管理员", description="接收人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """整单接收转移单"""
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_receive_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【接收库存】的权限")
    
    order = db.query(InventoryTransferOrder).filter(InventoryTransferOrder.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {order.status}，无法接收")
    
    # 构建 item_id -> receive_data 的映射
    receive_map = {r.item_id: r for r in receive_data.items}
    
    # 检查是否所有明细都有接收数据
    for item in order.items:
        if item.id not in receive_map:
            raise HTTPException(status_code=400, detail=f"缺少商品 {item.product_name} 的接收数据")
    
    # 更新明细并计算差异
    has_diff = False
    for item in order.items:
        receive_item = receive_map[item.id]
        item.actual_weight = receive_item.actual_weight
        item.weight_diff = receive_item.actual_weight - item.weight
        item.diff_reason = receive_item.diff_reason
        
        if abs(item.weight_diff) >= 0.01:
            has_diff = True
            if not receive_item.diff_reason:
                raise HTTPException(status_code=400, detail=f"商品 {item.product_name} 重量不符，必须填写差异原因")
    
    # 更新主表
    order.received_by = received_by
    order.received_at = china_now()
    
    if has_diff:
        # 有差异，需要商品部确认
        order.status = "pending_confirm"
        logger.info(f"接收转移单待确认: {order.transfer_no}")
    else:
        # 无差异，直接完成
        order.status = "received"
        
        # 更新目标位置库存
        for item in order.items:
            to_inventory = db.query(LocationInventory).filter(
                LocationInventory.location_id == order.to_location_id,
                LocationInventory.product_name == item.product_name
            ).first()
            
            if to_inventory:
                to_inventory.weight += item.actual_weight
            else:
                to_inventory = LocationInventory(
                    product_name=item.product_name,
                    location_id=order.to_location_id,
                    weight=item.actual_weight
                )
                db.add(to_inventory)
        
        logger.info(f"接收转移单完成: {order.transfer_no}")
    
    db.commit()
    db.refresh(order)
    
    total_weight = sum(item.weight for item in order.items)
    total_actual_weight = sum(item.actual_weight or 0 for item in order.items)
    
    return TransferOrderResponse(
        id=order.id,
        transfer_no=order.transfer_no,
        from_location_id=order.from_location_id,
        to_location_id=order.to_location_id,
        from_location_name=order.from_location.name if order.from_location else None,
        to_location_name=order.to_location.name if order.to_location else None,
        status=order.status,
        created_by=order.created_by,
        created_at=order.created_at,
        remark=order.remark,
        received_by=order.received_by,
        received_at=order.received_at,
        items=[TransferItemResponse(
            id=item.id,
            product_name=item.product_name,
            weight=item.weight,
            actual_weight=item.actual_weight,
            weight_diff=item.weight_diff,
            diff_reason=item.diff_reason
        ) for item in order.items],
        total_weight=total_weight,
        total_actual_weight=total_actual_weight
    )


@router.post("/transfer-orders/{order_id}/reject")
async def reject_transfer_order(
    order_id: int,
    reason: str = Query(..., description="拒收原因"),
    rejected_by: str = Query(default="系统管理员", description="拒收人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """整单拒收转移单"""
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_receive_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【接收库存】的权限")
    
    order = db.query(InventoryTransferOrder).filter(InventoryTransferOrder.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {order.status}，无法拒收")
    
    # 恢复发出位置库存
    for item in order.items:
        from_inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == order.from_location_id,
            LocationInventory.product_name == item.product_name
        ).first()
        
        if from_inventory:
            from_inventory.weight += item.weight
        else:
            from_inventory = LocationInventory(
                product_name=item.product_name,
                location_id=order.from_location_id,
                weight=item.weight
            )
            db.add(from_inventory)
    
    order.status = "rejected"
    order.remark = f"{order.remark or ''}\n拒收原因: {reason}".strip()
    
    db.commit()
    
    logger.info(f"拒收转移单: {order.transfer_no}, 原因: {reason}")
    
    return {"success": True, "message": "转移单已拒收，库存已恢复"}


@router.post("/transfer-orders/{order_id}/confirm", response_model=TransferOrderResponse)
async def confirm_transfer_order(
    order_id: int,
    confirmed_by: str = Query(default="系统管理员", description="确认人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """商品部确认转移单（同意柜台填写的实际重量，或确认批量转移）"""
    if user_role not in ['product', 'manager', 'counter']:
        raise HTTPException(status_code=403, detail="权限不足：只有商品专员、柜台或管理层可以确认转移单")
    
    order = db.query(InventoryTransferOrder).filter(InventoryTransferOrder.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if order.status != "pending_confirm":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {order.status}，无法确认")
    
    # 按实际重量（或原始重量）更新目标位置库存
    # 如果actual_weight未设置（批量转移场景），使用原始weight
    for item in order.items:
        transfer_weight = item.actual_weight if item.actual_weight is not None else item.weight
        
        to_inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == order.to_location_id,
            LocationInventory.product_name == item.product_name
        ).first()
        
        if to_inventory:
            to_inventory.weight += transfer_weight
        else:
            to_inventory = LocationInventory(
                product_name=item.product_name,
                location_id=order.to_location_id,
                weight=transfer_weight
            )
            db.add(to_inventory)
        
        # 如果actual_weight未设置，设置为weight（保持一致性）
        if item.actual_weight is None:
            item.actual_weight = item.weight
            item.weight_diff = 0
    
    order.status = "received"
    order.received_by = order.received_by or confirmed_by
    order.received_at = order.received_at or china_now()
    
    db.commit()
    db.refresh(order)
    
    logger.info(f"确认转移单: {order.transfer_no}, 确认人: {confirmed_by}")
    
    total_weight = sum(item.weight for item in order.items)
    total_actual_weight = sum(item.actual_weight or 0 for item in order.items)
    
    return TransferOrderResponse(
        id=order.id,
        transfer_no=order.transfer_no,
        from_location_id=order.from_location_id,
        to_location_id=order.to_location_id,
        from_location_name=order.from_location.name if order.from_location else None,
        to_location_name=order.to_location.name if order.to_location else None,
        status=order.status,
        created_by=order.created_by,
        created_at=order.created_at,
        remark=order.remark,
        received_by=order.received_by,
        received_at=order.received_at,
        items=[TransferItemResponse(
            id=item.id,
            product_name=item.product_name,
            weight=item.weight,
            actual_weight=item.actual_weight,
            weight_diff=item.weight_diff,
            diff_reason=item.diff_reason
        ) for item in order.items],
        total_weight=total_weight,
        total_actual_weight=total_actual_weight
    )


@router.post("/transfer-orders/{order_id}/reject-confirm")
async def reject_confirm_transfer_order(
    order_id: int,
    reason: str = Query(..., description="拒绝原因"),
    rejected_by: str = Query(default="系统管理员", description="拒绝人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """商品部拒绝确认转移单（库存退回发出位置）
    
    当柜台接收的实际重量与预期不符，转移单进入 pending_confirm 状态。
    商品专员可以拒绝确认，此时：
    1. 库存按预期重量退回发出位置（商品部仓库）
    2. 转移单状态变为 returned（已退回，转移单结束）
    3. 转移单记录保留，用于留痕
    """
    if user_role not in ['product', 'manager']:
        raise HTTPException(status_code=403, detail="权限不足：只有商品专员可以拒绝确认转移单")
    
    order = db.query(InventoryTransferOrder).filter(InventoryTransferOrder.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if order.status != "pending_confirm":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {order.status}，无法拒绝确认")
    
    # 恢复发出位置库存（按预期重量，因为实际重量有差异不被认可）
    for item in order.items:
        from_inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == order.from_location_id,
            LocationInventory.product_name == item.product_name
        ).first()
        
        if from_inventory:
            from_inventory.weight += item.weight
        else:
            from_inventory = LocationInventory(
                product_name=item.product_name,
                location_id=order.from_location_id,
                weight=item.weight
            )
            db.add(from_inventory)
    
    # 状态变为 returned（已退回，转移单结束，保留记录用于留痕）
    order.status = "returned"
    order.remark = f"{order.remark or ''}\n拒绝确认原因: {reason}\n拒绝人: {rejected_by}".strip()
    
    db.commit()
    
    total_weight = sum(item.weight for item in order.items)
    logger.info(f"拒绝确认转移单: {order.transfer_no}, 原因: {reason}, {total_weight}g 已退回发出位置")
    
    return {
        "success": True,
        "message": f"已拒绝确认，{total_weight}g 已退回商品部仓库",
        "new_status": "returned"
    }


@router.post("/transfer-orders/{order_id}/resubmit", response_model=TransferOrderResponse)
async def resubmit_transfer_order(
    order_id: int,
    created_by: str = Query(default="系统管理员", description="发起人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """重新发起退回的转移单
    
    基于已退回的转移单创建新单，保留原单记录用于审计追溯：
    1. 验证原单状态必须是 returned
    2. 复制原单商品信息，创建新转移单
    3. 设置 source_order_id 关联原单
    4. 扣减发出位置库存
    """
    if user_role not in ['product', 'manager']:
        raise HTTPException(status_code=403, detail="权限不足：只有商品专员可以重新发起转移单")
    
    # 查找原转移单
    source_order = db.query(InventoryTransferOrder).filter(InventoryTransferOrder.id == order_id).first()
    
    if not source_order:
        raise HTTPException(status_code=404, detail="原转移单不存在")
    if source_order.status != "returned":
        raise HTTPException(status_code=400, detail=f"只有已退回的转移单才能重新发起，当前状态为 {source_order.status}")
    
    # 检查是否已经重新发起过（防止重复）
    existing_resubmit = db.query(InventoryTransferOrder).filter(
        InventoryTransferOrder.source_order_id == order_id
    ).first()
    if existing_resubmit:
        raise HTTPException(
            status_code=400, 
            detail=f"该转移单已重新发起过，新单号为 {existing_resubmit.transfer_no}"
        )
    
    # 生成新转移单号
    from datetime import datetime
    today = datetime.now().strftime("%Y%m%d")
    last_order = db.query(InventoryTransferOrder).filter(
        InventoryTransferOrder.transfer_no.like(f"TR{today}%")
    ).order_by(InventoryTransferOrder.transfer_no.desc()).first()
    
    if last_order:
        last_seq = int(last_order.transfer_no[-3:])
        new_seq = last_seq + 1
    else:
        new_seq = 1
    
    new_transfer_no = f"TR{today}{new_seq:03d}"
    
    # 验证并扣减发出位置库存
    for item in source_order.items:
        from_inventory = db.query(LocationInventory).filter(
            LocationInventory.location_id == source_order.from_location_id,
            LocationInventory.product_name == item.product_name
        ).first()
        
        if not from_inventory or from_inventory.weight < item.weight:
            available = from_inventory.weight if from_inventory else 0
            raise HTTPException(
                status_code=400,
                detail=f"发出位置库存不足：{item.product_name} 需要 {item.weight}g，可用 {available}g"
            )
        
        from_inventory.weight -= item.weight
    
    # 创建新转移单
    new_order = InventoryTransferOrder(
        transfer_no=new_transfer_no,
        from_location_id=source_order.from_location_id,
        to_location_id=source_order.to_location_id,
        status="pending",
        created_by=created_by,
        created_at=china_now(),
        remark=f"来源于退回的转移单 {source_order.transfer_no}",
        source_order_id=source_order.id  # 关联原单
    )
    db.add(new_order)
    db.flush()
    
    # 复制商品明细
    for item in source_order.items:
        new_item = InventoryTransferItem(
            order_id=new_order.id,
            product_name=item.product_name,
            weight=item.weight
        )
        db.add(new_item)
    
    db.commit()
    db.refresh(new_order)
    
    logger.info(f"重新发起转移单: {new_transfer_no}, 来源: {source_order.transfer_no}")
    
    total_weight = sum(item.weight for item in new_order.items)
    
    return TransferOrderResponse(
        id=new_order.id,
        transfer_no=new_order.transfer_no,
        from_location_id=new_order.from_location_id,
        to_location_id=new_order.to_location_id,
        from_location_name=new_order.from_location.name if new_order.from_location else None,
        to_location_name=new_order.to_location.name if new_order.to_location else None,
        status=new_order.status,
        created_by=new_order.created_by,
        created_at=new_order.created_at,
        remark=new_order.remark,
        received_by=new_order.received_by,
        received_at=new_order.received_at,
        items=[TransferItemResponse(
            id=item.id,
            product_name=item.product_name,
            weight=item.weight,
            actual_weight=item.actual_weight,
            weight_diff=item.weight_diff,
            diff_reason=item.diff_reason
        ) for item in new_order.items],
        total_weight=total_weight,
        total_actual_weight=None,
        source_order_id=new_order.source_order_id,
        source_transfer_no=source_order.transfer_no
    )


# ============= 数据迁移 API =============

@router.post("/migrate-old-transfers")
async def migrate_old_transfers(
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """将旧版转移单数据迁移到新表
    
    将 inventory_transfers 表中的数据迁移到 inventory_transfer_orders 和 inventory_transfer_items 表。
    每条旧记录对应一个新的转移单主表记录和一条明细记录。
    """
    if user_role != 'manager':
        raise HTTPException(status_code=403, detail="只有管理员可以执行数据迁移")
    
    old_transfers = db.query(InventoryTransfer).all()
    migrated_count = 0
    skipped_count = 0
    
    for transfer in old_transfers:
        # 检查是否已经迁移过（通过 transfer_no 判断）
        existing = db.query(InventoryTransferOrder).filter(
            InventoryTransferOrder.transfer_no == transfer.transfer_no
        ).first()
        
        if existing:
            skipped_count += 1
            continue
        
        # 创建新的转移单主表记录
        order = InventoryTransferOrder(
            transfer_no=transfer.transfer_no,
            from_location_id=transfer.from_location_id,
            to_location_id=transfer.to_location_id,
            status=transfer.status,
            created_by=transfer.created_by,
            created_at=transfer.created_at,
            remark=transfer.remark,
            received_by=transfer.received_by,
            received_at=transfer.received_at
        )
        db.add(order)
        db.flush()
        
        # 创建明细记录
        item = InventoryTransferItem(
            order_id=order.id,
            product_name=transfer.product_name,
            weight=transfer.weight,
            actual_weight=transfer.actual_weight,
            weight_diff=transfer.weight_diff,
            diff_reason=transfer.diff_reason
        )
        db.add(item)
        migrated_count += 1
    
    db.commit()
    
    logger.info(f"数据迁移完成: 迁移 {migrated_count} 条, 跳过 {skipped_count} 条（已存在）")
    
    return {
        "success": True,
        "migrated": migrated_count,
        "skipped": skipped_count,
        "total_old_records": len(old_transfers)
    }


@router.post("/migrate-add-source-order-id")
async def migrate_add_source_order_id(
    user_role: str = Query(default="manager"),
    db: Session = Depends(get_db)
):
    """添加 source_order_id 列到 inventory_transfer_orders 表
    
    用于修复因模型更新但数据库未同步导致的列缺失问题。
    """
    if user_role != 'manager':
        raise HTTPException(status_code=403, detail="只有管理员可以执行数据库迁移")
    
    from sqlalchemy import text
    try:
        # 检查列是否存在
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'inventory_transfer_orders' 
            AND column_name = 'source_order_id'
        """))
        if result.fetchone():
            return {"message": "列已存在，无需迁移"}
        
        # 添加列
        db.execute(text("""
            ALTER TABLE inventory_transfer_orders 
            ADD COLUMN source_order_id INTEGER REFERENCES inventory_transfer_orders(id)
        """))
        db.commit()
        logger.info("数据库迁移: 已添加 source_order_id 列到 inventory_transfer_orders 表")
        return {"success": True, "message": "已成功添加 source_order_id 列"}
    except Exception as e:
        db.rollback()
        logger.error(f"数据库迁移失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


