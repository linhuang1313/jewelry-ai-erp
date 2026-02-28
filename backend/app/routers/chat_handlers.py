"""
Chat 业务处理函数模块
包含所有通过 AI 对话触发的业务操作处理函数（入库、创建客户、销售、退货、确认等）
"""
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from datetime import datetime
import logging
from typing import Dict, Any

from ..models import (
    InboundOrder, InboundDetail, Inventory, Customer, SalesOrder, SalesDetail,
    Supplier, Location, LocationInventory
)
from ..timezone_utils import china_now
from ..utils.product_utils import resolve_product_code

logger = logging.getLogger(__name__)

ROLE_DISPLAY_NAMES = {
    'finance': '财务',
    'settlement': '结算专员',
    'product': '商品部',
    'counter': '柜台',
    'material': '料部',
    'manager': '经理',
    'sales': '业务员',
}


# ========== 业务处理函数 ==========

async def handle_inbound(ai_response, db: Session) -> Dict[str, Any]:
    """处理入库操作"""
    from .inbound import handle_inbound as _handle_inbound
    return await _handle_inbound(ai_response, db)


async def handle_create_customer(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建客户"""
    try:
        customer_name = ai_response.customer_name
        if not customer_name:
            return {"success": False, "action": "创建客户", "message": "请提供客户名称"}
        
        existing = db.query(Customer).filter(Customer.name == customer_name).first()
        if existing:
            return {"success": False, "action": "创建客户", "message": f"客户【{customer_name}】已存在"}
        
        customer = Customer(
            name=customer_name,
            phone=getattr(ai_response, 'customer_phone', None),
            customer_type=getattr(ai_response, 'customer_type', '零售')
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        
        return {
            "success": True,
            "action": "创建客户",
            "message": f"客户【{customer_name}】创建成功",
            "customer_id": customer.id
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建客户失败: {e}", exc_info=True)
        return {"success": False, "action": "创建客户", "message": f"创建客户失败: {str(e)}"}


async def handle_create_supplier(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建供应商"""
    try:
        supplier_name = ai_response.supplier_name or ai_response.supplier
        if not supplier_name:
            return {"success": False, "action": "创建供应商", "message": "请提供供应商名称"}
        
        existing = db.query(Supplier).filter(Supplier.name == supplier_name).first()
        if existing:
            return {"success": False, "action": "创建供应商", "message": f"供应商【{supplier_name}】已存在"}
        
        supplier_no = f"GYS{china_now().strftime('%Y%m%d%H%M%S')}"
        supplier = Supplier(
            supplier_no=supplier_no,
            name=supplier_name,
            supplier_type="个人"
        )
        db.add(supplier)
        db.commit()
        db.refresh(supplier)
        
        return {
            "success": True,
            "action": "创建供应商",
            "message": f"供应商【{supplier_name}】创建成功",
            "supplier_id": supplier.id
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建供应商失败: {e}", exc_info=True)
        return {"success": False, "action": "创建供应商", "message": f"创建供应商失败: {str(e)}"}


from ..core.tenant_rules import apply_tenant_rules as _apply_tenant_rules


@_apply_tenant_rules(trigger_point="create_sales")
async def handle_create_sales_order(ai_response, db: Session) -> Dict[str, Any]:
    """通过对话创建销售单（draft状态）"""
    try:
        customer_name = getattr(ai_response, 'customer_name', None)
        items_data = getattr(ai_response, 'items', None)
        salesperson = getattr(ai_response, 'salesperson', None)
        
        if not customer_name:
            return {"success": False, "message": "未识别到客户名称，请提供客户名（如：卖给张三 足金手镯 10g 工费15）", "action": "创建销售单"}
        
        if not items_data or len(items_data) == 0:
            return {"success": False, "message": "未识别到商品信息，请提供商品名称、克重和工费（如：足金手镯 10g 工费15）", "action": "创建销售单"}
        
        if not salesperson or salesperson.strip() == '' or salesperson == '系统':
            return {"success": False, "message": "未识别到业务员姓名，请补充业务员（如：卖给张三 足金手镯 10g 工费15 业务员李四）", "action": "创建销售单"}
        
        # 客户匹配（复用模糊匹配逻辑）
        customer = db.query(Customer).filter(Customer.name == customer_name).first()
        if not customer:
            candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
            if len(candidates) == 1:
                customer = candidates[0]
            elif len(candidates) > 1:
                names = '、'.join([c.name for c in candidates])
                return {"success": False, "message": f"找到多个匹配客户：{names}，请输入完整姓名以确认", "action": "创建销售单"}
        
        if not customer:
            return {"success": False, "message": f"未找到客户「{customer_name}」，请先创建客户", "action": "创建销售单"}
        
        from ..models import OrderStatusLog
        
        # Generate order number
        now = china_now()
        order_no = f"XS{now.strftime('%Y%m%d%H%M%S')}"
        
        # Calculate totals
        total_weight = 0.0
        total_labor_cost = 0.0
        details_info = []
        
        for item in items_data:
            raw_name = item.get('product_name', '')
            resolved_name, code = resolve_product_code(raw_name, db)
            item['_resolved_name'] = resolved_name
            item['_code'] = code
            weight = float(item.get('weight', 0))
            labor_cost = float(item.get('labor_cost', 0))
            total_weight += weight
            total_labor_cost += weight * labor_cost
            if code and raw_name != resolved_name:
                details_info.append(f"{code}（{resolved_name}）{weight}g ¥{labor_cost}/g")
            else:
                details_info.append(f"{resolved_name} {weight}g ¥{labor_cost}/g")
        
        # Create sales order in draft status
        sales_order = SalesOrder(
            order_no=order_no,
            order_date=now,
            customer_id=customer.id,
            customer_name=customer.name,
            salesperson=salesperson,
            total_labor_cost=round(total_labor_cost, 2),
            total_weight=round(total_weight, 3),
            status="draft"
        )
        db.add(sales_order)
        db.flush()
        
        # Create details（使用已解析的商品名称）
        for item in items_data:
            resolved_name = item.get('_resolved_name', item.get('product_name', ''))
            code = item.get('_code')
            w = float(item.get('weight', 0))
            lc = float(item.get('labor_cost', 0))
            pc = int(item.get('piece_count', 0)) or None
            plc = float(item.get('piece_labor_cost', 0)) or None
            item_total = round(w * lc + (pc or 0) * (plc or 0), 2)
            detail = SalesDetail(
                order_id=sales_order.id,
                product_code=code,
                product_name=resolved_name,
                weight=w,
                labor_cost=lc,
                piece_count=pc,
                piece_labor_cost=plc,
                total_labor_cost=item_total
            )
            db.add(detail)
        
        # Update customer stats
        customer.total_purchase_amount = round((customer.total_purchase_amount or 0) + total_labor_cost, 2)
        customer.total_purchase_weight = round((customer.total_purchase_weight or 0) + total_weight, 3)
        customer.total_purchase_count = (customer.total_purchase_count or 0) + 1
        customer.last_purchase_time = now
        
        db.commit()
        
        items_text = '\n'.join([f"  - {info}" for info in details_info])
        message = f"""✅ **销售单已创建（未确认）**

📋 单号：{order_no}
👤 客户：{customer.name}
📦 商品明细：
{items_text}
💰 总工费：¥{total_labor_cost:.2f}
⚖️ 总克重：{total_weight:.2f}g

⚠️ 销售单为**未确认**状态，库存尚未扣减。
请在销售单列表中点击"确认"使库存生效，或输入"确认销售单 {order_no}"。

<!-- SALES_ORDER:{sales_order.id}:{order_no} -->"""
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="create_sales_order",
            user_role="counter",
            customer_id=customer.id,
            customer_name=customer.name,
            operation_details={
                "order_no": order_no,
                "total_weight": total_weight,
                "total_labor_cost": total_labor_cost,
                "item_count": len(items_data),
                "salesperson": salesperson,
                "items": [{"name": i.get("_resolved_name", i.get("product_name")), "weight": float(i.get("weight", 0)), "labor_cost": float(i.get("labor_cost", 0))} for i in items_data]
            }
        )
        
        return {
            "success": True,
            "action": "创建销售单",
            "message": message,
            "data": {
                "sales_order_id": sales_order.id,
                "order_no": order_no,
                "customer_name": customer.name,
                "total_labor_cost": total_labor_cost,
                "total_weight": total_weight
            }
        }
    except Exception as e:
        db.rollback()
        logger.error(f"对话创建销售单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建销售单失败: {str(e)}", "action": "创建销售单"}


async def handle_create_transfer(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建转移单"""
    return {"success": False, "action": "创建转移单", "message": "请使用仓库模块创建转移单"}


async def handle_return(ai_response, db: Session, user_role: str = "manager") -> Dict[str, Any]:
    """通过对话创建退货单（draft状态）"""
    try:
        from ..models import ReturnOrder, ReturnOrderDetail, OrderStatusLog
        
        raw_product_name = getattr(ai_response, 'return_product_name', None) or getattr(ai_response, 'product_name', None)
        weight = getattr(ai_response, 'return_weight', None) or getattr(ai_response, 'weight', None)
        labor_cost = getattr(ai_response, 'return_labor_cost', None) or getattr(ai_response, 'labor_cost', None) or 0
        return_type = getattr(ai_response, 'return_type', None) or 'to_supplier'
        supplier_name = getattr(ai_response, 'return_supplier_name', None) or getattr(ai_response, 'supplier', None)
        reason = getattr(ai_response, 'return_reason', None) or '质量问题'
        
        if not raw_product_name:
            return {"success": False, "message": "未识别到退货商品名称，请提供商品名（如：退货 足金手镯 10g 退给XX珠宝）", "action": "退货"}
        
        # 解析商品编码
        product_name, _code = resolve_product_code(raw_product_name, db)
        
        if weight is None:
            return {"success": False, "message": "未识别到退货克重，请提供克重（如：退货 足金手镯 10g）", "action": "退货"}
        
        weight = float(weight)
        labor_cost = float(labor_cost)
        
        # Find supplier if to_supplier
        supplier_id = None
        supplier_obj = None
        if return_type == 'to_supplier':
            if not supplier_name:
                return {"success": False, "message": "退给供应商需要指定供应商名称（如：退货 足金手镯 10g 退给XX珠宝）", "action": "退货"}
            
            supplier_obj = db.query(Supplier).filter(Supplier.name == supplier_name).first()
            if not supplier_obj:
                candidates = db.query(Supplier).filter(Supplier.name.contains(supplier_name)).all()
                if len(candidates) == 1:
                    supplier_obj = candidates[0]
                elif len(candidates) > 1:
                    names = '、'.join([s.name for s in candidates])
                    return {"success": False, "message": f"找到多个匹配供应商：{names}，请输入完整名称以确认", "action": "退货"}
            
            if not supplier_obj:
                return {"success": False, "message": f"未找到供应商「{supplier_name}」", "action": "退货"}
            supplier_id = supplier_obj.id
        
        # Find default from_location
        from_location_id = None
        if return_type == 'to_supplier':
            location = db.query(Location).filter(Location.code == "warehouse", Location.is_active == 1).first()
            if location:
                from_location_id = location.id
        else:
            location = db.query(Location).filter(Location.location_type == "showroom", Location.is_active == 1).first()
            if location:
                from_location_id = location.id
        
        # Generate return order number
        now = china_now()
        count = db.query(ReturnOrder).filter(
            ReturnOrder.return_no.like(f"TH{now.strftime('%Y%m%d')}%")
        ).count()
        return_no = f"TH{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # Calculate labor cost
        gram_cost = weight * labor_cost
        
        # Create return order in draft status
        return_order = ReturnOrder(
            return_no=return_no,
            return_type=return_type,
            product_name=product_name,
            return_weight=weight,
            total_weight=weight,
            item_count=1,
            total_labor_cost=gram_cost,
            from_location_id=from_location_id,
            supplier_id=supplier_id,
            return_reason=reason,
            status="draft",
            created_by=user_role,
            created_at=now
        )
        db.add(return_order)
        db.flush()
        
        # Create detail
        detail = ReturnOrderDetail(
            order_id=return_order.id,
            product_name=product_name,
            return_weight=weight,
            labor_cost=labor_cost,
            total_labor_cost=gram_cost
        )
        db.add(detail)
        
        db.commit()
        
        type_text = "退给供应商" if return_type == "to_supplier" else "退给商品部"
        supplier_text = f"\n🏭 供应商：{supplier_obj.name}" if supplier_obj else ""
        
        message = f"""✅ **退货单已创建（未确认）**

📋 单号：{return_no}
📦 类型：{type_text}{supplier_text}
📦 商品：{product_name} {weight}g
💰 工费：¥{gram_cost:.2f}
📝 原因：{reason}

⚠️ 退货单为**未确认**状态，库存尚未变动。
请在退货单列表中点击"确认"使库存生效，或输入"确认退货单 {return_no}"。

<!-- RETURN_ORDER:{return_order.id}:{return_no} -->"""
        
        return {
            "success": True,
            "action": "退货",
            "message": message,
            "data": {
                "return_id": return_order.id,
                "return_no": return_no,
                "product_name": product_name,
                "weight": weight
            }
        }
    except Exception as e:
        db.rollback()
        logger.error(f"对话创建退货单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建退货单失败: {str(e)}", "action": "退货"}


async def handle_sales_return(ai_response, db: Session, user_role: str = "manager") -> Dict[str, Any]:
    """通过对话创建销退单（客户退货给我们）"""
    try:
        from ..timezone_utils import china_now
        from ..models import SalesReturnOrder, SalesReturnDetail
        
        customer_name = getattr(ai_response, 'sales_return_customer_name', None) or getattr(ai_response, 'customer_name', None)
        raw_product_name = getattr(ai_response, 'sales_return_product_name', None) or getattr(ai_response, 'product_name', None)
        weight = getattr(ai_response, 'sales_return_weight', None) or getattr(ai_response, 'weight', None)
        reason = getattr(ai_response, 'sales_return_reason', None) or '客户退货'
        
        if not customer_name:
            return {"success": False, "message": "未识别到客户名称，请提供客户名（如：张三要退货 足金手镯 10g）", "action": "销退"}
        
        if not raw_product_name:
            return {"success": False, "message": "未识别到退货商品名称，请提供商品名（如：销退 足金手镯 10g 客户张三）", "action": "销退"}
        
        # 解析商品编码
        product_name, _code = resolve_product_code(raw_product_name, db)
        
        if weight is None:
            return {"success": False, "message": "未识别到退货克重，请提供克重（如：销退 足金手镯 10g）", "action": "销退"}
        
        weight = float(weight)
        
        # Customer matching (fuzzy with confirmation)
        customer = db.query(Customer).filter(Customer.name == customer_name).first()
        if not customer:
            candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
            if len(candidates) == 1:
                customer = candidates[0]
            elif len(candidates) > 1:
                names = '、'.join([c.name for c in candidates])
                return {"success": False, "message": f"找到多个匹配客户：{names}，请输入完整姓名以确认", "action": "销退"}
        
        if not customer:
            return {"success": False, "message": f"未找到客户「{customer_name}」", "action": "销退"}
        
        # Create sales return order in draft status
        now = china_now()
        return_no = f"XT{now.strftime('%Y%m%d%H%M%S')}"
        
        # labor_cost defaults to 0 when not provided via chat
        labor_cost = float(getattr(ai_response, 'sales_return_labor_cost', None) or getattr(ai_response, 'labor_cost', None) or 0)
        total_labor_cost = weight * labor_cost
        
        sales_return = SalesReturnOrder(
            return_no=return_no,
            order_date=now,
            customer_id=customer.id,
            customer_name=customer.name,
            return_to="showroom",
            return_reason=reason,
            total_weight=weight,
            total_labor_cost=round(total_labor_cost, 2),
            status="draft",
            created_by=user_role
        )
        db.add(sales_return)
        db.flush()
        
        # Create detail record
        detail = SalesReturnDetail(
            order_id=sales_return.id,
            product_name=product_name,
            weight=weight,
            labor_cost=labor_cost,
            total_labor_cost=round(total_labor_cost, 2)
        )
        db.add(detail)
        
        db.commit()
        db.refresh(sales_return)
        
        message = f"""✅ **销退单已创建（未确认）**

📋 单号：{return_no}
👤 客户：{customer.name}
📦 商品：{product_name} {weight}g
📝 原因：{reason}

⚠️ 销退单为**未确认**状态，库存尚未变动。
请在销退管理中确认后生效。

<!-- SALES_RETURN:{sales_return.id}:{return_no} -->"""
        
        return {
            "success": True,
            "action": "销退",
            "message": message,
            "data": {
                "sales_return_id": sales_return.id,
                "return_no": return_no,
                "customer_name": customer.name,
                "product_name": product_name,
                "weight": weight
            }
        }
    except Exception as e:
        db.rollback()
        logger.error(f"对话创建销退单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建销退单失败: {str(e)}", "action": "销退"}


async def handle_confirm_order(ai_response, db: Session, user_role: str = "manager") -> Dict[str, Any]:
    """通过对话确认单据"""
    try:
        from ..timezone_utils import china_now
        from ..models import InboundOrder, SalesOrder, ReturnOrder, OrderStatusLog
        from ..models import InboundDetail, Inventory, LocationInventory, Location, Supplier
        from ..models import SupplierGoldAccount, SupplierGoldTransaction, SalesDetail
        from ..models import ReturnOrderDetail
        
        order_no = getattr(ai_response, 'confirm_order_no', None)
        if not order_no:
            return {"success": False, "message": "请提供要确认的单据编号（如：确认入库单 RK20260206069900）", "action": "确认单据"}
        
        order_no = order_no.strip().upper()
        
        # Determine order type by prefix
        if order_no.startswith("RK"):
            # Confirm inbound order
            order = db.query(InboundOrder).filter(InboundOrder.order_no == order_no).first()
            if not order:
                return {"success": False, "message": f"未找到入库单 {order_no}", "action": "确认单据"}
            if order.status != "draft":
                return {"success": False, "message": f"入库单 {order_no} 状态为「{order.status}」，只有未确认的单据才能确认", "action": "确认单据"}
            
            # Get details and update inventory
            details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
            if not details:
                return {"success": False, "message": f"入库单 {order_no} 没有商品明细", "action": "确认单据"}
            
            default_location = db.query(Location).filter(Location.code == "warehouse").first()
            if not default_location:
                default_location = Location(code="warehouse", name="商品部仓库", location_type="warehouse", description="默认入库位置")
                db.add(default_location)
                db.flush()
            
            product_names = [d.product_name for d in details]
            inv_map = {i.product_name: i for i in db.query(Inventory).filter(Inventory.product_name.in_(product_names)).all()}
            loc_inv_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                LocationInventory.product_name.in_(product_names), LocationInventory.location_id == default_location.id
            ).all()}
            
            for detail in details:
                inv = inv_map.get(detail.product_name)
                if inv:
                    inv.total_weight = round(float(inv.total_weight or 0) + float(detail.weight or 0), 3)
                else:
                    inv = Inventory(product_name=detail.product_name, total_weight=detail.weight)
                    db.add(inv)
                    inv_map[detail.product_name] = inv
                
                loc_inv = loc_inv_map.get(detail.product_name)
                if loc_inv:
                    loc_inv.weight = float(loc_inv.weight or 0) + float(detail.weight or 0)
                else:
                    loc_inv = LocationInventory(product_name=detail.product_name, location_id=default_location.id, weight=detail.weight)
                    db.add(loc_inv)
                    loc_inv_map[detail.product_name] = loc_inv
            
            order.status = "confirmed"
            status_log = OrderStatusLog(order_type="inbound", order_id=order.id, action="confirm", old_status="draft", new_status="confirmed", operated_by=user_role, operated_at=china_now())
            db.add(status_log)
            db.commit()
            
            return {"success": True, "action": "确认单据", "message": f"✅ 入库单 **{order_no}** 已确认，库存已更新。共 {len(details)} 个品类入库。"}
        
        elif order_no.startswith("XS"):
            # Confirm sales order
            order = db.query(SalesOrder).filter(SalesOrder.order_no == order_no).first()
            if not order:
                return {"success": False, "message": f"未找到销售单 {order_no}", "action": "确认单据"}
            if order.status != "draft":
                return {"success": False, "message": f"销售单 {order_no} 状态为「{order.status}」，只有未确认的单据才能确认", "action": "确认单据"}
            
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            product_names = [d.product_name for d in details]
            inv_map = {i.product_name: i for i in db.query(Inventory).filter(Inventory.product_name.in_(product_names)).all()}
            
            for detail in details:
                inv = inv_map.get(detail.product_name)
                if not inv or inv.total_weight < detail.weight:
                    available = inv.total_weight if inv else 0
                    return {"success": False, "message": f"库存不足：{detail.product_name} 仅有 {available:.2f}g，需要 {detail.weight}g", "action": "确认单据"}
            
            showroom = db.query(Location).filter(Location.location_type == "showroom", Location.is_active == 1).first()
            loc_inv_map = {}
            if showroom:
                loc_inv_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                    LocationInventory.product_name.in_(product_names), LocationInventory.location_id == showroom.id
                ).all()}
            
            for detail in details:
                inv = inv_map.get(detail.product_name)
                if inv:
                    inv.total_weight = round(float(inv.total_weight or 0) - float(detail.weight or 0), 3)
                loc_inv = loc_inv_map.get(detail.product_name)
                if loc_inv:
                    loc_inv.weight = float(loc_inv.weight or 0) - float(detail.weight or 0)
            
            order.status = "confirmed"
            status_log = OrderStatusLog(order_type="sales", order_id=order.id, action="confirm", old_status="draft", new_status="confirmed", operated_by=user_role, operated_at=china_now())
            db.add(status_log)
            db.commit()
            
            return {"success": True, "action": "确认单据", "message": f"✅ 销售单 **{order_no}** 已确认，库存已扣减。客户：{order.customer_name}，总克重：{order.total_weight}g"}
        
        elif order_no.startswith("TH"):
            # Confirm return order
            from ..models import ReturnOrder, ReturnOrderDetail
            order = db.query(ReturnOrder).filter(ReturnOrder.return_no == order_no).first()
            if not order:
                return {"success": False, "message": f"未找到退货单 {order_no}", "action": "确认单据"}
            if order.status != "draft":
                return {"success": False, "message": f"退货单 {order_no} 状态为「{order.status}」，只有未确认的单据才能确认", "action": "确认单据"}
            
            details = db.query(ReturnOrderDetail).filter(ReturnOrderDetail.order_id == order.id).all()
            product_names = [d.product_name for d in details]
            
            if order.from_location_id:
                from_loc_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                    LocationInventory.location_id == order.from_location_id, LocationInventory.product_name.in_(product_names)
                ).all()}
                for detail in details:
                    inv = from_loc_map.get(detail.product_name)
                    if inv:
                        inv.weight = float(inv.weight or 0) - float(detail.return_weight or 0)
            
            if order.return_type == "to_warehouse":
                wh = db.query(Location).filter(Location.code == "warehouse", Location.is_active == 1).first()
                if wh:
                    wh_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                        LocationInventory.location_id == wh.id, LocationInventory.product_name.in_(product_names)
                    ).all()}
                    for detail in details:
                        target = wh_map.get(detail.product_name)
                        if target:
                            target.weight = float(target.weight or 0) + float(detail.return_weight or 0)
                        else:
                            target = LocationInventory(product_name=detail.product_name, location_id=wh.id, weight=detail.return_weight)
                            db.add(target)
                            wh_map[detail.product_name] = target
            
            order.status = "confirmed"
            order.completed_by = user_role
            order.completed_at = china_now()
            status_log = OrderStatusLog(order_type="return", order_id=order.id, action="confirm", old_status="draft", new_status="confirmed", operated_by=user_role, operated_at=china_now())
            db.add(status_log)
            db.commit()
            
            type_text = "退给供应商" if order.return_type == "to_supplier" else "退给商品部"
            return {"success": True, "action": "确认单据", "message": f"✅ 退货单 **{order_no}** 已确认（{type_text}），库存已更新。"}
        
        else:
            return {"success": False, "message": f"无法识别单据类型：{order_no}。支持的前缀：RK(入库)、XS(销售)、TH(退货)", "action": "确认单据"}
    
    except Exception as e:
        db.rollback()
        logger.error(f"对话确认单据失败: {e}", exc_info=True)
        return {"success": False, "message": f"确认单据失败: {str(e)}", "action": "确认单据"}


async def handle_unconfirm_order(ai_response, db: Session, user_role: str = "manager") -> Dict[str, Any]:
    """通过对话反确认单据"""
    try:
        from ..timezone_utils import china_now
        from ..models import InboundOrder, SalesOrder, ReturnOrder, OrderStatusLog
        from ..models import InboundDetail, Inventory, LocationInventory, Location
        from ..models import SalesDetail, ReturnOrderDetail
        
        order_no = getattr(ai_response, 'confirm_order_no', None)
        if not order_no:
            return {"success": False, "message": "请提供要反确认的单据编号（如：反确认入库单 RK20260206069900）", "action": "反确认单据"}
        
        order_no = order_no.strip().upper()
        
        if order_no.startswith("RK"):
            order = db.query(InboundOrder).filter(InboundOrder.order_no == order_no).first()
            if not order:
                return {"success": False, "message": f"未找到入库单 {order_no}", "action": "反确认单据"}
            if order.status != "confirmed":
                return {"success": False, "message": f"入库单 {order_no} 状态为「{order.status}」，只有已确认的单据才能反确认", "action": "反确认单据"}
            if order.is_audited:
                return {"success": False, "message": f"入库单 {order_no} 已审核，请先反审后再反确认", "action": "反确认单据"}
            
            details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
            default_location = db.query(Location).filter(Location.code == "warehouse").first()
            
            product_names = [d.product_name for d in details]
            inv_map = {i.product_name: i for i in db.query(Inventory).filter(Inventory.product_name.in_(product_names)).all()}
            loc_inv_map = {}
            if default_location:
                loc_inv_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                    LocationInventory.product_name.in_(product_names), LocationInventory.location_id == default_location.id
                ).all()}
            
            for detail in details:
                inv = inv_map.get(detail.product_name)
                if inv:
                    inv.total_weight = round(float(inv.total_weight or 0) - float(detail.weight or 0), 3)
                loc_inv = loc_inv_map.get(detail.product_name)
                if loc_inv:
                    loc_inv.weight = float(loc_inv.weight or 0) - float(detail.weight or 0)
            
            order.status = "draft"
            status_log = OrderStatusLog(order_type="inbound", order_id=order.id, action="unconfirm", old_status="confirmed", new_status="draft", operated_by=user_role, operated_at=china_now())
            db.add(status_log)
            db.commit()
            
            return {"success": True, "action": "反确认单据", "message": f"✅ 入库单 **{order_no}** 已反确认，库存已回滚。"}
        
        elif order_no.startswith("XS"):
            order = db.query(SalesOrder).filter(SalesOrder.order_no == order_no).first()
            if not order:
                return {"success": False, "message": f"未找到销售单 {order_no}", "action": "反确认单据"}
            if order.status != "confirmed":
                return {"success": False, "message": f"销售单 {order_no} 状态为「{order.status}」，只有已确认的单据才能反确认", "action": "反确认单据"}
            
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            showroom = db.query(Location).filter(Location.location_type == "showroom", Location.is_active == 1).first()
            
            product_names = [d.product_name for d in details]
            inv_map = {i.product_name: i for i in db.query(Inventory).filter(Inventory.product_name.in_(product_names)).all()}
            loc_inv_map = {}
            if showroom:
                loc_inv_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                    LocationInventory.product_name.in_(product_names), LocationInventory.location_id == showroom.id
                ).all()}
            
            for detail in details:
                inv = inv_map.get(detail.product_name)
                if inv:
                    inv.total_weight = round(float(inv.total_weight or 0) + float(detail.weight or 0), 3)
                loc_inv = loc_inv_map.get(detail.product_name)
                if loc_inv:
                    loc_inv.weight = float(loc_inv.weight or 0) + float(detail.weight or 0)
            
            order.status = "draft"
            status_log = OrderStatusLog(order_type="sales", order_id=order.id, action="unconfirm", old_status="confirmed", new_status="draft", operated_by=user_role, operated_at=china_now())
            db.add(status_log)
            db.commit()
            
            return {"success": True, "action": "反确认单据", "message": f"✅ 销售单 **{order_no}** 已反确认，库存已回滚。"}
        
        elif order_no.startswith("TH"):
            order = db.query(ReturnOrder).filter(ReturnOrder.return_no == order_no).first()
            if not order:
                return {"success": False, "message": f"未找到退货单 {order_no}", "action": "反确认单据"}
            if order.status != "confirmed":
                return {"success": False, "message": f"退货单 {order_no} 状态为「{order.status}」，只有已确认的单据才能反确认", "action": "反确认单据"}
            if order.is_audited:
                return {"success": False, "message": f"退货单 {order_no} 已审核，请先反审后再反确认", "action": "反确认单据"}
            
            details = db.query(ReturnOrderDetail).filter(ReturnOrderDetail.order_id == order.id).all()
            product_names = [d.product_name for d in details]
            
            if order.from_location_id:
                from_loc_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                    LocationInventory.location_id == order.from_location_id, LocationInventory.product_name.in_(product_names)
                ).all()}
                for detail in details:
                    inv = from_loc_map.get(detail.product_name)
                    if inv:
                        inv.weight = float(inv.weight or 0) + float(detail.return_weight or 0)
            
            if order.return_type == "to_warehouse":
                wh = db.query(Location).filter(Location.code == "warehouse", Location.is_active == 1).first()
                if wh:
                    wh_map = {li.product_name: li for li in db.query(LocationInventory).filter(
                        LocationInventory.location_id == wh.id, LocationInventory.product_name.in_(product_names)
                    ).all()}
                    for detail in details:
                        target = wh_map.get(detail.product_name)
                        if target:
                            target.weight = float(target.weight or 0) - float(detail.return_weight or 0)
            
            order.status = "draft"
            order.completed_by = None
            order.completed_at = None
            status_log = OrderStatusLog(order_type="return", order_id=order.id, action="unconfirm", old_status="confirmed", new_status="draft", operated_by=user_role, operated_at=china_now())
            db.add(status_log)
            db.commit()
            
            return {"success": True, "action": "反确认单据", "message": f"✅ 退货单 **{order_no}** 已反确认，库存已回滚。"}
        
        else:
            return {"success": False, "message": f"无法识别单据类型：{order_no}。支持的前缀：RK(入库)、XS(销售)、TH(退货)", "action": "反确认单据"}
    
    except Exception as e:
        db.rollback()
        logger.error(f"对话反确认单据失败: {e}", exc_info=True)
        return {"success": False, "message": f"反确认单据失败: {str(e)}", "action": "反确认单据"}


async def handle_payment_registration(ai_response, db: Session, user_role: str = "finance") -> Dict[str, Any]:
    """处理登记收款 - 必须附带付款截图才能登记"""
    from ..models import Customer
    from ..models.finance import PaymentRecord, AccountReceivable
    from datetime import date
    
    # 提取参数
    customer_name = getattr(ai_response, 'payment_customer_name', None)
    amount = getattr(ai_response, 'payment_amount', None)
    payment_method = getattr(ai_response, 'payment_method', '转账') or '转账'
    remark = getattr(ai_response, 'payment_remark', '') or ''
    
    # 强制要求付款截图凭证
    voucher_images = getattr(ai_response, 'voucher_images', None) or None
    if not voucher_images:
        return {
            "success": False,
            "action": "登记收款",
            "message": (
                "⚠️ **登记收款需要附带付款截图**\n\n"
                "请按以下步骤操作：\n"
                "1. 点击输入框旁的「💳 收款凭证」按钮上传转账截图\n"
                "2. 系统会自动 OCR 识别金额\n"
                "3. 确认信息后完成收款登记\n\n"
                "或使用 `@财务 @结算` 发起跨角色协同收款确认。"
            )
        }
    
    if not customer_name:
        return {"success": False, "message": "未识别到客户名称，请提供客户名", "action": "登记收款"}
    
    if not amount or float(amount) <= 0:
        return {"success": False, "message": "未识别到有效的金额，请提供收款金额", "action": "登记收款"}
    
    amount = float(amount)
    
    # 通过客户名查找客户
    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        # 尝试模糊匹配
        candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
        if len(candidates) == 1:
            customer = candidates[0]
        elif len(candidates) > 1:
            names = '、'.join([c.name for c in candidates])
            return {"success": False, "message": f"找到多个匹配客户：{names}，请输入完整姓名以确认", "action": "登记收款"}
    
    if not customer:
        return {"success": False, "message": f"未找到客户「{customer_name}」，请先在客户管理中创建该客户", "action": "登记收款"}
    
    # 转换付款方式为英文
    method_map = {
        '转账': 'bank_transfer',
        '现金': 'cash',
        '微信': 'wechat',
        '支付宝': 'alipay',
        '刷卡': 'card'
    }
    payment_method_en = method_map.get(payment_method, 'bank_transfer')
    
    try:
        now = china_now()
        payment_no = f"SK{now.strftime('%Y%m%d%H%M%S')}"
        
        bank_name = getattr(ai_response, 'bank_name', None) or None
        transfer_no = getattr(ai_response, 'transfer_no', None) or None
        
        # 创建收款记录
        payment = PaymentRecord(
            payment_no=payment_no,
            account_receivable_id=None,
            customer_id=customer.id,
            payment_date=date.today(),
            amount=amount,
            payment_method=payment_method_en,
            remark=remark or "AI对话收款",
            operator=ROLE_DISPLAY_NAMES.get(user_role, user_role),
            voucher_images=voucher_images,
            bank_name=bank_name,
            transfer_no=transfer_no
        )
        db.add(payment)
        db.flush()
        
        # FIFO方式冲抵应收账款
        unpaid_receivables = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer.id,
            AccountReceivable.status.in_(["unpaid", "overdue"]),
            AccountReceivable.unpaid_amount > 0
        ).order_by(AccountReceivable.credit_start_date.asc()).all()
        
        remaining_amount = amount
        offset_details = []
        
        for receivable in unpaid_receivables:
            if remaining_amount <= 0:
                break
            
            offset_amount = min(remaining_amount, receivable.unpaid_amount)
            receivable.received_amount += offset_amount
            receivable.unpaid_amount = receivable.total_amount - receivable.received_amount
            
            if receivable.unpaid_amount <= 0:
                receivable.status = "paid"
            
            offset_details.append(f"冲抵应收款#{receivable.id}(销售单#{receivable.sales_order_id})：¥{offset_amount:.2f}")
            remaining_amount -= offset_amount
        
        db.commit()
        
        # 构建返回消息
        offset_info = ""
        if offset_details:
            offset_info = f"\n📝 冲抵明细：\n" + "\n".join([f"   • {d}" for d in offset_details])
        if remaining_amount > 0:
            offset_info += f"\n💰 剩余预收款：¥{remaining_amount:.2f}"
        
        message = f"""✅ **收款登记成功**

📋 单号：{payment_no}
👤 客户：{customer.name}
💰 金额：¥{amount:.2f}
💳 方式：{payment_method}
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}{offset_info}

<!-- PAYMENT:{payment.id}:{payment_no} -->"""
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="payment_registration",
            user_role="settlement",
            customer_id=customer.id,
            customer_name=customer.name,
            operation_details={
                "payment_no": payment_no,
                "amount": amount,
                "payment_method": payment_method,
                "offset_count": len(offset_details),
                "remaining_prepaid": remaining_amount
            }
        )
        
        return {
            "success": True,
            "action": "登记收款",
            "message": message,
            "data": {
                "payment_id": payment.id,
                "payment_no": payment_no,
                "customer_name": customer.name,
                "amount": amount,
                "payment_method": payment_method
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"登记收款失败: {e}", exc_info=True)
        return {"success": False, "message": f"登记收款失败：{str(e)}", "action": "登记收款"}


async def handle_gold_receipt(ai_response, db: Session, user_role: str = "settlement") -> Dict[str, Any]:
    """处理收料 - 自动创建收料单"""
    from ..models import Customer, SettlementOrder, SalesOrder
    from ..models.finance import GoldReceipt
    from ..database import SessionLocal
    from sqlalchemy import func
    
    # 提取参数
    customer_name = getattr(ai_response, 'receipt_customer_name', None)
    gold_weight = getattr(ai_response, 'receipt_gold_weight', None)
    gold_fineness = getattr(ai_response, 'receipt_gold_fineness', '足金999') or '足金999'
    remark = getattr(ai_response, 'receipt_remark', '') or ''
    
    if not customer_name:
        return {"success": False, "message": "未识别到客户名称，请提供客户名", "action": "收料"}
    
    if not gold_weight or float(gold_weight) <= 0:
        return {"success": False, "message": "未识别到有效的克重，请提供收料克重", "action": "收料"}
    
    gold_weight = float(gold_weight)
    
    # 使用独立的数据库会话，确保在StreamingResponse中也能正确提交
    local_db = SessionLocal()
    try:
        # 通过客户名查找客户
        customer = local_db.query(Customer).filter(Customer.name == customer_name).first()
        if not customer:
            # 尝试模糊匹配
            candidates = local_db.query(Customer).filter(Customer.name.contains(customer_name)).all()
            if len(candidates) == 1:
                customer = candidates[0]
            elif len(candidates) > 1:
                names = '、'.join([c.name for c in candidates])
                return {"success": False, "message": f"找到多个匹配客户：{names}，请输入完整姓名以确认", "action": "收料"}
        
        if not customer:
            return {"success": False, "message": f"未找到客户「{customer_name}」，请先在客户管理中创建该客户", "action": "收料"}
        
        # 生成收料单号 SL + 时间戳
        now = china_now()
        receipt_no = f"SL{now.strftime('%Y%m%d%H%M%S')}"
        
        # 创建收料单（这是核心数据源）
        receipt = GoldReceipt(
            receipt_no=receipt_no,
            customer_id=customer.id,
            gold_weight=gold_weight,
            gold_fineness=gold_fineness,
            status="received",
            remark=remark or f"AI对话收料",
            created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
            received_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
            received_at=now
        )
        local_db.add(receipt)
        local_db.flush()
        
        # 立即提交，确保数据持久化
        local_db.commit()
        logger.info(f"[收料] 成功创建收料单: {receipt_no}, customer_id={customer.id}, weight={gold_weight}")
        
        # 刷新对象以获取最新的ID
        local_db.refresh(receipt)
        receipt_id = receipt.id
        customer_name_final = customer.name
        customer_id = customer.id
        
        # 统一使用工具函数计算金料余额
        from ..gold_balance import calculate_customer_gold_balance
        net_gold = calculate_customer_gold_balance(customer_id, local_db)
        
        # 返回成功消息
        if net_gold > 0:
            balance_text = f"当前存料余额：{net_gold:.2f}克"
        elif net_gold < 0:
            balance_text = f"当前欠料：{abs(net_gold):.2f}克"
        else:
            balance_text = "金料已结清（余额：0克）"
        
        message = f"""✅ **收料单已创建**

📋 单号：{receipt_no}
👤 客户：{customer_name_final}
⚖️ 克重：{gold_weight:.2f}克
🏷️ 成色：{gold_fineness}
💎 {balance_text}
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}

