"""
Chat/AI对话路由模块
包含 /api/chat 和 /api/chat-stream 端点

业务处理函数 -> chat_handlers.py
辅助函数和常量 -> chat_helpers.py
"""
from fastapi import APIRouter, Depends, Query, Request
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
from ..timezone_utils import china_now
from ..utils.response import sanitize_floats

# 从拆分模块导入
from .chat_helpers import (
    _build_clarification, _should_clarify, log_chat_message,
    _get_time_greeting, _build_chat_response,
    _dispatch_write_action, _collect_debt_payload,
    _check_order_exists, _should_generate_chart,
    WRITE_ACTIONS, SALES_FORBIDDEN_ACTIONS
)
from .chat_handlers import (
    handle_inbound, handle_create_customer, handle_create_supplier,
    handle_create_sales_order, handle_create_transfer, handle_return,
    handle_sales_return, handle_confirm_order, handle_unconfirm_order,
    handle_payment_registration, handle_gold_receipt, handle_gold_payment,
    handle_gold_withdrawal, handle_supplier_cash_payment, handle_batch_transfer,
    handle_deposit_settlement,
    handle_create_settlement, handle_query_settlement,
    handle_create_loan, handle_loan_return, handle_query_loan,
    handle_reconciliation, handle_query_voucher, handle_expense,
)
from .action_card import create_action_card

logger = logging.getLogger(__name__)

# ========== @角色 协同卡片检测 ==========
ROLE_MENTION_PATTERN = re.compile(r'@(财务|结算|商品部|柜台|业务员|金料|料部|经理)')
ROLE_NAME_TO_ID = {
    '财务': 'finance',
    '结算': 'settlement',
    '商品部': 'product',
    '柜台': 'counter',
    '业务员': 'sales',
    '金料': 'material',
    '料部': 'material',
    '经理': 'manager',
}

def _detect_role_mentions(message: str) -> list:
    """从消息中提取 @角色 提及，返回去重后的角色 ID 列表"""
    matches = ROLE_MENTION_PATTERN.findall(message)
    seen = set()
    result = []
    for name in matches:
        role_id = ROLE_NAME_TO_ID.get(name)
        if role_id and role_id not in seen:
            seen.add(role_id)
            result.append(role_id)
    return result


    # 已移除 _parse_payment_amounts / _extract_customer_name 正则 fallback
    # 协同解析完全依赖 DeepSeek AI，AI 失败时直接提示用户重试，不再用正则猜测


async def _ai_parse_collaboration_message(message: str) -> dict:
    """用 DeepSeek AI 从自然语言中提取跨角色协同任务的结构化信息（支持收款/结算/提料）"""
    from ..ai_parser import get_client

    def _sync_call():
        prompt = (
            "你是珠宝ERP系统的AI助手。用户发送了一条包含 @角色 的跨角色协同消息。\n"
            "请从消息中提取以下信息，返回 JSON：\n\n"
            "{\n"
            '  "customer_name": "客户姓名（如李老板、林煌、张总等，只要名字）",\n'
            '  "total_amount": 总金额（数字，单位元，如5万则填50000，非付款场景填0）,\n'
            '  "gold_amount": 金料/金款金额（数字，单位元，没有则填0）,\n'
            '  "labor_amount": 工费/加工费金额（数字，单位元，没有则填0）,\n'
            '  "gold_weight": 金料克重（数字，单位克，结算或提料场景，没有则填0）,\n'
            '  "payment_method": "结算方式（结料/结价/混合，仅结算场景，其他填空字符串）",\n'
            '  "gold_price": 金价（数字，单位元每克，结价时填写，没有则填0）,\n'
            '  "intent": "payment_confirm / settlement_confirm / withdrawal_confirm / other"\n'
            "}\n\n"
            "规则：\n"
            "- 如果用户说「都是工费」或「全部是工费」，则 labor_amount = total_amount，gold_amount = 0\n"
            "- 如果用户说「都是金款」或「全部是料款」，则 gold_amount = total_amount，labor_amount = 0\n"
            "- 「X万」表示 X*10000 元，「X千」表示 X*1000 元\n"
            "- 「还款」「打款」「付款」「转账」都属于 payment_confirm 意图\n"
            "- 「结算」「结料」「结价」属于 settlement_confirm 意图\n"
            "- 「提料」「取料」「客户要提」属于 withdrawal_confirm 意图\n"
            "- 如果消息明确包含金额和客户，intent 为 payment_confirm\n"
            "- 如果消息提到结算+客户，intent 为 settlement_confirm\n"
            "- 如果消息提到提料+客户+克重，intent 为 withdrawal_confirm\n"
            "- 如果无法确定，对应字段填 0 或空字符串\n\n"
            f"用户消息：{message}"
        )
        client = get_client()
        response = client.chat.completions.create(
            model="deepseek-chat",
            max_tokens=400,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "你是一个JSON提取助手，只输出合法JSON。"},
                {"role": "user", "content": prompt}
            ]
        )
        return response.choices[0].message.content.strip()

    try:
        content = await asyncio.wait_for(
            asyncio.to_thread(_sync_call),
            timeout=15
        )
        parsed = json.loads(content)
        result = {
            "customer_name": str(parsed.get("customer_name", "")).strip(),
            "total_amount": float(parsed.get("total_amount", 0)),
            "gold_amount": float(parsed.get("gold_amount", 0)),
            "labor_amount": float(parsed.get("labor_amount", 0)),
            "gold_weight": float(parsed.get("gold_weight", 0)),
            "payment_method": str(parsed.get("payment_method", "")).strip(),
            "gold_price": float(parsed.get("gold_price", 0)),
            "intent": str(parsed.get("intent", "other")),
        }
        if result["total_amount"] == 0 and (result["gold_amount"] > 0 or result["labor_amount"] > 0):
            result["total_amount"] = result["gold_amount"] + result["labor_amount"]
        logger.info(f"[协同AI解析] 结果: {result}")
        return result
    except asyncio.TimeoutError:
        logger.warning("[协同AI解析] 超时（15s）")
        return None
    except Exception as e:
        logger.warning(f"[协同AI解析] 失败: {e}")
        return None

