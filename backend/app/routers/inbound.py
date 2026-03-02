"""
入库管理路由模块
包含入库单CRUD、execute_inbound等功能
"""
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from fastapi.responses import Response, HTMLResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, desc
from datetime import datetime, date, timezone, timedelta
import logging
import random
from typing import Dict, Any, List, Optional

from ..database import get_db
from ..schemas import InboundOrderCreate, BatchInboundCreate
from ..models import (
    InboundOrder, InboundDetail, Inventory, Supplier,
    Location, LocationInventory, InventoryTransferOrder, InventoryTransferItem
)
from ..schemas import InboundOrderResponse, InboundDetailResponse, InventoryResponse
from ..middleware.permissions import has_permission
from ..timezone_utils import china_now
from ..dependencies.auth import get_current_role, require_permission
from ..utils.decimal_utils import to_decimal, round_weight, round_money, safe_float_for_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inbound-orders", tags=["inbound"])


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


def safe_float(value, default=0, field_name="数值"):
    """安全地将值转为 Decimal（函数名保留向后兼容，实际返回 Decimal）"""
    from ..utils.decimal_utils import to_decimal
    return to_decimal(value, default=str(default))


def safe_int(value, default=None, field_name="数值"):
    """安全的整数转换，带异常处理"""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"{field_name}格式无效: {value}")


def _ensure_zj_predefined(db: Session):
    """确保存在 ZJ=足金 的预定义编码。"""
    from ..models import ProductCode as ProductCodeModel
    zj = db.query(ProductCodeModel).filter(ProductCodeModel.code == "ZJ").first()
    if not zj:
        zj = ProductCodeModel(
            code="ZJ",
            name="足金",
            code_type="predefined",
            is_unique=0,
            is_used=0,
            created_by="系统规则"
        )
        db.add(zj)
        db.flush()
    return zj