<!-- GOLD_RECEIPT:{receipt_id}:{receipt_no} -->"""
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="gold_receipt",
            user_role="product",
            customer_id=customer_id,
            customer_name=customer_name_final,
            operation_details={
                "receipt_no": receipt_no,
                "gold_weight": gold_weight,
                "gold_fineness": gold_fineness,
                "balance_after": net_gold
            }
        )
        
        return {
            "success": True,
            "action": "收料",
            "message": message,
            "data": {
                "receipt_id": receipt_id,
                "receipt_no": receipt_no,
                "customer_name": customer_name_final,
                "gold_weight": gold_weight,
                "gold_fineness": gold_fineness,
                "current_balance": net_gold
            }
        }
        
    except Exception as e:
        local_db.rollback()
        logger.error(f"创建收料单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建收料单失败：{str(e)}", "action": "收料"}
    finally:
        local_db.close()


async def handle_gold_payment(ai_response, db: Session, user_role: str) -> Dict[str, Any]:
    """处理付料（给供应商金料）- 创建付料单（待确认，不扣供应商账户）"""
    from ..models import Supplier, GoldMaterialTransaction
    
    # 提取参数
    supplier_name = getattr(ai_response, 'gold_payment_supplier', None)
    gold_weight = getattr(ai_response, 'gold_payment_weight', None)
    remark = getattr(ai_response, 'gold_payment_remark', '') or ''
    
    if not supplier_name:
        return {"success": False, "message": "未识别到供应商名称，请提供供应商名", "action": "付料"}
    
    if not gold_weight or float(gold_weight) <= 0:
        return {"success": False, "message": "未识别到有效的克重，请提供付料克重", "action": "付料"}
    
    gold_weight = float(gold_weight)
    
    # 通过供应商名查找供应商
    supplier = db.query(Supplier).filter(Supplier.name == supplier_name).first()
    if not supplier:
        # 尝试模糊匹配
        candidates = db.query(Supplier).filter(Supplier.name.contains(supplier_name)).all()
        if len(candidates) == 1:
            supplier = candidates[0]
        elif len(candidates) > 1:
            names = '、'.join([s.name for s in candidates])
            return {"success": False, "message": f"找到多个匹配供应商：{names}，请输入完整名称以确认", "action": "付料"}
    
    if not supplier:
        return {"success": False, "message": f"未找到供应商「{supplier_name}」，请先在供应商管理中创建该供应商", "action": "付料"}
    
    try:
        now = china_now()
        count = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.transaction_no.like(f"FL{now.strftime('%Y%m%d')}%")
        ).count()
        payment_no = f"FL{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 创建金料支出记录（付料单 - 待确认，不扣供应商账户）
        transaction = GoldMaterialTransaction(
            transaction_no=payment_no,
            transaction_type='expense',
            supplier_id=supplier.id,
            supplier_name=supplier.name,
            gold_weight=gold_weight,
            status="pending",
            created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
            remark=remark or "AI对话付料"
        )
        db.add(transaction)
        
        db.commit()
        db.refresh(transaction)
        
        message = f"""📋 **付料单已创建（待确认）**

