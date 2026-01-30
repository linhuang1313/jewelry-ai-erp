"""
入库管理路由模块
包含入库单CRUD、execute_inbound等功能
"""
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from fastapi.responses import Response, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timezone, timedelta
import logging
import random
from typing import Dict, Any, List, Optional

from ..database import get_db
from ..schemas import InboundOrderCreate, BatchInboundCreate
from ..models import (
    InboundOrder, InboundDetail, Inventory, Supplier,
    Location, LocationInventory
)
from ..schemas import InboundOrderResponse, InboundDetailResponse, InventoryResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inbound-orders", tags=["inbound"])

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)


def generate_inbound_order_no(db) -> str:
    """生成唯一入库单号：RK + 日期 + 4位随机数"""
    date_str = china_now().strftime("%Y%m%d")
    
    for _ in range(10):
        random_suffix = f"{random.randint(0, 9999):04d}"
        order_no = f"RK{date_str}{random_suffix}"
        
        exists = db.query(InboundOrder).filter(
            InboundOrder.order_no == order_no
        ).first()
        
        if not exists:
            return order_no
    
    random_suffix = f"{random.randint(0, 999999):06d}"
    return f"RK{date_str}{random_suffix}"


def safe_float(value, default=0.0, field_name="数值"):
    """安全的浮点数转换，带异常处理"""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"{field_name}格式无效: {value}")


def safe_int(value, default=None, field_name="数值"):
    """安全的整数转换，带异常处理"""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"{field_name}格式无效: {value}")


async def handle_inbound(ai_response, db: Session) -> Dict[str, Any]:
    """处理入库操作（从AI解析结果）"""
    logger.info(f"[入库] 开始处理入库，AI解析出 {len(ai_response.products) if ai_response.products else 0} 个商品")
    
    if not ai_response.products:
        return {
            "success": False,
            "action": "入库",
            "need_form": True,
            "message": "📝 请在弹出的表格中填写入库信息",
            "hint": "请提供商品名称、重量、工费和供应商"
        }
    
    validated_products = []
    validation_errors = []
    
    shared_supplier = None
    for product in ai_response.products:
        if product.supplier:
            shared_supplier = product.supplier
            break
    
    for idx, product in enumerate(ai_response.products):
        product_supplier = product.supplier or shared_supplier
        
        if not product.product_name or not product.weight or product.labor_cost is None:
            validation_errors.append({
                "index": idx + 1,
                "message": f"商品信息不完整: {product.model_dump()}",
                "product": product.model_dump()
            })
            continue
        
        if not product_supplier:
            validation_errors.append({
                "index": idx + 1,
                "message": f"缺少供应商信息: {product.model_dump()}",
                "product": product.model_dump()
            })
            continue
        
        product.supplier = product_supplier
        
        try:
            weight = float(product.weight)
            labor_cost = float(product.labor_cost)
        except (ValueError, TypeError) as e:
            validation_errors.append({
                "index": idx + 1,
                "message": f"数值格式错误: {str(e)}",
                "product": product.model_dump()
            })
            continue
        
        if weight <= 0:
            validation_errors.append({
                "index": idx + 1,
                "message": f"重量必须大于0: {weight}",
                "product": product.model_dump()
            })
            continue
        
        if labor_cost < 0:
            validation_errors.append({
                "index": idx + 1,
                "message": f"工费不能为负数: {labor_cost}",
                "product": product.model_dump()
            })
            continue
        
        piece_count = None
        piece_labor_cost = None
        if product.piece_count is not None:
            try:
                piece_count = int(product.piece_count)
                if piece_count < 0:
                    piece_count = None
            except (ValueError, TypeError):
                piece_count = None
        
        if product.piece_labor_cost is not None:
            try:
                piece_labor_cost = float(product.piece_labor_cost)
                if piece_labor_cost < 0:
                    piece_labor_cost = None
            except (ValueError, TypeError):
                piece_labor_cost = None
        
        gram_cost = weight * labor_cost
        piece_cost = (piece_count or 0) * (piece_labor_cost or 0)
        total_cost = gram_cost + piece_cost
        
        validated_products.append({
            "product": product,
            "weight": weight,
            "labor_cost": labor_cost,
            "piece_count": piece_count,
            "piece_labor_cost": piece_labor_cost,
            "total_cost": total_cost
        })
    
    if validation_errors:
        return {
            "success": False,
            "message": f"商品验证失败，共{len(validation_errors)}个商品有问题",
            "validation_errors": validation_errors,
            "parsed": ai_response.model_dump()
        }
    
    if not validated_products:
        return {
            "success": False,
            "message": "没有有效的商品信息",
            "parsed": ai_response.model_dump()
        }
    
    suppliers = set(p["product"].supplier for p in validated_products if p["product"].supplier)
    if len(suppliers) > 1:
        return {
            "success": False,
            "message": f"检测到多个供应商: {', '.join(suppliers)}。每张入库单只能对应一个供应商。",
            "suppliers": list(suppliers),
            "parsed": ai_response.model_dump()
        }
    
    supplier_name = validated_products[0]["product"].supplier if validated_products else None
    
    if len(validated_products) == 1:
        product = validated_products[0]
        card_data = {
            "product_name": product["product"].product_name,
            "weight": product["weight"],
            "labor_cost": product["labor_cost"],
            "piece_count": product.get("piece_count"),
            "piece_labor_cost": product.get("piece_labor_cost"),
            "supplier": supplier_name,
            "total_cost": product["total_cost"]
        }
        return {
            "success": True,
            "message": f"请核对入库信息: {product['product'].product_name} {product['weight']}克",
            "pending": True,
            "card_data": card_data
        }
    else:
        first_product = validated_products[0]
        all_products_list = [
            {
                "product_name": p["product"].product_name,
                "weight": p["weight"],
                "labor_cost": p["labor_cost"],
                "piece_count": p.get("piece_count"),
                "piece_labor_cost": p.get("piece_labor_cost"),
                "supplier": p["product"].supplier,
                "total_cost": p["total_cost"]
            }
            for p in validated_products
        ]
        return {
            "success": True,
            "message": f"请核对入库信息，共{len(validated_products)}个商品",
            "pending": True,
            "card_data": {
                "product_name": first_product["product"].product_name,
                "weight": first_product["weight"],
                "labor_cost": first_product["labor_cost"],
                "piece_count": first_product.get("piece_count"),
                "piece_labor_cost": first_product.get("piece_labor_cost"),
                "supplier": supplier_name,
                "total_cost": first_product["total_cost"]
            },
            "all_products": all_products_list
        }


