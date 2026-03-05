"""
结算/金料 + DeepSeek 完整测试脚本

包含：
1. DeepSeek API：解析入库自然语言、入库全链路（解析 -> handle_inbound -> execute_inbound）
2. 结算与客户存料：创建 draft 结料结算 -> 取消 -> 校验客户存料是否回滚（当前已知 bug：未回滚）
3. 结算与客户存料：创建 draft 结料 -> 修改为结价 -> 校验客户存料是否回滚（当前已知 bug：未回滚）

运行方式：
- 需设置环境变量 DEEPSEEK_API_KEY 才会执行 DeepSeek 相关用例。
- 在 backend 目录下：
  pytest tests/test_settlement_gold_and_deepseek.py -v -s
  或直接：
  python tests/test_settlement_gold_and_deepseek.py
"""
import os
import sys
import asyncio
import time
from datetime import datetime, timezone, timedelta

import pytest

# 确保 backend 根目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()


def skip_if_no_deepseek():
    if not os.getenv("DEEPSEEK_API_KEY"):
        pytest.skip("DEEPSEEK_API_KEY not set, skip DeepSeek tests")


# ---------- Part 1: DeepSeek API 测试 ----------

@pytest.mark.asyncio
async def test_deepseek_parse_inbound_message():
    """DeepSeek 解析入库自然语言"""
    skip_if_no_deepseek()
    from app.ai_parser import parse_user_message

    msg = "古法黄金戒指 100克 工费6元 供应商金源珠宝，帮我做个入库"
    ai_response = parse_user_message(msg, user_role="product")
    assert ai_response.action == "入库", f"expected action=入库, got {ai_response.action}"
    assert ai_response.products, "expected products list"
    p = ai_response.products[0]
    assert p.product_name and ("戒指" in p.product_name or "古法" in p.product_name or p.product_name)
    assert p.weight == 100.0
    assert p.labor_cost == 6.0
    assert p.supplier and ("金" in p.supplier or "珠宝" in p.supplier or p.supplier)
    print("[OK] DeepSeek parse:", ai_response.action, p.product_name, p.weight, p.labor_cost, p.supplier)


@pytest.mark.asyncio
async def test_deepseek_inbound_full_flow():
    """全链路: DeepSeek 解析 -> handle_inbound -> execute_inbound"""
    skip_if_no_deepseek()
    from app.database import SessionLocal, init_db
    from app.ai_parser import parse_user_message
    from app.routers.inbound import handle_inbound, execute_inbound

    init_db()
    db = SessionLocal()
    try:
        msg = "古法黄金戒指 100克 工费6元 供应商金源珠宝，帮我做个入库"
        ai_response = parse_user_message(msg, user_role="product")
        assert ai_response.action == "入库"
        assert ai_response.products

        handle_result = await handle_inbound(ai_response, db)
        assert handle_result.get("success") is True
        assert handle_result.get("pending") is True
        card_data = handle_result.get("card_data")
        assert card_data and "product_name" in card_data and "weight" in card_data and "supplier" in card_data

        exec_result = await execute_inbound(card_data, db)
        assert exec_result.get("success") is True
        assert "order_no" in exec_result or "order_id" in exec_result
        print("[OK] Full flow: parse -> handle_inbound -> execute_inbound, order_no:", exec_result.get("order_no"))
    finally:
        db.close()


# ---------- Part 2: 结算与客户存料测试（取消 draft 是否回滚存料）----------

def _china_now():
    return datetime.now(timezone(timedelta(hours=8)))


def _create_customer_and_receipt(db, customer_name: str, gold_weight: float = 100.0):
    """创建客户、收料单并确认收料，使 CustomerGoldDeposit.current_balance = gold_weight"""
    from app.models import Customer
    from app.models.finance import GoldReceipt
    from app.routers.gold_material import get_or_create_customer_deposit
    from app.timezone_utils import china_now

    customer = db.query(Customer).filter(Customer.name == customer_name).first()
    if not customer:
        customer = Customer(
            name=customer_name,
            phone="13800000099",
            customer_type="个人",
        )
        db.add(customer)
        db.flush()

    receipt_no = f"SL{_china_now().strftime('%Y%m%d%H%M%S')}_{int(time.time() * 1000000) % 100000}"
    receipt = GoldReceipt(
        receipt_no=receipt_no,
        customer_id=customer.id,
        gold_weight=gold_weight,
        gold_fineness="足金999",
        status="received",
        created_by="测试",
        received_by="测试",
        received_at=china_now(),
    )
    db.add(receipt)
    db.flush()

    deposit = get_or_create_customer_deposit(customer.id, customer.name, db)
    deposit.current_balance = round(deposit.current_balance + gold_weight, 3)
    deposit.total_deposited = round(deposit.total_deposited + gold_weight, 3)
    deposit.last_transaction_at = china_now()
    db.flush()
    return customer, receipt, deposit


def _create_sales_order_direct(db, customer_id: int, customer_name: str, total_weight: float = 30.0):
    """直接插入待结算销售单（不扣库存），返回 SalesOrder"""
    from app.models import SalesOrder, SalesDetail

    order_no = f"TEST_SO_{int(time.time() * 1000)}"
    order = SalesOrder(
        order_no=order_no,
        order_date=_china_now(),
        customer_id=customer_id,
        customer_name=customer_name,
        salesperson="测试业务员",
        store_code="TEST",
        total_weight=total_weight,
        total_labor_cost=300.0,
        status="待结算",
    )
    db.add(order)
    db.flush()
    detail = SalesDetail(
        order_id=order.id,
        product_name="测试商品",
        weight=total_weight,
        labor_cost=10.0,
        total_labor_cost=300.0,
    )
    db.add(detail)
    db.flush()
    return order