📋 单号：{payment_no}
🏭 供应商：{supplier.name}
⚖️ 付料克重：{gold_weight:.2f}克
📦 状态：待确认
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}

请在金料管理页面的付料单列表中确认此单据。

<!-- GOLD_PAYMENT:{transaction.id}:{payment_no} -->"""
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="gold_payment",
            user_role=user_role,
            operation_details={
                "payment_no": payment_no,
                "supplier_name": supplier.name,
                "supplier_id": supplier.id,
                "gold_weight": gold_weight,
                "remark": remark
            }
        )
        
        return {
            "success": True,
            "action": "付料",
            "message": message,
            "data": {
                "transaction_id": transaction.id,
                "payment_no": payment_no,
                "supplier_name": supplier.name,
                "gold_weight": gold_weight
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"创建付料单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建付料单失败：{str(e)}", "action": "付料"}


async def handle_gold_withdrawal(ai_response, db: Session, user_role: str = "settlement") -> Dict[str, Any]:
    """处理提料（客户取料）- 创建提料单（待确认，不扣余额）"""
    from ..models import Customer, CustomerGoldDeposit, CustomerWithdrawal
    
    # 提取参数
    customer_name = getattr(ai_response, 'withdrawal_customer_name', None)
    gold_weight = getattr(ai_response, 'withdrawal_gold_weight', None)
    remark = getattr(ai_response, 'withdrawal_remark', '') or ''
    
    if not customer_name:
        return {"success": False, "message": "未识别到客户名称，请提供客户名", "action": "提料"}
    
    if not gold_weight or float(gold_weight) <= 0:
        return {"success": False, "message": "未识别到有效的克重，请提供提料克重", "action": "提料"}
    
    gold_weight = float(gold_weight)
    
    # 通过客户名查找客户
    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        # 尝试模糊匹配
        candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
        if len(candidates) == 1:
            customer = candidates[0]
        elif len(candidates) > 1:
            names = '、'.join([c.name for c in candidates])
            return {"success": False, "message": f"找到多个匹配客户：{names}，请输入完整姓名以确认", "action": "提料"}
    
    if not customer:
        return {"success": False, "message": f"未找到客户「{customer_name}」，请先在客户管理中创建该客户", "action": "提料"}
    
    # 使用统一计算函数验证存料余额（保证全系统口径一致）
    from ..gold_balance import calculate_customer_net_gold
    current_balance = calculate_customer_net_gold(customer.id, db)  # 正数=存料
    
    if current_balance < gold_weight:
        return {
            "success": False, 
            "message": f"客户「{customer.name}」存料余额不足。\n当前余额：{current_balance:.3f}克\n申请提料：{gold_weight:.3f}克",
            "action": "提料"
        }
    
    try:
        now = china_now()
        count = db.query(CustomerWithdrawal).filter(
            CustomerWithdrawal.withdrawal_no.like(f"QL{now.strftime('%Y%m%d')}%")
        ).count()
        withdrawal_no = f"QL{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 创建取料单（待确认状态，不扣余额）
        withdrawal = CustomerWithdrawal(
            withdrawal_no=withdrawal_no,
            customer_id=customer.id,
            customer_name=customer.name,
            gold_weight=gold_weight,
            withdrawal_type="self",
            status="pending",
            created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
            created_at=now,
            remark=remark or "AI对话提料"
        )
        db.add(withdrawal)
        
        db.commit()
        db.refresh(withdrawal)
        
        balance_after = current_balance - gold_weight
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="withdrawal",
            user_role="settlement",
            customer_id=customer.id,
            customer_name=customer.name,
            operation_details={
                "withdrawal_no": withdrawal_no,
                "gold_weight": gold_weight,
                "balance_before": current_balance,
                "balance_after": balance_after
            }
        )
        
        # 返回 withdrawal_confirm 类型，让前端显示确认卡片
        return {
            "success": True,
            "action": "提料",
            "type": "withdrawal_confirm",
            "message": f"提料单已创建，请确认",
            "data": {
                "withdrawal_id": withdrawal.id,
                "withdrawal_no": withdrawal_no,
                "customer": {
                    "id": customer.id,
                    "name": customer.name,
                    "phone": customer.phone
                },
                "gold_weight": gold_weight,
                "current_balance": current_balance,
                "balance_after": balance_after,
                "remark": remark,
                "created_at": now.strftime('%Y-%m-%d %H:%M:%S')
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"创建提料单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建提料单失败：{str(e)}", "action": "提料"}


async def handle_supplier_cash_payment(ai_response, db: Session, user_role: str = "material") -> Dict[str, Any]:
    """处理供应商付款（工费）- 必须附带付款截图才能登记"""
    from ..models import Supplier
    from ..models.finance import SupplierPayment, AccountPayable
    from datetime import date, datetime
    
    # 提取参数
    supplier_name = getattr(ai_response, 'supplier_payment_name', None)
    amount = getattr(ai_response, 'supplier_payment_amount', None)
    payment_method = getattr(ai_response, 'supplier_payment_method', '转账') or '转账'
    remark = getattr(ai_response, 'supplier_payment_remark', '') or ''
    
    # 强制要求付款截图凭证
    voucher_images = getattr(ai_response, 'voucher_images', None) or None
    if not voucher_images:
        return {
            "success": False,
            "action": "供应商付款",
            "message": (
                "⚠️ **供应商付款需要附带付款截图**\n\n"
                "请按以下步骤操作：\n"
                "1. 点击输入框旁的「💳 收款凭证」按钮上传转账截图\n"
                "2. 系统会自动 OCR 识别金额\n"
                "3. 确认信息后完成付款登记\n\n"
                "所有涉及资金的操作均需要凭证留痕。"
            )
        }
    
    if not supplier_name:
        return {"success": False, "message": "未识别到供应商名称，请提供供应商名", "action": "供应商付款"}
    
    if not amount or float(amount) <= 0:
        return {"success": False, "message": "未识别到有效的金额，请提供付款金额", "action": "供应商付款"}
    
    amount = float(amount)
    
    # 通过供应商名查找供应商
    supplier = db.query(Supplier).filter(Supplier.name == supplier_name).first()
    if not supplier:
        # 尝试模糊匹配
        candidates = db.query(Supplier).filter(Supplier.name.contains(supplier_name)).all()
        if len(candidates) == 1:
            supplier = candidates[0]
        elif len(candidates) > 1:
            names = '、'.join([s.name for s in candidates])
            return {"success": False, "message": f"找到多个匹配供应商：{names}，请输入完整名称以确认", "action": "供应商付款"}
    
    if not supplier:
        return {"success": False, "message": f"未找到供应商「{supplier_name}」，请先在供应商管理中创建该供应商", "action": "供应商付款"}
    
    # 转换付款方式为英文
    method_map = {
        '转账': 'bank_transfer',
        '现金': 'cash',
        '支票': 'check',
        '承兑': 'acceptance'
    }
    payment_method_en = method_map.get(payment_method, 'bank_transfer')
    
    try:
        now = china_now()
        count = db.query(SupplierPayment).filter(
            SupplierPayment.create_time >= datetime.now().replace(hour=0, minute=0, second=0)
        ).count()
        payment_no = f"FK{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 创建付款记录
        payment = SupplierPayment(
            payment_no=payment_no,
            supplier_id=supplier.id,
            payment_date=date.today(),
            amount=amount,
            payment_method=payment_method_en,
            remark=remark or "AI对话付款",
            created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role)
        )
        db.add(payment)
        db.flush()
        
        # FIFO方式冲抵应付账款
        unpaid_payables = db.query(AccountPayable).filter(
            AccountPayable.supplier_id == supplier.id,
            AccountPayable.status.in_(["unpaid", "partial"]),
            AccountPayable.unpaid_amount > 0
        ).order_by(AccountPayable.due_date.asc()).all()
        
        remaining_amount = amount
        offset_details = []
        
        for payable in unpaid_payables:
            if remaining_amount <= 0:
                break
            
            offset_amount = min(remaining_amount, payable.unpaid_amount)
            payable.paid_amount += offset_amount
            payable.unpaid_amount = payable.total_amount - payable.paid_amount
            
            if payable.unpaid_amount <= 0:
                payable.status = "paid"
            else:
                payable.status = "partial"
            
            offset_details.append(f"冲抵{payable.payable_no}：¥{offset_amount:.2f}")
            remaining_amount -= offset_amount
        
        db.commit()
        
        # 构建返回消息
        offset_info = ""
        if offset_details:
            offset_info = f"\n📝 冲抵明细：\n" + "\n".join([f"   • {d}" for d in offset_details])
        if remaining_amount > 0:
            offset_info += f"\n💰 剩余预付款：¥{remaining_amount:.2f}"
        
        message = f"""✅ **供应商付款成功**

