"""
Chat/AI对话路由模块
包含 /api/chat 和 /api/chat-stream 端点
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timezone, timedelta
import logging
import json
import asyncio
import re
from typing import Dict, Any, List, Optional

from ..database import get_db
from ..schemas import AIRequest
from ..models import (
    InboundOrder, InboundDetail, Inventory, Customer, SalesOrder, SalesDetail,
    Supplier, ChatLog, Location, LocationInventory, InventoryTransferOrder
)
from ..ai_parser import parse_user_message
from .. import context_manager as ctx

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)


def log_chat_message(
    db: Session,
    session_id: str,
    user_role: str,
    message_type: str,
    content: str,
    intent: str = None,
    entities: dict = None,
    response_time_ms: int = None,
    is_successful: bool = True,
    error_message: str = None,
    user_id: str = None
):
    """记录对话日志到数据库"""
    try:
        chat_log = ChatLog(
            session_id=session_id or f"session_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            user_id=user_id,
            user_role=user_role or "sales",
            message_type=message_type,
            content=content[:10000] if content else "",
            intent=intent,
            entities=json.dumps(entities, ensure_ascii=False) if entities else None,
            response_time_ms=response_time_ms,
            is_successful=1 if is_successful else 0,
            error_message=error_message
        )
        db.add(chat_log)
        db.commit()
        logger.info(f"[对话日志] 已记录: role={user_role}, type={message_type}, intent={intent}")
    except Exception as e:
        logger.error(f"[对话日志] 记录失败: {e}")
        db.rollback()


# ========== 业务处理函数（从main.py移入）==========

async def handle_inbound(ai_response, db: Session) -> Dict[str, Any]:
    """处理入库操作"""
    from .inbound import handle_inbound as _handle_inbound
    return await _handle_inbound(ai_response, db)


async def handle_create_customer(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建客户"""
    try:
        customer_name = ai_response.customer_name
        if not customer_name:
            return {"success": False, "message": "请提供客户名称"}
        
        existing = db.query(Customer).filter(Customer.name == customer_name).first()
        if existing:
            return {"success": False, "message": f"客户【{customer_name}】已存在"}
        
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
            "message": f"客户【{customer_name}】创建成功",
            "customer_id": customer.id
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建客户失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建客户失败: {str(e)}"}


