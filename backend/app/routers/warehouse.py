"""
仓库/分仓库存管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
import logging

from ..database import get_db
from ..timezone_utils import china_now
from ..models import Location, LocationInventory, InventoryTransfer, Inventory
from ..schemas import (
    LocationCreate,
    LocationResponse,
    LocationInventoryResponse,
    LocationInventorySummary,
    InventoryTransferCreate,
    InventoryTransferReceive,
    InventoryTransferResponse,
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
    db: Session = Depends(get_db)
):
    """获取分仓库存列表"""
    query = db.query(LocationInventory).join(Location)
    
    if location_id:
        query = query.filter(LocationInventory.location_id == location_id)
    if product_name:
        query = query.filter(LocationInventory.product_name.contains(product_name))
    
    # 只返回有库存的记录
    query = query.filter(LocationInventory.weight > 0)
    
    items = query.order_by(Location.id, LocationInventory.product_name).all()
    
    # 添加位置信息
    result = []
    for item in items:
        item_dict = {
            "id": item.id,
            "product_name": item.product_name,
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
    db: Session = Depends(get_db)
):
    """获取库存汇总（按商品分组，显示各位置库存、件数、金额）"""
    from sqlalchemy import func
    from ..models import InboundDetail
    
    query = db.query(LocationInventory).join(Location).filter(LocationInventory.weight > 0)
    
    if product_name:
        query = query.filter(LocationInventory.product_name.contains(product_name))
    
    items = query.order_by(LocationInventory.product_name, Location.id).all()
    
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
    db: Session = Depends(get_db)
):
    """获取货品转移单列表"""
    query = db.query(InventoryTransfer)
    
    if status:
        query = query.filter(InventoryTransfer.status == status)
    if from_location_id:
        query = query.filter(InventoryTransfer.from_location_id == from_location_id)
    if to_location_id:
        query = query.filter(InventoryTransfer.to_location_id == to_location_id)
    
    transfers = query.order_by(InventoryTransfer.created_at.desc()).all()
    
    # 添加位置名称
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
        remark=transfer.remark
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
    
    return {
        "success": True,
        "created_count": len(created_transfers),
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
    """接收货品转移"""
    # 权限检查
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_receive_transfer'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【接收库存】的权限")
    transfer = db.query(InventoryTransfer).filter(InventoryTransfer.id == transfer_id).first()
    
    if not transfer:
        raise HTTPException(status_code=404, detail="转移单不存在")
    if transfer.status != "pending":
        raise HTTPException(status_code=400, detail=f"转移单状态为 {transfer.status}，无法接收")
    
    # 更新转移单状态
    transfer.status = "received"
    transfer.received_by = received_by
    transfer.received_at = china_now()
    transfer.actual_weight = receive_data.actual_weight
    transfer.weight_diff = receive_data.actual_weight - transfer.weight
    transfer.diff_reason = receive_data.diff_reason
    
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
    
    db.commit()
    db.refresh(transfer)
    
    logger.info(f"接收转移单: {transfer.transfer_no}, 实际接收 {receive_data.actual_weight}g, "
                f"差异 {transfer.weight_diff}g")
    
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