📋 单号：{payment_no}
🏭 供应商：{supplier.name}
💰 金额：¥{amount:.2f}
💳 方式：{payment_method}
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}{offset_info}

<!-- SUPPLIER_PAYMENT:{payment.id}:{payment_no} -->"""
        
        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="supplier_payment",
            user_role="finance",
            operation_details={
                "payment_no": payment_no,
                "supplier_name": supplier.name,
                "supplier_id": supplier.id,
                "amount": amount,
                "payment_method": payment_method,
                "offset_count": len(offset_details),
                "remaining_prepaid": remaining_amount
            }
        )
        
        return {
            "success": True,
            "action": "供应商付款",
            "message": message,
            "data": {
                "payment_id": payment.id,
                "payment_no": payment_no,
                "supplier_name": supplier.name,
                "amount": amount,
                "payment_method": payment_method
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"供应商付款失败: {e}", exc_info=True)
        return {"success": False, "message": f"供应商付款失败：{str(e)}", "action": "供应商付款"}


async def handle_batch_transfer(ai_response, db: Session, user_role: str) -> Dict[str, Any]:
    """处理批量转移 - 按入库单号批量转移商品到目标位置"""
    from ..models import InboundOrder, InboundDetail, Location, LocationInventory, InventoryTransfer
    from datetime import datetime
    
    # 提取参数
    order_no = getattr(ai_response, 'batch_transfer_order_no', None)
    to_location_name = getattr(ai_response, 'batch_transfer_to_location', '展厅') or '展厅'
    
    if not order_no:
        return {"success": False, "message": "未识别到入库单号，请提供RK开头的入库单号", "action": "批量转移"}
    
    # 查找入库单
    inbound_order = db.query(InboundOrder).filter(InboundOrder.order_no == order_no).first()
    if not inbound_order:
        return {"success": False, "message": f"未找到入库单「{order_no}」", "action": "批量转移"}
    
    # 获取入库单商品明细
    details = db.query(InboundDetail).filter(InboundDetail.order_id == inbound_order.id).all()
    if not details:
        return {"success": False, "message": f"入库单「{order_no}」没有商品明细", "action": "批量转移"}
    
    # 确定源位置和目标位置
    from_location = db.query(Location).filter(Location.code == "warehouse").first()
    
    # 目标位置：根据用户输入匹配
    if "展厅" in to_location_name or "showroom" in to_location_name.lower():
        to_location = db.query(Location).filter(Location.code == "showroom").first()
        to_location_display = "展厅"
    elif "仓库" in to_location_name or "warehouse" in to_location_name.lower():
        to_location = db.query(Location).filter(Location.code == "warehouse").first()
        to_location_display = "商品部仓库"
    else:
        to_location = db.query(Location).filter(Location.code == "showroom").first()
        to_location_display = "展厅"
    
    if not from_location:
        return {"success": False, "message": "系统配置错误：未找到商品部仓库位置", "action": "批量转移"}
    if not to_location:
        return {"success": False, "message": f"系统配置错误：未找到{to_location_display}位置", "action": "批量转移"}
    if from_location.id == to_location.id:
        return {"success": False, "message": "商品已在目标位置，无需转移", "action": "批量转移"}
    
    try:
        now = china_now()
        created_transfers = []
        errors = []
        
        product_names = [d.product_name for d in details]
        src_inv_map = {li.product_name: li for li in db.query(LocationInventory).filter(
            LocationInventory.location_id == from_location.id, LocationInventory.product_name.in_(product_names)
        ).all()}
        
        for detail in details:
            try:
                inventory = src_inv_map.get(detail.product_name)
                
                if not inventory or inventory.weight < detail.weight:
                    available = inventory.weight if inventory else 0
                    errors.append(f"{detail.product_name}: 库存不足（需要{detail.weight:.2f}克，仅有{available:.2f}克）")
                    continue
                
                # 扣减源位置库存
                inventory.weight = float(inventory.weight or 0) - float(detail.weight or 0)
                inventory.last_update = now
                
                # 生成转移单号
                transfer_no = f"ZY{now.strftime('%Y%m%d%H%M%S')}{len(created_transfers):03d}"
                
                # 创建转移单
                new_transfer = InventoryTransfer(
                    transfer_no=transfer_no,
                    product_name=detail.product_name,
                    weight=detail.weight,
                    from_location_id=from_location.id,
                    to_location_id=to_location.id,
                    status="pending",
                    created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
                    created_at=now,
                    remark=f"来自入库单{order_no}"
                )
                db.add(new_transfer)
                created_transfers.append({
                    "product_name": detail.product_name,
                    "weight": detail.weight,
                    "transfer_no": transfer_no
                })
            except Exception as e:
                errors.append(f"{detail.product_name}: {str(e)}")
        
        db.commit()
        
        if not created_transfers:
            return {
                "success": False,
                "message": f"批量转移失败，所有商品转移失败：\n" + "\n".join([f"• {e}" for e in errors]),
                "action": "批量转移"
            }
        
        total_weight = sum(t["weight"] for t in created_transfers)
        
        # 构建商品列表
        items_text = "\n".join([f"   • {t['product_name']}：{t['weight']:.2f}克" for t in created_transfers])
        
        error_text = ""
        if errors:
            error_text = f"\n\n⚠️ 部分商品转移失败：\n" + "\n".join([f"   • {e}" for e in errors])
        
        message = f"""✅ **批量转移单已创建**

