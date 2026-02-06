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
from .customers import chat_debt_query
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
    """处理登记收款 - 自动登记客户收款"""
    from ..models import Customer
    from ..models.finance import PaymentRecord, AccountReceivable
    from ..timezone_utils import china_now
    from datetime import date
    
    # 提取参数
    customer_name = getattr(ai_response, 'payment_customer_name', None)
    amount = getattr(ai_response, 'payment_amount', None)
    payment_method = getattr(ai_response, 'payment_method', '转账') or '转账'
    remark = getattr(ai_response, 'payment_remark', '') or ''
    
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
        
        # 创建收款记录
        payment = PaymentRecord(
            payment_no=payment_no,
            account_receivable_id=None,
            customer_id=customer.id,
            payment_date=date.today(),
            amount=amount,
            payment_method=payment_method_en,
            remark=remark or "AI对话收款",
            operator="AI助手"
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
            
            offset_details.append(f"冲抵{receivable.receivable_no}：¥{offset_amount:.2f}")
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


async def handle_gold_receipt(ai_response, db: Session) -> Dict[str, Any]:
    """处理收料 - 自动创建收料单
    
    注意：由于在StreamingResponse中db会话可能失效，这里使用独立的数据库会话
    """
    from ..models import Customer, SettlementOrder, SalesOrder
    from ..models.finance import GoldReceipt
    from ..timezone_utils import china_now
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
            status="received",  # 直接确认接收
            remark=remark or f"AI对话收料",
            created_by="AI助手",
            received_by="AI助手",
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
        
        # ========== 统一使用历史交易汇总：来料 - 结算用料 - 提料 ==========
        from ..models import CustomerWithdrawal
        
        # 1. 来料（GoldReceipt）
        total_receipts = local_db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
            GoldReceipt.customer_id == customer_id,
            GoldReceipt.status == 'received'
        ).scalar() or 0
        
        # 2. 结算用料（结料支付 + 混合支付的金料部分）
        total_settlement_gold = 0.0
        settlements = local_db.query(SettlementOrder).join(SalesOrder).filter(
            SalesOrder.customer_id == customer_id,
            SettlementOrder.status.in_(['confirmed', 'printed'])
        ).all()
        for s in settlements:
            if s.payment_method == 'physical_gold':
                total_settlement_gold += s.physical_gold_weight or 0
            elif s.payment_method == 'mixed':
                total_settlement_gold += s.gold_payment_weight or 0
        
        # 3. 提料（CustomerWithdrawal）
        total_withdrawals = local_db.query(func.coalesce(func.sum(CustomerWithdrawal.gold_weight), 0)).filter(
            CustomerWithdrawal.customer_id == customer_id,
            CustomerWithdrawal.status.in_(['pending', 'completed'])
        ).scalar() or 0
        
        # 4. 净存料 = 来料 - 结算用料 - 提料
        net_gold = float(total_receipts) - total_settlement_gold - float(total_withdrawals)
        
        logger.info(f"[收料] 余额计算: 来料={total_receipts}, 结算用料={total_settlement_gold}, 提料={total_withdrawals}, 净存料={net_gold}")
        
        # 返回成功消息（包含隐藏标记供前端解析打印按钮）
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
    """处理付料（给供应商金料）- 自动创建付料单"""
    from ..models import Supplier, GoldMaterialTransaction, SupplierGoldAccount, SupplierGoldTransaction
    from ..timezone_utils import china_now
    
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
        
        # 创建金料支出记录（付料单）
        transaction = GoldMaterialTransaction(
            transaction_no=payment_no,
            transaction_type='expense',
            supplier_id=supplier.id,
            supplier_name=supplier.name,
            gold_weight=gold_weight,
            status="confirmed",  # 付料单直接确认
            created_by="AI助手",
            confirmed_by="AI助手",
            confirmed_at=now,
            remark=remark or "AI对话付料"
        )
        db.add(transaction)
        db.flush()
        
        # 更新供应商金料账户
        supplier_gold_account = db.query(SupplierGoldAccount).filter(
            SupplierGoldAccount.supplier_id == supplier.id
        ).first()
        
        if not supplier_gold_account:
            supplier_gold_account = SupplierGoldAccount(
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                current_balance=0.0,
                total_received=0.0,
                total_paid=0.0
            )
            db.add(supplier_gold_account)
            db.flush()
        
        balance_before = supplier_gold_account.current_balance
        supplier_gold_account.current_balance = round(supplier_gold_account.current_balance - gold_weight, 3)
        supplier_gold_account.total_paid = round(supplier_gold_account.total_paid + gold_weight, 3)
        supplier_gold_account.last_transaction_at = now
        
        # 创建供应商金料交易记录
        supplier_gold_tx = SupplierGoldTransaction(
            supplier_id=supplier.id,
            supplier_name=supplier.name,
            transaction_type='pay',
            payment_transaction_id=transaction.id,
            gold_weight=gold_weight,
            balance_before=balance_before,
            balance_after=supplier_gold_account.current_balance,
            created_by="AI助手",
            remark=f"付料单：{payment_no}"
        )
        db.add(supplier_gold_tx)
        
        db.commit()
        
        # 构建余额状态描述
        if supplier_gold_account.current_balance > 0:
            status_text = f"我们仍欠供应商 {supplier_gold_account.current_balance:.2f}克"
        elif supplier_gold_account.current_balance < 0:
            status_text = f"供应商欠我们 {abs(supplier_gold_account.current_balance):.2f}克"
        else:
            status_text = "已结清"
        
        message = f"""✅ **付料单已创建**

📋 单号：{payment_no}
🏭 供应商：{supplier.name}
⚖️ 付料克重：{gold_weight:.2f}克
💎 金料账户：{status_text}
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}

<!-- GOLD_PAYMENT:{transaction.id}:{payment_no} -->"""
        
        return {
            "success": True,
            "action": "付料",
            "message": message,
            "data": {
                "transaction_id": transaction.id,
                "payment_no": payment_no,
                "supplier_name": supplier.name,
                "gold_weight": gold_weight,
                "balance_after": supplier_gold_account.current_balance
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"创建付料单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建付料单失败：{str(e)}", "action": "付料"}


async def handle_gold_withdrawal(ai_response, db: Session) -> Dict[str, Any]:
    """处理提料（客户取料）- 自动创建提料单"""
    from ..models import Customer, CustomerGoldDeposit, CustomerWithdrawal, CustomerGoldDepositTransaction
    from ..timezone_utils import china_now
    
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
    
    # 验证存料余额
    deposit = db.query(CustomerGoldDeposit).filter(
        CustomerGoldDeposit.customer_id == customer.id
    ).first()
    
    current_balance = deposit.current_balance if deposit else 0.0
    if current_balance < gold_weight:
        return {
            "success": False, 
            "message": f"客户「{customer.name}」存料余额不足。\n当前余额：{current_balance:.2f}克\n申请提料：{gold_weight:.2f}克",
            "action": "提料"
        }
    
    try:
        now = china_now()
        count = db.query(CustomerWithdrawal).filter(
            CustomerWithdrawal.withdrawal_no.like(f"QL{now.strftime('%Y%m%d')}%")
        ).count()
        withdrawal_no = f"QL{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 记录扣减前余额
        balance_before = deposit.current_balance
        balance_after = balance_before - gold_weight
        
        # 创建取料单
        withdrawal = CustomerWithdrawal(
            withdrawal_no=withdrawal_no,
            customer_id=customer.id,
            customer_name=customer.name,
            gold_weight=gold_weight,
            withdrawal_type="self",  # 默认自取
            status="pending",  # 待取料
            created_by="AI助手",
            remark=remark or "AI对话提料"
        )
        db.add(withdrawal)
        
        # 扣减客户存料余额
        deposit.current_balance = balance_after
        deposit.total_used += gold_weight
        deposit.last_transaction_at = now
        
        # 创建存料交易记录
        transaction = CustomerGoldDepositTransaction(
            customer_id=customer.id,
            customer_name=customer.name,
            transaction_type="use",
            amount=-gold_weight,  # 负数表示支出
            balance_before=balance_before,
            balance_after=balance_after,
            created_by="AI助手",
            remark=f"提料单：{withdrawal_no}" + (f" - {remark}" if remark else "")
        )
        db.add(transaction)
        
        db.commit()
        db.refresh(withdrawal)
        
        message = f"""✅ **提料单已创建**

📋 单号：{withdrawal_no}
👤 客户：{customer.name}
⚖️ 提料克重：{gold_weight:.2f}克
💎 剩余存料：{balance_after:.2f}克
📦 状态：待取料
🕐 时间：{now.strftime('%Y-%m-%d %H:%M:%S')}

<!-- GOLD_WITHDRAWAL:{withdrawal.id}:{withdrawal_no} -->"""
        
        return {
            "success": True,
            "action": "提料",
            "message": message,
            "data": {
                "withdrawal_id": withdrawal.id,
                "withdrawal_no": withdrawal_no,
                "customer_name": customer.name,
                "gold_weight": gold_weight,
                "balance_after": balance_after
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"创建提料单失败: {e}", exc_info=True)
        return {"success": False, "message": f"创建提料单失败：{str(e)}", "action": "提料"}


async def handle_supplier_cash_payment(ai_response, db: Session) -> Dict[str, Any]:
    """处理供应商付款（工费）- 自动登记给供应商付款"""
    from ..models import Supplier
    from ..models.finance import SupplierPayment, AccountPayable
    from ..timezone_utils import china_now
    from datetime import date, datetime
    
    # 提取参数
    supplier_name = getattr(ai_response, 'supplier_payment_name', None)
    amount = getattr(ai_response, 'supplier_payment_amount', None)
    payment_method = getattr(ai_response, 'supplier_payment_method', '转账') or '转账'
    remark = getattr(ai_response, 'supplier_payment_remark', '') or ''
    
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
            created_by="AI助手"
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
    from ..timezone_utils import china_now
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
    # 入库单商品默认在商品部仓库
    from_location = db.query(Location).filter(Location.code == "warehouse").first()
    
    # 目标位置：根据用户输入匹配
    if "展厅" in to_location_name or "showroom" in to_location_name.lower():
        to_location = db.query(Location).filter(Location.code == "showroom").first()
        to_location_display = "展厅"
    elif "仓库" in to_location_name or "warehouse" in to_location_name.lower():
        to_location = db.query(Location).filter(Location.code == "warehouse").first()
        to_location_display = "商品部仓库"
    else:
        # 默认转到展厅
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
        
        for detail in details:
            try:
                # 检查源位置库存
                inventory = db.query(LocationInventory).filter(
                    LocationInventory.location_id == from_location.id,
                    LocationInventory.product_name == detail.product_name
                ).first()
                
                if not inventory or inventory.weight < detail.weight:
                    available = inventory.weight if inventory else 0
                    errors.append(f"{detail.product_name}: 库存不足（需要{detail.weight:.2f}克，仅有{available:.2f}克）")
                    continue
                
                # 扣减源位置库存
                inventory.weight -= detail.weight
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
                    created_by="AI助手",
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
            customer_debt_payload = None
            if ai_response.action == "查询客户账务":
                debt_name = ai_response.debt_customer_name or ai_response.customer_name
                debt_query_type = ai_response.debt_query_type or "all"
                if debt_name:
                    debt_response = await chat_debt_query(
                        customer_name=debt_name,
                        query_type=debt_query_type,
                        date_start=ai_response.date_start,
                        date_end=ai_response.date_end,
                        db=db
                    )
                    if debt_response.get("success"):
                        debt_data = debt_response.get("data") or {}
                        customer_debt_payload = {
                            "success": True,
                            "message": debt_response.get("message"),
                            **debt_data
                        }
                    else:
                        customer_debt_payload = {
                            "success": False,
                            "message": debt_response.get("message"),
                            "customer_name": debt_name
                        }
            
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
            if customer_debt_payload is not None:
                data["customer_debt"] = customer_debt_payload
            
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
                    from ..models import CustomerWithdrawal
                    
                    # 1. 来料（GoldReceipt）
                    total_receipts = db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
                        GoldReceipt.customer_id == customer.id,
                        GoldReceipt.status == 'received'
                    ).scalar() or 0
                    
                    # 2. 结算用料
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
                    
                    # 3. 提料（CustomerWithdrawal）
                    total_withdrawals = db.query(func.coalesce(func.sum(CustomerWithdrawal.gold_weight), 0)).filter(
                        CustomerWithdrawal.customer_id == customer.id,
                        CustomerWithdrawal.status.in_(['pending', 'completed'])
                    ).scalar() or 0
                    
                    # 4. 净存料 = 来料 - 结算用料 - 提料
                    net_gold = float(total_receipts) - total_settlement_gold - float(total_withdrawals)
                    
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
            if ai_response.action in ["入库", "创建客户", "创建供应商", "创建销售单", "创建转移单", "退货", "登记收款", "查询客户账务", "收料", "提料", "付料", "批量转移", "供应商付款"]:
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
                        # 自动登记客户收款
                        result = await handle_payment_registration(ai_response, db)
                    elif ai_response.action == "提料":
                        # 自动创建客户提料单
                        result = await handle_gold_withdrawal(ai_response, db)
                    elif ai_response.action == "付料":
                        # 自动创建供应商付料单
                        result = await handle_gold_payment(ai_response, db, user_role)
                    elif ai_response.action == "批量转移":
                        # 按入库单号批量转移商品
                        result = await handle_batch_transfer(ai_response, db, user_role)
                    elif ai_response.action == "供应商付款":
                        # 自动登记供应商付款
                        result = await handle_supplier_cash_payment(ai_response, db)
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
            customer_debt_payload = None
            if ai_response.action == "查询客户账务":
                debt_name = ai_response.debt_customer_name or ai_response.customer_name
                debt_query_type = ai_response.debt_query_type or "all"
                if debt_name:
                    debt_response = await chat_debt_query(
                        customer_name=debt_name,
                        query_type=debt_query_type,
                        date_start=ai_response.date_start,
                        date_end=ai_response.date_end,
                        db=db
                    )
                    if debt_response.get("success"):
                        debt_data = debt_response.get("data") or {}
                        customer_debt_payload = {
                            "success": True,
                            "message": debt_response.get("message"),
                            **debt_data
                        }
                    else:
                        customer_debt_payload = {
                            "success": False,
                            "message": debt_response.get("message"),
                            "customer_name": debt_name
                        }
            
            # 收集数据
            data = ai_analyzer.collect_all_data(
                ai_response.action,
                request.message,
                db,
                order_no=getattr(ai_response, 'order_no', None),
                sales_order_no=getattr(ai_response, 'sales_order_no', None),
                user_role=user_role
            )
            if customer_debt_payload is not None:
                data["customer_debt"] = customer_debt_payload
            
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