async def handle_create_supplier(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建供应商"""
    try:
        supplier_name = ai_response.supplier_name or ai_response.supplier
        if not supplier_name:
            return {"success": False, "message": "请提供供应商名称"}
        
        existing = db.query(Supplier).filter(Supplier.name == supplier_name).first()
        if existing:
            return {"success": False, "message": f"供应商【{supplier_name}】已存在"}
        
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
            "message": f"供应商【{supplier_name}】创建成功",
            "supplier_id": supplier.id
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建供应商失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建供应商失败: {str(e)}"}


async def handle_create_sales_order(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建销售单"""
    return {"success": False, "message": "请使用销售模块创建销售单"}


async def handle_create_transfer(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建转移单"""
    return {"success": False, "message": "请使用仓库模块创建转移单"}


async def handle_return(ai_response, db: Session, user_role: str) -> Dict[str, Any]:
    """处理退货"""
    return {"success": False, "message": "请使用退货模块处理退货"}


async def handle_payment_registration(ai_response, db: Session) -> Dict[str, Any]:
    """处理登记收款"""
    return {"success": False, "message": "请使用财务模块登记收款", "need_confirm": True}


async def handle_gold_receipt(ai_response, db: Session) -> Dict[str, Any]:
    """处理收料 - 自动创建收料单"""
    from ..models import Customer, GoldReceipt, CustomerGoldTransaction
    from ..utils import china_now
    
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
    
    # 通过客户名查找客户
    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        # 尝试模糊匹配
        customer = db.query(Customer).filter(Customer.name.contains(customer_name)).first()
    
    if not customer:
        return {"success": False, "message": f"未找到客户「{customer_name}」，请先在客户管理中创建该客户", "action": "收料"}
    
    try:
        # 生成收料单号 SL + 时间戳
        now = china_now()
        receipt_no = f"SL{now.strftime('%Y%m%d%H%M%S')}"
        
        # 创建收料单
        receipt = GoldReceipt(
            receipt_no=receipt_no,
            customer_id=customer.id,
            gold_weight=gold_weight,
            gold_fineness=gold_fineness,
            status="pending",  # 待接收状态
            remark=remark or f"AI对话收料",
            created_by="AI助手"
        )
        db.add(receipt)
        db.flush()  # 获取ID
        
        # 直接确认接收（更新客户存料余额）
        receipt.status = "received"
        receipt.received_by = "AI助手"
        receipt.received_at = now
        
        # 更新客户金料账户（单一账户模式：current_balance）
        customer.current_balance = (customer.current_balance or 0) + gold_weight
        
        # 记录金料交易流水
        transaction = CustomerGoldTransaction(
            customer_id=customer.id,
            transaction_type="deposit",  # 存料
            gold_weight=gold_weight,
            gold_fineness=gold_fineness,
            balance_after=customer.current_balance,
            reference_type="gold_receipt",
            reference_id=receipt.id,
            remark=f"收料单{receipt_no}",
            created_by="AI助手"
        )
        db.add(transaction)
        
        db.commit()
        
        # 返回成功消息（包含隐藏标记供前端解析打印按钮）
        message = f"""✅ **收料单已创建**

📋 单号：{receipt_no}
👤 客户：{customer.name}
⚖️ 克重：{gold_weight:.2f}克
🏷️ 成色：{gold_fineness}
💎 当前存料余额：{customer.current_balance:.2f}克
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}

<!-- GOLD_RECEIPT:{receipt.id}:{receipt_no} -->"""
        
        return {
            "success": True,
            "action": "收料",
            "message": message,
            "data": {
                "receipt_id": receipt.id,
                "receipt_no": receipt_no,
                "customer_name": customer.name,
                "gold_weight": gold_weight,
                "gold_fineness": gold_fineness,
                "current_balance": customer.current_balance
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"创建收料单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建收料单失败：{str(e)}", "action": "收料"}


async def handle_gold_payment(ai_response, db: Session, user_role: str) -> Dict[str, Any]:
    """处理付料"""
    return {"success": False, "message": "请使用金料模块处理付料", "need_confirm": True}


async def handle_gold_withdrawal(ai_response, db: Session) -> Dict[str, Any]:
    """处理提料"""
    return {"success": False, "message": "请使用金料模块处理提料", "need_confirm": True}


async def handle_supplier_cash_payment(ai_response, db: Session) -> Dict[str, Any]:
    """处理供应商付款"""
    return {"success": False, "message": "请使用财务模块处理供应商付款", "need_confirm": True}


async def handle_batch_transfer(ai_response, db: Session) -> Dict[str, Any]:
    """处理批量转移"""
    return {"success": False, "message": "请使用仓库模块处理批量转移", "need_confirm": True}


# ========== API端点 ==========

@router.post("/api/chat")
async def chat(request: AIRequest, db: Session = Depends(get_db)):
    """处理用户聊天消息 - AI驱动架构"""
    try:
        logger.info(f"收到用户消息: {request.message}")
        
        # 使用AI解析用户消息
        ai_response = parse_user_message(request.message)
        logger.info(f"AI解析结果: action={ai_response.action}, products={ai_response.products}")
        
        # 业务员角色限制
        user_role = request.user_role or 'sales'
        if user_role == 'sales':
            forbidden_actions = ["入库", "创建客户", "创建供应商", "创建销售单", "创建转移单", "退货"]
            if ai_response.action in forbidden_actions:
                return {
                    "success": False,
                    "message": "⚠️ 您是业务员角色，只能查询客户相关信息。\n\n如需执行入库、开单等操作，请联系相应岗位人员。"
                }
        
        # 权限检查
        from ..middleware.permissions import check_action_permission
        
        if ai_response.action == "入库":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_inbound(ai_response, db)
        elif ai_response.action == "创建客户":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_customer(ai_response, db)
        elif ai_response.action == "创建供应商":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_supplier(ai_response, db)
        elif ai_response.action == "创建销售单":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_sales_order(ai_response, db)
        elif ai_response.action == "创建转移单":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_transfer(ai_response, db)
        elif ai_response.action == "退货":
            return await handle_return(ai_response, db, request.user_role or 'product')
        elif ai_response.action in ["闲聊", "其他"]:
            # 闲聊处理
            hour = datetime.now().hour
            if hour < 9:
                time_greeting = "早上好！"
            elif hour < 12:
                time_greeting = "上午好！"
            elif hour < 14:
                time_greeting = "中午好！"
            elif hour < 18:
                time_greeting = "下午好！"
            else:
                time_greeting = "晚上好！"
            
            user_msg_lower = request.message.lower().strip()
            
            if any(word in user_msg_lower for word in ["你好", "hi", "hello", "嗨", "hey"]):
                chat_response = f"{time_greeting}我是珠宝ERP智能助手，有什么可以帮您的吗？"
            elif any(word in user_msg_lower for word in ["谢谢", "感谢", "thanks"]):
                chat_response = "不客气！有其他需要随时告诉我"
            else:
                chat_response = f"我是珠宝ERP助手，可以帮您：\n\n📦 入库管理\n📊 库存查询\n🧾 销售开单\n💰 财务管理\n\n请告诉我具体需要什么帮助？"
            
            return {
                "success": True,
                "action": "闲聊",
                "message": chat_response
            }
        
        # 查询和分析操作
        else:
            from ..ai_analyzer import ai_analyzer
            
            data = ai_analyzer.collect_all_data(
                ai_response.action,
                request.message,
                db,
                order_no=ai_response.order_no,
                sales_order_no=ai_response.sales_order_no,
                user_role=user_role,
                inbound_supplier=ai_response.inbound_supplier,
                inbound_product=ai_response.inbound_product,
                inbound_date_start=ai_response.inbound_date_start,
                inbound_date_end=ai_response.inbound_date_end,
                transfer_order_no=ai_response.transfer_order_no,
                transfer_status=ai_response.transfer_status,
                transfer_date_start=ai_response.transfer_date_start,
                transfer_date_end=ai_response.transfer_date_end
            )
            
            analysis_result = ai_analyzer.analyze(
                request.message,
                ai_response.action,
                data
            )
            
            # 图表数据
            chart_keywords = ["图表", "chart", "可视化", "饼图", "柱状图", "折线图"]
            auto_chart_actions = ["供应商分析", "查询库存", "库存分析", "销售分析", "查询入库单", "统计分析"]
            needs_chart = (
                ai_response.action == "生成图表" or 
                ai_response.action in auto_chart_actions or
                any(keyword in request.message for keyword in chart_keywords)
            )
            
            chart_data_result = {}
            if needs_chart:
                chart_data_result = ai_analyzer.generate_chart_data(ai_response.action, data)
            
            return {
                "success": True,
                "message": analysis_result,
                "raw_data": data,
                "action": ai_response.action,
                "chart_data": chart_data_result.get('chart_data'),
                "pie_data": chart_data_result.get('pie_data')
            }
    
    except Exception as e:
        logger.error(f"处理消息时出错: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理消息时出错: {str(e)}"
        }


@router.options("/api/chat-stream")
async def chat_stream_options():
    """处理CORS预检请求"""
    logger.info("[流式] 收到OPTIONS预检请求")
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
    )


@router.post("/api/chat-stream")
async def chat_stream(request: AIRequest, db: Session = Depends(get_db)):
    """流式响应聊天接口 - 显示思考过程和内容逐字生成"""
    
    logger.info(f"[流式] 收到请求: {request.message}, 角色: {request.user_role}")
    
    start_time = datetime.now()
    session_id = request.session_id or f"session_{start_time.strftime('%Y%m%d%H%M%S%f')}"
    
    log_chat_message(
        db=db,
        session_id=session_id,
        user_role=request.user_role,
        message_type="user",
        content=request.message
    )
    
    # 加载会话上下文
    session_context = ctx.load_session_context(session_id)
    context_summary = ctx.generate_context_summary(session_id)
    knowledge_base = ctx.load_knowledge_base()
    
    # 查询对话历史
    conversation_history = []
    try:
        recent_logs = db.query(ChatLog).filter(
            ChatLog.user_role == request.user_role
        ).order_by(desc(ChatLog.created_at)).limit(10).all()
        
        for log in reversed(recent_logs):
            if log.content:
                conversation_history.append({
                    "role": "user" if log.message_type == "user" else "assistant",
                    "content": log.content
                })
    except Exception as e:
        logger.warning(f"[流式] 加载对话历史失败: {e}")
    
    async def generate():
        try:
            logger.info("[流式] 开始生成响应")
            user_role = request.user_role or 'sales'
            user_msg = request.message.strip()
            
            # 初始填充
            initial_padding = ": " + "." * 2048 + "\n\n"
            yield initial_padding
            
            # 从上下文提取实体
            ctx_entities = session_context.get("entities", {})
            last_customer = ctx_entities.get("last_customer")
            last_product = ctx_entities.get("last_product")
            
            fast_result = None
            
            # 快速路径：客户存料查询
            deposit_match = re.search(r'^(.+?)(有|的)?(存料|余额|金料余额)(吗|多少)?[？?]?$', user_msg)
            if deposit_match:
                customer_name = deposit_match.group(1).strip()
                logger.info(f"[快速路径] 检测到存料查询: {customer_name}")
                yield f"data: {json.dumps({'type': 'thinking', 'step': '快速查询', 'message': f'正在查询 {customer_name} 的存料信息...', 'progress': 30}, ensure_ascii=False)}\n\n"
                
                from ..models import SettlementOrder
                from ..models.finance import GoldReceipt
                
                customer = db.query(Customer).filter(Customer.name == customer_name).first()
                if not customer:
                    candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
                    if candidates:
                        customer = min(candidates, key=lambda c: abs(len(c.name) - len(customer_name)))
                
                if customer:
                    total_settlement_gold = 0.0
                    settlements = db.query(SettlementOrder).join(SalesOrder).filter(
                        SalesOrder.customer_id == customer.id,
                        SettlementOrder.status.in_(['confirmed', 'printed'])
                    ).all()
                    for s in settlements:
                        if s.payment_method == 'physical_gold':
                            total_settlement_gold += s.physical_gold_weight or 0
                        elif s.payment_method == 'mixed':
                            total_settlement_gold += s.gold_payment_weight or 0
                    
                    total_receipts_gold = db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
                        GoldReceipt.customer_id == customer.id,
                        GoldReceipt.status == 'received'
                    ).scalar() or 0
                    
                    net_gold = float(total_receipts_gold) - total_settlement_gold
                    
                    if net_gold > 0:
                        msg = f"**{customer.name}** 当前存料余额：**{net_gold:.2f}克**"
                    elif net_gold < 0:
                        msg = f"**{customer.name}** 当前欠料：**{abs(net_gold):.2f}克**"
                    else:
                        msg = f"**{customer.name}** 金料已结清（余额：0克）"
                    fast_result = {"success": True, "action": "查询客户存料", "message": msg}
                    ctx.update_entities(session_id, {"last_customer": customer.name})
                else:
                    fast_result = {"success": False, "message": f"未找到名为 **{customer_name}** 的客户"}
            
            # 快速路径：整体库存查询
            overall_inventory_match = re.search(r'^(当前|目前|现在)?(的)?库存(是|有)?(多少|几何)?[？?]?$', user_msg)
            if not fast_result and overall_inventory_match:
                if user_role in ['sales']:
                    fast_result = {"success": False, "message": "⚠️ 您的角色无权查看库存信息，请联系商品专员或管理层。"}
                else:
                    yield f"data: {json.dumps({'type': 'thinking', 'step': '快速查询', 'message': '正在查询库存汇总...', 'progress': 30}, ensure_ascii=False)}\n\n"
                    
                    if user_role == 'product':
                        location_code = 'warehouse'
                        location_display = '商品部仓库'
                    elif user_role in ['counter', 'settlement']:
                        location_code = 'showroom'
                        location_display = '展厅'
                    else:
                        location_code = None
                        location_display = '总'
                    
                    if location_code:
                        location = db.query(Location).filter(Location.code == location_code).first()
                        if location:
                            location_inventories = db.query(LocationInventory).filter(
                                LocationInventory.location_id == location.id,
                                LocationInventory.weight > 0
                            ).order_by(LocationInventory.weight.desc()).all()
                            
                            total_weight = sum(li.weight for li in location_inventories)
                            product_count = len(location_inventories)
                            
                            msg = f"{location_display}当前库存：**{total_weight:.2f}克**，共 **{product_count}** 种商品\n\n"
                            if location_inventories:
                                msg += "主要商品：\n"
                                for li in location_inventories[:5]:
                                    msg += f"* {li.product_name}：{li.weight:.2f}克\n"
                            
                            fast_result = {"success": True, "action": "查询库存", "message": msg.strip()}
                    else:
                        inventories = db.query(Inventory).filter(Inventory.total_weight > 0).order_by(Inventory.total_weight.desc()).all()
                        total_weight = sum(inv.total_weight for inv in inventories)
                        product_count = len(inventories)
                        
                        msg = f"当前{location_display}库存：**{total_weight:.2f}克**，共 **{product_count}** 种商品\n\n"
                        if inventories:
                            msg += "主要商品：\n"
                            for inv in inventories[:5]:
                                msg += f"* {inv.product_name}：{inv.total_weight:.2f}克\n"
                        
                        fast_result = {"success": True, "action": "查询库存", "message": msg.strip()}
            
            # 如果匹配到快速路径，直接返回
            if fast_result:
                yield f"data: {json.dumps({'type': 'thinking', 'step': '快速查询', 'message': '查询完成', 'progress': 100, 'status': 'complete'}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'complete', 'data': fast_result}, ensure_ascii=False)}\n\n"
                
                end_time = datetime.now()
                response_time_ms = int((end_time - start_time).total_seconds() * 1000)
                log_chat_message(
                    db=db,
                    session_id=session_id,
                    user_role=request.user_role,
                    message_type="assistant",
                    content=fast_result.get("message", ""),
                    intent=fast_result.get("action", "快速查询"),
                    response_time_ms=response_time_ms,
                    is_successful=fast_result.get("success", True)
                )
                return
            
            # 意图解析
            yield f"data: {json.dumps({'type': 'thinking', 'step': '意图解析', 'message': '正在理解您的问题...', 'progress': 10}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            enhanced_message = request.message
            if context_summary or knowledge_base:
                context_parts = []
                if knowledge_base:
                    context_parts.append(f"【业务规则参考】\n{knowledge_base[:1000]}...")
                if context_summary:
                    context_parts.append(f"【会话上下文】\n{context_summary}")
                context_parts.append(f"【用户请求】\n{request.message}")
                enhanced_message = "\n\n".join(context_parts)
            
            ai_response = parse_user_message(enhanced_message, conversation_history)
            logger.info(f"[流式] 识别到意图: {ai_response.action}")
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '意图解析', 'message': f'已识别意图：{ai_response.action}', 'progress': 20, 'status': 'complete'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 业务员角色限制
            if user_role == 'sales':
                forbidden_actions = ["入库", "创建客户", "创建供应商", "创建销售单", "创建转移单", "退货"]
                if ai_response.action in forbidden_actions:
                    error_msg = "⚠️ 您是业务员角色，只能查询客户相关信息。\n\n如需执行入库、开单等操作，请联系相应岗位人员。"
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': error_msg}}, ensure_ascii=False)}\n\n"
                    return
            
            # 闲聊处理
            if ai_response.action in ["闲聊", "其他"]:
                hour = datetime.now().hour
                if hour < 9:
                    time_greeting = "早上好！"
                elif hour < 12:
                    time_greeting = "上午好！"
                elif hour < 14:
                    time_greeting = "中午好！"
                elif hour < 18:
                    time_greeting = "下午好！"
                else:
                    time_greeting = "晚上好！"
                
                chat_response = f"{time_greeting}我是珠宝ERP助手，可以帮您：\n\n📦 入库管理\n📊 库存查询\n🧾 销售开单\n💰 财务管理\n\n请告诉我具体需要什么帮助？"
                
                result = {"success": True, "action": "闲聊", "message": chat_response}
                yield f"data: {json.dumps({'type': 'complete', 'data': result}, ensure_ascii=False)}\n\n"
                return
            
            # 写操作处理
            if ai_response.action in ["入库", "创建客户", "创建供应商", "创建销售单", "创建转移单", "退货", "登记收款", "查询客户账务", "收料"]:
                from ..middleware.permissions import check_action_permission
                
                has_perm, perm_error = check_action_permission(user_role, ai_response.action)
                
                if not has_perm:
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': perm_error}}, ensure_ascii=False)}\n\n"
                    return
                
                yield f"data: {json.dumps({'type': 'thinking', 'step': '执行操作', 'message': f'正在执行{ai_response.action}操作...', 'progress': 30}, ensure_ascii=False)}\n\n"
                
                try:
                    result = None
                    if ai_response.action == "入库":
                        result = await handle_inbound(ai_response, db)
                    elif ai_response.action == "创建客户":
                        result = await handle_create_customer(ai_response, db)
                    elif ai_response.action == "创建供应商":
                        result = await handle_create_supplier(ai_response, db)
                    elif ai_response.action == "创建销售单":
                        result = await handle_create_sales_order(ai_response, db)
                    elif ai_response.action == "创建转移单":
                        result = await handle_create_transfer(ai_response, db)
                    elif ai_response.action == "退货":
                        result = await handle_return(ai_response, db, user_role)
                    elif ai_response.action == "收料":
                        # 自动创建收料单
                        result = await handle_gold_receipt(ai_response, db)
                    elif ai_response.action == "登记收款":
                        result = await handle_payment_registration(ai_response, db)
                    elif ai_response.action == "查询客户账务":
                        # 让查询客户账务继续走AI分析流程
                        pass
                    
                    if result is not None:
                        yield f"data: {json.dumps({'type': 'complete', 'data': result}, ensure_ascii=False, default=str)}\n\n"
                        return
                except Exception as op_error:
                    logger.error(f"[流式] 执行{ai_response.action}操作时出错: {op_error}", exc_info=True)
                    yield f"data: {json.dumps({'type': 'error', 'message': f'执行{ai_response.action}操作失败: {str(op_error)}'}, ensure_ascii=False)}\n\n"
                    return
            
            # 数据收集和AI分析
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在从数据库收集相关数据...', 'progress': 30}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            from ..ai_analyzer import ai_analyzer
            
            # 收集数据
            data = ai_analyzer.collect_all_data(
                ai_response.action,
                request.message,
                db,
                order_no=getattr(ai_response, 'order_no', None),
                sales_order_no=getattr(ai_response, 'sales_order_no', None),
                user_role=user_role
            )
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '已加载数据', 'progress': 70, 'status': 'complete'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # AI流式分析
            yield f"data: {json.dumps({'type': 'thinking', 'step': 'AI分析', 'message': '正在使用AI进行智能分析...', 'progress': 75}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'content_start'})}\n\n"
            
            full_response = ""
            import time
            stream_start_time = time.time()
            MAX_ANALYSIS_TIME = 60
            
            try:
                language = getattr(request, 'language', 'zh') or 'zh'
                
                for text_chunk in ai_analyzer.analyze_stream(
                    request.message,
                    ai_response.action,
                    data,
                    language=language
                ):
                    if time.time() - stream_start_time > MAX_ANALYSIS_TIME:
                        timeout_msg = "\n\n[分析超时] AI分析时间过长，已自动中断。"
                        full_response += timeout_msg
                        yield f"data: {json.dumps({'type': 'content', 'chunk': timeout_msg}, ensure_ascii=False)}\n\n"
                        break
                    
                    full_response += text_chunk
                    yield f"data: {json.dumps({'type': 'content', 'chunk': text_chunk}, ensure_ascii=False)}\n\n"
                    
            except Exception as e:
                logger.error(f"流式AI分析失败: {e}", exc_info=True)
                error_msg = f"AI分析过程中出现错误：{str(e)}。请稍后重试。"
                yield f"data: {json.dumps({'type': 'content', 'chunk': error_msg}, ensure_ascii=False)}\n\n"
                full_response = error_msg
            
            # 图表数据
            chart_keywords = ["图表", "chart", "可视化", "饼图", "柱状图", "折线图"]
            auto_chart_actions = ["供应商分析", "查询库存", "库存分析", "销售分析", "查询入库单", "统计分析"]
            needs_chart = (
                ai_response.action == "生成图表" or 
                ai_response.action in auto_chart_actions or
                any(keyword in request.message for keyword in chart_keywords)
            )
            
            chart_data_result = {}
            if needs_chart:
                chart_data_result = ai_analyzer.generate_chart_data(ai_response.action, data)
            
            # 完成
            yield f"data: {json.dumps({'type': 'complete', 'data': {'success': True, 'message': full_response, 'raw_data': data, 'action': ai_response.action, 'chart_data': chart_data_result.get('chart_data'), 'pie_data': chart_data_result.get('pie_data')}, 'progress': 100}, ensure_ascii=False)}\n\n"
            
            end_time = datetime.now()
            response_time_ms = int((end_time - start_time).total_seconds() * 1000)
            log_chat_message(
                db=db,
                session_id=session_id,
                user_role=request.user_role,
                message_type="assistant",
                content=full_response[:5000] if full_response else "",
                intent=ai_response.action,
                response_time_ms=response_time_ms,
                is_successful=True
            )
            
        except Exception as e:
            logger.error(f"流式处理出错: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': f'处理出错：{str(e)}'}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        generate(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    )
