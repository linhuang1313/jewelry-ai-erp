"""
Chat 辅助函数模块
包含反问逻辑、日志记录、公共辅助函数和常量
"""
from sqlalchemy.orm import Session
from datetime import datetime
import logging
import re
from typing import Dict, Any, Optional

from ..models import InboundOrder, SalesOrder, Customer, ChatLog
from .customers import chat_debt_query

from .chat_handlers import (
    ROLE_DISPLAY_NAMES,
    handle_inbound, handle_create_customer, handle_create_supplier,
    handle_create_sales_order, handle_create_transfer, handle_return,
    handle_sales_return, handle_confirm_order, handle_unconfirm_order,
    handle_payment_registration, handle_gold_receipt, handle_gold_payment,
    handle_gold_withdrawal, handle_supplier_cash_payment, handle_batch_transfer,
    handle_deposit_settlement,
    handle_create_settlement, handle_query_settlement,
    handle_create_loan, handle_loan_return, handle_query_loan,
    handle_reconciliation, handle_query_voucher, handle_expense,
    handle_query_gold_records,
)

logger = logging.getLogger(__name__)


# ========== 需要权限检查的写操作列表 ==========

WRITE_ACTIONS = [
    "入库", "创建客户", "创建供应商", "创建销售单", "创建转移单",
    "退货", "销退", "确认单据", "反确认单据", "登记收款",
    "查询客户账务", "收料", "提料", "付料", "批量转移", "供应商付款",
    "存料结价", "创建结算单", "查询结算单",
    "创建暂借单", "归还暂借", "查询暂借单",
    "查询对账单", "查询凭证", "费用报销", "查询金料记录",
]

# 业务员禁止的操作
SALES_FORBIDDEN_ACTIONS = ["入库", "创建客户", "创建供应商", "创建销售单", "创建转移单", "退货", "销退"]


# ========== 反问与澄清 ==========

def _build_clarification(message: str, session_entities: dict = None) -> str:
    """当 AI 无法确定用户意图时，构建反问消息"""
    last_action = session_entities.get("last_action") if session_entities else None
    last_customer = session_entities.get("last_customer") if session_entities else None
    
    if re.search(r'\d+[gG克]|\d+元|\d+块|\d+万', message):
        hints = []
        if last_action == "入库" or "入" in message:
            hints.append("入库（如：入库 足金手镯 10g 工费15 供应商XX）")
        if last_action == "创建销售单" or any(w in message for w in ["卖", "销售"]):
            hints.append("创建销售单（如：卖给张三 足金手镯 10g 工费15）")
        if "退" in message:
            hints.append("退货（如：退货 足金手镯 10g 退给XX珠宝）")
        
        if hints:
            hint_text = "\n".join([f"  • {h}" for h in hints])
            return f"您的输入包含商品信息，但我不太确定您想执行什么操作。请问您是想：\n\n{hint_text}\n\n请补充更多信息，我来帮您处理。"
    
    return "抱歉，我不太理解您的意思。您可以试试以下操作：\n\n📦 入库（如：足金手镯 10g 工费15 供应商XX珠宝）\n📊 查库存（如：查看库存）\n🧾 销售开单（如：卖给张三 足金手镯 10g）\n💰 登记收款（如：张三收款5000元）\n🔄 退货（如：退货 足金手镯 10g 退给XX珠宝）\n\n也可以输入「怎么入库」等问题查看操作指南。"


def _should_clarify(message: str, action: str) -> bool:
    """判断是否需要反问用户"""
    if action not in ["未知", "闲聊", "其他"]:
        return False
    if re.search(r'\d+[gG克]|\d+元|\d+块|\d+万', message):
        return True
    return False


# ========== 日志记录 ==========

def log_chat_message(db: Session, session_id: str, user_role: str,
                     message_type: str, content: str,
                     intent: str = None, response_time_ms: int = None,
                     is_successful: bool = None):
    """记录聊天消息到数据库"""
    try:
        log = ChatLog(
            session_id=session_id,
            user_role=user_role,
            message_type=message_type,
            content=content[:5000] if content else "",
            intent=intent,
            response_time_ms=response_time_ms,
            is_successful=int(is_successful) if is_successful is not None else None
        )
        db.add(log)
        db.commit()
    except Exception as e:
        logger.warning(f"记录聊天日志失败: {e}")
        db.rollback()


# ========== 公共辅助函数（消除 /api/chat 和 /api/chat-stream 的重复逻辑）==========

def _get_time_greeting() -> str:
    """根据当前时间返回问候语"""
    hour = datetime.now().hour
    if hour < 9:
        return "早上好！"
    elif hour < 12:
        return "上午好！"
    elif hour < 14:
        return "中午好！"
    elif hour < 18:
        return "下午好！"
    else:
        return "晚上好！"


