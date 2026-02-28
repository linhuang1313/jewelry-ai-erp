"""
卡片终极闭环执行器
当所有 target_roles 都确认后，根据 card_type 执行真实的数据库平账操作。
所有操作在调用方的同一个 db 事务中完成（不调用 db.commit）。
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

CHINA_TZ = timezone(timedelta(hours=8))


def china_now() -> datetime:
    return datetime.now(CHINA_TZ)


CARD_TYPE_EXECUTORS: Dict[str, Any] = {}


def register_executor(card_type: str):
    """装饰器：注册 card_type 对应的 executor"""
    def decorator(func):
        CARD_TYPE_EXECUTORS[card_type] = func
        return func
    return decorator


async def on_card_completed(card, db: Session) -> Dict[str, Any]:
    """
    终极闭环入口。
    在 execute 端点的同一事务中调用，不 commit。
    """
    from ..models.action_card import Notification

    executor = CARD_TYPE_EXECUTORS.get(card.card_type)
    if not executor:
        logger.warning(f"No executor for card_type={card.card_type}, skip business logic")
        return {"success": True, "summary": f"卡片 {card.card_id} 已完成（无关联业务操作）"}

    payload = dict(card.payload or {})
    payload["action_card_id"] = card.card_id

    actions = card.actions_taken or []
    confirmed_roles = [a["role"] for a in actions if a.get("action") == "confirm"]
    payload["confirmed_by_roles"] = confirmed_roles

    result = await executor(payload, db)

    if not result.get("success", False):
        return result

    notification = Notification(
        target_role=card.creator_role,
        target_user=card.creator_id,
        title=result.get("summary", f"卡片 {card.card_id} 已完成"),
        body=result.get("detail"),
        card_id=card.card_id,
        notification_type="card_completed",
    )
    db.add(notification)

    return result


# ============= 收款确认 executor =============

@register_executor("payment_confirm")
async def execute_payment_confirm(payload: dict, db: Session) -> Dict[str, Any]:
    """
    收款确认的真实平账逻辑。
    payload 字段:
      customer_name, total_amount, gold_amount, labor_amount,
      image_url, related_settlements, original_message
    """
    from ..models import Customer
    from ..models.finance import PaymentRecord, AccountReceivable
    from datetime import date

    customer_name = payload.get("customer_name", "")
    total_amount = float(payload.get("total_amount", 0))
    gold_amount = float(payload.get("gold_amount", 0))
    labor_amount = float(payload.get("labor_amount", 0))

    if total_amount <= 0:
        return {"success": False, "summary": "收款金额必须大于 0"}

    # 校验金额明细：gold_amount + labor_amount 必须等于 total_amount
    parts_sum = round(gold_amount + labor_amount, 2)
    if parts_sum != round(total_amount, 2):
        diff = round(total_amount - gold_amount, 2)
        if gold_amount > 0 and labor_amount == 0:
            labor_amount = diff
        elif labor_amount > 0 and gold_amount == 0:
            gold_amount = diff
        else:
            labor_amount = round(total_amount - gold_amount, 2)
        logger.warning(
            f"[协同] 金额明细不平衡 (金款={gold_amount}+工费={labor_amount}≠总额={total_amount})，已自动补正工费为 {labor_amount}"
        )

    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        return {"success": False, "summary": f"未找到客户「{customer_name}」，平账中止"}

    now = china_now()
    payment_no = f"SK{now.strftime('%Y%m%d%H%M%S%f')[:18]}"

    confirmed_roles = payload.get("confirmed_by_roles", [])
    finance_confirmer = "财务" if "finance" in confirmed_roles else None
    settlement_reviewer = "结算" if "settlement" in confirmed_roles else None

    payment = PaymentRecord(
        payment_no=payment_no,
        customer_id=customer.id,
        payment_date=date.today(),
        amount=total_amount,
        gold_amount=gold_amount,
        labor_amount=labor_amount,
        payment_method="bank_transfer",
        receipt_reason="货款",
        action_card_id=payload.get("action_card_id"),
        confirmed_by=finance_confirmer,
        confirmed_at=now,
        reviewed_by=settlement_reviewer,
        remark="跨角色协同收款确认",
        operator="系统-协同卡片",
        voucher_images=payload.get("image_url"),
    )
    db.add(payment)
    db.flush()

    # FIFO 冲抵应收账款
    unpaid = (
        db.query(AccountReceivable)
        .filter(
            AccountReceivable.customer_id == customer.id,
            AccountReceivable.status.in_(["unpaid", "overdue"]),
            AccountReceivable.unpaid_amount > 0,
        )
        .order_by(AccountReceivable.credit_start_date.asc())
        .all()
    )

    remaining = total_amount
    offset_details = []
    for recv in unpaid:
        if remaining <= 0:
            break
        offset = min(remaining, recv.unpaid_amount)
        recv.received_amount = round((recv.received_amount or 0) + offset, 2)
        recv.unpaid_amount = round(float(recv.total_amount or 0) - float(recv.received_amount or 0), 2)
        if recv.unpaid_amount <= 0:
            recv.status = "paid"
        offset_details.append({"receivable_id": recv.id, "amount": round(offset, 2)})
        remaining = round(remaining - offset, 2)

    # 金料账户处理（如有金料部分）
    gold_tx_id = None
    if gold_amount > 0:
        from ..models import CustomerGoldDeposit, CustomerGoldDepositTransaction

        deposit = (
            db.query(CustomerGoldDeposit)
            .filter(CustomerGoldDeposit.customer_id == customer.id)
            .first()
        )
        if deposit:
            balance_before = deposit.current_balance
            deposit.current_balance = round(float(deposit.current_balance or 0) - gold_amount, 3)
            deposit.total_used = round(float(deposit.total_used or 0) + gold_amount, 3)
            deposit.last_transaction_at = now

            tx = CustomerGoldDepositTransaction(
                customer_id=customer.id,
                customer_name=customer.name,
                transaction_type="use",
                amount=gold_amount,
                balance_before=balance_before,
                balance_after=deposit.current_balance,
                remark="收款确认-金料部分抵扣",
                created_by="系统-协同卡片",
            )
            db.add(tx)
            db.flush()
            gold_tx_id = tx.id

    # 更新客户统计
    customer.total_purchase_amount = round((customer.total_purchase_amount or 0) + total_amount, 2)

    # ===== 自动生成 FBL 收款凭证 =====
    fbl_voucher_result = None
    try:
        from .fbl_voucher_service import create_payment_voucher

        summary_text = f"收 {customer_name} 货款"
        fbl_voucher_result = create_payment_voucher(
            customer_name=customer_name,
            total_amount=total_amount,
            payment_date=date.today(),
            summary=summary_text,
            maker="系统-协同卡片",
        )
        if fbl_voucher_result.get("success"):
            logger.info(f"[协同] FBL 收款凭证已自动生成: {fbl_voucher_result.get('voucher_code')}")
        else:
            logger.warning(f"[协同] FBL 收款凭证生成失败: {fbl_voucher_result.get('message')}")
    except Exception as fbl_err:
        logger.warning(f"[协同] FBL 凭证生成异常（不影响主流程）: {fbl_err}")
        fbl_voucher_result = {"success": False, "message": str(fbl_err)}

    detail_parts = [
        f"收款记录 #{payment.id} 已创建",
        f"冲抵 {len(offset_details)} 笔应收",
    ]
    if gold_tx_id:
        detail_parts.append(f"金料抵扣 ¥{gold_amount:,.2f}")
    if remaining > 0:
        detail_parts.append(f"余额 ¥{remaining:,.2f} 待分配")
    if fbl_voucher_result and fbl_voucher_result.get("success"):
        detail_parts.append(f"收款凭证 {fbl_voucher_result['voucher_code']} 已自动生成")

    return {
        "success": True,
        "summary": f"{customer_name} 的 ¥{total_amount:,.2f} 收款已由财务和结算核收完毕，成功入账！",
        "detail": "；".join(detail_parts),
        "payment_record_id": payment.id,
        "payment_no": payment_no,
        "offset_details": offset_details,
        "gold_transaction_id": gold_tx_id,
        "fbl_voucher": fbl_voucher_result,
    }


# ============= 结算确认 executor =============

@register_executor("settlement_confirm")
async def execute_settlement_confirm(payload: dict, db: Session) -> Dict[str, Any]:
    """
    结算确认的执行逻辑：根据协同卡片信息自动创建结算单。
    payload 字段: customer_name, payment_method, gold_weight, gold_price, sales_order_id, sales_order_no
    卡片创建时已完成前置验证（客户存在、销售单存在、金价检查），此处做二次确认防并发。
    """
    from ..models import Customer, SalesOrder, SettlementOrder, SalesDetail

    customer_name = payload.get("customer_name", "")
    payment_method_raw = payload.get("payment_method", "结料")
    gold_price = float(payload.get("gold_price", 0))
    pre_validated_so_id = payload.get("sales_order_id")

    method_map = {"结料": "physical_gold", "结价": "cash_price", "混合": "mixed"}
    payment_method = method_map.get(payment_method_raw, "physical_gold")

    if payment_method == "cash_price" and gold_price <= 0:
        return {"success": False, "summary": "结价方式需要提供金价，请重新发起协同并注明金价"}

    # 优先使用卡片创建时已验证的 sales_order_id
    if pre_validated_so_id:
        sales_order = db.query(SalesOrder).filter(SalesOrder.id == pre_validated_so_id).first()
        if not sales_order:
            return {"success": False, "summary": f"关联的销售单（ID:{pre_validated_so_id}）已不存在，请重新发起"}
    else:
        customer = db.query(Customer).filter(Customer.name == customer_name).first()
        if not customer:
            return {"success": False, "summary": f"未找到客户「{customer_name}」，结算中止"}
        sales_order = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.status.in_(["confirmed", "待结算"])
        ).order_by(SalesOrder.create_time.desc()).first()
        if not sales_order:
            return {"success": False, "summary": f"客户「{customer_name}」没有待结算的销售单，请先开销售单"}

    # 二次检查防并发：确认期间可能已有人创建了结算单
    existing = db.query(SettlementOrder).filter(
        SettlementOrder.sales_order_id == sales_order.id,
        SettlementOrder.status != "cancelled"
    ).first()
    if existing:
        return {"success": False, "summary": f"销售单 {sales_order.order_no} 已有结算单 {existing.settlement_no}，无需重复创建"}

    so_total_weight = sales_order.total_weight or 0.0
    so_total_labor_cost = sales_order.total_labor_cost or 0.0

    if so_total_weight <= 0:
        return {"success": False, "summary": f"销售单 {sales_order.order_no} 总克重为0，无法结算"}

    if payment_method == "cash_price":
        if gold_price <= 0:
            return {"success": False, "summary": "结价方式需要提供金价"}
        material_amount = float(gold_price or 0) * float(so_total_weight or 0)
        physical_gold_weight = 0.0
    elif payment_method == "physical_gold":
        material_amount = 0
        physical_gold_weight = so_total_weight
    else:
        return {"success": False, "summary": "协同卡片暂不支持混合支付，请前往结算管理页面操作"}

    now = china_now()
    from sqlalchemy import func as sqlfunc
    count = db.query(SettlementOrder).filter(
        SettlementOrder.settlement_no.like(f"JS{now.strftime('%Y%m%d')}%")
    ).count()
    settlement_no = f"JS{now.strftime('%Y%m%d')}{count + 1:03d}"

    labor_amount = so_total_labor_cost
    total_amount = material_amount + float(labor_amount or 0)

    confirmed_roles = payload.get("confirmed_by_roles", [])
    confirmed_by = "、".join(confirmed_roles) if confirmed_roles else "协同确认"

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
        created_by=f"协同卡片({confirmed_by})",
        created_at=now,
        remark=f"跨角色协同结算确认",
    )
    db.add(new_settlement)
    db.flush()

    method_label = {"cash_price": "结价", "physical_gold": "结料"}.get(payment_method, payment_method)
    detail_parts = [
        f"结算单 {settlement_no} 已创建（草稿）",
        f"销售单 {sales_order.order_no}",
        f"结算方式 {method_label}",
        f"总克重 {so_total_weight:.2f}克",
    ]
    if payment_method == "cash_price":
        detail_parts.append(f"总额 ¥{total_amount:,.2f}")

    return {
        "success": True,
        "summary": f"{customer_name} 的结算单 {settlement_no} 已由{confirmed_by}协同确认，已创建草稿！",
        "detail": "；".join(detail_parts),
        "settlement_no": settlement_no,
        "settlement_id": new_settlement.id,
        "sales_order_no": sales_order.order_no,
    }


# ============= 提料确认 executor =============

@register_executor("withdrawal_confirm")
async def execute_withdrawal_confirm(payload: dict, db: Session) -> Dict[str, Any]:
    """
    结算确认提料：扣减客户存料余额并完成提料单。
    业务员拿打印单去料部取实物金料，料部无需再在系统中确认。
    """
    from ..models import Customer, CustomerGoldDeposit, CustomerGoldDepositTransaction, CustomerWithdrawal
    from ..models import OrderStatusLog

    customer_name = payload.get("customer_name", "")
    gold_weight = float(payload.get("gold_weight", 0))
    withdrawal_id = payload.get("withdrawal_id")

    if gold_weight <= 0:
        return {"success": False, "summary": "提料克重必须大于0"}

    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        return {"success": False, "summary": f"未找到客户「{customer_name}」，提料中止"}

    deposit = db.query(CustomerGoldDeposit).filter(
        CustomerGoldDeposit.customer_id == customer.id
    ).first()

    if not deposit:
        return {"success": False, "summary": f"客户「{customer_name}」没有存料记录"}

    cb = float(deposit.current_balance)
    available_gold = abs(cb) if cb < 0 else cb
    if available_gold < gold_weight:
        return {
            "success": False,
            "summary": f"客户「{customer_name}」存料余额不足：当前存料 {available_gold:.3f}克，需 {gold_weight:.3f}克"
        }

    now = china_now()
    balance_before = float(deposit.current_balance)
    deposit.current_balance = round(balance_before + gold_weight, 3)
    deposit.total_used = round(float(deposit.total_used or 0) + gold_weight, 3)
    deposit.last_transaction_at = now

    withdrawal_no = payload.get("withdrawal_no", "")

    if withdrawal_id:
        withdrawal = db.query(CustomerWithdrawal).filter(CustomerWithdrawal.id == withdrawal_id).first()
        if withdrawal and withdrawal.status == "pending":
            withdrawal.status = "completed"
            withdrawal.completed_by = "协同卡片确认"
            withdrawal.completed_at = now
            withdrawal_no = withdrawal.withdrawal_no

            status_log = OrderStatusLog(
                order_type="withdrawal", order_id=withdrawal.id,
                action="complete", old_status="pending", new_status="completed",
                operated_by="协同卡片确认", operated_at=now,
                remark=f"协同提料确认：{withdrawal_no}"
            )
            db.add(status_log)

    tx = CustomerGoldDepositTransaction(
        customer_id=customer.id,
        customer_name=customer.name,
        transaction_type="withdrawal",
        amount=gold_weight,
        balance_before=balance_before,
        balance_after=deposit.current_balance,
        remark=f"协同提料确认：{withdrawal_no}" if withdrawal_no else "跨角色协同提料确认",
        created_by="系统-协同卡片",
    )
    db.add(tx)
    db.flush()

    confirmed_roles = payload.get("confirmed_by_roles", [])
    confirmed_by = "、".join(confirmed_roles) if confirmed_roles else "协同确认"

    display_before = abs(balance_before)
    display_after = abs(float(deposit.current_balance))

    return {
        "success": True,
        "summary": f"{customer_name} 提料 {gold_weight:.3f}克 已由{confirmed_by}确认，存料余额 {display_after:.3f}克",
        "detail": f"提料前余额 {display_before:.3f}克 → 提料后余额 {display_after:.3f}克",
        "withdrawal_amount": gold_weight,
        "withdrawal_id": withdrawal_id,
        "withdrawal_no": withdrawal_no,
        "balance_before": display_before,
        "balance_after": display_after,
        "transaction_id": tx.id,
    }