📋 来源入库单：{order_no}
📍 转移路径：商品部仓库 → {to_location_display}
📦 转移商品（{len(created_transfers)}种）：
{items_text}
⚖️ 总克重：{total_weight:.2f}克
📊 状态：待接收
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}{error_text}

<!-- BATCH_TRANSFER:{order_no}:{len(created_transfers)} -->"""
        
        return {
            "success": True,
            "action": "批量转移",
            "message": message,
            "data": {
                "order_no": order_no,
                "created_count": len(created_transfers),
                "total_weight": total_weight,
                "created_transfers": created_transfers,
                "errors": errors
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"批量转移失败: {e}", exc_info=True)
        return {"success": False, "message": f"批量转移失败：{str(e)}", "action": "批量转移"}


async def handle_deposit_settlement(ai_response, db: Session, user_role: str = "settlement") -> Dict[str, Any]:
    """处理存料结价（将客户存料折算成现金抵扣欠款）- 创建存料结价单（草稿状态）"""
    from ..models import Customer, DepositSettlement

    customer_name = getattr(ai_response, 'deposit_settle_customer_name', None)
    gold_weight = getattr(ai_response, 'deposit_settle_gold_weight', None)
    gold_price = getattr(ai_response, 'deposit_settle_gold_price', None)
    remark = getattr(ai_response, 'deposit_settle_remark', '') or ''

    if not customer_name:
        return {"success": False, "message": "未识别到客户名称，请提供客户名", "action": "存料结价"}

    if not gold_weight or float(gold_weight) <= 0:
        return {"success": False, "message": "未识别到有效的结价克重，请提供克重（如：3克）", "action": "存料结价"}

    if not gold_price or float(gold_price) <= 0:
        return {"success": False, "message": "未识别到有效的金价，请提供金价（如：金价800）", "action": "存料结价"}

    gold_weight = float(gold_weight)
    gold_price = float(gold_price)

    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
        if len(candidates) == 1:
            customer = candidates[0]
        elif len(candidates) > 1:
            names = '、'.join([c.name for c in candidates])
            return {"success": False, "message": f"找到多个匹配客户：{names}，请输入完整姓名以确认", "action": "存料结价"}

    if not customer:
        return {"success": False, "message": f"未找到客户「{customer_name}」，请先在客户管理中创建该客户", "action": "存料结价"}

    # 使用统一计算函数验证存料余额（保证全系统口径一致）
    from ..gold_balance import calculate_customer_net_gold
    current_balance = calculate_customer_net_gold(customer.id, db)  # 正数=存料

    if current_balance <= 0:
        return {
            "success": False,
            "message": f"客户「{customer.name}」当前无存料余额（{current_balance:.3f}克），无法进行存料结价",
            "action": "存料结价"
        }

    if gold_weight > current_balance:
        return {
            "success": False,
            "message": f"客户「{customer.name}」存料余额不足。\n当前余额：{current_balance:.3f}克\n申请结价：{gold_weight:.3f}克",
            "action": "存料结价"
        }

    try:
        now = china_now()
        count = db.query(DepositSettlement).filter(
            DepositSettlement.settlement_no.like(f"CJ{now.strftime('%Y%m%d')}%")
        ).count()
        settlement_no = f"CJ{now.strftime('%Y%m%d')}{count + 1:03d}"

        total_amount = round(gold_weight * gold_price, 2)

        new_settlement = DepositSettlement(
            settlement_no=settlement_no,
            customer_id=customer.id,
            customer_name=customer.name,
            gold_weight=gold_weight,
            gold_price=gold_price,
            total_amount=total_amount,
            status="draft",
            created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
            remark=remark or "AI对话存料结价"
        )
        db.add(new_settlement)
        db.commit()
        db.refresh(new_settlement)

        message = f"""✅ **存料结价单已创建**

👤 客户：{customer.name}
📋 单号：{settlement_no}
⚖️ 结价克重：{gold_weight:.3f}克
💰 金价：¥{gold_price:.0f}/克
💵 抵扣金额：¥{total_amount:,.2f}
📊 状态：待确认
📦 存料余额：{current_balance:.3f}克 → 确认后 {current_balance - gold_weight:.3f}克
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}

