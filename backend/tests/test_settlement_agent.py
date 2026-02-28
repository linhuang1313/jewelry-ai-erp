# -*- coding: utf-8 -*-
r"""SettlementAgent 单元测试

Layer 1: 本地测试，无需启动服务器，无需 DeepSeek API key。
所有测试用例走关键词路径，不触发 AI 兜底分类。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_settlement_agent.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.agents.settlement_agent import SettlementAgent
from app.agents.registry import AgentRegistry
from app.agents.base import BaseAgent


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def agent():
    return SettlementAgent()


@pytest.fixture
def fresh_registry():
    """每个测试用独立的 registry，避免单例污染"""
    AgentRegistry._instance = None
    reg = AgentRegistry()
    yield reg
    AgentRegistry._instance = None


# ============================================================
# 1.1 分类器测试 — 关键词路径（不调 API）
# ============================================================

class TestClassifySettlement:
    """结算类关键词 → 'settlement'"""

    def test_js_order_no(self, agent):
        assert agent.classify("JS20260222001") == "settlement"

    def test_settlement_with_customer(self, agent):
        assert agent.classify("帮张三做结算 结料") == "settlement"

    def test_query_settlement(self, agent):
        assert agent.classify("查询结算单") == "settlement"

    def test_jieliao_keyword(self, agent):
        assert agent.classify("张三结料") == "settlement"

    def test_jiejia_keyword(self, agent):
        assert agent.classify("结价 金价550") == "settlement"

    def test_hunhe_keyword(self, agent):
        assert agent.classify("混合支付") == "settlement"


class TestClassifyFinance:
    """财务类关键词 → 'finance'"""

    def test_jiaoliao(self, agent):
        assert agent.classify("张老板交料5克") == "finance"

    def test_tiliao(self, agent):
        assert agent.classify("张老板提5克") == "finance"

    def test_qiankuan(self, agent):
        assert agent.classify("张三的欠款") == "finance"

    def test_cunliao_jiejia(self, agent):
        assert agent.classify("存料结价3克 金价800") == "finance"

    def test_cunliao_dikou(self, agent):
        assert agent.classify("存料抵扣2克 金价810") == "finance"

    def test_liao_jiejia(self, agent):
        assert agent.classify("料结价5克 金价820") == "finance"

    def test_zanjie(self, agent):
        assert agent.classify("查一下暂借单") == "finance"

    def test_duizhang(self, agent):
        assert agent.classify("对账单") == "finance"

    def test_pingzheng(self, agent):
        assert agent.classify("查凭证") == "finance"

    def test_baoxiao(self, agent):
        assert agent.classify("报销交通费200元") == "finance"

    def test_fu_digit(self, agent):
        assert agent.classify("付20克给金源") == "finance"

    def test_ti_digit(self, agent):
        assert agent.classify("提5克") == "finance"

    def test_zj_order_no(self, agent):
        assert agent.classify("ZJ20260222001") == "finance"

    def test_hh_order_no(self, agent):
        assert agent.classify("HH20260222001") == "finance"

    def test_shoukuan(self, agent):
        assert agent.classify("收款5000元") == "finance"

    def test_jinliao(self, agent):
        assert agent.classify("金料流水") == "finance"

    def test_yue(self, agent):
        assert agent.classify("余额查询") == "finance"


class TestClassifySales:
    """销售类关键词 → 'sales'"""

    def test_xs_order_no(self, agent):
        assert agent.classify("XS20260222001") == "sales"

    def test_xiaoshou_keyword(self, agent):
        assert agent.classify("销售单") == "sales"

    def test_yeji_keyword(self, agent):
        assert agent.classify("业绩排行") == "sales"


class TestClassifyQuery:
    """通用查询关键词 → 'query'"""

    def test_query_customer(self, agent):
        assert agent.classify("查询客户张三") == "query"

    def test_query_inventory(self, agent):
        assert agent.classify("查询库存") == "query"

    def test_tongji(self, agent):
        assert agent.classify("统计分析") == "query"

    def test_tr_order_no(self, agent):
        assert agent.classify("TR20260222001") == "query"

    def test_gongyingshang(self, agent):
        assert agent.classify("供应商列表") == "query"


class TestClassifySystem:
    """系统/帮助/确认 → 'system'"""

    def test_confirm_js(self, agent):
        assert agent.classify("确认JS20260222001") == "system"

    def test_unconfirm_rk(self, agent):
        assert agent.classify("反确认RK20260222001") == "system"

    def test_help_zenme(self, agent):
        assert agent.classify("怎么结算") == "system"

    def test_help_ruhe(self, agent):
        assert agent.classify("如何查询") == "system"

    def test_help_jiaowo(self, agent):
        assert agent.classify("教我操作") == "system"


# ============================================================
# 1.2 Registry 路由测试
# ============================================================

class TestRegistry:

    def test_register_and_route(self, fresh_registry):
        agent = SettlementAgent()
        fresh_registry.register(agent)
        routed = fresh_registry.route("settlement")
        assert routed is agent

    def test_unregistered_returns_none(self, fresh_registry):
        assert fresh_registry.route("counter") is None
        assert fresh_registry.route("manager") is None
        assert fresh_registry.route("product") is None

    def test_has_registered(self, fresh_registry):
        fresh_registry.register(SettlementAgent())
        assert fresh_registry.has("settlement") is True
        assert fresh_registry.has("counter") is False

    def test_list_agents(self, fresh_registry):
        fresh_registry.register(SettlementAgent())
        agents = fresh_registry.list_agents()
        assert agents == {"settlement": "结算专员"}

    def test_get_agent(self, fresh_registry):
        agent = SettlementAgent()
        fresh_registry.register(agent)
        assert fresh_registry.get("settlement") is agent
        assert fresh_registry.get("counter") is None


# ============================================================
# 1.3 Agent 属性测试
# ============================================================

class TestAgentProperties:

    def test_role_id(self, agent):
        assert agent.role_id == "settlement"

    def test_role_name(self, agent):
        assert agent.role_name == "结算专员"

    def test_system_prompt_not_empty(self, agent):
        assert len(agent.system_prompt) > 0
        assert "结算" in agent.system_prompt

    def test_is_base_agent(self, agent):
        assert isinstance(agent, BaseAgent)

    def test_repr(self, agent):
        assert "SettlementAgent" in repr(agent)
        assert "settlement" in repr(agent)


class TestAllowedActions:

    def test_contains_settlement_actions(self, agent):
        actions = agent.get_allowed_actions()
        assert "创建结算单" in actions
        assert "查询结算单" in actions

    def test_contains_finance_actions(self, agent):
        actions = agent.get_allowed_actions()
        assert "收料" in actions
        assert "提料" in actions
        assert "查询客户账务" in actions
        assert "存料结价" in actions

    def test_contains_query_actions(self, agent):
        actions = agent.get_allowed_actions()
        assert "查询客户" in actions
        assert "查询库存" in actions

    def test_contains_system_actions(self, agent):
        actions = agent.get_allowed_actions()
        assert "闲聊" in actions
        assert "系统帮助" in actions

    def test_does_not_contain_inbound(self, agent):
        actions = agent.get_allowed_actions()
        assert "入库" not in actions
        assert "退货" not in actions
        assert "创建销售单" not in actions


class TestCanHandle:

    def test_can_handle_settlement(self, agent):
        assert agent.can_handle("创建结算单") is True
        assert agent.can_handle("查询结算单") is True

    def test_can_handle_finance(self, agent):
        assert agent.can_handle("收料") is True
        assert agent.can_handle("提料") is True

    def test_cannot_handle_inbound(self, agent):
        assert agent.can_handle("入库") is False
        assert agent.can_handle("退货") is False
        assert agent.can_handle("创建销售单") is False
        assert agent.can_handle("批量转移") is False


class TestDataAccess:

    def test_has_customer_access(self, agent):
        access = agent.get_data_access()
        assert "customers" in access
        assert "customer_debt" in access

    def test_has_sales_access(self, agent):
        assert "sales_orders" in agent.get_data_access()

    def test_has_inventory_access(self, agent):
        assert "inventory" in agent.get_data_access()

    def test_no_supplier_gold_access(self, agent):
        access = agent.get_data_access()
        assert "supplier_gold" not in access


# ============================================================
# 1.4 Prompt 生成测试（不调 API）
# ============================================================

class TestPromptGeneration:

    def test_settlement_prompt_contains_actions(self, agent):
        prompt = agent.get_prompt("settlement", "帮张三结算", "")
        assert "创建结算单" in prompt
        assert "查询结算单" in prompt

    def test_settlement_prompt_excludes_unrelated(self, agent):
        prompt = agent.get_prompt("settlement", "帮张三结算", "")
        assert "入库" not in prompt
        assert "退货" not in prompt

    def test_finance_prompt_contains_actions(self, agent):
        prompt = agent.get_prompt("finance", "张老板交料5克", "")
        assert "收料" in prompt
        assert "提料" in prompt
        assert "查询客户账务" in prompt

    def test_sales_prompt_is_query_only(self, agent):
        prompt = agent.get_prompt("sales", "查询销售单", "")
        assert "查询销售单" in prompt
        lines = prompt.split("\n")
        action_lines = [l for l in lines if l.strip().startswith("- action:")]
        for line in action_lines:
            assert "创建销售单" not in line

    def test_query_prompt_contains_actions(self, agent):
        prompt = agent.get_prompt("query", "查询客户", "")
        assert "查询客户" in prompt
        assert "查询库存" in prompt

    def test_system_prompt_contains_actions(self, agent):
        prompt = agent.get_prompt("system", "你好", "")
        assert "闲聊" in prompt
        assert "确认单据" in prompt

    def test_unknown_category_falls_back_to_system(self, agent):
        prompt = agent.get_prompt("unknown_category", "随便说", "")
        assert "闲聊" in prompt

    def test_prompt_includes_context(self, agent):
        ctx = "【最近操作结果】\n- 操作类型：结算"
        prompt = agent.get_prompt("settlement", "继续", ctx)
        assert "最近操作结果" in prompt

    def test_prompt_includes_user_message(self, agent):
        prompt = agent.get_prompt("settlement", "帮张三结算 结料", "")
        assert "帮张三结算 结料" in prompt

    def test_settlement_prompt_shorter_than_old(self, agent):
        """Agent 专属 Prompt 应显著短于旧架构的全局 Prompt"""
        from app.ai_prompts import get_sales_prompt
        old_prompt = get_sales_prompt("帮张三结算", "")
        new_prompt = agent.get_prompt("settlement", "帮张三结算", "")
        assert len(new_prompt) < len(old_prompt), (
            f"Agent prompt ({len(new_prompt)} chars) should be shorter "
            f"than old prompt ({len(old_prompt)} chars)"
        )