def _normalize_inbound_code_fields(
    db: Session,
    product_name: Optional[str],
    product_code: Optional[str],
    barcode: Optional[str] = None
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    规范化入库编码字段：
    - standard_code：标准商品编码
    - product_name：规范化后的商品名称
    - barcode：条码号（可自定义）
    """
    from ..models import ProductCode as ProductCodeModel

    p_name = (product_name or "").strip() if product_name is not None else None
    p_code = (product_code or "").strip() if product_code is not None else None
    p_barcode = (barcode or "").strip() if barcode is not None else None

    # 先按编码查名称（兼容历史行为）
    code_record = None
    if p_code:
        code_record = db.query(ProductCodeModel).filter(ProductCodeModel.code == p_code).first()
        if code_record and code_record.name:
            p_name = code_record.name

    # 纯编码文本填在商品名里时，尝试反查
    if p_name and (p_name.isupper() or p_name.replace(' ', '').isalnum()):
        by_name_code = db.query(ProductCodeModel).filter(ProductCodeModel.code == p_name).first()
        if by_name_code and by_name_code.name:
            p_code = p_name
            p_name = by_name_code.name
            code_record = by_name_code

    # 方案B：足金统一标准编码 ZJ，条码可自定义
    if p_name == "足金":
        _ensure_zj_predefined(db)
        # 当用户在“编码”列填了非标准编码内容，按条码号处理
        if not p_barcode and p_code and p_code.upper() != "ZJ" and code_record is None:
            p_barcode = p_code
        p_code = "ZJ"

    # 非足金，若未指定编码则按原规则自动匹配/生成
    if p_name != "足金" and not p_code and p_name:
        valid_product = db.query(ProductCodeModel).filter(
            ProductCodeModel.name == p_name,
            ProductCodeModel.code_type == 'predefined'
        ).first()
        if valid_product and not valid_product.code.startswith('F'):
            p_code = valid_product.code
        else:
            from ..init_product_codes import get_next_f_code
            p_code = get_next_f_code(db)
            new_code = ProductCodeModel(
                code=p_code,
                name=p_name,
                code_type="f_single",
                is_unique=1,
                is_used=1,
                created_by="系统自动"
            )
            db.add(new_code)
            db.flush()

    return p_code, p_name, p_barcode


from ..core.tenant_rules import apply_tenant_rules


@apply_tenant_rules(trigger_point="before_inbound")
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
            weight = to_decimal(product.weight)
            labor_cost = to_decimal(product.labor_cost)
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
                piece_labor_cost = to_decimal(product.piece_labor_cost)
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
    
    # 创建入库单到数据库（status=draft，不影响库存）
    try:
        from ..models import ProductCode as ProductCodeModel
        
        order_no = generate_inbound_order_no(db)
        order = InboundOrder(order_no=order_no, create_time=china_now(), status="draft")
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
        
        created_details = []
        for vp in validated_products:
            product = vp["product"]
            weight = vp["weight"]
            labor_cost = vp["labor_cost"]
            piece_count = vp.get("piece_count")
            piece_labor_cost = vp.get("piece_labor_cost")
            total_cost = vp["total_cost"]
            
            p_name = product.product_name
            p_code = getattr(product, 'product_code', None)
            
            # 商品编码处理
            if p_code:
                code_record = db.query(ProductCodeModel).filter(ProductCodeModel.code == p_code).first()
                if code_record and code_record.name:
                    p_name = code_record.name
            if p_name and (p_name.isupper() or p_name.replace(' ', '').isalnum()):
                code_record = db.query(ProductCodeModel).filter(ProductCodeModel.code == p_name).first()
                if code_record and code_record.name:
                    p_code = p_name
                    p_name = code_record.name
            
            if not p_code:
                valid_product = db.query(ProductCodeModel).filter(
                    ProductCodeModel.name == p_name,
                    ProductCodeModel.code_type == 'predefined'
                ).first()
                if valid_product:
                    p_code = valid_product.code
                else:
                    from ..init_product_codes import get_next_f_code
                    p_code = get_next_f_code(db)
                    new_code = ProductCodeModel(
                        code=p_code,
                        name=p_name,
                        code_type="f_single",
                        is_unique=1,
                        is_used=1,
                        created_by="系统自动"
                    )
                    db.add(new_code)
                    db.flush()
            
            p_code, p_name, p_barcode = _normalize_inbound_code_fields(db, p_name, p_code, p_barcode)

            detail = InboundDetail(
                order_id=order.id,
                product_code=p_code,
                standard_code=p_code,
                barcode=p_barcode,
                product_name=p_name,
                weight=weight,
                labor_cost=labor_cost,
                piece_count=piece_count,
                piece_labor_cost=piece_labor_cost,
                supplier=product.supplier or supplier_name,
                supplier_id=supplier_id,
                total_cost=total_cost,
            )
            db.add(detail)
            created_details.append({
                "product_name": p_name,
                "product_code": p_code,
                "barcode": p_barcode,
                "weight": weight,
                "labor_cost": labor_cost,
                "piece_count": piece_count,
                "piece_labor_cost": piece_labor_cost,
                "supplier": product.supplier or supplier_name,
                "total_cost": total_cost
            })
        
        db.commit()
        db.refresh(order)
        
        logger.info(f"[入库] 已创建草稿入库单 {order.order_no}，包含 {len(created_details)} 个商品，待确认")
        
    except Exception as e:
        db.rollback()
        logger.error(f"[入库] 创建入库单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建入库单失败: {str(e)}",
        }
    
    if len(created_details) == 1:
        d = created_details[0]
        card_data = {
            "product_name": d["product_name"],
            "weight": d["weight"],
            "labor_cost": d["labor_cost"],
            "piece_count": d.get("piece_count"),
            "piece_labor_cost": d.get("piece_labor_cost"),
            "supplier": supplier_name,
            "total_cost": d["total_cost"],
            "order_id": order.id,
            "order_no": order.order_no,
        }
        return {
            "success": True,
            "message": f"请核对入库信息: {d['product_name']} {d['weight']}克",
            "pending": True,
            "card_data": card_data
        }
    else:
        first = created_details[0]
        all_products_list = [
            {
                "product_name": d["product_name"],
                "weight": d["weight"],
                "labor_cost": d["labor_cost"],
                "piece_count": d.get("piece_count"),
                "piece_labor_cost": d.get("piece_labor_cost"),
                "supplier": d["supplier"],
                "total_cost": d["total_cost"],
                "order_id": order.id,
                "order_no": order.order_no,
            }
            for d in created_details
        ]
        return {
            "success": True,
            "message": f"请核对入库信息，共{len(created_details)}个商品",
            "pending": True,
            "card_data": {
                "product_name": first["product_name"],
                "weight": first["weight"],
                "labor_cost": first["labor_cost"],
                "piece_count": first.get("piece_count"),
                "piece_labor_cost": first.get("piece_labor_cost"),
                "supplier": supplier_name,
                "total_cost": first["total_cost"],
                "order_id": order.id,
                "order_no": order.order_no,
            },
            "all_products": all_products_list
        }


@apply_tenant_rules(trigger_point="execute_inbound")
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
        
        # 商品名称匹配预定义编码，或自动生成F编码
        valid_product = db.query(ProductCodeModel).filter(
            ProductCodeModel.name == product_name,
            ProductCodeModel.code_type == 'predefined'
        ).first()
        if valid_product and not product_code:
            product_code = valid_product.code
        elif not valid_product and not product_code:
            # 非预定义商品 → 自动生成唯一F编码
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
        order = InboundOrder(order_no=order_no, create_time=china_now(), status="draft")
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
        
        # 计算总成本（镶嵌产品优先使用 total_amount）
        raw_total_amount = card_data.get("total_amount")
        if raw_total_amount and to_decimal(raw_total_amount) > 0:
            total_cost = to_decimal(raw_total_amount)
        else:
            gram_cost = labor_cost * weight
            piece_cost = (piece_count or 0) * (piece_labor_cost or 0)
            total_cost = gram_cost + piece_cost
        
        product_code, product_name, barcode = _normalize_inbound_code_fields(
            db, product_name, product_code, barcode
        )

        # 创建入库明细
        detail = InboundDetail(
            order_id=order.id,
            product_code=product_code,
            standard_code=product_code,
            barcode=barcode,
            product_name=product_name,
            product_category=card_data.get("product_category"),
            weight=weight,
            labor_cost=labor_cost,
            piece_count=piece_count,
            piece_labor_cost=piece_labor_cost,
            supplier=supplier_name,
            supplier_id=supplier_id,
            total_cost=total_cost,
            craft=card_data.get("craft"),
            # 镶嵌入库相关字段
            main_stone_weight=card_data.get("main_stone_weight"),
            main_stone_count=card_data.get("main_stone_count"),
            main_stone_price=card_data.get("main_stone_price"),
            main_stone_amount=card_data.get("main_stone_amount"),
            sub_stone_weight=card_data.get("sub_stone_weight"),
            sub_stone_count=card_data.get("sub_stone_count"),
            sub_stone_price=card_data.get("sub_stone_price"),
            sub_stone_amount=card_data.get("sub_stone_amount"),
            stone_setting_fee=card_data.get("stone_setting_fee"),
            total_amount=card_data.get("total_amount"),
            main_stone_mark=card_data.get("main_stone_mark"),
            sub_stone_mark=card_data.get("sub_stone_mark"),
            pearl_weight=card_data.get("pearl_weight"),
            bearing_weight=card_data.get("bearing_weight"),
            sale_labor_cost=card_data.get("sale_labor_cost"),
            sale_piece_labor_cost=card_data.get("sale_piece_labor_cost"),
        )
        db.add(detail)
        
        # 库存将在确认(confirm)时更新，创建时不影响库存
        
        db.commit()
        db.refresh(order)
        db.refresh(detail)
        
        order_response = InboundOrderResponse.model_validate(order).model_dump(mode='json')
        detail_response = InboundDetailResponse.model_validate(detail).model_dump(mode='json')
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="inbound",
            user_role="product",
            operation_details={
                "order_no": order.order_no,
                "product_name": product_name,
                "product_code": product_code,
                "weight": weight,
                "labor_cost": labor_cost,
                "supplier_name": supplier_name,
                "total_cost": total_cost
            }
        )
        
        return {
            "success": True,
            "message": f"入库成功: {product_name} {weight}克",
            "order_id": order.id,
            "order_no": order.order_no,
            "order": order_response,
            "detail": detail_response,
            "inventory": None
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
    status: Optional[str] = Query(None, description="状态筛选（draft/confirmed/cancelled）"),
    limit: int = Query(100, description="返回数量"),
    offset: int = Query(0, description="偏移量"),
    db: Session = Depends(get_db)
):
    """获取入库单列表"""
    try:
        query = db.query(InboundOrder).filter(
            InboundOrder.deleted_at.is_(None)
        ).order_by(InboundOrder.create_time.desc())
        
        if status:
            status_map = {
                'confirmed': ['confirmed', 'completed', '已入库'],
                'draft': ['draft', '未确认'],
                'cancelled': ['cancelled', '已取消'],
            }
            mapped = status_map.get(status, [status])
            query = query.filter(InboundOrder.status.in_(mapped))
        
        if start_date:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query = query.filter(InboundOrder.create_time >= start_dt)
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                query = query.filter(InboundOrder.create_time <= end_dt)
            except (ValueError, TypeError):
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
        
        # 预先计算所有入库单的已转移重量
        # 查询所有转移单及其明细，根据remark字段匹配入库单号
        order_nos = [order.order_no for order in orders]
        transferred_weight_map = {}
        
        if order_nos:
            # 查询remark中包含入库单号的转移单（状态为 pending_confirm, received, pending 都算已转移）
            transfer_orders = db.query(InventoryTransferOrder).filter(
                InventoryTransferOrder.status.in_(['pending', 'pending_confirm', 'received'])
            ).all()
            
            for transfer_order in transfer_orders:
                if not transfer_order.remark:
                    continue
                # 检查remark中是否包含任何入库单号
                for order_no in order_nos:
                    if order_no in transfer_order.remark:
                        # 计算该转移单的总重量
                        transfer_weight = sum(item.weight or 0 for item in transfer_order.items)
                        if order_no not in transferred_weight_map:
                            transferred_weight_map[order_no] = 0
                        transferred_weight_map[order_no] += transfer_weight
        
        result = []
        for order in orders:
            details = details_by_order.get(order.id, [])
            
            if has_detail_filters and len(details) == 0:
                continue
            
            item_count = len(details)
            total_weight = sum(d.weight or 0 for d in details)
            suppliers_list = list(set(d.supplier for d in details if d.supplier))
            transferred_weight = transferred_weight_map.get(order.order_no, 0)
            
            result.append({
                "id": order.id,
                "order_no": order.order_no,
                "create_time": order.create_time.isoformat() if order.create_time else None,
                "operator": order.operator,
                "status": order.status,
                "is_audited": bool(order.is_audited),
                "audited_by": order.audited_by,
                "audited_at": order.audited_at.isoformat() if order.audited_at else None,
                "item_count": item_count,
                "total_weight": round_weight(to_decimal(total_weight)),
                "transferred_weight": round_weight(to_decimal(transferred_weight)),
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
                    "style": d.style,
                    # 镶嵌入库相关字段
                    "main_stone_weight": d.main_stone_weight,
                    "main_stone_count": d.main_stone_count,
                    "main_stone_price": d.main_stone_price,
                    "main_stone_amount": d.main_stone_amount,
                    "sub_stone_weight": d.sub_stone_weight,
                    "sub_stone_count": d.sub_stone_count,
                    "sub_stone_price": d.sub_stone_price,
                    "sub_stone_amount": d.sub_stone_amount,
                    "stone_setting_fee": d.stone_setting_fee,
                    "total_amount": d.total_amount,
                    "main_stone_mark": d.main_stone_mark,
                    "sub_stone_mark": d.sub_stone_mark,
                    "pearl_weight": d.pearl_weight,
                    "bearing_weight": d.bearing_weight,
                    "sale_labor_cost": d.sale_labor_cost,
                    "sale_piece_labor_cost": d.sale_piece_labor_cost,
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


@router.post("/repair-payables")
async def repair_missing_account_payables(
    db: Session = Depends(get_db)
):
    """
    数据修复：为已确认的入库单补建缺失的 AccountPayable 记录。
    只处理 status='confirmed' 且没有关联 AccountPayable 的入库单。
    """
    from ..models.finance import AccountPayable

    confirmed_orders = db.query(InboundOrder).filter(
        InboundOrder.status == "confirmed"
    ).all()

    existing_order_ids = set(
        row[0] for row in db.query(AccountPayable.inbound_order_id).filter(
            AccountPayable.inbound_order_id.isnot(None),
            AccountPayable.status != "cancelled"
        ).all()
    )

    created_count = 0
    total_amount_created = 0.0
    errors = []

    for order in confirmed_orders:
        if order.id in existing_order_ids:
            continue

        details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
        if not details:
            continue

        supplier_cost_map: Dict[int, float] = {}
        for detail in details:
            sid = detail.supplier_id
            if not sid and detail.supplier:
                s = db.query(Supplier).filter(Supplier.name == detail.supplier, Supplier.status == "active").first()
                if s:
                    sid = s.id
            if not sid:
                continue

            cost = to_decimal(detail.weight) * to_decimal(detail.labor_cost)
            if detail.piece_count and detail.piece_labor_cost:
                cost += to_decimal(detail.piece_count) * to_decimal(detail.piece_labor_cost)
            supplier_cost_map[sid] = supplier_cost_map.get(sid, 0.0) + cost

        order_date = (order.create_time or china_now()).date() if hasattr(order.create_time, 'date') else date.today()

        for sid, cost in supplier_cost_map.items():
            if cost <= 0:
                continue
            try:
                date_str = order_date.strftime('%Y%m%d')
                seq = db.query(AccountPayable).filter(
                    AccountPayable.payable_no.like(f"CG{date_str}%")
                ).count()
                payable_no = f"CG{date_str}{seq + 1:03d}"

                ap = AccountPayable(
                    payable_no=payable_no,
                    supplier_id=sid,
                    inbound_order_id=order.id,
                    total_amount=round_money(cost),
                    paid_amount=0.0,
                    unpaid_amount=round_money(cost),
                    credit_days=30,
                    credit_start_date=order_date,
                    due_date=order_date + timedelta(days=30),
                    status="unpaid",
                    remark=f"数据修复：入库单 {order.order_no} 补建",
                    operator="系统修复"
                )
                db.add(ap)
                created_count += 1
                total_amount_created += round_money(cost)
            except Exception as e:
                errors.append(f"入库单 {order.order_no}, 供应商ID {sid}: {str(e)}")

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"数据修复提交失败: {e}", exc_info=True)
        return {"success": False, "message": f"提交失败: {str(e)}"}

    logger.info(f"数据修复完成: 补建 {created_count} 条应付账款, 总金额 ¥{total_amount_created:.2f}")
    return {
        "success": True,
        "message": f"修复完成：补建 {created_count} 条应付账款，总金额 ¥{total_amount_created:.2f}",
        "created_count": created_count,
        "total_amount": round_money(to_decimal(total_amount_created)),
        "skipped_existing": len(existing_order_ids),
        "errors": errors[:20] if errors else []
    }


@router.post("/repair-supplier-ids")
async def repair_supplier_ids(
    db: Session = Depends(get_db)
):
    """
    修复 InboundDetail 中 supplier_id 为 NULL 但 supplier（文本）有值的记录。
    通过 supplier 名称匹配 Supplier 表来填充 supplier_id。
    """
    try:
        orphan_details = db.query(InboundDetail).filter(
            InboundDetail.supplier_id.is_(None),
            InboundDetail.supplier.isnot(None),
            InboundDetail.supplier != ""
        ).all()

        if not orphan_details:
            return {"success": True, "message": "没有需要修复的记录", "fixed": 0}

        supplier_cache = {}
        for s in db.query(Supplier).all():
            supplier_cache[s.name] = s.id

        fixed = 0
        still_unmatched = set()
        for detail in orphan_details:
            name = detail.supplier.strip() if detail.supplier else ""
            sid = supplier_cache.get(name)
            if sid:
                detail.supplier_id = sid
                fixed += 1
            elif name:
                still_unmatched.add(name)

        db.commit()
        msg = f"修复完成: {fixed}/{len(orphan_details)} 条明细的 supplier_id 已填充"
        if still_unmatched:
            msg += f", {len(still_unmatched)} 个供应商名称未匹配"
        logger.info(msg)
        return {
            "success": True,
            "message": msg,
            "fixed": fixed,
            "total_orphan": len(orphan_details),
            "unmatched_names": list(still_unmatched)[:50]
        }
    except Exception as e:
        db.rollback()
        logger.error(f"修复 supplier_id 失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/rebuild-inventory")
async def rebuild_inventory_from_inbound(
    db: Session = Depends(get_db)
):
    """
    库存重建（幂等）：从入库单明细重新计算商品部仓库库存。
    保留展厅等非仓库位置的库存数据不受影响。
    同时扣除已确认的销售出库重量。
    """
    try:
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

        # 只清空商品部仓库的分仓库存，保留展厅等其他位置
        db.query(LocationInventory).filter(
            LocationInventory.location_id == default_location.id
        ).delete()
        db.query(Inventory).delete()
        db.flush()

        inbound_weight = db.query(
            InboundDetail.product_name,
            func.sum(InboundDetail.weight).label('total_weight')
        ).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundOrder.status.in_(["completed", "confirmed"]),
            InboundDetail.weight > 0
        ).group_by(InboundDetail.product_name).all()

        from ..models import SalesOrder, SalesDetail
        sold_weight = db.query(
            SalesDetail.product_name,
            func.sum(SalesDetail.weight).label('total_weight')
        ).join(
            SalesOrder, SalesDetail.order_id == SalesOrder.id
        ).filter(
            SalesOrder.status.in_(["confirmed", "completed", "settled"])
        ).group_by(SalesDetail.product_name).all()

        sold_map = {}
        for pname, tw in sold_weight:
            if pname and tw:
                sold_map[pname] = to_decimal(tw)

        # 收集展厅等非仓库位置的现有库存（rebuild 不影响这些）
        other_location_weight = {}
        other_inv = db.query(
            LocationInventory.product_name,
            func.sum(LocationInventory.weight).label('total_weight')
        ).filter(
            LocationInventory.location_id != default_location.id,
            LocationInventory.weight > 0
        ).group_by(LocationInventory.product_name).all()
        for pname, tw in other_inv:
            if pname and tw:
                other_location_weight[pname] = to_decimal(tw)

        total_inbound = 0.0
        total_sold = 0.0
        product_count = 0
        all_products = set()

        for product_name, total_w in inbound_weight:
            if not product_name or not total_w:
                continue
            w_in = round_weight(to_decimal(total_w))
            if w_in <= 0:
                continue

            w_out = sold_map.get(product_name, to_decimal(0))
            warehouse_weight = round_weight(w_in - w_out)
            if warehouse_weight < 0:
                warehouse_weight = to_decimal(0)

            other_w = other_location_weight.pop(product_name, to_decimal(0))
            total_weight = round_weight(warehouse_weight + other_w)

            db.add(Inventory(product_name=product_name, total_weight=total_weight))
            if warehouse_weight > 0:
                db.add(LocationInventory(
                    product_name=product_name,
                    location_id=default_location.id,
                    weight=warehouse_weight
                ))

            total_inbound += w_in
            total_sold += w_out
            product_count += 1
            all_products.add(product_name)

        # 展厅有库存但没有入库单记录的商品，也需要写入 inventory 总表
        for pname, other_w in other_location_weight.items():
            if pname not in all_products and other_w > 0:
                db.add(Inventory(product_name=pname, total_weight=round_weight(to_decimal(other_w))))
                product_count += 1

        db.commit()
        msg = (
            f"库存重建完成（幂等）：{product_count} 种商品，"
            f"入库总重 {total_inbound:.3f}g，销售出库 {total_sold:.3f}g，"
            f"净库存 {total_inbound - total_sold:.3f}g"
        )
        logger.info(msg)
        return {
            "success": True,
            "message": msg,
            "product_count": product_count,
            "total_inbound_weight": round_weight(to_decimal(total_inbound)),
            "total_sold_weight": round_weight(to_decimal(total_sold)),
            "net_inventory_weight": round_weight(to_decimal(total_inbound) - to_decimal(total_sold))
        }
    except Exception as e:
        db.rollback()
        logger.error(f"库存重建失败: {e}", exc_info=True)
        return {"success": False, "message": f"库存重建失败: {str(e)}"}


@router.put("/{order_id}")
async def update_inbound_order(
    order_id: int,
    updates: dict,
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """修改入库单"""
    try:
        order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
        if not order:
            return {"success": False, "error": "入库单不存在"}

        if order.is_audited:
            return {"success": False, "error": "该入库单已审核，无法编辑，请先反审"}

        if order.status != "draft":
            return {"success": False, "error": "只有未确认的入库单才能编辑，请先反确认"}

        if not has_permission(user_role, 'can_inbound'):
            raise HTTPException(status_code=403, detail="权限不足：无法编辑入库单")
        
        if "operator" in updates:
            order.operator = updates["operator"]
        if "status" in updates:
            order.status = updates["status"]
        
        changed_fields = []
        if "details" in updates and isinstance(updates["details"], list):
            for detail_update in updates["details"]:
                detail_id = detail_update.get("id")
                if detail_id:
                    detail = db.query(InboundDetail).filter(InboundDetail.id == detail_id).first()
                    if detail:
                        if "product_name" in detail_update:
                            if detail.product_name != detail_update["product_name"]:
                                changed_fields.append(f"商品名称: {detail.product_name} -> {detail_update['product_name']}")
                            detail.product_name = detail_update["product_name"]
                        if "weight" in detail_update:
                            new_weight = to_decimal(detail_update["weight"])
                            if detail.weight != new_weight:
                                changed_fields.append(f"克重: {detail.weight} -> {new_weight}")
                            detail.weight = new_weight
                        if "labor_cost" in detail_update:
                            new_labor = to_decimal(detail_update["labor_cost"])
                            if detail.labor_cost != new_labor:
                                changed_fields.append(f"克工费: {detail.labor_cost} -> {new_labor}")
                            detail.labor_cost = new_labor
                        if "supplier" in detail_update:
                            detail.supplier = detail_update["supplier"]
                        if "piece_count" in detail_update:
                            detail.piece_count = int(detail_update["piece_count"]) if detail_update["piece_count"] else None
                        if "piece_labor_cost" in detail_update:
                            detail.piece_labor_cost = to_decimal(detail_update["piece_labor_cost"]) if detail_update["piece_labor_cost"] else None
                        
                        for float_field in ['main_stone_weight', 'main_stone_price', 'main_stone_amount',
                                            'sub_stone_weight', 'sub_stone_price', 'sub_stone_amount',
                                            'stone_setting_fee', 'pearl_weight', 'bearing_weight',
                                            'sale_labor_cost', 'sale_piece_labor_cost']:
                            if float_field in detail_update:
                                val = to_decimal(detail_update[float_field]) if detail_update[float_field] else None
                                setattr(detail, float_field, val)

                        for int_field in ['main_stone_count', 'sub_stone_count']:
                            if int_field in detail_update:
                                val = int(detail_update[int_field]) if detail_update[int_field] else None
                                setattr(detail, int_field, val)

                        for str_field in ['main_stone_mark', 'sub_stone_mark']:
                            if str_field in detail_update:
                                setattr(detail, str_field, detail_update[str_field] or None)

                        # 重算总成本
                        gram_cost = to_decimal(detail.weight) * to_decimal(detail.labor_cost)
                        piece_cost = (detail.piece_count or 0) * (detail.piece_labor_cost or 0)
                        detail.total_cost = round_money(gram_cost + piece_cost)
        
        # 编辑留痕
        if changed_fields:
            from ..models import OrderStatusLog
            edit_log = OrderStatusLog(
                order_type="inbound",
                order_id=order_id,
                action="edit",
                old_status="draft",
                new_status="draft",
                operated_by=user_role,
                operated_at=china_now(),
                remark="；".join(changed_fields)
            )
            db.add(edit_log)
        
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


@router.post("/{order_id}/audit")
async def audit_inbound_order(
    order_id: int,
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """审核入库单（财务）"""
    if not has_permission(user_role, 'can_audit_inbound'):
        raise HTTPException(status_code=403, detail="权限不足：无法审核入库单")

    order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
    if not order:
        return {"success": False, "error": "入库单不存在"}

    if order.is_audited:
        return {"success": False, "error": "入库单已审核"}

    order.is_audited = True
    order.audited_by = user_role
    order.audited_at = china_now()
    db.commit()

    return {"success": True, "message": "审核成功", "order_id": order_id}


@router.post("/{order_id}/unaudit")
async def unaudit_inbound_order(
    order_id: int,
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """反审入库单（财务）"""
    if not has_permission(user_role, 'can_audit_inbound'):
        raise HTTPException(status_code=403, detail="权限不足：无法反审入库单")

    order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
    if not order:
        return {"success": False, "error": "入库单不存在"}

    if not order.is_audited:
        return {"success": False, "error": "入库单未审核"}

    order.is_audited = False
    order.audited_by = None
    order.audited_at = None
    db.commit()

    return {"success": True, "message": "反审成功", "order_id": order_id}


@router.post("/{order_id}/confirm")
async def confirm_inbound_order(
    order_id: int,
    confirmed_by: str = Query(default="系统管理员", description="确认人"),
    user_role: str = Query(default="sales", description="用户角色"),
    role: str = Depends(require_permission("can_inbound")),
    db: Session = Depends(get_db)
):
    """确认入库单（库存生效，行级锁防并发）"""
    if not has_permission(user_role, 'can_inbound'):
        raise HTTPException(status_code=403, detail="权限不足：无法确认入库单")
    
    # 行级锁：锁定入库单防止并发确认
    order = db.query(InboundOrder).filter(
        InboundOrder.id == order_id
    ).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="入库单不存在")
    if order.status != "draft":
        raise HTTPException(status_code=400, detail=f"入库单状态为 {order.status}，只有未确认的入库单才能确认")
    
    # 获取所有明细
    details = db.query(InboundDetail).filter(InboundDetail.order_id == order_id).all()
    if not details:
        raise HTTPException(status_code=400, detail="入库单没有商品明细，无法确认")
    
    # 获取默认入库位置
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
    
    # 先按 product_name 汇总重量，再一次性写入（避免同名商品产生重复行）
    product_weights: Dict[str, Any] = {}
    for detail in details:
        product_weights[detail.product_name] = to_decimal(product_weights.get(detail.product_name, 0)) + to_decimal(detail.weight)

    for product_name, total_weight in product_weights.items():
        # 合并重复的 inventory 行（历史数据可能存在重复）
        all_inv = db.query(Inventory).filter(
            Inventory.product_name == product_name
        ).with_for_update().all()
        if len(all_inv) > 1:
            keep = all_inv[0]
            for dup in all_inv[1:]:
                keep.total_weight = round_weight(to_decimal(keep.total_weight) + to_decimal(dup.total_weight))
                db.delete(dup)
            db.flush()
            inventory = keep
        elif all_inv:
            inventory = all_inv[0]
        else:
            inventory = None

        if inventory:
            inventory.total_weight = round_weight(to_decimal(inventory.total_weight) + to_decimal(total_weight))
        else:
            inventory = Inventory(product_name=product_name, total_weight=round_weight(to_decimal(total_weight)))
            db.add(inventory)

        # 合并重复的 location_inventory 行
        all_loc = db.query(LocationInventory).filter(
            LocationInventory.product_name == product_name,
            LocationInventory.location_id == default_location.id
        ).all()
        if len(all_loc) > 1:
            keep_loc = all_loc[0]
            for dup_loc in all_loc[1:]:
                keep_loc.weight = round_weight(to_decimal(keep_loc.weight) + to_decimal(dup_loc.weight), precision=4)
                db.delete(dup_loc)
            db.flush()
            location_inventory = keep_loc
        elif all_loc:
            location_inventory = all_loc[0]
        else:
            location_inventory = None

        if location_inventory:
            location_inventory.weight = round_weight(to_decimal(location_inventory.weight) + to_decimal(total_weight), precision=4)
        else:
            location_inventory = LocationInventory(
                product_name=product_name,
                location_id=default_location.id,
                weight=round_weight(to_decimal(total_weight), precision=4)
            )
            db.add(location_inventory)
    
    # 按 supplier_id 汇总后一次性更新（避免同名供应商导致 StaleDataError）
    from ..models import SupplierGoldAccount, SupplierGoldTransaction
    supplier_agg: Dict[int, Dict] = {}
    for detail in details:
        sid = detail.supplier_id
        if not sid:
            continue
        w = to_decimal(detail.weight)
        labor = to_decimal(detail.labor_cost)
        if sid not in supplier_agg:
            supplier_agg[sid] = {"total_weight": to_decimal(0), "total_amount": to_decimal(0), "count": 0}
        supplier_agg[sid]["total_weight"] += w
        supplier_agg[sid]["total_amount"] += w * labor
        supplier_agg[sid]["count"] += 1

    for sid, agg in supplier_agg.items():
        supplier_obj = db.query(Supplier).filter(Supplier.id == sid).first()
        if not supplier_obj:
            continue
        supplier_obj.total_supply_amount = round_money(to_decimal(supplier_obj.total_supply_amount) + to_decimal(agg["total_amount"]))
        supplier_obj.total_supply_weight = round_weight(to_decimal(supplier_obj.total_supply_weight) + to_decimal(agg["total_weight"]))
        supplier_obj.total_supply_count = (supplier_obj.total_supply_count or 0) + agg["count"]
        supplier_obj.last_supply_time = datetime.now()

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

        balance_before = to_decimal(supplier_gold_account.current_balance)
        supplier_gold_account.current_balance = round_weight(balance_before + to_decimal(agg["total_weight"]))
        supplier_gold_account.total_received = round_weight(to_decimal(supplier_gold_account.total_received) + to_decimal(agg["total_weight"]))
        supplier_gold_account.last_transaction_at = china_now()

        supplier_gold_tx = SupplierGoldTransaction(
            supplier_id=supplier_obj.id,
            supplier_name=supplier_obj.name,
            transaction_type='receive',
            inbound_order_id=order.id,
            gold_weight=agg["total_weight"],
            balance_before=balance_before,
            balance_after=supplier_gold_account.current_balance,
            created_by=confirmed_by,
            remark=f"入库单确认：{order.order_no}"
        )
        db.add(supplier_gold_tx)
    
    # 更新状态
    order.status = "confirmed"
    
    # ========== 自动生成应付账款（按供应商汇总工费） ==========
    from ..models.finance import AccountPayable
    supplier_cost_map: Dict[int, Any] = {}
    for detail in details:
        if detail.supplier_id:
            total_cost = to_decimal(detail.weight) * to_decimal(detail.labor_cost)
            if detail.piece_count and detail.piece_labor_cost:
                total_cost += to_decimal(detail.piece_count) * to_decimal(detail.piece_labor_cost)
            supplier_cost_map[detail.supplier_id] = to_decimal(supplier_cost_map.get(detail.supplier_id, 0)) + total_cost
        elif detail.supplier:
            s = db.query(Supplier).filter(Supplier.name == detail.supplier, Supplier.status == "active").first()
            if s:
                total_cost = to_decimal(detail.weight) * to_decimal(detail.labor_cost)
                if detail.piece_count and detail.piece_labor_cost:
                    total_cost += to_decimal(detail.piece_count) * to_decimal(detail.piece_labor_cost)
                supplier_cost_map[s.id] = to_decimal(supplier_cost_map.get(s.id, 0)) + total_cost

    today_str = china_now().strftime('%Y%m%d')
    for sid, cost in supplier_cost_map.items():
        if cost <= 0:
            continue
        existing = db.query(AccountPayable).filter(
            AccountPayable.inbound_order_id == order.id,
            AccountPayable.supplier_id == sid
        ).first()
        if existing:
            continue
        seq = db.query(AccountPayable).filter(
            AccountPayable.payable_no.like(f"CG{today_str}%")
        ).count()
        payable_no = f"CG{today_str}{seq + 1:03d}"
        credit_start = date.today()
        ap = AccountPayable(
            payable_no=payable_no,
            supplier_id=sid,
            inbound_order_id=order.id,
            total_amount=round_money(cost),
            paid_amount=0.0,
            unpaid_amount=round_money(cost),
            credit_days=30,
            credit_start_date=credit_start,
            due_date=credit_start + timedelta(days=30),
            status="unpaid",
            remark=f"入库单 {order.order_no} 确认自动生成",
            operator=confirmed_by
        )
        db.add(ap)
        db.flush()
        logger.info(f"自动生成应付账款: {payable_no}, 供应商ID: {sid}, 金额: {round_money(cost)}")
    # ========== 应付账款生成完成 ==========
    
    # 写操作日志
    from ..models import OrderStatusLog
    status_log = OrderStatusLog(
        order_type="inbound",
        order_id=order_id,
        action="confirm",
        old_status="draft",
        new_status="confirmed",
        operated_by=confirmed_by,
        operated_at=china_now()
    )
    db.add(status_log)
    
    db.commit()
    
    logger.info(f"入库单已确认: {order.order_no}, 确认人: {confirmed_by}")
    
    return {"success": True, "message": f"入库单 {order.order_no} 已确认，库存已更新"}


@router.post("/{order_id}/unconfirm")
async def unconfirm_inbound_order(
    order_id: int,
    operated_by: str = Query(default="系统管理员", description="操作人"),
    user_role: str = Query(default="sales", description="用户角色"),
    remark: str = Query(default="", description="反确认原因"),
    db: Session = Depends(get_db)
):
    """反确认入库单（回滚库存）"""
    if not has_permission(user_role, 'can_inbound'):
        raise HTTPException(status_code=403, detail="权限不足：无法反确认入库单")
    
    order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="入库单不存在")
    if order.status != "confirmed":
        raise HTTPException(status_code=400, detail=f"入库单状态为 {order.status}，只有已确认的入库单才能反确认")
    if order.is_audited:
        raise HTTPException(status_code=400, detail="入库单已审核，请先反审后再反确认")
    
    # 获取所有明细
    details = db.query(InboundDetail).filter(InboundDetail.order_id == order_id).all()
    
    # 获取默认入库位置
    default_location = db.query(Location).filter(Location.code == "warehouse").first()
    
    # 先按 product_name 汇总重量，再一次性回滚（避免重复行问题）
    product_weights: Dict[str, Any] = {}
    for detail in details:
        product_weights[detail.product_name] = to_decimal(product_weights.get(detail.product_name, 0)) + to_decimal(detail.weight)

    for product_name, total_weight in product_weights.items():
        # 合并重复的 inventory 行（历史数据可能存在重复）
        all_inv = db.query(Inventory).filter(Inventory.product_name == product_name).all()
        if len(all_inv) > 1:
            keep = all_inv[0]
            for dup in all_inv[1:]:
                keep.total_weight = round_weight(to_decimal(keep.total_weight) + to_decimal(dup.total_weight))
                db.delete(dup)
            db.flush()
            inventory = keep
        elif all_inv:
            inventory = all_inv[0]
        else:
            inventory = None
        if inventory:
            inventory.total_weight = round_weight(to_decimal(inventory.total_weight) - to_decimal(total_weight))

        # 合并重复的 location_inventory 行
        if default_location:
            all_loc = db.query(LocationInventory).filter(
                LocationInventory.product_name == product_name,
                LocationInventory.location_id == default_location.id
            ).all()
            if len(all_loc) > 1:
                keep_loc = all_loc[0]
                for dup_loc in all_loc[1:]:
                    keep_loc.weight = round_weight(to_decimal(keep_loc.weight) + to_decimal(dup_loc.weight), precision=4)
                    db.delete(dup_loc)
                db.flush()
                location_inventory = keep_loc
            elif all_loc:
                location_inventory = all_loc[0]
            else:
                location_inventory = None
            if location_inventory:
                location_inventory.weight = round_weight(to_decimal(location_inventory.weight) - to_decimal(total_weight), precision=4)
    
    # 按 supplier_id 汇总后一次性回滚（避免同名供应商导致 StaleDataError）
    from ..models import SupplierGoldAccount, SupplierGoldTransaction
    supplier_agg: Dict[int, Dict] = {}
    for detail in details:
        sid = detail.supplier_id
        if not sid:
            continue
        w = to_decimal(detail.weight)
        labor = to_decimal(detail.labor_cost)
        if sid not in supplier_agg:
            supplier_agg[sid] = {"total_weight": to_decimal(0), "total_amount": to_decimal(0), "count": 0}
        supplier_agg[sid]["total_weight"] += w
        supplier_agg[sid]["total_amount"] += w * labor
        supplier_agg[sid]["count"] += 1

    for sid, agg in supplier_agg.items():
        supplier_obj = db.query(Supplier).filter(Supplier.id == sid).first()
        if not supplier_obj:
            continue
        supplier_obj.total_supply_weight = round_weight(to_decimal(supplier_obj.total_supply_weight) - to_decimal(agg["total_weight"]))
        supplier_obj.total_supply_amount = round_money(max(to_decimal(0), to_decimal(supplier_obj.total_supply_amount) - to_decimal(agg["total_amount"])))
        supplier_obj.total_supply_count = max(0, (supplier_obj.total_supply_count or 0) - agg["count"])

        supplier_gold_account = db.query(SupplierGoldAccount).filter(
            SupplierGoldAccount.supplier_id == supplier_obj.id
        ).first()
        if supplier_gold_account:
            balance_before = to_decimal(supplier_gold_account.current_balance)
            supplier_gold_account.current_balance = round_weight(balance_before - to_decimal(agg["total_weight"]))
            supplier_gold_account.total_received = round_weight(to_decimal(supplier_gold_account.total_received) - to_decimal(agg["total_weight"]))
            supplier_gold_account.last_transaction_at = china_now()

            supplier_gold_tx = SupplierGoldTransaction(
                supplier_id=supplier_obj.id,
                supplier_name=supplier_obj.name,
                transaction_type='return',
                inbound_order_id=order.id,
                gold_weight=agg["total_weight"],
                balance_before=balance_before,
                balance_after=supplier_gold_account.current_balance,
                created_by=operated_by,
                remark=f"入库单反确认：{order.order_no}"
            )
            db.add(supplier_gold_tx)
    
    # 更新状态
    order.status = "draft"
    
    # ========== 取消关联的应付账款（使用 bulk UPDATE 避免重复行导致 StaleDataError） ==========
    from ..models.finance import AccountPayable
    from sqlalchemy import update as sa_update
    cancelled_count = db.execute(
        sa_update(AccountPayable)
        .where(AccountPayable.inbound_order_id == order_id)
        .where(AccountPayable.status.in_(["unpaid", "partial"]))
        .values(status="cancelled")
    ).rowcount
    if cancelled_count:
        logger.info(f"取消 {cancelled_count} 条应付账款, 原因: 入库单 {order.order_no} 反确认")
    # ========== 应付账款取消完成 ==========
    
    # 写操作日志
    from ..models import OrderStatusLog
    status_log = OrderStatusLog(
        order_type="inbound",
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
    
    logger.info(f"入库单已反确认: {order.order_no}, 操作人: {operated_by}, 原因: {remark}")
    
    return {"success": True, "message": f"入库单 {order.order_no} 已反确认，库存已回滚"}


@router.post("/{order_id}/cancel")
async def cancel_inbound_order(
    order_id: int,
    cancelled_by: str = Query(default="系统管理员", description="取消人"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """取消草稿入库单（仅 draft 状态可取消，不影响库存）"""
    order = db.query(InboundOrder).filter(
        InboundOrder.id == order_id
    ).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="入库单不存在")
    if order.status != "draft":
        raise HTTPException(status_code=400, detail=f"入库单状态为 {order.status}，只有未确认的入库单才能取消")
    
    order.status = "cancelled"
    
    from ..models import OrderStatusLog
    status_log = OrderStatusLog(
        order_type="inbound",
        order_id=order_id,
        action="cancel",
        old_status="draft",
        new_status="cancelled",
        operated_by=cancelled_by,
        operated_at=china_now()
    )
    db.add(status_log)
    
    db.commit()
    
    logger.info(f"入库单已取消: {order.order_no}, 取消人: {cancelled_by}")
    
    return {"success": True, "message": f"入库单 {order.order_no} 已取消"}


@router.delete("/{order_id}")
async def delete_inbound_order(
    order_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """软删除入库单（仅 draft 状态可删除，已确认需先反确认）"""
    order = db.query(InboundOrder).filter(
        InboundOrder.id == order_id
    ).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="入库单不存在")
    if order.deleted_at is not None:
        raise HTTPException(status_code=400, detail="该入库单已被删除")
    if order.status != "draft":
        raise HTTPException(
            status_code=400,
            detail="只有未确认的入库单才能删除，已确认的需要先反确认"
        )

    order.deleted_at = china_now()

    from ..models import OrderStatusLog
    status_log = OrderStatusLog(
        order_type="inbound",
        order_id=order_id,
        action="delete",
        old_status="draft",
        new_status="deleted",
        operated_by=user_role,
        operated_at=china_now()
    )
    db.add(status_log)

    db.commit()

    logger.info(f"入库单已软删除: {order.order_no}, 操作人角色: {user_role}")

    return {"success": True, "message": f"入库单 {order.order_no} 已删除"}


@router.post("")
async def create_inbound_order(
    card_data: InboundOrderCreate,
    role: str = Depends(require_permission("can_inbound")),
    db: Session = Depends(get_db)
):
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
async def create_batch_inbound_orders(
    batch_data: BatchInboundCreate,
    role: str = Depends(require_permission("can_inbound")),
    db: Session = Depends(get_db)
):
    """批量创建入库单"""
    try:
        if not batch_data.items:
            return {"success": False, "message": "没有商品数据"}
        
        from ..models import ProductCode as ProductCodeModel
        
        order_no = generate_inbound_order_no(db)
        order = InboundOrder(
            order_no=order_no,
            create_time=china_now(),
            operator=batch_data.operator or "系统",
            status="draft"
        )
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
        
        results = []
        total_weight = 0
        total_cost = 0
        success_count = 0
        error_count = 0
        
        for idx, item in enumerate(batch_data.items):
            try:
                product_name = item.product_name
                product_code = item.product_code
                weight = to_decimal(item.weight)
                labor_cost = to_decimal(item.labor_cost)
                piece_count = item.piece_count or 0
                piece_labor_cost = item.piece_labor_cost or 0.0
                barcode = item.barcode
                
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
                
                # 检查是否是镶嵌产品（有镶嵌相关字段）
                is_inlay_product = any([
                    getattr(item, 'main_stone_weight', None),
                    getattr(item, 'main_stone_amount', None),
                    getattr(item, 'sub_stone_amount', None),
                    getattr(item, 'stone_setting_fee', None),
                    getattr(item, 'total_amount', None),
                ])
                
                # 匹配预定义编码或自动生成F编码（镶嵌产品同样需要独立编码）
                if not product_code:
                    valid_product = db.query(ProductCodeModel).filter(
                        ProductCodeModel.name == product_name,
                        ProductCodeModel.code_type == 'predefined'
                    ).first()
                    if valid_product and not valid_product.code.startswith('F'):
                        product_code = valid_product.code
                    else:
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
                
                # 镶嵌产品优先使用 total_amount 作为总成本
                raw_total_amount = getattr(item, 'total_amount', None)
                if raw_total_amount and raw_total_amount > 0:
                    item_total_cost = raw_total_amount
                else:
                    gram_cost = labor_cost * weight
                    piece_cost = piece_count * piece_labor_cost
                    item_total_cost = gram_cost + piece_cost
                
                product_code, product_name, barcode = _normalize_inbound_code_fields(
                    db, product_name, product_code, barcode
                )

                detail = InboundDetail(
                    order_id=order.id,
                    product_code=product_code,
                    standard_code=product_code,
                    barcode=barcode,
                    product_name=product_name,
                    weight=weight,
                    labor_cost=labor_cost,
                    piece_count=piece_count if piece_count > 0 else None,
                    piece_labor_cost=piece_labor_cost if piece_labor_cost > 0 else None,
                    supplier=supplier_name,
                    supplier_id=supplier_id,
                    total_cost=item_total_cost,
                    # 镶嵌入库相关字段
                    main_stone_weight=getattr(item, 'main_stone_weight', None),
                    main_stone_count=getattr(item, 'main_stone_count', None),
                    main_stone_price=getattr(item, 'main_stone_price', None),
                    main_stone_amount=getattr(item, 'main_stone_amount', None),
                    sub_stone_weight=getattr(item, 'sub_stone_weight', None),
                    sub_stone_count=getattr(item, 'sub_stone_count', None),
                    sub_stone_price=getattr(item, 'sub_stone_price', None),
                    sub_stone_amount=getattr(item, 'sub_stone_amount', None),
                    stone_setting_fee=getattr(item, 'stone_setting_fee', None),
                    total_amount=getattr(item, 'total_amount', None),
                    main_stone_mark=getattr(item, 'main_stone_mark', None),
                    sub_stone_mark=getattr(item, 'sub_stone_mark', None),
                    pearl_weight=getattr(item, 'pearl_weight', None),
                    bearing_weight=getattr(item, 'bearing_weight', None),
                    sale_labor_cost=getattr(item, 'sale_labor_cost', None),
                    sale_piece_labor_cost=getattr(item, 'sale_piece_labor_cost', None),
                )
                db.add(detail)
                
                # 库存将在确认(confirm)时更新，创建时不影响库存
                
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
        
        # 供应商统计将在确认(confirm)时更新
        
        # ========== 自动生成采购单（应付账款） ==========
        if supplier_id and total_cost > 0:
            from ..models.finance import AccountPayable
            from datetime import date, timedelta
            
            # 生成采购单号：CG + 日期 + 序号
            today_str = china_now().strftime('%Y%m%d')
            existing_count = db.query(AccountPayable).filter(
                AccountPayable.payable_no.like(f"CG{today_str}%")
            ).count()
            payable_no = f"CG{today_str}{existing_count + 1:03d}"
            
            # 计算账期（默认30天）
            credit_start = date.today()
            due_date = credit_start + timedelta(days=30)
            
            # 创建应付账款记录
            account_payable = AccountPayable(
                payable_no=payable_no,
                supplier_id=supplier_id,
                inbound_order_id=order.id,
                total_amount=total_cost,
                paid_amount=0.0,
                unpaid_amount=total_cost,
                credit_days=30,
                credit_start_date=credit_start,
                due_date=due_date,
                status="unpaid",
                remark=f"入库单 {order.order_no} 自动生成",
                operator=batch_data.operator or "系统"
            )
            db.add(account_payable)
            logger.info(f"自动生成采购单: {payable_no}, 供应商: {supplier_name}, 金额: {total_cost}")
        # ========== 采购单生成完成 ==========
        
        db.commit()
        db.refresh(order)
        
        # 构建返回结果
        result = {
            "success": success_count > 0,
            "message": f"批量入库成功：{success_count} 个品类已入库" if error_count == 0 else f"批量入库完成：成功 {success_count} 件，失败 {error_count} 件",
            "order_id": order.id,
            "order_no": order.order_no,
            "success_count": success_count,
            "error_count": error_count,
            "total_weight": total_weight,
            "total_cost": total_cost,
            "results": results
        }
        
        # 如果生成了采购单，添加采购单号到返回值
        if supplier_id and total_cost > 0:
            result["purchase_order_no"] = payable_no
            result["message"] += f"，已生成采购单 {payable_no}"
        
        return result
    except Exception as e:
        db.rollback()
        logger.error(f"批量入库失败: {e}", exc_info=True)
        return {"success": False, "message": f"批量入库失败: {str(e)}", "error": str(e)}



@router.get("/{order_id}/download")
async def download_inbound_order(
    order_id: int, 
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    doc_type: str = Query("inbound", pattern="^(inbound|purchase)$", description="单据类型：inbound=入库单，purchase=采购单"),
    db: Session = Depends(get_db)
):
    """下载或打印入库单/采购单"""
    try:
        order = db.query(InboundOrder).filter(
            InboundOrder.id == order_id
        ).options(
            selectinload(InboundOrder.details)
        ).first()
        if not order:
            raise HTTPException(status_code=404, detail="入库单不存在")
        
        details = order.details
        if not details:
            raise HTTPException(status_code=404, detail="入库单明细不存在")
        
        # 根据doc_type设置标题和文件名前缀
        if doc_type == "purchase":
            doc_title = "采购单"
            file_prefix = "purchase_order"
        else:
            doc_title = "珠宝入库单"
            file_prefix = "inbound_order"
        
        if format == "pdf":
            from reportlab.pdfgen import canvas
            from reportlab.lib.units import mm
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            import io
            import math
            from ..timezone_utils import to_china_time, format_china_time
            
            PAGE_WIDTH = 241 * mm
            
            # ========== 动态高度计算 ==========
            # 基础高度（页头+页尾）+ 每行高度 * 行数
            base_height = 80 * mm   # 页头页尾固定部分
            row_height = 12 * mm    # 每行明细高度（包含行间距）
            content_height = base_height + (row_height * len(details))
            
            # 按140mm的倍数向上取整（最小140mm，适配针式打印机连续纸）
            min_unit = 140 * mm
            PAGE_HEIGHT = max(min_unit, math.ceil(content_height / min_unit) * min_unit)
            # ========== 动态高度计算完成 ==========
            
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
            p.drawCentredString(width / 2, top_margin, doc_title)
            
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
                
                # 镶嵌产品使用 total_amount，普通产品使用 total_cost
                item_cost = detail.total_amount if detail.total_amount is not None else detail.total_cost
                total_cost += item_cost
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
            
            filename = f"{file_prefix}_{order.order_no}.pdf"
            pdf_content = buffer.getvalue()
            
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename={filename}",
                    "Content-Type": "application/pdf",
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
    <div class="header"><h1>{doc_title}</h1></div>
    <p>单号：{order.order_no} | 时间：{create_time_str} | 操作员：{order.operator}</p>
    <table>
        <thead><tr><th>商品编码</th><th>商品名称</th><th>重量(克)</th><th>克工费</th><th>总成本</th><th>供应商</th></tr></thead>
        <tbody>
"""
            total_cost = 0
            total_weight = 0
            for detail in details:
                # 镶嵌产品使用 total_amount，普通产品使用 total_cost
                item_cost = detail.total_amount if detail.total_amount is not None else detail.total_cost
                html_content += f"""<tr><td>{detail.product_code or '-'}</td><td>{detail.product_name}</td><td>{detail.weight:.2f}</td><td>{detail.labor_cost:.2f}</td><td>{item_cost:.2f}</td><td>{detail.supplier or '-'}</td></tr>"""
                total_cost += item_cost
                total_weight += detail.weight
            
            html_content += f"""</tbody></table><p>合计：重量 {total_weight:.2f}克 | 总成本 ¥{total_cost:.2f}</p></body></html>"""
            
            return HTMLResponse(content=html_content)
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成入库单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成入库单失败: {str(e)}")