async def _ocr_verify_payment_amount(image_data_url: str) -> float | None:
    """从 base64 data URL 解码图片 → 百度 OCR → DeepSeek 提取金额，返回 float 或 None"""
    import base64
    from ..baidu_ocr import parse_payment_proof, is_ocr_configured

    if not is_ocr_configured():
        return None

    try:
        header, b64data = image_data_url.split(",", 1)
        image_bytes = base64.b64decode(b64data)
    except (ValueError, Exception):
        logger.warning("[OCR验证] base64 解码失败")
        return None

    result = await asyncio.to_thread(parse_payment_proof, image_bytes=image_bytes)
    if not result.get("success"):
        return None

    parsed = result.get("parsed_data")
    if not parsed:
        return None

    raw_amount = parsed.get("amount")
    if raw_amount is None:
        return None
    try:
        return float(raw_amount)
    except (ValueError, TypeError):
        return None


def _build_card_message(customer_name: str, amounts: dict, target_display: str) -> str:
    lines = [
        "📋 已发起跨角色收款确认\n",
        f"**客户**: {customer_name}",
        f"**总金额**: ¥{amounts['total_amount']:,.0f}",
    ]
    if amounts['gold_amount'] > 0:
        lines.append(f"**金款**: ¥{amounts['gold_amount']:,.0f}")
    if amounts['labor_amount'] > 0:
        lines.append(f"**工费**: ¥{amounts['labor_amount']:,.0f}")
    lines.append(f"**目标角色**: {target_display}\n")
    lines.append(f"等待 {target_display} 确认后自动入账。")
    return "\n".join(lines)

from slowapi import Limiter
from slowapi.util import get_remote_address

_limiter = Limiter(key_func=get_remote_address)

router = APIRouter(tags=["chat"])


# ========== API端点 ==========

