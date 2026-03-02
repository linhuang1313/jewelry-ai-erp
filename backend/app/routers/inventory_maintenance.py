"""
库存维护路由模块
包含库存合并、清理、同步等维护功能
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, update
from datetime import datetime
import logging
from typing import Optional

from ..database import get_db
from ..dependencies.auth import get_current_role, require_permission
from ..models import (
    Inventory, InboundDetail, InboundOrder, SalesDetail,
    Location, LocationInventory
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inventory", tags=["inventory-maintenance"])


@router.post("/merge-duplicates")
async def merge_duplicate_inventory(db: Session = Depends(get_db)):
    """
    合并重复的库存商品（商品编码与商品名称分开存储的情况）
    例如：将 "3DDZ" 的库存合并到 "足金3D硬金吊坠"
    """
    try:
        from ..models import ProductCode as ProductCodeModel
        
        merged_count = 0
        merge_details = []
        
        product_codes = db.query(ProductCodeModel).filter(
            ProductCodeModel.name.isnot(None),
            ProductCodeModel.name != ""
        ).all()
        
        for pc in product_codes:
            code = pc.code
            name = pc.name
            
            code_inventory = db.query(Inventory).filter(Inventory.product_name == code).first()
            if not code_inventory:
                continue
            
            name_inventory = db.query(Inventory).filter(Inventory.product_name == name).first()
            
            if name_inventory:
                name_inventory.total_weight = round(float(name_inventory.total_weight or 0) + float(code_inventory.total_weight or 0), 3)
                db.delete(code_inventory)
            else:
                code_inventory.product_name = name
            
            code_location_inventories = db.query(LocationInventory).filter(
                LocationInventory.product_name == code
            ).all()
            
            for cli in code_location_inventories:
                name_location_inventory = db.query(LocationInventory).filter(
                    LocationInventory.product_name == name,
                    LocationInventory.location_id == cli.location_id
                ).first()
                
                if name_location_inventory:
                    name_location_inventory.weight = float(name_location_inventory.weight or 0) + float(cli.weight or 0)
                    db.delete(cli)
                else:
                    cli.product_name = name
            
            merged_count += 1
            merge_details.append({
                "code": code,
                "name": name,
                "merged_weight": code_inventory.total_weight if code_inventory else 0
            })
        
        db.commit()
        
        return {
            "success": True,
            "message": f"成功合并 {merged_count} 个重复商品",
            "merged_count": merged_count,
            "details": merge_details
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"合并重复库存失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/merge-manual")
async def merge_inventory_manual(
    source_name: str = Query(..., description="要合并的源商品名称（将被删除）"),
    target_name: str = Query(..., description="目标商品名称（将保留）"),
    db: Session = Depends(get_db)
):
    """
    手动合并两个商品库存
    将 source_name 的库存合并到 target_name，然后删除 source_name
    """
    try:
        source_inventory = db.query(Inventory).filter(Inventory.product_name == source_name).first()
        if not source_inventory:
            return {"success": False, "message": f"未找到源商品：{source_name}"}
        
        target_inventory = db.query(Inventory).filter(Inventory.product_name == target_name).first()
        
        source_weight = float(source_inventory.total_weight or 0)
        
        if target_inventory:
            target_inventory.total_weight = round(float(target_inventory.total_weight or 0) + source_weight, 3)
            db.delete(source_inventory)
        else:
            source_inventory.product_name = target_name
        
        source_location_inventories = db.query(LocationInventory).filter(
            LocationInventory.product_name == source_name
        ).all()
        
        for sli in source_location_inventories:
            target_li = db.query(LocationInventory).filter(
                LocationInventory.product_name == target_name,
                LocationInventory.location_id == sli.location_id
            ).first()
            
            if target_li:
                target_li.weight = float(target_li.weight or 0) + float(sli.weight or 0)
                db.delete(sli)
            else:
                sli.product_name = target_name
        
        db.commit()
        
        return {
            "success": True,
            "message": f"成功将 {source_name} ({source_weight}g) 合并到 {target_name}",
            "merged_weight": source_weight
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"手动合并库存失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/by-code")
async def get_inbound_detail_by_code(
    code: str = Query(..., description="商品编码（如 F00149797）"),
    db: Session = Depends(get_db)
):
    """
    按商品编码查询入库明细 — 返回销售工费、克重等信息。
    用于一码一件(F编码)开销售单时自动填充工费。
    """
    try:
        result = db.query(InboundDetail).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundDetail.product_code == code,
            InboundOrder.status.in_(['confirmed', 'completed'])
        ).order_by(InboundOrder.create_time.desc()).first()

        if not result:
            return {"success": False, "message": f"未找到编码 {code} 的入库记录"}

        def _f(val):
            return float(val) if val is not None else None

        return {
            "success": True,
            "data": {
                "product_code": result.product_code,
                "product_name": result.product_name,
                "weight": _f(result.weight),
                "labor_cost": _f(result.labor_cost),
                "piece_count": result.piece_count,
                "piece_labor_cost": _f(result.piece_labor_cost),
                "sale_labor_cost": _f(result.sale_labor_cost),
                "sale_piece_labor_cost": _f(result.sale_piece_labor_cost),
                "supplier": result.supplier,
                "main_stone_weight": _f(getattr(result, 'main_stone_weight', None)),
                "main_stone_count": getattr(result, 'main_stone_count', None),
                "main_stone_price": _f(getattr(result, 'main_stone_price', None)),
                "main_stone_amount": _f(getattr(result, 'main_stone_amount', None)),
                "sub_stone_weight": _f(getattr(result, 'sub_stone_weight', None)),
                "sub_stone_count": getattr(result, 'sub_stone_count', None),
                "sub_stone_price": _f(getattr(result, 'sub_stone_price', None)),
                "sub_stone_amount": _f(getattr(result, 'sub_stone_amount', None)),
                "stone_setting_fee": _f(getattr(result, 'stone_setting_fee', None)),
                "total_amount": _f(getattr(result, 'total_amount', None)),
                "main_stone_mark": getattr(result, 'main_stone_mark', None),
                "sub_stone_mark": getattr(result, 'sub_stone_mark', None),
                "pearl_weight": _f(getattr(result, 'pearl_weight', None)),
                "bearing_weight": _f(getattr(result, 'bearing_weight', None)),
            }
        }
    except Exception as e:
        logger.error(f"按编码查询入库明细失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/by-barcode")
async def get_inventory_by_barcode(
    search: Optional[str] = Query(None, description="搜索商品编码或名称"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """
    按条码查看库存 - 返回入库明细列表
    """
    try:
        from ..timezone_utils import to_china_time, format_china_time
        
        query = db.query(InboundDetail, InboundOrder).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        )
        
        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                (InboundDetail.product_code.ilike(search_pattern)) |
                (InboundDetail.product_name.ilike(search_pattern))
            )
        
        query = query.order_by(InboundOrder.create_time.desc())
        
        total = query.count()
        results = query.offset(skip).limit(limit).all()
        
        items = []
        for detail, order in results:
            china_time = to_china_time(order.create_time) if order.create_time else None
            items.append({
                "id": detail.id,
                "product_code": detail.product_code or "-",
                "product_name": detail.product_name,
                "weight": detail.weight,
                "labor_cost": detail.labor_cost,
                "piece_count": detail.piece_count,
                "piece_labor_cost": detail.piece_labor_cost,
                "total_cost": detail.total_cost,
                "supplier": detail.supplier,
                "order_no": order.order_no,
                "inbound_time": format_china_time(china_time, "%Y-%m-%d %H:%M") if china_time else None,
                "status": order.status
            })
        
        return {
            "success": True,
            "data": items,
            "total": total,
            "skip": skip,
            "limit": limit
        }
        
    except Exception as e:
        logger.error(f"按条码查询库存失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/by-product-name")
async def get_inventory_by_product_name(
    product_name: str = Query(..., description="商品名称（精确匹配）"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """
    按商品名称查询已确认入库单的明细（用于库存展开行显示条码明细）
    """
    try:
        from ..timezone_utils import to_china_time, format_china_time

        query = db.query(InboundDetail, InboundOrder).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundDetail.product_name == product_name,
            InboundOrder.status.in_(['confirmed', 'completed'])
        ).order_by(InboundOrder.create_time.desc())

        results = query.limit(limit).all()

        items = []
        for detail, order in results:
            china_time = to_china_time(order.create_time) if order.create_time else None
            items.append({
                "id": detail.id,
                "product_code": detail.product_code or "-",
                "product_name": detail.product_name,
                "weight": float(detail.weight or 0),
                "labor_cost": float(detail.labor_cost or 0),
                "piece_count": detail.piece_count,
                "piece_labor_cost": float(detail.piece_labor_cost) if detail.piece_labor_cost else None,
                "total_cost": float(detail.total_cost or 0),
                "supplier": detail.supplier,
                "order_no": order.order_no,
                "inbound_time": format_china_time(china_time, "%Y-%m-%d %H:%M") if china_time else None,
                "status": order.status,
                "main_stone_weight": float(detail.main_stone_weight) if detail.main_stone_weight else None,
                "main_stone_count": detail.main_stone_count,
                "main_stone_price": float(detail.main_stone_price) if detail.main_stone_price else None,
                "main_stone_amount": float(detail.main_stone_amount) if detail.main_stone_amount else None,
                "sub_stone_weight": float(detail.sub_stone_weight) if detail.sub_stone_weight else None,
                "sub_stone_count": detail.sub_stone_count,
                "sub_stone_price": float(detail.sub_stone_price) if detail.sub_stone_price else None,
                "sub_stone_amount": float(detail.sub_stone_amount) if detail.sub_stone_amount else None,
                "stone_setting_fee": float(detail.stone_setting_fee) if detail.stone_setting_fee else None,
                "total_amount": float(detail.total_amount) if detail.total_amount else None,
                "main_stone_mark": detail.main_stone_mark,
                "sub_stone_mark": detail.sub_stone_mark,
                "pearl_weight": float(detail.pearl_weight) if detail.pearl_weight else None,
                "bearing_weight": float(detail.bearing_weight) if detail.bearing_weight else None,
                "sale_labor_cost": float(detail.sale_labor_cost) if detail.sale_labor_cost else None,
                "sale_piece_labor_cost": float(detail.sale_piece_labor_cost) if detail.sale_piece_labor_cost else None,
            })

        if not items:
            from ..models import ProductCode as ProductCodeModel
            codes = db.query(ProductCodeModel).filter(
                ProductCodeModel.name == product_name
            ).all()
            for pc in codes:
                items.append({
                    "id": pc.id,
                    "product_code": pc.code,
                    "product_name": pc.name,
                    "weight": 0,
                    "labor_cost": 0,
                    "piece_count": None,
                    "piece_labor_cost": None,
                    "total_cost": 0,
                    "supplier": None,
                    "order_no": "-",
                    "inbound_time": None,
                    "status": "-",
                    "source": "product_codes"
                })

        return {"success": True, "data": items, "total": len(items)}

    except Exception as e:
        logger.error(f"按商品名称查询入库明细失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.delete("/cleanup-no-barcode")
async def cleanup_no_barcode_inventory(db: Session = Depends(get_db)):
    """
    删除没有条码的入库明细记录
    """
    try:
        records = db.query(InboundDetail).filter(
            (InboundDetail.product_code == None) | 
            (InboundDetail.product_code == '') |
            (InboundDetail.product_code == '-')
        ).all()
        
        count = len(records)
        
        if count == 0:
            return {"success": True, "message": "没有找到需要删除的记录", "deleted_count": 0}
        
        for record in records:
            db.delete(record)
        
        db.commit()
        
        logger.info(f"成功删除 {count} 条无条码的入库明细记录")
        
        return {
            "success": True, 
            "message": f"成功删除 {count} 条无条码的入库明细记录",
            "deleted_count": count
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"删除无条码记录失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "deleted_count": 0}


@router.delete("/cleanup-invalid-products")
async def cleanup_invalid_products(
    preview: bool = Query(True, description="预览模式，不实际删除"),
    db: Session = Depends(get_db)
):
    """
    删除商品名称不在预定义编码表中的库存记录
    """
    try:
        from ..models import ProductCode as ProductCodeModel
        
        valid_names = db.query(ProductCodeModel.name).filter(
            ProductCodeModel.code_type == 'predefined'
        ).all()
        valid_name_set = {name[0] for name in valid_names}
        
        if not valid_name_set:
            return {"success": False, "message": "预定义商品列表为空，无法执行清理"}
        
        invalid_inventory = db.query(Inventory).filter(
            ~Inventory.product_name.in_(valid_name_set)
        ).all()
        
        invalid_details = db.query(InboundDetail).filter(
            ~InboundDetail.product_name.in_(valid_name_set)
        ).all()
        
        if preview:
            return {
                "success": True,
                "preview": True,
                "valid_product_count": len(valid_name_set),
                "inventory_to_delete": len(invalid_inventory),
                "inbound_details_to_delete": len(invalid_details),
                "sample_inventory": [i.product_name for i in invalid_inventory[:20]],
                "sample_details": list(set([d.product_name for d in invalid_details[:20]]))
            }
        
        inventory_count = len(invalid_inventory)
        details_count = len(invalid_details)
        
        for record in invalid_inventory:
            db.delete(record)
        for record in invalid_details:
            db.delete(record)
        
        db.commit()
        
        logger.info(f"清理非预定义商品: 删除 {inventory_count} 条库存记录, {details_count} 条入库明细")
        
        return {
            "success": True,
            "message": f"成功删除 {inventory_count} 条库存记录和 {details_count} 条入库明细",
            "inventory_deleted": inventory_count,
            "details_deleted": details_count
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"清理非预定义商品失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/merge-product-names")
async def merge_product_names(
    old_name: str = Query(..., description="原商品名称（要被合并的）"),
    new_name: str = Query(..., description="新商品名称（合并到）"),
    db: Session = Depends(get_db)
):
    """
    合并商品名称：将 old_name 的所有数据合并到 new_name
    """
    try:
        changes = {
            "inventory": 0,
            "location_inventory": 0,
            "inbound_details": 0,
            "sales_details": 0
        }
        
        old_inv = db.query(Inventory).filter(Inventory.product_name == old_name).first()
        new_inv = db.query(Inventory).filter(Inventory.product_name == new_name).first()
        
        if old_inv:
            if new_inv:
                new_inv.total_weight = round(float(new_inv.total_weight or 0) + float(old_inv.total_weight or 0), 3)
                db.delete(old_inv)
                changes["inventory"] = 1
                logger.info(f"库存合并: {old_name} ({old_inv.total_weight}g) -> {new_name}")
            else:
                old_inv.product_name = new_name
                changes["inventory"] = 1
                logger.info(f"库存改名: {old_name} -> {new_name}")
        
        old_loc_invs = db.query(LocationInventory).filter(LocationInventory.product_name == old_name).all()
        for old_loc in old_loc_invs:
            new_loc = db.query(LocationInventory).filter(
                LocationInventory.product_name == new_name,
                LocationInventory.location_id == old_loc.location_id
            ).first()
            
            if new_loc:
                new_loc.weight = float(new_loc.weight or 0) + float(old_loc.weight or 0)
                db.delete(old_loc)
            else:
                old_loc.product_name = new_name
            changes["location_inventory"] += 1
        
        result = db.execute(
            update(InboundDetail).where(InboundDetail.product_name == old_name).values(product_name=new_name)
        )
        changes["inbound_details"] = result.rowcount
        
        result = db.execute(
            update(SalesDetail).where(SalesDetail.product_name == old_name).values(product_name=new_name)
        )
        changes["sales_details"] = result.rowcount
        
        db.commit()
        
        logger.info(f"商品名称合并完成: {old_name} -> {new_name}, 变更: {changes}")
        
        return {
            "success": True,
            "message": f"已将 '{old_name}' 合并到 '{new_name}'",
            "changes": changes
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"合并商品名称失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/check-consistency")
async def check_inventory_consistency(db: Session = Depends(get_db)):
    """
    检查 Inventory（总库存）和 LocationInventory（分仓库存）的一致性
    """
    total_inventory = db.query(Inventory).all()
    
    location_inventory_summary = db.query(
        LocationInventory.product_name,
        func.sum(LocationInventory.weight).label("total_weight")
    ).group_by(LocationInventory.product_name).all()

    total_dict = {inv.product_name: inv.total_weight for inv in total_inventory}
    location_dict = {item.product_name: float(item.total_weight or 0) for item in location_inventory_summary}
    
    discrepancies = []
    all_products = set(total_dict.keys()) | set(location_dict.keys())
    
    for product in all_products:
        total_weight = total_dict.get(product, 0)
        location_weight = location_dict.get(product, 0)
        
        if abs(total_weight - location_weight) > 0.01:
            discrepancies.append({
                "product_name": product,
                "inventory_total": total_weight,
                "location_total": location_weight,
                "difference": total_weight - location_weight
            })
    
    return {
        "success": True,
        "is_consistent": len(discrepancies) == 0,
        "total_inventory_weight": sum(total_dict.values()),
        "total_location_weight": sum(location_dict.values()),
        "difference": sum(total_dict.values()) - sum(location_dict.values()),
        "discrepancies": discrepancies,
        "product_count_in_inventory": len(total_dict),
        "product_count_in_location": len(location_dict)
    }


@router.post("/sync-to-location")
async def sync_inventory_to_location(db: Session = Depends(get_db)):
    """
    将 Inventory 表的数据同步到 LocationInventory 表
    以 Inventory 表为准，确保分仓库存与总库存一致
    """
    default_location = db.query(Location).filter(Location.code == "warehouse").first()
    if not default_location:
        default_location = Location(
            code="warehouse",
            name="商品部仓库",
            location_type="warehouse",
            description="商品部主仓库"
        )
        db.add(default_location)
        db.flush()
    
    total_inventory = db.query(Inventory).all()
    
    sync_results = []
    
    for inv in total_inventory:
        if inv.total_weight <= 0:
            continue
            
        location_total = db.query(
            func.sum(LocationInventory.weight)
        ).filter(
            LocationInventory.product_name == inv.product_name
        ).scalar() or 0
        
        difference = inv.total_weight - float(location_total)
        
        if abs(difference) > 0.01:
            location_inv = db.query(LocationInventory).filter(
                LocationInventory.product_name == inv.product_name,
                LocationInventory.location_id == default_location.id
            ).first()
            
            if location_inv:
                old_weight = location_inv.weight
                location_inv.weight = float(location_inv.weight or 0) + difference
                sync_results.append({
                    "product_name": inv.product_name,
                    "action": "updated",
                    "old_weight": old_weight,
                    "new_weight": location_inv.weight,
                    "adjustment": difference
                })
            else:
                new_location_inv = LocationInventory(
                    product_name=inv.product_name,
                    location_id=default_location.id,
                    weight=inv.total_weight
                )
                db.add(new_location_inv)
                sync_results.append({
                    "product_name": inv.product_name,
                    "action": "created",
                    "weight": inv.total_weight
                })
    
    db.commit()
    
    return {
        "success": True,
        "message": f"同步完成，共调整 {len(sync_results)} 项商品库存",
        "sync_results": sync_results
    }


# ==================== 数据库迁移API ====================

@router.post("/migrate/add-payment-no")
async def migrate_add_payment_no(db: Session = Depends(get_db)):
    """
    数据库迁移：为 payment_records 表添加 payment_no 字段
    """
    from sqlalchemy import text
    
    try:
        check_sql = text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'payment_records' AND column_name = 'payment_no'
        """)
        result = db.execute(check_sql).fetchone()
        
        if result:
            return {
                "success": True,
                "message": "payment_no 列已存在，无需迁移"
            }
        
        alter_sql = text("""
            ALTER TABLE payment_records 
            ADD COLUMN payment_no VARCHAR(50)
        """)
        db.execute(alter_sql)
        
        try:
            alter_nullable_sql = text("""
                ALTER TABLE payment_records 
                ALTER COLUMN account_receivable_id DROP NOT NULL
            """)
            db.execute(alter_nullable_sql)
        except Exception as e:
            logger.warning(f"修改 account_receivable_id 可空失败（可能已是可空）: {e}")
        
        update_sql = text("""
            UPDATE payment_records 
            SET payment_no = 'SK' || TO_CHAR(create_time, 'YYYYMMDDHH24MISS') || id::text
            WHERE payment_no IS NULL
        """)
        db.execute(update_sql)
        
        db.commit()
        
        return {
            "success": True,
            "message": "迁移成功：已添加 payment_no 列并更新现有记录"
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"迁移失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.delete("/location-inventory/{item_id}")
async def delete_location_inventory(
    item_id: int,
    db: Session = Depends(get_db)
):
    """删除单条分仓库存记录"""
    try:
        item = db.query(LocationInventory).filter(LocationInventory.id == item_id).first()
        if not item:
            return {"success": False, "error": "库存记录不存在"}
        
        product_name = item.product_name
        weight = item.weight
        location_id = item.location_id
        
        location = db.query(Location).filter(Location.id == location_id).first()
        location_name = location.name if location else "未知位置"
        
        db.delete(item)
        
        main_inv = db.query(Inventory).filter(Inventory.product_name == product_name).first()
        if main_inv and weight:
            main_inv.total_weight = max(0, (main_inv.total_weight or 0) - weight)
            main_inv.last_update = datetime.now()
        
        db.commit()
        logger.info(f"删除库存记录: {product_name}, 重量={weight}g, 位置={location_name}")
        
        return {
            "success": True,
            "message": f"已删除 {location_name} 的 {product_name} 库存记录（{weight}g）"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"删除库存记录失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