async def execute_inbound(card_data: Dict[str, Any], db: Session) -> Dict[str, Any]:
    """执行实际的入库操作（从卡片数据）"""
    try:
        product_name = card_data.get("product_name")
        product_code = card_data.get("product_code")
        weight = safe_float(card_data.get("weight", 0), field_name="重量")
        labor_cost = safe_float(card_data.get("labor_cost", 0), field_name="工费")
        piece_count = card_data.get("piece_count")
        piece_labor_cost = card_data.get("piece_labor_cost")
        supplier_name = card_data.get("supplier")
        
        piece_count = safe_int(piece_count, field_name="件数")
        piece_labor_cost = safe_float(piece_labor_cost, default=None, field_name="件工费") if piece_labor_cost is not None else None
        
        # 商品编码与名称关联处理
        from ..models import ProductCode as ProductCodeModel
        
        if product_code:
            code_record = db.query(ProductCodeModel).filter(ProductCodeModel.code == product_code).first()
            if code_record and code_record.name:
                product_name = code_record.name
        
        if product_name and (product_name.isupper() or product_name.replace(' ', '').isalnum()):
            code_record = db.query(ProductCodeModel).filter(ProductCodeModel.code == product_name).first()
            if code_record and code_record.name:
                product_code = product_name
                product_name = code_record.name
        
        if not product_name or weight <= 0 or labor_cost < 0:
            return {
                "success": False,
                "message": "商品信息不完整或无效",
                "error": "validation_failed"
            }
        
        # 验证商品名称
        valid_product = db.query(ProductCodeModel).filter(
            ProductCodeModel.name == product_name,
            ProductCodeModel.code_type == 'predefined'
        ).first()
        if not valid_product:
            return {
                "success": False,
                "message": f"商品名称 '{product_name}' 不在预定义列表中",
                "error": "invalid_product_name"
            }
        
        # 珐琅产品自动生成F编码
        craft = card_data.get("craft", "")
        is_enamel_product = "珐琅" in (product_name or "") or "珐琅" in (craft or "")
        
        if is_enamel_product and not product_code:
            from ..init_product_codes import get_next_f_code
            
            product_code = get_next_f_code(db)
            new_code = ProductCodeModel(
                code=product_code,
                name=product_name,
                code_type="f_single",
                is_unique=1,
                is_used=1,
                created_by="系统自动"
            )
            db.add(new_code)
            db.flush()
        
        # 生成入库单号
        order_no = generate_inbound_order_no(db)
        
        # 创建入库单
        order = InboundOrder(order_no=order_no, create_time=china_now())
        db.add(order)
        db.flush()
        
        # 查找或创建供应商
        supplier_id = None
        supplier_obj = None
        if supplier_name:
            supplier_obj = db.query(Supplier).filter(
                Supplier.name == supplier_name,
                Supplier.status == "active"
            ).first()
            
            if not supplier_obj:
                supplier_no = f"GYS{china_now().strftime('%Y%m%d%H%M%S')}"
                supplier_obj = Supplier(
                    supplier_no=supplier_no,
                    name=supplier_name,
                    supplier_type="个人"
                )
                db.add(supplier_obj)
                db.flush()
            
            supplier_id = supplier_obj.id
        
        # 计算总成本
        gram_cost = labor_cost * weight
        piece_cost = (piece_count or 0) * (piece_labor_cost or 0)
        total_cost = gram_cost + piece_cost
        
        # 创建入库明细
        detail = InboundDetail(
            order_id=order.id,
            product_code=product_code,
            product_name=product_name,
            product_category=card_data.get("product_category"),
            weight=weight,
            labor_cost=labor_cost,
            piece_count=piece_count,
            piece_labor_cost=piece_labor_cost,
            supplier=supplier_name,
            supplier_id=supplier_id,
            total_cost=total_cost,
            craft=craft if craft else None
        )
        db.add(detail)
        
        # 更新总库存
        inventory = db.query(Inventory).filter(Inventory.product_name == product_name).first()
        if inventory:
            inventory.total_weight = round(inventory.total_weight + weight, 3)
        else:
            inventory = Inventory(product_name=product_name, total_weight=weight)
            db.add(inventory)
        
        # 更新分仓库存
        default_location = db.query(Location).filter(Location.code == "warehouse").first()
        if not default_location:
            default_location = Location(
                code="warehouse",
name="商品部仓库",
                location_type="warehouse",
                description="默认入库位置"
            )
            db.add(default_location)
            db.flush()
        
        location_inventory = db.query(LocationInventory).filter(
            LocationInventory.product_name == product_name,
            LocationInventory.location_id == default_location.id
        ).first()
        
        if location_inventory:
            location_inventory.weight += weight
        else:
            location_inventory = LocationInventory(
                product_name=product_name,
                location_id=default_location.id,
                weight=weight
            )
            db.add(location_inventory)
        
        # 更新供应商统计
        if supplier_obj:
            supplier_obj.total_supply_amount = round(supplier_obj.total_supply_amount + total_cost, 2)
            supplier_obj.total_supply_weight = round(supplier_obj.total_supply_weight + weight, 3)
            supplier_obj.total_supply_count += 1
            supplier_obj.last_supply_time = datetime.now()
            
            # 更新供应商金料账户
            from ..models import SupplierGoldAccount, SupplierGoldTransaction
            
            supplier_gold_account = db.query(SupplierGoldAccount).filter(
                SupplierGoldAccount.supplier_id == supplier_obj.id
            ).first()
            
            if not supplier_gold_account:
                supplier_gold_account = SupplierGoldAccount(
                    supplier_id=supplier_obj.id,
                    supplier_name=supplier_obj.name,
                    current_balance=0.0,
                    total_received=0.0,
                    total_paid=0.0
                )
                db.add(supplier_gold_account)
                db.flush()
            
            balance_before = supplier_gold_account.current_balance
            supplier_gold_account.current_balance = round(supplier_gold_account.current_balance + weight, 3)
            supplier_gold_account.total_received = round(supplier_gold_account.total_received + weight, 3)
            supplier_gold_account.last_transaction_at = china_now()
            
            supplier_gold_tx = SupplierGoldTransaction(
                supplier_id=supplier_obj.id,
                supplier_name=supplier_obj.name,
                transaction_type='receive',
                inbound_order_id=order.id,
                gold_weight=weight,
                balance_before=balance_before,
                balance_after=supplier_gold_account.current_balance,
                created_by="系统",
                remark=f"入库单：{order.order_no}，供应商发货"
            )
            db.add(supplier_gold_tx)
        
        db.commit()
        db.refresh(order)
        db.refresh(detail)
        db.refresh(inventory)
        
        order_response = InboundOrderResponse.model_validate(order).model_dump(mode='json')
        detail_response = InboundDetailResponse.model_validate(detail).model_dump(mode='json')
        inventory_response = InventoryResponse.model_validate(inventory).model_dump(mode='json')
        
        return {
            "success": True,
            "message": f"入库成功: {product_name} {weight}克",
            "order_id": order.id,
            "order_no": order.order_no,
            "order": order_response,
            "detail": detail_response,
            "inventory": inventory_response
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"入库操作失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"入库操作失败: {str(e)}",
            "error": str(e)
        }