@router.post("/api/chat")
@_limiter.limit("10/minute")
async def chat(request: Request, ai_req: AIRequest, db: Session = Depends(get_db)):
    """处理用户聊天消息 - AI驱动架构"""
    try:
        logger.info(f"收到用户消息: {ai_req.message}")
        user_role = ai_req.user_role or 'sales'
        
        ai_response = parse_user_message(ai_req.message, user_role=ai_req.user_role or 'manager')
        logger.info(f"AI解析结果: action={ai_response.action}, products={ai_response.products}")
        
        # 业务员角色限制
        if user_role == 'sales' and ai_response.action in SALES_FORBIDDEN_ACTIONS:
            return {"success": False, "message": "⚠️ 您是业务员角色，只能查询客户相关信息。\n\n如需执行入库、开单等操作，请联系相应岗位人员。"}
        
        # 权限检查 + 写操作分发
        from ..middleware.permissions import check_action_permission
        
        if ai_response.action in WRITE_ACTIONS and ai_response.action != "查询客户账务":
            has_perm, perm_error = check_action_permission(user_role, ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            
            result = await _dispatch_write_action(ai_response, db, user_role)
            if result is not None:
                _session_id = getattr(ai_req, 'session_id', None) or 'default'
                if result.get("success"):
                    _data = result.get("data", {})
                    if isinstance(_data, dict):
                        ctx.append_action(_session_id, ai_response.action,
                                        result.get("message", "")[:200],
                                        success=True, data=_data)
                else:
                    ctx.append_action(_session_id, ai_response.action,
                                    result.get("message", "操作失败")[:200],
                                    success=False)
                return result
        
        # 反问确认
        if _should_clarify(ai_req.message, ai_response.action):
            clarify_msg = _build_clarification(ai_req.message)
            return {"success": True, "action": "反问确认", "message": clarify_msg}
        
        # 闲聊处理
        if ai_response.action in ["闲聊", "其他"]:
            return {"success": True, "action": "闲聊", "message": _build_chat_response(ai_req.message)}
        
        # ── 新路径：AI 驱动查询引擎 ──
        from ..query_engine import is_query_intent, generate_query_plan, execute_query_plan, format_query_result, summarize_result

        if is_query_intent(ai_response.action):
            plan = generate_query_plan(ai_req.message)
            if plan:
                result = execute_query_plan(plan, db)
                result_text = format_query_result(plan, result)
                analysis_result = summarize_result(ai_req.message, result_text)
                return {"success": True, "message": analysis_result, "action": ai_response.action}

        # ── 旧路径 fallback ──
        from ..ai_analyzer import ai_analyzer
        
        customer_debt_payload = await _collect_debt_payload(ai_response, db)
        
        order_error = _check_order_exists(ai_response, db)
        if order_error:
            return order_error
        
        data = ai_analyzer.collect_all_data(
            ai_response.action, ai_req.message, db,
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
            transfer_date_end=ai_response.transfer_date_end,
            customer_name=getattr(ai_response, 'customer_name', None)
        )

        _cust_name_filter = getattr(ai_response, 'customer_name', None)
        if _cust_name_filter and not data.get("customers"):
            return {"success": True, "message": f"查不到客户「{_cust_name_filter}」的信息，请确认客户名称是否正确。"}

        if customer_debt_payload is not None:
            data["customer_debt"] = customer_debt_payload
        
        knowledge_base = ctx.load_knowledge_base()
        analysis_result = ai_analyzer.analyze(ai_req.message, ai_response.action, data, knowledge_base=knowledge_base)
        
        chart_data_result = {}
        if _should_generate_chart(ai_response, ai_req.message):
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
        return {"success": False, "message": f"处理消息时出错: {str(e)}"}



@router.post("/api/chat-stream")
@_limiter.limit("10/minute")
async def chat_stream(request: Request, ai_req: AIRequest, db: Session = Depends(get_db)):
    """流式响应聊天接口 - 显示思考过程和内容逐字生成"""
    
    logger.info(f"[流式] 收到请求: {ai_req.message}, 角色: {ai_req.user_role}")
    
    start_time = datetime.now()
    session_id = ai_req.session_id or f"session_{start_time.strftime('%Y%m%d%H%M%S%f')}"
    
    log_chat_message(
        db=db,
        session_id=session_id,
        user_role=ai_req.user_role,
        message_type="user",
        content=ai_req.message
    )
    
    # 定期清理过期上下文文件
    ctx.cleanup_old_context_files()
    
    # 加载会话上下文
    session_context = ctx.load_session_context(session_id)
    context_summary = ctx.generate_context_summary(session_id)
    knowledge_base = ctx.load_knowledge_base()
    
    # 查询对话历史（按 session_id 过滤，确保上下文是当前对话的）
    conversation_history = []
    try:
        recent_logs = db.query(ChatLog).filter(
            ChatLog.session_id == session_id
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
        nonlocal knowledge_base
        try:
            logger.info("[流式] 开始生成响应")
            user_role = ai_req.user_role or 'sales'
            user_msg = ai_req.message.strip()
            
            # 初始填充
            initial_padding = ": " + "." * 2048 + "\n\n"
            yield initial_padding
            
            # 从上下文提取实体
            ctx_entities = session_context.get("entities", {})
            last_customer = ctx_entities.get("last_customer")
            last_product = ctx_entities.get("last_product")
            
            fast_result = None

            # ===== 快速路径：@角色 跨角色协同卡片 =====
            mentioned_roles = _detect_role_mentions(user_msg)
            logger.info(f"[协同] 检测 @角色: mentioned_roles={mentioned_roles}, user_role={user_role}")
            if mentioned_roles:
              try:
                from ..middleware.permissions import has_permission
                perm_ok = has_permission(user_role, 'can_create_action_card')
                logger.info(f"[协同] 权限检查: can_create_action_card={perm_ok}")
                if not perm_ok:
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': '⚠️ 您当前角色无权发起跨角色协同任务。'}}, ensure_ascii=False)}\n\n"
                    return

                yield f"data: {json.dumps({'type': 'thinking', 'step': '协同解析', 'message': '检测到 @角色 提及，AI 正在智能解析...', 'progress': 10}, ensure_ascii=False)}\n\n"
                await asyncio.sleep(0.05)

                logger.info("[协同] 开始 AI 解析...")
                ai_parsed = await _ai_parse_collaboration_message(user_msg)
                logger.info(f"[协同] AI 解析结果: {ai_parsed}")

                # AI 解析失败 → 直接提示用户重试，不再用正则猜测
                if not ai_parsed:
                    _err_ai = (
                        '⚠️ **AI 解析暂时不可用，请稍后重试**\n\n'
                        '可能原因：系统繁忙或网络波动。\n'
                        '请稍等几秒后重新发送消息。'
                    )
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _err_ai}}, ensure_ascii=False)}\n\n"
                    return

                customer_name = ai_parsed.get("customer_name", "")
                if not customer_name:
                    _err_msg2 = (
                        '⚠️ **未能识别客户名称**\n\n'
                        '请在消息中明确包含客户名，例如：\n'
                        '「@财务 @结算 **李老板**打款了，总共5万」\n'
                        '「@结算 **张三**要结算，结料」\n'
                        '「@料部 **王总**要提20克」'
                    )
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _err_msg2}}, ensure_ascii=False)}\n\n"
                    return

                collab_intent = ai_parsed.get("intent", "payment_confirm")
                amounts = {
                    "total_amount": ai_parsed.get("total_amount", 0),
                    "gold_amount": ai_parsed.get("gold_amount", 0),
                    "labor_amount": ai_parsed.get("labor_amount", 0),
                }
                logger.info(f"[协同] AI 解析成功: {customer_name}, intent={collab_intent}, {amounts}")

                role_labels = {'finance': '财务', 'settlement': '结算', 'product': '商品部', 'counter': '柜台', 'material': '金料', 'manager': '经理', 'sales': '业务员'}
                target_display = '、'.join(role_labels.get(r, r) for r in mentioned_roles)

                # ===== Branch by intent =====
                if collab_intent == "settlement_confirm":
                    # Settlement confirmation card - no image/OCR required
                    gold_weight = ai_parsed.get("gold_weight", 0) if ai_parsed else 0
                    payment_method = ai_parsed.get("payment_method", "") if ai_parsed else ""
                    gold_price = ai_parsed.get("gold_price", 0) if ai_parsed else 0

                    if not payment_method:
                        payment_method = "结料"

                    # 前置验证：结价必须提供金价
                    if payment_method == "结价" and gold_price <= 0:
                        _err = (
                            '⚠️ **结价方式必须提供金价**\n\n'
                            '请在消息中注明金价，例如：\n'
                            '「@结算 李老板结价，金价680」\n'
                            '「@结算 李老板结价 今日金价685元/克」'
                        )
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _err}}, ensure_ascii=False)}\n\n"
                        return

                    yield f"data: {json.dumps({'type': 'thinking', 'step': '协同解析', 'message': '正在验证客户销售单信息...', 'progress': 40}, ensure_ascii=False)}\n\n"

                    # 前置验证：查询客户和销售单
                    from ..models import Customer as _Cust, SalesOrder as _SO, SettlementOrder as _ST
                    _customer = db.query(_Cust).filter(_Cust.name == customer_name).first()
                    if not _customer:
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': f'⚠️ 未找到客户「{customer_name}」，请确认客户名称'}}, ensure_ascii=False)}\n\n"
                        return

                    _sales_order = db.query(_SO).filter(
                        _SO.customer_name == _customer.name,
                        _SO.status.in_(["confirmed", "待结算"])
                    ).order_by(_SO.create_time.desc()).first()

                    if not _sales_order:
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': f'⚠️ 客户「{customer_name}」没有已确认的销售单，请先开销售单再发起结算'}}, ensure_ascii=False)}\n\n"
                        return

                    _existing = db.query(_ST).filter(
                        _ST.sales_order_id == _sales_order.id,
                        _ST.status != "cancelled"
                    ).first()
                    if _existing:
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': f'⚠️ 销售单 {_sales_order.order_no} 已有结算单 {_existing.settlement_no}，无需重复发起'}}, ensure_ascii=False)}\n\n"
                        return

                    display_info = f"客户: {customer_name}，销售单: {_sales_order.order_no}，结算方式: {payment_method}"
                    if gold_price > 0:
                        display_info += f"，金价: ¥{gold_price:.0f}"
                    yield f"data: {json.dumps({'type': 'thinking', 'step': '协同解析', 'message': display_info, 'progress': 50}, ensure_ascii=False)}\n\n"

                    payload = {
                        "customer_name": customer_name,
                        "payment_method": payment_method,
                        "gold_weight": gold_weight,
                        "gold_price": gold_price,
                        "sales_order_id": _sales_order.id,
                        "sales_order_no": _sales_order.order_no,
                        "original_message": user_msg,
                    }
                    card_type = "settlement_confirm"
                    card_message = (
                        f"📋 已发起跨角色结算确认\n\n"
                        f"**客户**: {customer_name}\n"
                        f"**销售单**: {_sales_order.order_no}\n"
                        f"**结算方式**: {payment_method}\n"
                    )
                    if payment_method == "结价":
                        card_message += f"**金价**: ¥{gold_price:.0f}/克\n"
                    card_message += f"\n等待 {target_display} 确认后自动创建结算单。"

                elif collab_intent == "withdrawal_confirm":
                    # 创建正式提料单 + ActionCard，结算通过待办铃铛确认
                    gold_weight = ai_parsed.get("gold_weight", 0) if ai_parsed else 0

                    if gold_weight <= 0:
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': '⚠️ 请提供提料克重，例如：「@结算 陈津，提料40克」'}}, ensure_ascii=False)}\n\n"
                        return

                    yield f"data: {json.dumps({'type': 'thinking', 'step': '协同解析', 'message': f'客户: {customer_name}，提料: {gold_weight:.2f}克，正在创建提料单...', 'progress': 50}, ensure_ascii=False)}\n\n"

                    from types import SimpleNamespace
                    mock_ai_response = SimpleNamespace(
                        withdrawal_customer_name=customer_name,
                        withdrawal_gold_weight=gold_weight,
                        withdrawal_remark=f"业务员协同提料：{user_msg}",
                    )
                    wd_result = await handle_gold_withdrawal(mock_ai_response, db)

                    if not wd_result.get("success"):
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': wd_result.get('message', '创建提料单失败')}}, ensure_ascii=False)}\n\n"
                        return

                    wd_data = wd_result.get("data", {})
                    wd_no = wd_data.get("withdrawal_no", "")

                    payload = {
                        "customer_name": customer_name,
                        "gold_weight": gold_weight,
                        "original_message": user_msg,
                        "withdrawal_id": wd_data.get("withdrawal_id"),
                        "withdrawal_no": wd_no,
                        "current_balance": wd_data.get("current_balance"),
                        "balance_after": wd_data.get("balance_after"),
                    }
                    card_type = "withdrawal_confirm"
                    card_message = (
                        f"📋 提料单 {wd_no} 已创建，等待确认\n\n"
                        f"**客户**: {customer_name}\n"
                        f"**提料克重**: {gold_weight:.2f}克\n"
                        f"**当前存料**: {wd_data.get('current_balance', 0):.2f}克\n"
                        f"**确认后余额**: {wd_data.get('balance_after', 0):.2f}克\n\n"
                        f"等待 {target_display} 确认后完成提料。"
                    )

                else:
                    # Default: payment_confirm - requires image + OCR
                    card_type = "payment_confirm"

                    if amounts["total_amount"] <= 0:
                        _err_msg = '⚠️ 未能从消息中解析出有效金额，请包含金额信息，例如：\n\n「@财务 @结算，李老板打款了，总共5万（金款4万，工费1万）」\n「@财务 客人 林煌 还款100 都是工费」'
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _err_msg}}, ensure_ascii=False)}\n\n"
                        return

                    _total_display = f"{amounts['total_amount']:,.0f}"
                    yield f"data: {json.dumps({'type': 'thinking', 'step': '协同解析', 'message': f'客户: {customer_name}，金额: ¥{_total_display}', 'progress': 50}, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0.05)

                    attached_image_url = ai_req.image_url
                    if not attached_image_url:
                        _no_img = '⚠️ **请附带转账截图后再发起收款协同**\n\n操作方式：先点击 📎 上传转账截图，再输入 @角色 消息一起发送。\n\n系统会自动 OCR 识别截图金额并与口述金额核对，确保账实相符。'
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _no_img}}, ensure_ascii=False)}\n\n"
                        return

                    yield f"data: {json.dumps({'type': 'thinking', 'step': '凭证核验', 'message': '正在 OCR 识别转账截图并核对金额...', 'progress': 55}, ensure_ascii=False)}\n\n"
                    ocr_verified = False
                    try:
                        ocr_amount = await _ocr_verify_payment_amount(attached_image_url)
                        if ocr_amount is not None:
                            stated = amounts["total_amount"]
                            diff = abs(ocr_amount - stated)
                            if diff > 1.0:
                                _warn = (
                                    f"⚠️ **风控拦截：金额不符**\n\n"
                                    f"📸 凭证截图金额：¥{ocr_amount:,.2f}\n"
                                    f"💬 口述金额：¥{stated:,.0f}\n"
                                    f"📊 差额：¥{diff:,.2f}\n\n"
                                    f"请核实后重新提交，或修正金额后再发起协同。"
                                )
                                yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _warn}}, ensure_ascii=False)}\n\n"
                                return
                            ocr_verified = True
                            yield f"data: {json.dumps({'type': 'thinking', 'step': '凭证核验', 'message': f'凭证金额 ¥{ocr_amount:,.2f} 与口述金额一致 ✓', 'progress': 65, 'status': 'complete'}, ensure_ascii=False)}\n\n"
                        else:
                            _ocr_fail = '⚠️ **凭证识别失败：未能从截图中提取金额**\n\n请确认上传的是清晰的银行转账截图，然后重新发送。'
                            yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _ocr_fail}}, ensure_ascii=False)}\n\n"
                            return
                    except Exception as ocr_err:
                        logger.warning(f"[协同] OCR 验证异常: {ocr_err}")
                        _ocr_err = '⚠️ **凭证识别异常，请重试**\n\n如多次失败，请检查图片是否为有效的转账截图。'
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': _ocr_err}}, ensure_ascii=False)}\n\n"
                        return

                    payload = {
                        "customer_name": customer_name,
                        "total_amount": amounts["total_amount"],
                        "gold_amount": amounts["gold_amount"],
                        "labor_amount": amounts["labor_amount"],
                        "original_message": user_msg,
                        "image_url": attached_image_url,
                        "ocr_verified": ocr_verified,
                    }
                    card_message = _build_card_message(customer_name, amounts, target_display)

                # ===== Create the card (shared for all intents) =====
                try:
                    card = create_action_card(
                        db=db,
                        creator_id=user_role,
                        creator_role=user_role,
                        card_type=card_type,
                        target_roles=mentioned_roles,
                        payload=payload,
                        session_id=session_id,
                    )
                    db.commit()
                    logger.info(f"[协同] 创建卡片 {card.card_id}，类型: {card_type}，目标角色: {mentioned_roles}")
                except Exception as card_err:
                    db.rollback()
                    logger.error(f"[协同] 创建卡片失败: {card_err}", exc_info=True)
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': f'创建协同任务失败: {str(card_err)}'}}, ensure_ascii=False)}\n\n"
                    return

                yield f"data: {json.dumps({'type': 'thinking', 'step': '协同解析', 'message': f'已创建协同任务，等待{target_display}确认', 'progress': 100, 'status': 'complete'}, ensure_ascii=False)}\n\n"

                card_response = {
                    "type": "interactive_card",
                    "data": {
                        "success": True,
                        "card_id": card.card_id,
                        "card_type": card.card_type,
                        "status": card.status,
                        "creator_role": card.creator_role,
                        "target_roles": card.target_roles,
                        "payload": card.payload,
                        "actions_taken": card.actions_taken or [],
                        "message": card_message,
                    }
                }
                logger.info(f"[协同] 即将发送 interactive_card 事件: card_id={card.card_id}")
                yield f"data: {json.dumps(card_response, ensure_ascii=False)}\n\n"
                logger.info(f"[协同] interactive_card 事件已发送")

                log_chat_message(
                    db=db, session_id=session_id, user_role=ai_req.user_role,
                    message_type="assistant", content=card_response["data"]["message"],
                    intent="跨角色协同", response_time_ms=int((datetime.now() - start_time).total_seconds() * 1000),
                    is_successful=True
                )
                return
              except Exception as collab_err:
                logger.error(f"[协同] 整体处理失败: {collab_err}", exc_info=True)
                yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': f'⚠️ 跨角色协同处理出错: {str(collab_err)}'}}, ensure_ascii=False)}\n\n"
                return

            # 快速路径：客户存料查询（支持"测试客户1目前存料多少"等句式）
            deposit_match = re.search(r'^(.+?)(目前|现在|当前)?(有|的)?(存料|余额|金料余额)(吗|多少|是多少)?[？?]?$', user_msg)
            if deposit_match:
                customer_name = deposit_match.group(1).strip()
                # 排除可能被误匹配的时间词后缀
                for suffix in ['目前', '现在', '当前', '的', '有']:
                    if customer_name.endswith(suffix):
                        customer_name = customer_name[:-len(suffix)].strip()
                logger.info(f"[快速路径] 检测到存料查询: {customer_name}")
                yield f"data: {json.dumps({'type': 'thinking', 'step': '快速查询', 'message': f'正在查询 {customer_name} 的存料信息...', 'progress': 30}, ensure_ascii=False)}\n\n"
                
                from ..models import SettlementOrder
                from ..models.finance import GoldReceipt
                
                customer = db.query(Customer).filter(Customer.name == customer_name).first()
                if not customer:
                    candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
                    if len(candidates) == 1:
                        customer = candidates[0]
                    elif len(candidates) > 1:
                        names = '、'.join([c.name for c in candidates])
                        yield f"data: {json.dumps({'type': 'complete', 'content': f'找到多个匹配客户：{names}，请输入完整姓名以确认'}, ensure_ascii=False)}\n\n"
                        return
                
                if customer:
                    from ..gold_balance import calculate_customer_gold_balance
                    net_gold = calculate_customer_gold_balance(customer.id, db)
                    
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
                    user_role=ai_req.user_role,
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
            
            enhanced_message = ai_req.message
            if context_summary or knowledge_base:
                context_parts = []
                if knowledge_base:
                    context_parts.append(f"【业务规则参考】\n{knowledge_base[:1000]}...")
                if context_summary:
                    context_parts.append(f"【会话上下文】\n{context_summary}")
                context_parts.append(f"【用户请求】\n{ai_req.message}")
                enhanced_message = "\n\n".join(context_parts)
            
            session_entities = session_context.get("entities", {})
            ai_response = parse_user_message(ai_req.message, conversation_history, user_role=user_role, session_entities=session_entities)
            logger.info(f"[流式] 识别到意图: {ai_response.action}")
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '意图解析', 'message': f'已识别意图：{ai_response.action}', 'progress': 20, 'status': 'complete'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 业务员角色限制
            if user_role == 'sales' and ai_response.action in SALES_FORBIDDEN_ACTIONS:
                    error_msg = "⚠️ 您是业务员角色，只能查询客户相关信息。\n\n如需执行入库、开单等操作，请联系相应岗位人员。"
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': error_msg}}, ensure_ascii=False)}\n\n"
                    return
            
            # AI 不确定但输入像业务操作 → 反问用户
            if _should_clarify(ai_req.message, ai_response.action):
                _entities = session_context.get("entities", {}) if session_context else {}
                clarify_msg = _build_clarification(ai_req.message, _entities)
                result = {"success": True, "action": "反问确认", "message": clarify_msg}
                yield f"data: {json.dumps({'type': 'complete', 'data': result}, ensure_ascii=False)}\n\n"
                return
            
            # 闲聊处理（调用共享函数）
            if ai_response.action in ["闲聊", "其他"]:
                chat_response = _build_chat_response(ai_req.message)
                result = {"success": True, "action": "闲聊", "message": chat_response}
                yield f"data: {json.dumps({'type': 'complete', 'data': result}, ensure_ascii=False)}\n\n"
                return
            
            # 写操作处理（调用共享分发函数）
            if ai_response.action in WRITE_ACTIONS and ai_response.action != "查询客户账务":
                from ..middleware.permissions import check_action_permission
                
                has_perm, perm_error = check_action_permission(user_role, ai_response.action)
                
                if not has_perm:
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': perm_error}}, ensure_ascii=False)}\n\n"
                    return
                
                yield f"data: {json.dumps({'type': 'thinking', 'step': '执行操作', 'message': f'正在执行{ai_response.action}操作...', 'progress': 30}, ensure_ascii=False)}\n\n"
                
                try:
                    result = await _dispatch_write_action(ai_response, db, user_role)
                    
                    if result is not None:
                        # Save operation result to context
                        if result.get("success"):
                            _data = result.get("data", {})
                            if isinstance(_data, dict):
                                ctx.append_action(session_id, ai_response.action,
                                                result.get("message", "")[:200],
                                                success=True, data=_data)
                        else:
                            ctx.append_action(session_id, ai_response.action,
                                            result.get("message", "操作失败")[:200],
                                            success=False)
                        
                        # 如果结果包含特殊 type（如 withdrawal_confirm），使用该 type
                        sse_type = result.pop("type", "complete")
                        sse_payload = {"type": sse_type, "data": result}
                        yield f"data: {json.dumps(sanitize_floats(sse_payload), ensure_ascii=False, default=str)}\n\n"
                        return
                except Exception as op_error:
                    logger.error(f"[流式] 执行{ai_response.action}操作时出错: {op_error}", exc_info=True)
                    yield f"data: {json.dumps({'type': 'error', 'message': f'执行{ai_response.action}操作失败: {str(op_error)}'}, ensure_ascii=False)}\n\n"
                    return
            
            # ── 新路径：AI 驱动查询引擎（查询/分析类意图） ──
            from ..query_engine import is_query_intent, generate_query_plan, execute_query_plan, format_query_result, summarize_result_stream

            if is_query_intent(ai_response.action):
                yield f"data: {json.dumps({'type': 'thinking', 'step': '查询规划', 'message': 'AI 正在理解您的问题...', 'progress': 30}, ensure_ascii=False)}\n\n"
                await asyncio.sleep(0.05)

                _qe_context = ""
                if conversation_history:
                    for h in conversation_history[-4:]:
                        _role = "用户" if h.get("role") == "user" else "系统"
                        _qe_context += f"{_role}: {h.get('content', '')[:200]}\n"

                plan = generate_query_plan(ai_req.message, context=_qe_context)

                if plan:
                    yield f"data: {json.dumps({'type': 'thinking', 'step': '数据查询', 'message': '正在查询数据库...', 'progress': 50}, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0.05)

                    result = execute_query_plan(plan, db)
                    result_text = format_query_result(plan, result)

                    yield f"data: {json.dumps({'type': 'thinking', 'step': 'AI总结', 'message': '正在生成回答...', 'progress': 75}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'content_start'})}\n\n"

                    full_response = ""
                    import time as _time
                    _qe_start = _time.time()
                    for chunk in summarize_result_stream(ai_req.message, result_text):
                        if _time.time() - _qe_start > 30:
                            _timeout_chunk = "\n\n[回答超时，已中断]"
                            full_response += _timeout_chunk
                            yield f"data: {json.dumps({'type': 'content', 'chunk': _timeout_chunk}, ensure_ascii=False)}\n\n"
                            break
                        full_response += chunk
                        yield f"data: {json.dumps({'type': 'content', 'chunk': chunk}, ensure_ascii=False)}\n\n"

                    try:
                        ctx.append_action(session_id, ai_response.action,
                                        str(full_response)[:200] if full_response else "",
                                        success=True)
                    except Exception:
                        pass

                    _complete_payload = {'type': 'complete', 'data': {'success': True, 'message': full_response, 'action': ai_response.action}, 'progress': 100}
                    yield f"data: {json.dumps(sanitize_floats(_complete_payload), ensure_ascii=False, default=str)}\n\n"

                    end_time = datetime.now()
                    response_time_ms = int((end_time - start_time).total_seconds() * 1000)
                    log_chat_message(db=db, session_id=session_id, user_role=ai_req.user_role,
                                    message_type="assistant", content=full_response[:5000],
                                    intent=ai_response.action, response_time_ms=response_time_ms, is_successful=True)
                    return

                # AI query plan failed → fall through to legacy path
                logger.warning("[QueryEngine] Plan generation failed, falling back to legacy path")

            # ── 旧路径：硬编码数据收集 + AI 分析（操作类意图 & fallback） ──
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在从数据库收集相关数据...', 'progress': 30}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            from ..ai_analyzer import ai_analyzer
            
            # 收集客户账务数据（调用共享函数）
            customer_debt_payload = await _collect_debt_payload(ai_response, db)
            
            # 前置检查：如果指定了具体单号但查不到，直接返回
            _order_no = getattr(ai_response, 'order_no', None)
            _sales_order_no = getattr(ai_response, 'sales_order_no', None)
            
            if ai_response.action == "查询入库单" and _order_no:
                _check_order = db.query(InboundOrder).filter(InboundOrder.order_no == _order_no).first()
                if not _check_order:
                    yield f"data: {json.dumps({'type': 'content_start'})}\n\n"
                    yield f"data: {json.dumps({'type': 'content', 'chunk': f'未找到入库单「{_order_no}」，请检查单号是否正确。'}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'complete', 'content': f'未找到入库单「{_order_no}」'}, ensure_ascii=False)}\n\n"
                    return
            if ai_response.action == "查询销售单" and _sales_order_no:
                _check_order = db.query(SalesOrder).filter(SalesOrder.order_no == _sales_order_no).first()
                if not _check_order:
                    yield f"data: {json.dumps({'type': 'content_start'})}\n\n"
                    yield f"data: {json.dumps({'type': 'content', 'chunk': f'未找到销售单「{_sales_order_no}」，请检查单号是否正确。'}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'complete', 'content': f'未找到销售单「{_sales_order_no}」'}, ensure_ascii=False)}\n\n"
                    return
            
            # 收集数据
            data = ai_analyzer.collect_all_data(
                ai_response.action,
                ai_req.message,
                db,
                order_no=_order_no,
                sales_order_no=_sales_order_no,
                user_role=user_role,
                inbound_supplier=getattr(ai_response, 'inbound_supplier', None),
                inbound_product=getattr(ai_response, 'inbound_product', None),
                inbound_date_start=getattr(ai_response, 'inbound_date_start', None),
                inbound_date_end=getattr(ai_response, 'inbound_date_end', None),
                transfer_order_no=getattr(ai_response, 'transfer_order_no', None),
                transfer_status=getattr(ai_response, 'transfer_status', None),
                transfer_date_start=getattr(ai_response, 'transfer_date_start', None),
                transfer_date_end=getattr(ai_response, 'transfer_date_end', None),
                customer_name=getattr(ai_response, 'customer_name', None),
            )

            _cust_name_filter = getattr(ai_response, 'customer_name', None)
            if _cust_name_filter and not data.get("customers"):
                _no_cust_msg = f"查不到客户「{_cust_name_filter}」的信息，请确认客户名称是否正确。"
                yield f"data: {json.dumps({'type': 'content_start'})}\n\n"
                yield f"data: {json.dumps({'type': 'content', 'chunk': _no_cust_msg}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'complete', 'content': _no_cust_msg}, ensure_ascii=False)}\n\n"
                return

            if customer_debt_payload is not None:
                data["customer_debt"] = customer_debt_payload
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '已加载数据', 'progress': 70, 'status': 'complete'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 向量检索：注入历史决策经验和客户画像
            try:
                from ..services.behavior_logger import get_decision_context_for_suggestion, get_customer_profile
                
                _action_map = {
                    "查询客户账务": "settlement",
                    "登记收款": "payment_registration",
                    "收料": "gold_receipt",
                    "付料": "gold_payment",
                    "存料结价": "deposit_settlement",
                    "入库": "inbound",
                    "查询入库单": "inbound",
                    "创建销售单": "create_sales_order",
                    "查询销售单": "create_sales_order",
                    "提料": "withdrawal",
                    "供应商付款": "supplier_payment",
                }
                _vec_action = _action_map.get(ai_response.action)
                _cust_name = getattr(ai_response, 'customer_name', None) or getattr(ai_response, 'payment_customer_name', None)
                _cust_id = None
                if _cust_name:
                    _cust = db.query(Customer).filter(Customer.name == _cust_name).first()
                    _cust_id = _cust.id if _cust else None
                
                if _vec_action and _cust_name:
                    decision_ctx = await get_decision_context_for_suggestion(
                        db=db, action_type=_vec_action,
                        customer_name=_cust_name, customer_id=_cust_id,
                        top_k=3
                    )
                    if decision_ctx:
                        knowledge_base = (knowledge_base or "") + "\n\n" + decision_ctx
                
                if _cust_id and _cust_name and ai_response.action == "查询客户账务":
                    profile = await get_customer_profile(db, _cust_id, _cust_name)
                    if profile:
                        knowledge_base = (knowledge_base or "") + f"\n\n【客户画像】{_cust_name}：{profile}"
            except Exception as vec_err:
                logger.warning(f"[向量检索] 跳过: {vec_err}")
            
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
                    ai_req.message,
                    ai_response.action,
                    data,
                    language=language,
                    knowledge_base=knowledge_base
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
            
            # 图表数据（调用共享函数）
            needs_chart = _should_generate_chart(ai_response, ai_req.message)
            
            chart_data_result = {}
            if needs_chart:
                chart_data_result = ai_analyzer.generate_chart_data(ai_response.action, data)
            
            # 记录查询/分析结果到上下文
            try:
                ctx.append_action(session_id, ai_response.action,
                                str(full_response)[:200] if full_response else "",
                                success=True)
            except Exception:
                pass
            
            # 完成
            _complete_payload = {'type': 'complete', 'data': {'success': True, 'message': full_response, 'raw_data': data, 'action': ai_response.action, 'chart_data': chart_data_result.get('chart_data'), 'pie_data': chart_data_result.get('pie_data')}, 'progress': 100}
            yield f"data: {json.dumps(sanitize_floats(_complete_payload), ensure_ascii=False)}\n\n"
            
            end_time = datetime.now()
            response_time_ms = int((end_time - start_time).total_seconds() * 1000)
            log_chat_message(
                db=db,
                session_id=session_id,
                user_role=ai_req.user_role,
                message_type="assistant",
                content=full_response[:5000] if full_response else "",
                intent=ai_response.action,
                response_time_ms=response_time_ms,
                is_successful=True
            )
            
        except Exception as e:
            logger.error(f"流式处理出错: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': f'处理出错：{str(e)}'}, ensure_ascii=False)}\n\n"
        finally:
            logger.info("[流式] generate() 完成")
    
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
        }
    )