⚠️ 请前往「结算管理 → 存料结价」Tab 确认此单，确认后将扣减存料并抵扣欠款。"""

        # 后台记录决策到向量库
        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="deposit_settlement",
            user_role="settlement",
            customer_id=customer.id,
            customer_name=customer.name,
            gold_price=gold_price,
            operation_details={
                "settlement_no": settlement_no,
                "gold_weight": gold_weight,
                "gold_price": gold_price,
                "total_amount": total_amount,
                "deposit_balance_before": current_balance,
                "deposit_balance_after": current_balance - gold_weight
            }
        )
        
        return {
            "success": True,
            "action": "存料结价",
            "message": message,
            "data": {
                "settlement_id": new_settlement.id,
                "settlement_no": settlement_no,
                "customer_name": customer.name,
                "gold_weight": gold_weight,
                "gold_price": gold_price,
                "total_amount": total_amount,
                "deposit_balance": current_balance,
                "deposit_balance_after": current_balance - gold_weight
            }
        }

    except Exception as e:
        db.rollback()
        logger.error(f"存料结价失败: {e}", exc_info=True)
        return {"success": False, "message": f"存料结价失败：{str(e)}", "action": "存料结价"}


# ========== 结算单聊天支持 ==========

@_apply_tenant_rules(trigger_point="create_settlement")
async def handle_create_settlement(ai_response, db: Session, user_role: str = "settlement") -> Dict[str, Any]:
    """通过自然语言创建结算单"""
    from ..models import SettlementOrder, SalesOrder, SalesDetail
    from ..database import SessionLocal

    try:
        customer_name = getattr(ai_response, 'settlement_customer_name', None)
        sales_order_no = getattr(ai_response, 'settlement_sales_order_no', None)
        payment_method_raw = getattr(ai_response, 'settlement_payment_method', None) or ''
        gold_price = getattr(ai_response, 'settlement_gold_price', None)
        remark = getattr(ai_response, 'settlement_remark', None) or ''

        method_map = {
            '结料': 'physical_gold', '结价': 'cash_price', '混合': 'mixed',
            'physical_gold': 'physical_gold', 'cash_price': 'cash_price', 'mixed': 'mixed',
        }
        payment_method = method_map.get(payment_method_raw.strip(), None)
        if not payment_method:
            return {"success": False, "action": "创建结算单",
                    "message": "请指定结算方式：**结料**（付金料）或 **结价**（按金价结现金），例如：\n\n"
                               "• `张三结算 结料`\n• `张三结算 结价 金价550`"}

        if payment_method == 'cash_price' and (not gold_price or gold_price <= 0):
            return {"success": False, "action": "创建结算单",
                    "message": "结价方式需要提供当日金价，例如：`张三结算 结价 金价550`"}

        local_db = SessionLocal()
        try:
            sales_order = None
            if sales_order_no:
                sales_order = local_db.query(SalesOrder).filter(SalesOrder.order_no == sales_order_no).first()
                if not sales_order:
                    return {"success": False, "action": "创建结算单",
                            "message": f"未找到销售单「{sales_order_no}」，请检查单号"}
            elif customer_name:
                from ..models import Customer
                customer = local_db.query(Customer).filter(Customer.name == customer_name).first()
                if not customer:
                    candidates = local_db.query(Customer).filter(
                        Customer.name.contains(customer_name)
                    ).limit(5).all()
                    if candidates:
                        names = "、".join([c.name for c in candidates])
                        return {"success": False, "action": "创建结算单",
                                "message": f"未找到客户「{customer_name}」，您是否要找：{names}？"}
                    return {"success": False, "action": "创建结算单",
                            "message": f"未找到客户「{customer_name}」，请先创建客户"}

                sales_order = local_db.query(SalesOrder).filter(
                    SalesOrder.customer_name == customer.name,
                    SalesOrder.status.in_(["confirmed", "待结算"])
                ).order_by(SalesOrder.create_time.desc()).first()

                if not sales_order:
                    return {"success": False, "action": "创建结算单",
                            "message": f"客户「{customer_name}」没有待结算的销售单"}
            else:
                return {"success": False, "action": "创建结算单",
                        "message": "请提供客户名称或销售单号"}

            existing = local_db.query(SettlementOrder).filter(
                SettlementOrder.sales_order_id == sales_order.id,
                SettlementOrder.status != "cancelled"
            ).first()
            if existing:
                return {"success": False, "action": "创建结算单",
                        "message": f"销售单 {sales_order.order_no} 已有结算单 {existing.settlement_no}"}

            so_total_weight = sales_order.total_weight or 0.0
            so_total_labor_cost = sales_order.total_labor_cost or 0.0
            if so_total_weight <= 0:
                return {"success": False, "action": "创建结算单",
                        "message": f"销售单 {sales_order.order_no} 总克重为0，无法结算"}

            if payment_method == "cash_price":
                material_amount = gold_price * so_total_weight
                actual_gold_due = 0.0
            elif payment_method == "physical_gold":
                material_amount = 0
                actual_gold_due = so_total_weight
            else:
                return {"success": False, "action": "创建结算单",
                        "message": "暂不支持聊天创建混合支付结算单，请前往结算管理页面操作"}

            now = china_now()
            count = local_db.query(SettlementOrder).filter(
                SettlementOrder.settlement_no.like(f"JS{now.strftime('%Y%m%d')}%")
            ).count()
            settlement_no = f"JS{now.strftime('%Y%m%d')}{count + 1:03d}"

            labor_amount = so_total_labor_cost
            total_amount = material_amount + labor_amount

            customer_id = sales_order.customer_id
            physical_gold_weight = actual_gold_due if payment_method == "physical_gold" else 0

            new_settlement = SettlementOrder(
                settlement_no=settlement_no,
                sales_order_id=sales_order.id,
                payment_method=payment_method,
                gold_price=gold_price if payment_method == "cash_price" else None,
                total_weight=round(so_total_weight, 3),
                material_amount=round(material_amount, 2),
                labor_amount=round(labor_amount, 2),
                total_amount=round(total_amount, 2),
                physical_gold_weight=round(physical_gold_weight, 3),
                status="draft",
                created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
                created_at=now,
                remark=remark,
            )
            local_db.add(new_settlement)
            local_db.commit()
            local_db.refresh(new_settlement)

            method_label = {'cash_price': '结价', 'physical_gold': '结料', 'mixed': '混合'}[payment_method]
            details = local_db.query(SalesDetail).filter(SalesDetail.order_id == sales_order.id).all()
            items_text = "\n".join([f"  • {d.product_name} {d.weight:.2f}克 工费¥{d.labor_cost:.0f}/克" for d in details[:5]])

            message = f"""✅ **结算单已创建（草稿）**

📋 结算单号：{settlement_no}
👤 客户：{sales_order.customer_name}
🧾 关联销售单：{sales_order.order_no}
📦 商品明细：
{items_text}
⚖️ 总克重：{so_total_weight:.2f}克
💰 总工费：¥{labor_amount:,.2f}
💳 结算方式：{method_label}"""

            if payment_method == "cash_price":
                message += f"""
📈 金价：¥{gold_price:,.0f}/克
💵 原料金额：¥{material_amount:,.2f}
💰 **结算总额：¥{total_amount:,.2f}**"""
            else:
                message += f"""
⚖️ 应付金料：{physical_gold_weight:.2f}克
💰 应付工费：¥{labor_amount:,.2f}"""

            message += f"""

⚠️ 请前往「结算管理」确认此结算单，确认后将正式入账。
<!-- SETTLEMENT:{new_settlement.id}:{settlement_no} -->"""

            from ..services.behavior_logger import log_decision_background
            log_decision_background(
                action_type="create_settlement",
                user_role="settlement",
                customer_id=customer_id,
                customer_name=sales_order.customer_name,
                operation_details={
                    "settlement_no": settlement_no,
                    "sales_order_no": sales_order.order_no,
                    "payment_method": payment_method,
                    "total_amount": total_amount,
                }
            )

            return {
                "success": True, "action": "创建结算单", "message": message,
                "data": {
                    "settlement_id": new_settlement.id,
                    "settlement_no": settlement_no,
                    "sales_order_no": sales_order.order_no,
                    "customer_name": sales_order.customer_name,
                    "payment_method": payment_method,
                    "total_amount": total_amount,
                }
            }
        finally:
            local_db.close()

    except Exception as e:
        logger.error(f"创建结算单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建结算单失败：{str(e)}", "action": "创建结算单"}


async def handle_query_settlement(ai_response, db: Session) -> Dict[str, Any]:
    """查询结算单"""
    from ..models import SettlementOrder, SalesOrder

    try:
        order_no = getattr(ai_response, 'settlement_order_no', None)
        customer_name = getattr(ai_response, 'settlement_customer_name', None)
        start_date = getattr(ai_response, 'start_date', None)
        end_date = getattr(ai_response, 'end_date', None)

        query = db.query(SettlementOrder)

        if order_no:
            settlement = query.filter(SettlementOrder.settlement_no == order_no).first()
            if not settlement:
                settlement = query.filter(SettlementOrder.settlement_no.contains(order_no)).first()
            if not settlement:
                return {"success": False, "action": "查询结算单",
                        "message": f"未找到结算单「{order_no}」"}

            sales_order = db.query(SalesOrder).filter(SalesOrder.id == settlement.sales_order_id).first()
            method_label = {'cash_price': '结价', 'physical_gold': '结料', 'mixed': '混合'}.get(
                settlement.payment_method, settlement.payment_method)
            status_label = {'draft': '待确认', 'confirmed': '已确认', 'printed': '已打印',
                          'cancelled': '已取消', 'refunded': '已退款'}.get(
                settlement.status, settlement.status)

            msg = f"""📋 **结算单详情**