@pytest.mark.asyncio
async def test_settlement_cancel_draft_rollback_deposit():
    """
    创建 draft 结料结算 -> 取消 -> 校验客户存料是否回滚。
    当前实现：取消后未回滚存料（已知 bug），本用例断言「应回滚」；
    若未修 bug 会失败并提示需在 cancel_settlement_order 中回滚 CustomerGoldDeposit。
    """
    from app.database import init_db, SessionLocal
    from app.main import app
    from app.database import get_db
    from fastapi.testclient import TestClient
    from app.models import CustomerGoldDeposit

    init_db()
    session = SessionLocal()

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    try:
        customer_name = f"测试结算取消_{int(time.time())}"
        customer, receipt, deposit = _create_customer_and_receipt(session, customer_name, gold_weight=100.0)
        balance_before_settlement = round(deposit.current_balance, 3)
        assert balance_before_settlement == 100.0, "收料后余额应为 100"

        sales_order = _create_sales_order_direct(session, customer.id, customer.name, total_weight=30.0)
        session.commit()

        r = client.post(
            "/api/settlement/orders",
            json={
                "sales_order_id": sales_order.id,
                "payment_method": "physical_gold",
                "physical_gold_weight": 30.0,
            },
            params={"user_role": "settlement"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        settlement_id = data.get("id") if data.get("id") else data.get("settlement", {}).get("id")
        assert settlement_id, "应返回结算单 id"

        session.expire_all()
        d = session.query(CustomerGoldDeposit).filter(CustomerGoldDeposit.customer_id == customer.id).first()
        balance_after_create = round(d.current_balance, 3)
        assert balance_after_create == 70.0, f"创建结料结算后余额应为 70，实际 {balance_after_create}"

        r2 = client.post(
            f"/api/settlement/orders/{settlement_id}/cancel",
            params={"user_role": "settlement"},
        )
        assert r2.status_code == 200, r2.text

        session.expire_all()
        d2 = session.query(CustomerGoldDeposit).filter(CustomerGoldDeposit.customer_id == customer.id).first()
        balance_after_cancel = round(d2.current_balance, 3)
        assert balance_after_cancel == balance_before_settlement, (
            f"取消 draft 结算后应回滚客户存料：期望 {balance_before_settlement}，实际 {balance_after_cancel}。"
            "若未修 bug，请在 cancel_settlement_order 中回滚 CustomerGoldDeposit 并冲正 CustomerGoldDepositTransaction。"
        )
        print("[OK] 取消 draft 结料结算后客户存料已回滚:", balance_after_cancel)
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.rollback()
        session.close()


@pytest.mark.asyncio
async def test_settlement_update_draft_to_cash_rollback_deposit():
    """
    创建 draft 结料结算 -> 修改为结价 -> 校验客户存料是否回滚。
    当前实现：修改为结价后未回滚存料（已知 bug），本用例断言「应回滚」。
    """
    from app.database import init_db, SessionLocal
    from app.main import app
    from app.database import get_db
    from fastapi.testclient import TestClient
    from app.models import CustomerGoldDeposit

    init_db()
    session = SessionLocal()

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    try:
        customer_name = f"测试结算改结价_{int(time.time())}"
        customer, receipt, deposit = _create_customer_and_receipt(session, customer_name, gold_weight=100.0)
        balance_before_settlement = round(deposit.current_balance, 3)
        assert balance_before_settlement == 100.0

        sales_order = _create_sales_order_direct(session, customer.id, customer.name, total_weight=30.0)
        session.commit()

        r = client.post(
            "/api/settlement/orders",
            json={
                "sales_order_id": sales_order.id,
                "payment_method": "physical_gold",
                "physical_gold_weight": 30.0,
            },
            params={"user_role": "settlement"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        settlement_id = data.get("id") or data.get("settlement", {}).get("id")
        assert settlement_id

        session.expire_all()
        d = session.query(CustomerGoldDeposit).filter(CustomerGoldDeposit.customer_id == customer.id).first()
        assert round(d.current_balance, 3) == 70.0

        r2 = client.put(
            f"/api/settlement/orders/{settlement_id}",
            json={"payment_method": "cash_price", "gold_price": 500.0},
            params={"user_role": "settlement"},
        )
        assert r2.status_code == 200, r2.text

        session.expire_all()
        d2 = session.query(CustomerGoldDeposit).filter(CustomerGoldDeposit.customer_id == customer.id).first()
        balance_after_update = round(d2.current_balance, 3)
        assert balance_after_update == balance_before_settlement, (
            f"draft 结料改为结价后应回滚客户存料：期望 {balance_before_settlement}，实际 {balance_after_update}。"
            "请在 update_settlement_order 中当支付方式从结料/混合改为结价时回滚 CustomerGoldDeposit。"
        )
        print("[OK] draft 结料改为结价后客户存料已回滚:", balance_after_update)
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.rollback()
        session.close()


if __name__ == "__main__":
    async def run_all():
        print("=" * 60)
        print("1. DeepSeek 解析入库")
        if os.getenv("DEEPSEEK_API_KEY"):
            await test_deepseek_parse_inbound_message()
            await test_deepseek_inbound_full_flow()
        else:
            print("  (跳过: DEEPSEEK_API_KEY 未设置)")

        print("=" * 60)
        print("2. 结算取消 draft 是否回滚存料")
        await test_settlement_cancel_draft_rollback_deposit()

        print("=" * 60)
        print("3. 结算 draft 结料改结价是否回滚存料")
        await test_settlement_update_draft_to_cash_rollback_deposit()

        print("=" * 60)
        print("All tests passed.")

    asyncio.run(run_all())