def _build_chat_response(message: str) -> str:
    """构建闲聊响应"""
    time_greeting = _get_time_greeting()
    user_msg_lower = message.lower().strip()
    
    if any(word in user_msg_lower for word in ["你好", "hi", "hello", "嗨", "hey"]):
        return f"{time_greeting}我是珠宝ERP智能助手，有什么可以帮您的吗？"
    elif any(word in user_msg_lower for word in ["谢谢", "感谢", "thanks"]):
        return "不客气！有其他需要随时告诉我"
    else:
        return "我是珠宝ERP助手，您可以直接告诉我想做什么，例如：\n\n📦 入库（如：足金手镯 10g 工费15 供应商XX珠宝）\n📊 查库存（如：查看库存）\n🧾 销售开单（如：卖给张三 足金手镯 10g）\n💰 登记收款（如：张三收款5000元）\n\n也可以输入「怎么入库」等问题查看操作指南。"


async def _dispatch_write_action(ai_response, db: Session, user_role: str) -> Optional[Dict[str, Any]]:
    """根据 action 分发到对应的写操作处理函数，返回 None 表示不是写操作"""
    action = ai_response.action
    dispatch_map = {
        "入库": lambda: handle_inbound(ai_response, db),
        "创建客户": lambda: handle_create_customer(ai_response, db),
        "创建供应商": lambda: handle_create_supplier(ai_response, db),
        "创建销售单": lambda: handle_create_sales_order(ai_response, db),
        "创建转移单": lambda: handle_create_transfer(ai_response, db),
        "退货": lambda: handle_return(ai_response, db, user_role),
        "销退": lambda: handle_sales_return(ai_response, db, user_role),
        "确认单据": lambda: handle_confirm_order(ai_response, db, user_role),
        "反确认单据": lambda: handle_unconfirm_order(ai_response, db, user_role),
        "收料": lambda: handle_gold_receipt(ai_response, db, user_role),
        "登记收款": lambda: handle_payment_registration(ai_response, db, user_role),
        "提料": lambda: handle_gold_withdrawal(ai_response, db, user_role),
        "付料": lambda: handle_gold_payment(ai_response, db, user_role),
        "批量转移": lambda: handle_batch_transfer(ai_response, db, user_role),
        "供应商付款": lambda: handle_supplier_cash_payment(ai_response, db, user_role),
        "存料结价": lambda: handle_deposit_settlement(ai_response, db, user_role),
        "创建结算单": lambda: handle_create_settlement(ai_response, db, user_role),
        "查询结算单": lambda: handle_query_settlement(ai_response, db),
        "创建暂借单": lambda: handle_create_loan(ai_response, db, user_role),
        "归还暂借": lambda: handle_loan_return(ai_response, db),
        "查询暂借单": lambda: handle_query_loan(ai_response, db),
        "查询对账单": lambda: handle_reconciliation(ai_response, db),
        "查询凭证": lambda: handle_query_voucher(ai_response, db),
        "费用报销": lambda: handle_expense(ai_response, db),
        "查询金料记录": lambda: handle_query_gold_records(ai_response, db),
    }
    
    handler = dispatch_map.get(action)
    if handler:
        return await handler()
    return None


async def _collect_debt_payload(ai_response, db: Session) -> Optional[Dict[str, Any]]:
    """收集客户账务数据（chat 和 chat-stream 共用）"""
    if ai_response.action != "查询客户账务":
        return None
    
    debt_name = ai_response.debt_customer_name or ai_response.customer_name
    debt_query_type = ai_response.debt_query_type or "all"
    if not debt_name:
        return None
    
    debt_response = await chat_debt_query(
        customer_name=debt_name,
        query_type=debt_query_type,
        date_start=ai_response.date_start,
        date_end=ai_response.date_end,
        db=db
    )
    if debt_response.get("success"):
        debt_data = debt_response.get("data") or {}
        return {
            "success": True,
            "message": debt_response.get("message"),
            **debt_data
        }
    else:
        return {
            "success": False,
            "message": debt_response.get("message"),
            "customer_name": debt_name
        }


def _check_order_exists(ai_response, db: Session) -> Optional[Dict[str, Any]]:
    """前置检查单号是否存在，返回错误响应或 None"""
    if ai_response.action == "查询入库单" and ai_response.order_no:
        order = db.query(InboundOrder).filter(InboundOrder.order_no == ai_response.order_no).first()
        if not order:
            return {"success": False, "message": f"未找到入库单「{ai_response.order_no}」，请检查单号是否正确。", "action": "查询入库单"}
    if ai_response.action == "查询销售单" and ai_response.sales_order_no:
        order = db.query(SalesOrder).filter(SalesOrder.order_no == ai_response.sales_order_no).first()
        if not order:
            return {"success": False, "message": f"未找到销售单「{ai_response.sales_order_no}」，请检查单号是否正确。", "action": "查询销售单"}
    return None


def _should_generate_chart(ai_response, message: str) -> bool:
    """判断是否需要生成图表"""
    chart_keywords = ["图表", "chart", "可视化", "饼图", "柱状图", "折线图"]
    auto_chart_actions = ["供应商分析", "查询库存", "库存分析", "销售分析", "查询入库单", "统计分析"]
    return (
        ai_response.action == "生成图表" or 
        ai_response.action in auto_chart_actions or
        any(keyword in message for keyword in chart_keywords)
    )