📄 单号：{settlement.settlement_no}
👤 客户：{sales_order.customer_name if sales_order else '未知'}
🧾 销售单：{sales_order.order_no if sales_order else '未知'}
💳 结算方式：{method_label}
💰 总金额：¥{(settlement.total_amount or 0):,.2f}
📊 状态：{status_label}
🕐 创建时间：{settlement.created_at.strftime('%Y-%m-%d %H:%M') if settlement.created_at else ''}"""
            if settlement.gold_price:
                msg += f"\n📈 金价：¥{settlement.gold_price:,.0f}/克"
            if settlement.physical_gold_weight:
                msg += f"\n⚖️ 应付金料：{settlement.physical_gold_weight:.2f}克"
            return {"success": True, "action": "查询结算单", "message": msg}

        if customer_name:
            query = query.join(SalesOrder, SettlementOrder.sales_order_id == SalesOrder.id)
            query = query.filter(SalesOrder.customer_name.contains(customer_name))

        if start_date:
            try:
                from datetime import datetime as dt
                query = query.filter(SettlementOrder.created_at >= dt.strptime(start_date, "%Y-%m-%d"))
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                from datetime import datetime as dt
                query = query.filter(SettlementOrder.created_at <= dt.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59))
            except (ValueError, TypeError):
                pass

        settlements = query.order_by(SettlementOrder.created_at.desc()).limit(10).all()
        if not settlements:
            filter_desc = f"客户「{customer_name}」的" if customer_name else ""
            return {"success": True, "action": "查询结算单",
                    "message": f"未找到{filter_desc}结算单记录"}

        sales_ids = [s.sales_order_id for s in settlements if s.sales_order_id]
        sales_map = {}
        if sales_ids:
            sales_list = db.query(SalesOrder).filter(SalesOrder.id.in_(sales_ids)).all()
            sales_map = {so.id: so for so in sales_list}

        status_map = {'draft': '待确认', 'confirmed': '已确认', 'printed': '已打印',
                     'cancelled': '已取消', 'refunded': '已退款'}
        method_map = {'cash_price': '结价', 'physical_gold': '结料', 'mixed': '混合'}

        lines = [f"📋 **结算单列表**（共 {len(settlements)} 条）\n"]
        for s in settlements:
            so = sales_map.get(s.sales_order_id)
            c_name = so.customer_name if so else "未知"
            lines.append(
                f"• **{s.settlement_no}** | {c_name} | "
                f"{method_map.get(s.payment_method, s.payment_method)} | "
                f"¥{(s.total_amount or 0):,.2f} | {status_map.get(s.status, s.status)}"
            )
        return {"success": True, "action": "查询结算单", "message": "\n".join(lines)}

    except Exception as e:
        logger.error(f"查询结算单失败: {e}", exc_info=True)
        return {"success": False, "message": f"查询结算单失败：{str(e)}", "action": "查询结算单"}


# ========== 暂借单聊天支持 ==========

async def handle_create_loan(ai_response, db: Session, user_role: str = "settlement") -> Dict[str, Any]:
    """通过自然语言创建暂借单"""
    from ..models import Customer, LoanOrder, LoanDetail, Inventory
    from ..database import SessionLocal

    try:
        customer_name = getattr(ai_response, 'loan_customer_name', None)
        loan_items = getattr(ai_response, 'loan_items', None) or []
        salesperson = getattr(ai_response, 'loan_salesperson', None) or ''
        remark = getattr(ai_response, 'loan_remark', None) or ''

        if not customer_name:
            return {"success": False, "action": "创建暂借单",
                    "message": "请提供暂借客户名称，例如：`张三暂借足金手镯10克 工费8元`"}

        if not loan_items:
            return {"success": False, "action": "创建暂借单",
                    "message": "请提供暂借商品信息（商品名、克重、工费），例如：\n`张三暂借足金手镯10克 工费8元`"}

        local_db = SessionLocal()
        try:
            customer = local_db.query(Customer).filter(Customer.name == customer_name).first()
            if not customer:
                candidates = local_db.query(Customer).filter(
                    Customer.name.contains(customer_name)
                ).limit(5).all()
                if candidates:
                    names = "、".join([c.name for c in candidates])
                    return {"success": False, "action": "创建暂借单",
                            "message": f"未找到客户「{customer_name}」，您是否要找：{names}？"}
                return {"success": False, "action": "创建暂借单",
                        "message": f"未找到客户「{customer_name}」，请先创建客户"}

            inventory_errors = []
            for item in loan_items:
                name = item.get('product_name', '')
                weight = float(item.get('weight', 0))
                if weight <= 0:
                    return {"success": False, "action": "创建暂借单",
                            "message": f"商品「{name}」的克重必须大于0"}
                inv = local_db.query(Inventory).filter(Inventory.product_name == name).first()
                available = inv.total_weight if inv else 0
                if available < weight:
                    inventory_errors.append(f"{name}（库存 {available:.2f}克，需 {weight:.2f}克）")

            if inventory_errors:
                return {"success": False, "action": "创建暂借单",
                        "message": f"库存不足：{'、'.join(inventory_errors)}"}

            total_weight = sum(float(it.get('weight', 0)) for it in loan_items)

            now = china_now()
            date_str = now.strftime("%Y%m%d")
            prefix = f"ZJ{date_str}"
            last_order = local_db.query(LoanOrder).filter(
                LoanOrder.loan_no.like(f"{prefix}%")
            ).order_by(LoanOrder.loan_no.desc()).first()
            seq = (int(last_order.loan_no[-4:]) + 1) if last_order else 1
            loan_no = f"{prefix}{seq:04d}"

            loan_order = LoanOrder(
                loan_no=loan_no,
                customer_id=customer.id,
                customer_name=customer.name,
                total_weight=round(total_weight, 3),
                salesperson=salesperson or ROLE_DISPLAY_NAMES.get(user_role, user_role),
                loan_date=now,
                status="pending",
                created_by=ROLE_DISPLAY_NAMES.get(user_role, user_role),
                created_at=now,
                remark=remark,
            )
            local_db.add(loan_order)
            local_db.flush()

            for item in loan_items:
                detail = LoanDetail(
                    loan_id=loan_order.id,
                    product_name=item.get('product_name', ''),
                    weight=float(item.get('weight', 0)),
                    status="pending",
                )
                local_db.add(detail)

            local_db.commit()
            local_db.refresh(loan_order)

            items_text = "\n".join([
                f"  • {it.get('product_name', '')} {float(it.get('weight', 0)):.2f}克"
                for it in loan_items
            ])

            message = f"""✅ **暂借单已创建（待确认）**

📋 单号：{loan_no}
👤 客户：{customer.name}
📦 暂借商品：
{items_text}
⚖️ 总克重：{total_weight:.2f}克

⚠️ 请前往「暂借管理」确认借出，确认后将扣减库存。"""

            from ..services.behavior_logger import log_decision_background
            log_decision_background(
                action_type="create_loan",
                user_role="settlement",
                customer_id=customer.id,
                customer_name=customer.name,
                operation_details={
                    "loan_no": loan_no,
                    "total_weight": total_weight,
                    "item_count": len(loan_items),
                }
            )

            return {
                "success": True, "action": "创建暂借单", "message": message,
                "data": {
                    "loan_id": loan_order.id,
                    "loan_no": loan_no,
                    "customer_name": customer.name,
                    "total_weight": total_weight,
                    "item_count": len(loan_items),
                }
            }
        finally:
            local_db.close()

    except Exception as e:
        logger.error(f"创建暂借单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建暂借单失败：{str(e)}", "action": "创建暂借单"}


async def handle_loan_return(ai_response, db: Session) -> Dict[str, Any]:
    """通过自然语言归还暂借"""
    from ..models import Customer, LoanOrder, LoanDetail

    try:
        customer_name = getattr(ai_response, 'loan_customer_name', None)
        order_no = getattr(ai_response, 'loan_order_no', None)
        remark = getattr(ai_response, 'loan_remark', None) or ''

        loan = None
        if order_no:
            loan = db.query(LoanOrder).filter(LoanOrder.loan_no == order_no).first()
            if not loan:
                loan = db.query(LoanOrder).filter(LoanOrder.loan_no.contains(order_no)).first()
            if not loan:
                return {"success": False, "action": "归还暂借",
                        "message": f"未找到暂借单「{order_no}」"}
        elif customer_name:
            customer = db.query(Customer).filter(Customer.name == customer_name).first()
            if not customer:
                return {"success": False, "action": "归还暂借",
                        "message": f"未找到客户「{customer_name}」"}
            loan = db.query(LoanOrder).filter(
                LoanOrder.customer_id == customer.id,
                LoanOrder.status.in_(["borrowed", "partial_returned"])
            ).order_by(LoanOrder.created_at.desc()).first()
            if not loan:
                return {"success": False, "action": "归还暂借",
                        "message": f"客户「{customer_name}」没有未归还的暂借单"}
        else:
            return {"success": False, "action": "归还暂借",
                    "message": "请提供客户名称或暂借单号"}

        if loan.status not in ["borrowed", "partial_returned"]:
            status_label = {'pending': '待确认', 'returned': '已归还', 'cancelled': '已撤销'}.get(
                loan.status, loan.status)
            return {"success": False, "action": "归还暂借",
                    "message": f"暂借单 {loan.loan_no} 状态为「{status_label}」，无法归还"}

        unreturned = db.query(LoanDetail).filter(
            LoanDetail.loan_id == loan.id,
            LoanDetail.status == "borrowed"
        ).all()

        if not unreturned:
            return {"success": False, "action": "归还暂借",
                    "message": f"暂借单 {loan.loan_no} 没有未归还的商品"}

        items_text = "\n".join([
            f"  • {d.product_name} {d.weight:.2f}克"
            for d in unreturned
        ])
        total_w = sum(d.weight for d in unreturned)

        message = f"""📋 **暂借单 {loan.loan_no}** 有以下未归还商品：

{items_text}
⚖️ 总克重：{total_w:.2f}克

请前往「暂借管理 → 还货」操作归还，或输入具体要归还的商品。
<!-- LOAN_RETURN:{loan.id}:{loan.loan_no} -->"""

        return {"success": True, "action": "归还暂借", "message": message,
                "data": {"loan_id": loan.id, "loan_no": loan.loan_no,
                         "unreturned_count": len(unreturned), "total_weight": total_w}}

    except Exception as e:
        logger.error(f"归还暂借失败: {e}", exc_info=True)
        return {"success": False, "message": f"归还暂借失败：{str(e)}", "action": "归还暂借"}


async def handle_query_loan(ai_response, db: Session) -> Dict[str, Any]:
    """查询暂借单"""
    from ..models import LoanOrder, LoanDetail, Customer

    try:
        order_no = getattr(ai_response, 'loan_order_no', None)
        customer_name = getattr(ai_response, 'loan_customer_name', None)

        if order_no:
            loan = db.query(LoanOrder).filter(LoanOrder.loan_no == order_no).first()
            if not loan:
                loan = db.query(LoanOrder).filter(LoanOrder.loan_no.contains(order_no)).first()
            if not loan:
                return {"success": False, "action": "查询暂借单",
                        "message": f"未找到暂借单「{order_no}」"}

            details = db.query(LoanDetail).filter(LoanDetail.loan_id == loan.id).all()
            status_map = {'pending': '待确认', 'borrowed': '已借出',
                         'partial_returned': '部分归还', 'returned': '已归还', 'cancelled': '已撤销'}

            items_text = "\n".join([
                f"  • {d.product_name} {d.weight:.2f}克 | {status_map.get(d.status, d.status)}"
                for d in details
            ])

            msg = f"""📋 **暂借单详情**

📄 单号：{loan.loan_no}
👤 客户：{loan.customer_name}
👔 业务员：{loan.salesperson or ''}
⚖️ 总克重：{(loan.total_weight or 0):.2f}克
📊 状态：{status_map.get(loan.status, loan.status)}
📦 明细：
{items_text}
🕐 创建时间：{loan.created_at.strftime('%Y-%m-%d %H:%M') if loan.created_at else ''}"""

            return {"success": True, "action": "查询暂借单", "message": msg}

        query = db.query(LoanOrder)
        if customer_name:
            query = query.filter(LoanOrder.customer_name.contains(customer_name))

        loans = query.order_by(LoanOrder.created_at.desc()).limit(10).all()
        if not loans:
            filter_desc = f"客户「{customer_name}」的" if customer_name else ""
            return {"success": True, "action": "查询暂借单",
                    "message": f"未找到{filter_desc}暂借单记录"}

        status_map = {'pending': '待确认', 'borrowed': '已借出',
                     'partial_returned': '部分归还', 'returned': '已归还', 'cancelled': '已撤销'}

        lines = [f"📋 **暂借单列表**（共 {len(loans)} 条）\n"]
        for loan in loans:
            lines.append(
                f"• **{loan.loan_no}** | {loan.customer_name} | "
                f"{(loan.total_weight or 0):.2f}克 | "
                f"{status_map.get(loan.status, loan.status)}"
            )
        return {"success": True, "action": "查询暂借单", "message": "\n".join(lines)}

    except Exception as e:
        logger.error(f"查询暂借单失败: {e}", exc_info=True)
        return {"success": False, "message": f"查询暂借单失败：{str(e)}", "action": "查询暂借单"}


# ========== 对账单查询 ==========

async def handle_reconciliation(ai_response, db: Session) -> Dict[str, Any]:
    """生成/查询客户对账单"""
    from ..models import Customer, SalesOrder
    from ..models.finance import PaymentRecord, AccountReceivable

    try:
        customer_name = getattr(ai_response, 'reconciliation_customer_name', None)
        month = getattr(ai_response, 'reconciliation_month', None)

        if not customer_name:
            return {"success": False, "action": "查询对账单",
                    "message": "请提供客户名称，例如：`帮我生成张三1月份的对账单`"}

        customer = db.query(Customer).filter(Customer.name == customer_name).first()
        if not customer:
            candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).limit(5).all()
            if candidates:
                names = "、".join([c.name for c in candidates])
                return {"success": False, "action": "查询对账单",
                        "message": f"未找到客户「{customer_name}」，您是否要找：{names}？"}
            return {"success": False, "action": "查询对账单",
                    "message": f"未找到客户「{customer_name}」"}

        from datetime import datetime as dt
        if month:
            try:
                start = dt.strptime(month + "-01", "%Y-%m-%d")
                if start.month == 12:
                    end = start.replace(year=start.year + 1, month=1)
                else:
                    end = start.replace(month=start.month + 1)
            except ValueError:
                start = dt.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                end = (start.replace(month=start.month + 1) if start.month < 12
                       else start.replace(year=start.year + 1, month=1))
        else:
            start = dt.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = (start.replace(month=start.month + 1) if start.month < 12
                   else start.replace(year=start.year + 1, month=1))

        month_label = start.strftime("%Y年%m月")

        sales = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.create_time >= start,
            SalesOrder.create_time < end,
            SalesOrder.status != "cancelled"
        ).order_by(SalesOrder.create_time).all()

        payments = db.query(PaymentRecord).filter(
            PaymentRecord.customer_id == customer.id,
            PaymentRecord.create_time >= start,
            PaymentRecord.create_time < end
        ).order_by(PaymentRecord.create_time).all()

        receivables = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer.id,
            AccountReceivable.status.in_(["unpaid", "overdue"])
        ).all()

        total_sales = sum((s.total_labor_cost or 0) for s in sales)
        total_weight = sum((s.total_weight or 0) for s in sales)
        total_paid = sum((p.amount or 0) for p in payments)
        total_unpaid = sum((r.unpaid_amount or 0) for r in receivables)

        from ..gold_balance import calculate_customer_net_gold
        try:
            net_gold = calculate_customer_net_gold(customer.id, db)
        except Exception:
            net_gold = 0

        msg = f"""📋 **{customer.name} {month_label}对账单**

