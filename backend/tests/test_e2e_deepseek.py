# -*- coding: utf-8 -*-
r"""DeepSeek API 端到端测试

Layer 3: 真实调用 DeepSeek API，需要 DEEPSEEK_API_KEY 环境变量。
没有 API key 时自动跳过。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_e2e_deepseek.py -v

跳过条件: 未设置 DEEPSEEK_API_KEY 环境变量
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

import pytest

SKIP_NO_KEY = pytest.mark.skipif(
    not os.getenv("DEEPSEEK_API_KEY"),
    reason="DEEPSEEK_API_KEY not set",
)


# ============================================================
# 旧架构 parse_user_message 端到端测试
# ============================================================

@SKIP_NO_KEY
class TestOldArchitectureE2E:

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.ai_parser import parse_user_message
        self.parse = parse_user_message

    def test_inbound(self):
        result = self.parse("入库 足金手镯 10g 工费15", user_role="product")
        assert result.action == "入库"

    def test_sales(self):
        result = self.parse("卖给张三 足金手镯 10g 工费15")
        assert result.action == "创建销售单"

    def test_return(self):
        result = self.parse("退货 足金手镯 10g 退给XX珠宝 质量问题")
        assert result.action == "退货"

    def test_finance_receipt(self):
        result = self.parse("张三来料100克")
        assert result.action == "收料"

    def test_query_customer(self):
        result = self.parse("查询客户张三")
        assert result.action == "查询客户"

    def test_confirm(self):
        result = self.parse("确认入库单RK20260206069900")
        assert result.action == "确认单据"

    def test_chat(self):
        result = self.parse("你好")
        assert result.action == "闲聊"


# ============================================================
# 新架构 parse_with_agent 端到端测试
# ============================================================

@SKIP_NO_KEY
class TestAgentE2E:

    @pytest.fixture(autouse=True)
    def _setup(self):
        from app.agents.settlement_agent import SettlementAgent
        from app.agents.agent_parser import parse_with_agent
        self.agent = SettlementAgent()
        self.parse = parse_with_agent

    def test_settlement_create(self):
        result = self.parse(self.agent, "帮张三做结算 结料")
        assert result.action == "创建结算单"

    def test_finance_receipt(self):
        result = self.parse(self.agent, "张老板交料5克")
        assert result.action == "收料"

    def test_query_debt(self):
        result = self.parse(self.agent, "张三的欠款情况")
        assert result.action == "查询客户账务"

    def test_query_inventory(self):
        result = self.parse(self.agent, "查询库存")
        assert result.action == "查询库存"

    def test_chat(self):
        result = self.parse(self.agent, "你好")
        assert result.action == "闲聊"


# ============================================================
# 对比测试 — 同一消息，两条路径应返回相同 action
# ============================================================

@SKIP_NO_KEY
class TestComparePathsE2E:

    @pytest.fixture(autouse=True)
    def _setup(self):
        from app.ai_parser import parse_user_message
        from app.agents.settlement_agent import SettlementAgent
        from app.agents.agent_parser import parse_with_agent
        self.old_parse = parse_user_message
        self.agent = SettlementAgent()
        self.new_parse = parse_with_agent

    @pytest.mark.parametrize("message", [
        "张三的欠款情况",
        "查询库存",
    ])
    def test_same_action(self, message):
        old_result = self.old_parse(message, user_role="settlement")
        new_result = self.new_parse(self.agent, message)
        assert old_result.action == new_result.action, (
            f"Action mismatch for '{message}': "
            f"old={old_result.action}, new={new_result.action}"
        )


# ============================================================
# query_engine.generate_query_plan 端到端测试
# ============================================================

@SKIP_NO_KEY
class TestQueryEngineE2E:

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.query_engine import generate_query_plan
        self.generate = generate_query_plan

    def test_customer_query_plan(self):
        plan = self.generate("查询客户张三")
        assert plan is not None
        assert "table" in plan

    def test_inventory_query_plan(self):
        plan = self.generate("查询库存")
        assert plan is not None
        assert "table" in plan


# ============================================================
# 角色推断测试
# ============================================================

@SKIP_NO_KEY
class TestRoleInferenceE2E:

    @pytest.fixture(autouse=True)
    def _import(self):
        from app.ai_parser import parse_user_message
        self.parse = parse_user_message

    def test_product_role_inbound(self):
        result = self.parse(
            "足金手镯 10g 工费15 供应商测试珠宝",
            user_role="product",
        )
        assert result.action == "入库"

    def test_counter_role_sales(self):
        result = self.parse(
            "足金手镯 10g 工费15 客户张三",
            user_role="counter",
        )
        assert result.action == "创建销售单"