# ==================== API端点 ====================

@router.get("/filter-options")
async def get_inbound_filter_options(db: Session = Depends(get_db)):
    """获取入库单高级搜索的筛选选项"""
    from ..models import ProductAttribute
    
    try:
        product_names = db.query(InboundDetail.product_name).distinct().filter(
            InboundDetail.product_name.isnot(None),
            InboundDetail.product_name != ''
        ).all()
        
        product_codes = db.query(InboundDetail.product_code).distinct().filter(
            InboundDetail.product_code.isnot(None),
            InboundDetail.product_code != ''
        ).all()
        
        suppliers = db.query(InboundDetail.supplier).distinct().filter(
            InboundDetail.supplier.isnot(None),
            InboundDetail.supplier != ''
        ).all()
        
        fineness_attrs = db.query(ProductAttribute.value).filter(
            ProductAttribute.category == 'fineness',
            ProductAttribute.is_active == True
        ).order_by(ProductAttribute.sort_order).all()
        
        craft_attrs = db.query(ProductAttribute.value).filter(
            ProductAttribute.category == 'craft',
            ProductAttribute.is_active == True
        ).order_by(ProductAttribute.sort_order).all()
        
        style_attrs = db.query(ProductAttribute.value).filter(
            ProductAttribute.category == 'style',
            ProductAttribute.is_active == True
        ).order_by(ProductAttribute.sort_order).all()
        
        fineness_from_details = db.query(InboundDetail.fineness).distinct().filter(
            InboundDetail.fineness.isnot(None),
            InboundDetail.fineness != ''
        ).all()
        
        crafts_from_details = db.query(InboundDetail.craft).distinct().filter(
            InboundDetail.craft.isnot(None),
            InboundDetail.craft != ''
        ).all()
        
        styles_from_details = db.query(InboundDetail.style).distinct().filter(
            InboundDetail.style.isnot(None),
            InboundDetail.style != ''
        ).all()
        
        fineness_set = set([f[0] for f in fineness_attrs if f[0]]) | set([f[0] for f in fineness_from_details if f[0]])
        crafts_set = set([c[0] for c in craft_attrs if c[0]]) | set([c[0] for c in crafts_from_details if c[0]])
        styles_set = set([s[0] for s in style_attrs if s[0]]) | set([s[0] for s in styles_from_details if s[0]])
        
        return {
            "success": True,
            "data": {
                "product_names": sorted([p[0] for p in product_names if p[0]]),
                "product_codes": sorted([p[0] for p in product_codes if p[0]]),
                "suppliers": sorted([s[0] for s in suppliers if s[0]]),
                "fineness": sorted(list(fineness_set)),
                "crafts": sorted(list(crafts_set)),
                "styles": sorted(list(styles_set))
            }
        }
    except Exception as e:
        logger.error(f"获取筛选选项失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("")
async def get_inbound_orders(
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    supplier: Optional[str] = Query(None, description="供应商名称"),
    order_no: Optional[str] = Query(None, description="单号搜索"),
    product_name: Optional[str] = Query(None, description="商品名称"),
    product_code: Optional[str] = Query(None, description="商品编码"),
    weight_min: Optional[float] = Query(None, description="最小重量"),
    weight_max: Optional[float] = Query(None, description="最大重量"),
    labor_cost_min: Optional[float] = Query(None, description="最小克工费"),
    labor_cost_max: Optional[float] = Query(None, description="最大克工费"),
    total_cost_min: Optional[float] = Query(None, description="最小总成本"),
    total_cost_max: Optional[float] = Query(None, description="最大总成本"),
    operator: Optional[str] = Query(None, description="操作员"),
    fineness: Optional[str] = Query(None, description="成色"),
    craft: Optional[str] = Query(None, description="工艺"),
    style: Optional[str] = Query(None, description="款式"),
    limit: int = Query(100, description="返回数量"),
    offset: int = Query(0, description="偏移量"),
    db: Session = Depends(get_db)
):
    """获取入库单列表"""
    try:
        query = db.query(InboundOrder).order_by(InboundOrder.create_time.desc())
        
        if start_date:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query = query.filter(InboundOrder.create_time >= start_dt)
            except:
                pass
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                query = query.filter(InboundOrder.create_time <= end_dt)
            except:
                pass
        
        if order_no:
            query = query.filter(InboundOrder.order_no.contains(order_no))
        
        if operator:
            query = query.filter(InboundOrder.operator.contains(operator))
        
        base_total = query.count()
        orders = query.offset(offset).limit(limit).all()
        
        order_ids = [order.id for order in orders]
        
        if order_ids:
            details_query = db.query(InboundDetail).filter(InboundDetail.order_id.in_(order_ids))
            
            if supplier:
                details_query = details_query.filter(InboundDetail.supplier.contains(supplier))
            if product_name:
                details_query = details_query.filter(InboundDetail.product_name.contains(product_name))
            if product_code:
                details_query = details_query.filter(InboundDetail.product_code.contains(product_code))
            if weight_min is not None:
                details_query = details_query.filter(InboundDetail.weight >= weight_min)
            if weight_max is not None:
                details_query = details_query.filter(InboundDetail.weight <= weight_max)
            if labor_cost_min is not None:
                details_query = details_query.filter(InboundDetail.labor_cost >= labor_cost_min)
            if labor_cost_max is not None:
                details_query = details_query.filter(InboundDetail.labor_cost <= labor_cost_max)
            if total_cost_min is not None:
                details_query = details_query.filter(InboundDetail.total_cost >= total_cost_min)
            if total_cost_max is not None:
                details_query = details_query.filter(InboundDetail.total_cost <= total_cost_max)
            if fineness:
                details_query = details_query.filter(InboundDetail.fineness.contains(fineness))
            if craft:
                details_query = details_query.filter(InboundDetail.craft.contains(craft))
            if style:
                details_query = details_query.filter(InboundDetail.style.contains(style))
            
            all_details = details_query.all()
            
            details_by_order = {}
            for detail in all_details:
                if detail.order_id not in details_by_order:
                    details_by_order[detail.order_id] = []
                details_by_order[detail.order_id].append(detail)
        else:
            details_by_order = {}
        
        has_detail_filters = any([supplier, product_name, product_code, 
                                  weight_min, weight_max, labor_cost_min, labor_cost_max,
                                  total_cost_min, total_cost_max, fineness, craft, style])
        
        result = []
        for order in orders:
            details = details_by_order.get(order.id, [])
            
            if has_detail_filters and len(details) == 0:
                continue
            
            item_count = len(details)
            total_weight = sum(d.weight or 0 for d in details)
            suppliers_list = list(set(d.supplier for d in details if d.supplier))
            
            result.append({
                "id": order.id,
                "order_no": order.order_no,
                "create_time": order.create_time.isoformat() if order.create_time else None,
                "operator": order.operator,
                "status": order.status,
                "item_count": item_count,
                "total_weight": round(total_weight, 2),
                "suppliers": suppliers_list,
                "details": [{
                    "id": d.id,
                    "product_code": d.product_code,
                    "product_name": d.product_name,
                    "product_category": d.product_category,
                    "weight": d.weight,
                    "labor_cost": d.labor_cost,
                    "piece_count": d.piece_count,
                    "piece_labor_cost": d.piece_labor_cost,
                    "supplier": d.supplier,
                    "total_cost": d.total_cost,
                    "fineness": d.fineness,
                    "craft": d.craft,
                    "style": d.style
                } for d in details]
            })
        
        return {
            "success": True,
            "data": result,
            "total": len(result),
            "base_total": base_total,
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"获取入库单列表失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.put("/{order_id}")
async def update_inbound_order(
    order_id: int,
    updates: dict,
    db: Session = Depends(get_db)
):
    """修改入库单"""
    try:
        order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
        if not order:
            return {"success": False, "error": "入库单不存在"}
        
        if "operator" in updates:
            order.operator = updates["operator"]
        if "status" in updates:
            order.status = updates["status"]
        
        if "details" in updates and isinstance(updates["details"], list):
            for detail_update in updates["details"]:
                detail_id = detail_update.get("id")
                if detail_id:
                    detail = db.query(InboundDetail).filter(InboundDetail.id == detail_id).first()
                    if detail:
                        if "product_name" in detail_update:
                            detail.product_name = detail_update["product_name"]
                        if "weight" in detail_update:
                            detail.weight = float(detail_update["weight"])
                        if "labor_cost" in detail_update:
                            detail.labor_cost = float(detail_update["labor_cost"])
                        if "supplier" in detail_update:
                            detail.supplier = detail_update["supplier"]
                        if "piece_count" in detail_update:
                            detail.piece_count = int(detail_update["piece_count"]) if detail_update["piece_count"] else None
                        if "piece_labor_cost" in detail_update:
                            detail.piece_labor_cost = float(detail_update["piece_labor_cost"]) if detail_update["piece_labor_cost"] else None
        
        db.commit()
        
        return {
            "success": True,
            "message": "入库单更新成功",
            "order_id": order_id
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"更新入库单失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.post("")
async def create_inbound_order(card_data: InboundOrderCreate, db: Session = Depends(get_db)):
    """创建入库单（从卡片数据确认入库）"""
    try:
        card_dict = {
            "product_name": card_data.product_name,
            "product_category": card_data.product_category,
            "weight": card_data.weight,
            "labor_cost": card_data.labor_cost,
            "supplier": card_data.supplier
        }
        
        result = await execute_inbound(card_dict, db)
        return result
    except Exception as e:
        logger.error(f"创建入库单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建入库单失败: {str(e)}",
            "error": str(e)
        }


@router.post("/batch")
async def create_batch_inbound_orders(batch_data: BatchInboundCreate, db: Session = Depends(get_db)):
    """批量创建入库单"""
    try:
        if not batch_data.items:
            return {"success": False, "message": "没有商品数据"}
        
        from ..models import ProductCode as ProductCodeModel
        
        order_no = generate_inbound_order_no(db)
        order = InboundOrder(order_no=order_no, create_time=china_now())
        db.add(order)
        db.flush()
        
        supplier_name = batch_data.supplier
        supplier_id = None
        supplier_obj = None
        if supplier_name:
            supplier_obj = db.query(Supplier).filter(
                Supplier.name == supplier_name,
                Supplier.status == "active"
            ).first()
            
            if not supplier_obj:
                supplier_no = f"GYS{china_now().strftime('%Y%m%d%H%M%S')}"
                supplier_obj = Supplier(
                    supplier_no=supplier_no,
                    name=supplier_name,
                    supplier_type="个人"
                )
                db.add(supplier_obj)
                db.flush()
            
            supplier_id = supplier_obj.id
        
        default_location = db.query(Location).filter(Location.code == "warehouse").first()
        if not default_location:
            default_location = Location(
                code="warehouse",
                name="商品部仓库",
                location_type="warehouse",
                description="默认入库位置"
            )
            db.add(default_location)
            db.flush()
        
        results = []
        total_weight = 0
        total_cost = 0
        success_count = 0
        error_count = 0
        
        inventory_cache = {}
        location_inventory_cache = {}
        
        for idx, item in enumerate(batch_data.items):
            try:
                product_name = item.product_name
                product_code = item.product_code
                weight = float(item.weight)
                labor_cost = float(item.labor_cost)
                piece_count = item.piece_count or 0
                piece_labor_cost = item.piece_labor_cost or 0.0
                
                if product_code:
                    code_record = db.query(ProductCodeModel).filter(ProductCodeModel.code == product_code).first()
                    if code_record and code_record.name:
                        product_name = code_record.name
                
                if not product_name or weight <= 0 or labor_cost < 0:
                    error_count += 1
                    results.append({
                        "index": idx + 1,
                        "product_name": item.product_name,
                        "success": False,
                        "error": "商品信息不完整或无效"
                    })
                    continue
                
                valid_product = db.query(ProductCodeModel).filter(
                    ProductCodeModel.name == product_name,
                    ProductCodeModel.code_type == 'predefined'
                ).first()
                if not valid_product:
                    error_count += 1
                    results.append({
                        "index": idx + 1,
                        "product_name": product_name,
                        "success": False,
                        "error": f"商品名称 '{product_name}' 不在预定义列表中"
                    })
                    continue
                
                gram_cost = labor_cost * weight
                piece_cost = piece_count * piece_labor_cost
                item_total_cost = gram_cost + piece_cost
                
                detail = InboundDetail(
                    order_id=order.id,
                    product_code=product_code,
                    product_name=product_name,
                    weight=weight,
                    labor_cost=labor_cost,
                    piece_count=piece_count if piece_count > 0 else None,
                    piece_labor_cost=piece_labor_cost if piece_labor_cost > 0 else None,
                    supplier=supplier_name,
                    supplier_id=supplier_id,
                    total_cost=item_total_cost
                )
                db.add(detail)
                
                if product_name in inventory_cache:
                    inventory_cache[product_name].total_weight = round(inventory_cache[product_name].total_weight + weight, 3)
                else:
                    inventory = db.query(Inventory).filter(Inventory.product_name == product_name).first()
                    if inventory:
                        inventory.total_weight = round(inventory.total_weight + weight, 3)
                        inventory_cache[product_name] = inventory
                    else:
                        inventory = Inventory(product_name=product_name, total_weight=weight)
                        db.add(inventory)
                        inventory_cache[product_name] = inventory
                
                if product_name in location_inventory_cache:
                    location_inventory_cache[product_name].weight += weight
                else:
                    location_inventory = db.query(LocationInventory).filter(
                        LocationInventory.product_name == product_name,
                        LocationInventory.location_id == default_location.id
                    ).first()
                    
                    if location_inventory:
                        location_inventory.weight += weight
                        location_inventory_cache[product_name] = location_inventory
                    else:
                        location_inventory = LocationInventory(
                            product_name=product_name,
                            location_id=default_location.id,
                            weight=weight
                        )
                        db.add(location_inventory)
                        location_inventory_cache[product_name] = location_inventory
                
                total_weight += weight
                total_cost += item_total_cost
                success_count += 1
                results.append({
                    "index": idx + 1,
                    "product_name": product_name,
                    "weight": weight,
                    "success": True
                })
                
            except Exception as e:
                error_count += 1
                results.append({
                    "index": idx + 1,
                    "product_name": item.product_name,
                    "success": False,
                    "error": str(e)
                })
        
        if supplier_obj and success_count > 0:
            supplier_obj.total_supply_amount = round(supplier_obj.total_supply_amount + total_cost, 2)
            supplier_obj.total_supply_weight = round(supplier_obj.total_supply_weight + total_weight, 3)
            supplier_obj.total_supply_count += success_count
            supplier_obj.last_supply_time = datetime.now()
        
        db.commit()
        db.refresh(order)
        
        return {
            "success": success_count > 0,
            "message": f"批量入库成功：{success_count} 件商品已入库" if error_count == 0 else f"批量入库完成：成功 {success_count} 件，失败 {error_count} 件",
            "order_id": order.id,
            "order_no": order.order_no,
            "success_count": success_count,
            "error_count": error_count,
            "total_weight": total_weight,
            "total_cost": total_cost,
            "results": results
        }
    except Exception as e:
        db.rollback()
        logger.error(f"批量入库失败: {e}", exc_info=True)
        return {"success": False, "message": f"批量入库失败: {str(e)}", "error": str(e)}


@router.options("/{order_id}/download")
async def download_inbound_order_options(order_id: int):
    """处理CORS预检请求"""
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/{order_id}/download")
async def download_inbound_order(
    order_id: int, 
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印入库单"""
    try:
        order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="入库单不存在")
        
        details = db.query(InboundDetail).filter(InboundDetail.order_id == order_id).all()
        if not details:
            raise HTTPException(status_code=404, detail="入库单明细不存在")
        
        if format == "pdf":
            from reportlab.pdfgen import canvas
            from reportlab.lib.units import mm
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            import io
            from ..timezone_utils import to_china_time, format_china_time
            
            PAGE_WIDTH = 241 * mm
            PAGE_HEIGHT = 140 * mm
            
            buffer = io.BytesIO()
            p = canvas.Canvas(buffer, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
            width, height = PAGE_WIDTH, PAGE_HEIGHT
            
            try:
                pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                chinese_font = 'STSong-Light'
            except Exception:
                chinese_font = None
            
            left_margin = 10 * mm
            right_margin = width - 10 * mm
            top_margin = height - 8 * mm
            
            if chinese_font:
                p.setFont(chinese_font, 14)
            else:
                p.setFont("Helvetica-Bold", 14)
            p.drawCentredString(width / 2, top_margin, "珠宝入库单")
            
            y = top_margin - 18
            if chinese_font:
                p.setFont(chinese_font, 9)
            else:
                p.setFont("Helvetica", 9)
            
            if order.create_time:
                china_time = to_china_time(order.create_time)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M')
            else:
                create_time_str = "未知"
            
            p.drawString(left_margin, y, f"单号：{order.order_no}")
            p.drawString(width / 2, y, f"时间：{create_time_str}  操作员：{order.operator}")
            y -= 15
            
            p.line(left_margin, y, right_margin, y)
            y -= 12
            
            col_x = [left_margin, 70*mm, 100*mm, 125*mm, 150*mm, 175*mm, 200*mm]
            if chinese_font:
                p.setFont(chinese_font, 8)
            else:
                p.setFont("Helvetica-Bold", 8)
            p.drawString(col_x[0], y, "商品名称")
            p.drawString(col_x[1], y, "重量(克)")
            p.drawString(col_x[2], y, "克工费")
            p.drawString(col_x[3], y, "件数")
            p.drawString(col_x[4], y, "件工费")
            p.drawString(col_x[5], y, "总成本")
            p.drawString(col_x[6], y, "供应商")
            y -= 10
            
            p.line(left_margin, y, right_margin, y)
            y -= 10
            
            total_cost = 0
            total_weight = 0
            total_piece_count = 0
            bottom_margin = 25 * mm
            
            for detail in details:
                if y < bottom_margin:
                    p.showPage()
                    y = top_margin - 10
                
                product_name = detail.product_name[:12] if len(detail.product_name) > 12 else detail.product_name
                supplier_name = (detail.supplier or "-")[:6] if detail.supplier else "-"
                piece_count = getattr(detail, 'piece_count', None) or 0
                piece_labor_cost = getattr(detail, 'piece_labor_cost', None) or 0
                
                if chinese_font:
                    p.setFont(chinese_font, 8)
                    p.drawString(col_x[0], y, product_name)
                    p.setFont("Helvetica", 8)
                    p.drawString(col_x[1], y, f"{detail.weight:.2f}")
                    p.drawString(col_x[2], y, f"{detail.labor_cost:.1f}")
                    p.drawString(col_x[3], y, str(piece_count) if piece_count > 0 else "-")
                    p.drawString(col_x[4], y, f"{piece_labor_cost:.1f}" if piece_count > 0 else "-")
                    p.drawString(col_x[5], y, f"{detail.total_cost:.2f}")
                    p.setFont(chinese_font, 8)
                    p.drawString(col_x[6], y, supplier_name)
                else:
                    p.setFont("Helvetica", 8)
                    p.drawString(col_x[0], y, product_name)
                    p.drawString(col_x[1], y, f"{detail.weight:.2f}")
                    p.drawString(col_x[2], y, f"{detail.labor_cost:.1f}")
                    p.drawString(col_x[3], y, str(piece_count) if piece_count > 0 else "-")
                    p.drawString(col_x[4], y, f"{piece_labor_cost:.1f}" if piece_count > 0 else "-")
                    p.drawString(col_x[5], y, f"{detail.total_cost:.2f}")
                    p.drawString(col_x[6], y, supplier_name)
                
                total_cost += detail.total_cost
                total_weight += detail.weight
                total_piece_count += piece_count
                y -= 12
            
            y -= 5
            p.line(left_margin, y, right_margin, y)
            y -= 12
            if chinese_font:
                p.setFont(chinese_font, 9)
            else:
                p.setFont("Helvetica-Bold", 9)
            
            summary_text = f"合计：重量 {total_weight:.2f}克"
            if total_piece_count > 0:
                summary_text += f"  |  件数 {total_piece_count}件"
            summary_text += f"  |  总工费 ¥{total_cost:.2f}"
            p.drawString(left_margin, y, summary_text)
            
            p.save()
            buffer.seek(0)
            
            filename = f"inbound_order_{order.order_no}.pdf"
            pdf_content = buffer.getvalue()
            
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename={filename}",
                    "Content-Type": "application/pdf",
                    "Access-Control-Allow-Origin": "*",
                }
            )
        
        elif format == "html":
            from ..timezone_utils import to_china_time, format_china_time
            
            if order.create_time:
                china_time = to_china_time(order.create_time)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            else:
                create_time_str = '未知'
            
            html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>入库单 - {order.order_no}</title>
    <style>
        body {{ font-family: "Microsoft YaHei", Arial, sans-serif; padding: 20px; }}
        .header {{ text-align: center; margin-bottom: 20px; }}
        table {{ width: 100%; border-collapse: collapse; }}
        th, td {{ border: 1px solid #999; padding: 8px; text-align: center; }}
        th {{ background-color: #f0f0f0; }}
    </style>
</head>
<body>
    <div class="header"><h1>珠宝入库单</h1></div>
    <p>单号：{order.order_no} | 时间：{create_time_str} | 操作员：{order.operator}</p>
    <table>
        <thead><tr><th>商品名称</th><th>重量(克)</th><th>克工费</th><th>总成本</th><th>供应商</th></tr></thead>
        <tbody>
"""
            total_cost = 0
            total_weight = 0
            for detail in details:
                html_content += f"""<tr><td>{detail.product_name}</td><td>{detail.weight:.2f}</td><td>{detail.labor_cost:.2f}</td><td>{detail.total_cost:.2f}</td><td>{detail.supplier or '-'}</td></tr>"""
                total_cost += detail.total_cost
                total_weight += detail.weight
            
            html_content += f"""</tbody></table><p>合计：重量 {total_weight:.2f}克 | 总成本 ¥{total_cost:.2f}</p></body></html>"""
            
            response = HTMLResponse(content=html_content)
            response.headers["Access-Control-Allow-Origin"] = "*"
            return response
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成入库单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成入库单失败: {str(e)}")