━━━ 销售汇总 ━━━
🧾 销售单数：{len(sales)} 笔
⚖️ 总克重：{total_weight:.2f}克
💰 总工费：¥{total_sales:,.2f}

━━━ 收款汇总 ━━━
💵 收款笔数：{len(payments)} 笔
💰 收款总额：¥{total_paid:,.2f}

━━━ 当前余额 ━━━
📊 未付欠款：¥{total_unpaid:,.2f}
⚖️ 金料余额：{net_gold:+.3f}克"""

        if net_gold > 0:
            msg += "（存料）"
        elif net_gold < 0:
            msg += "（欠料）"

        if sales:
            msg += "\n\n━━━ 销售明细 ━━━"
            for s in sales[:10]:
                date_str = s.create_time.strftime('%m/%d') if s.create_time else ''
                msg += f"\n• {date_str} {s.order_no} | {(s.total_weight or 0):.2f}克 ¥{(s.total_labor_cost or 0):,.2f}"
            if len(sales) > 10:
                msg += f"\n... 共 {len(sales)} 笔"

        if payments:
            msg += "\n\n━━━ 收款明细 ━━━"
            for p in payments[:10]:
                date_str = p.create_time.strftime('%m/%d') if p.create_time else ''
                msg += f"\n• {date_str} {p.payment_no or ''} | ¥{(p.amount or 0):,.2f}"
            if len(payments) > 10:
                msg += f"\n... 共 {len(payments)} 笔"

        return {"success": True, "action": "查询对账单", "message": msg}

    except Exception as e:
        logger.error(f"查询对账单失败: {e}", exc_info=True)
        return {"success": False, "message": f"查询对账单失败：{str(e)}", "action": "查询对账单"}


# ========== 凭证查询 ==========

async def handle_query_voucher(ai_response, db: Session) -> Dict[str, Any]:
    """查询FBL凭证"""
    try:
        from ..fbl_database import FBLSessionLocal
        from sqlalchemy import text

        voucher_type = getattr(ai_response, 'voucher_query_type', None)
        date_start = getattr(ai_response, 'voucher_date_start', None)
        date_end = getattr(ai_response, 'voucher_date_end', None)
        keyword = getattr(ai_response, 'voucher_keyword', None)

        fbl_db = FBLSessionLocal()
        try:
            conditions = []
            params = {}

            if voucher_type:
                conditions.append('dt."name" = :vtype')
                params['vtype'] = voucher_type

            if date_start:
                conditions.append('d."docDate" >= :ds')
                params['ds'] = date_start
            if date_end:
                conditions.append('d."docDate" <= :de')
                params['de'] = date_end

            if keyword:
                conditions.append('d."summary" LIKE :kw')
                params['kw'] = f'%{keyword}%'

            where = (" AND " + " AND ".join(conditions)) if conditions else ""

            sql = f"""
                SELECT d.id, d."docCode", d."docDate", d."summary", d."maker",
                       dt."name" as doc_type, d."isPosted"
                FROM gl_doc d
                LEFT JOIN aa_doctype dt ON d."docType" = dt.id
                WHERE 1=1 {where}
                ORDER BY d."docDate" DESC, d.id DESC
                LIMIT 20
            """
            rows = fbl_db.execute(text(sql), params).fetchall()

            if not rows:
                filter_desc = []
                if voucher_type:
                    filter_desc.append(f"类型「{voucher_type}」")
                if date_start or date_end:
                    filter_desc.append(f"日期 {date_start or ''}~{date_end or ''}")
                desc = "、".join(filter_desc) if filter_desc else ""
                return {"success": True, "action": "查询凭证",
                        "message": f"未找到{desc}的凭证记录"}

            lines = [f"📄 **凭证列表**（共 {len(rows)} 条）\n"]
            for r in rows:
                posted = "✅已过账" if r.isPosted else "⏳未过账"
                date_str = str(r.docDate) if r.docDate else ''
                lines.append(
                    f"• **{r.docCode or ''}** | {date_str} | {r.doc_type or ''} | "
                    f"{r.summary or ''} | {posted}"
                )

            return {"success": True, "action": "查询凭证", "message": "\n".join(lines)}

        finally:
            fbl_db.close()

    except ImportError:
        return {"success": False, "action": "查询凭证",
                "message": "凭证管理模块未配置，请检查FBL数据库连接"}
    except Exception as e:
        logger.error(f"查询凭证失败: {e}", exc_info=True)
        return {"success": False, "message": f"查询凭证失败：{str(e)}", "action": "查询凭证"}


# ========== 费用报销 ==========

async def handle_expense(ai_response, db: Session) -> Dict[str, Any]:
    """提交费用报销"""
    try:
        category = getattr(ai_response, 'expense_category', None) or '其他'
        amount = getattr(ai_response, 'expense_amount', None)
        description = getattr(ai_response, 'expense_description', None)
        remark = getattr(ai_response, 'expense_remark', None) or ''

        if not amount or amount <= 0:
            return {"success": False, "action": "费用报销",
                    "message": "请提供费用金额，例如：`报销交通费200元`"}

        if not description:
            description = category

        now = china_now()
        expense_no = f"BX{now.strftime('%Y%m%d%H%M%S')}"

        message = f"""✅ **费用报销已提交**

📋 编号：{expense_no}
📂 类别：{category}
💰 金额：¥{amount:,.2f}
📝 说明：{description}
🕐 时间：{now.strftime('%Y-%m-%d %H:%M')}

⚠️ 费用报销功能正在完善中，当前已记录报销申请。
请前往「财务管理 → 费用报销」查看和审批。"""

        from ..services.behavior_logger import log_decision_background
        log_decision_background(
            action_type="expense",
            user_role="finance",
            operation_details={
                "expense_no": expense_no,
                "category": category,
                "amount": amount,
                "description": description,
            }
        )

        return {
            "success": True, "action": "费用报销", "message": message,
            "data": {
                "expense_no": expense_no,
                "category": category,
                "amount": amount,
            }
        }

    except Exception as e:
        logger.error(f"费用报销失败: {e}", exc_info=True)
        return {"success": False, "message": f"费用报销失败：{str(e)}", "action": "费用报销"}


async def handle_query_gold_records(ai_response, db: Session) -> Dict[str, Any]:
    """查询金料记录（收料/付料/提料的历史记录和统计）"""
    from ..models import GoldMaterialTransaction, CustomerWithdrawal, Customer

    try:
        record_type = getattr(ai_response, 'gold_record_type', '全部') or '全部'
        customer_name = getattr(ai_response, 'gold_record_customer_name', None)
        date_start = getattr(ai_response, 'gold_record_date_start', None)
        date_end = getattr(ai_response, 'gold_record_date_end', None)

        results = []

        if record_type in ('收料', '全部'):
            q = db.query(GoldMaterialTransaction).filter(
                GoldMaterialTransaction.transaction_type == 'income',
                GoldMaterialTransaction.status == 'active',
            )
            if customer_name:
                q = q.filter(GoldMaterialTransaction.customer_name.ilike(f'%{customer_name}%'))
            if date_start:
                q = q.filter(cast(GoldMaterialTransaction.created_at, Date) >= date_start)
            if date_end:
                q = q.filter(cast(GoldMaterialTransaction.created_at, Date) <= date_end)
            rows = q.order_by(GoldMaterialTransaction.created_at.desc()).limit(50).all()
            for r in rows:
                results.append({
                    "type": "收料",
                    "no": r.transaction_no,
                    "customer": r.customer_name or "-",
                    "weight": float(r.gold_weight or 0),
                    "time": r.created_at.strftime('%Y-%m-%d %H:%M') if r.created_at else "-",
                    "remark": r.remark or "",
                })

        if record_type in ('付料', '全部'):
            q = db.query(GoldMaterialTransaction).filter(
                GoldMaterialTransaction.transaction_type == 'expense',
                GoldMaterialTransaction.status == 'active',
            )
            if date_start:
                q = q.filter(cast(GoldMaterialTransaction.created_at, Date) >= date_start)
            if date_end:
                q = q.filter(cast(GoldMaterialTransaction.created_at, Date) <= date_end)
            rows = q.order_by(GoldMaterialTransaction.created_at.desc()).limit(50).all()
            for r in rows:
                results.append({
                    "type": "付料",
                    "no": r.transaction_no,
                    "customer": r.supplier_name or "-",
                    "weight": float(r.gold_weight or 0),
                    "time": r.created_at.strftime('%Y-%m-%d %H:%M') if r.created_at else "-",
                    "remark": r.remark or "",
                })

        if record_type in ('提料', '全部'):
            q = db.query(CustomerWithdrawal).filter(
                CustomerWithdrawal.status.in_(['pending', 'confirmed', 'completed']),
            )
            if customer_name:
                q = q.filter(CustomerWithdrawal.customer_name.ilike(f'%{customer_name}%'))
            if date_start:
                q = q.filter(cast(CustomerWithdrawal.created_at, Date) >= date_start)
            if date_end:
                q = q.filter(cast(CustomerWithdrawal.created_at, Date) <= date_end)
            rows = q.order_by(CustomerWithdrawal.created_at.desc()).limit(50).all()
            for r in rows:
                results.append({
                    "type": "提料",
                    "no": r.withdrawal_no,
                    "customer": r.customer_name,
                    "weight": float(r.gold_weight or 0),
                    "time": r.created_at.strftime('%Y-%m-%d %H:%M') if r.created_at else "-",
                    "remark": r.remark or "",
                })

        results.sort(key=lambda x: x["time"], reverse=True)

        if not results:
            date_hint = ""
            if date_start:
                date_hint = f"（{date_start}"
                if date_end and date_end != date_start:
                    date_hint += f" ~ {date_end}"
                date_hint += "）"
            return {
                "success": True, "action": "查询金料记录",
                "message": f"未找到{record_type}记录{date_hint}",
            }

        type_counts = {}
        type_weights = {}
        customer_set = set()
        for r in results:
            t = r["type"]
            type_counts[t] = type_counts.get(t, 0) + 1
            type_weights[t] = round(type_weights.get(t, 0) + r["weight"], 3)
            if r["customer"] and r["customer"] != "-":
                customer_set.add(r["customer"])

        summary_parts = []
        for t in ['收料', '付料', '提料']:
            if t in type_counts:
                summary_parts.append(f"{t} {type_counts[t]} 笔，共 {type_weights[t]:.2f}克")

        date_range = ""
        if date_start:
            date_range = f"📅 日期：{date_start}"
            if date_end and date_end != date_start:
                date_range += f" ~ {date_end}"
            date_range += "\n"

        detail_lines = []
        for r in results[:20]:
            detail_lines.append(
                f"  {r['type']} | {r['no']} | {r['customer']} | {r['weight']:.2f}克 | {r['time']}"
            )
        detail_text = "\n".join(detail_lines)

        message = f"""📊 **金料记录查询结果**

{date_range}🔢 共 {len(results)} 笔记录，涉及 {len(customer_set)} 位客户/供应商
📈 {' | '.join(summary_parts)}

**明细（最近 {min(len(results), 20)} 笔）：**
{detail_text}"""

        if len(results) > 20:
            message += f"\n\n⚠️ 仅显示最近 20 笔，共 {len(results)} 笔。如需查看更多，请缩小日期范围或指定客户名。"

        return {
            "success": True, "action": "查询金料记录",
            "message": message,
            "data": {
                "total": len(results),
                "summary": {t: {"count": type_counts[t], "weight": type_weights[t]} for t in type_counts},
                "records": results[:20],
            }
        }

    except Exception as e:
        logger.error(f"查询金料记录失败: {e}", exc_info=True)
        return {"success": False, "message": f"查询金料记录失败：{str(e)}", "action": "查询金料记录"}
