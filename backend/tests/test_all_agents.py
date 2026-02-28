# -*- coding: utf-8 -*-
r"""全角色 Agent 单元测试

测试所有 7 个 Agent 的 classify / get_allowed_actions / get_data_access / get_prompt。
纯逻辑测试，不调 API。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_all_agents.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.agents.counter_agent import CounterAgent
from app.agents.product_agent import ProductAgent
from app.agents.finance_agent import FinanceAgent
from app.agents.material_agent import MaterialAgent
from app.agents.sales_agent import SalesAgent
from app.agents.manager_agent import ManagerAgent
from app.agents.settlement_agent import SettlementAgent
from app.agents.registry import AgentRegistry
from app.agents import ALL_AGENTS


# ============================================================
# CounterAgent 测试
# ============================================================

class TestCounterAgent:

    @pytest.fixture
    def agent(self):
        return CounterAgent()

    def test_role_id(self, agent):
        assert agent.role_id == "counter"

    def test_role_name(self, agent):
        assert agent.role_name == "柜台"

    @pytest.mark.parametrize("msg,expected", [
        ("卖给张三 足金手镯 10g 工费15", "sales"),
        ("XS20260222001", "sales"),
        ("今天卖了多少钱", "sales"),
        ("销售单", "sales"),
        ("暂借足金手镯", "sales"),
        ("ZJ20260222001", "sales"),
        ("退给商品部 古法戒指 5g", "return"),
        ("张三要退货", "return"),
        ("客户退货", "return"),
        ("TH20260222001", "return"),
        ("查询客户张三", "query"),
        ("查询库存", "query"),
        ("查询转移单", "query"),
        ("TR20260222001", "query"),
        ("确认销售单XS20260222001", "system"),
        ("新建客户 张三", "system"),
        ("怎么开单", "system"),
        ("你好", "system"),
    ])
    def test_classify(self, agent, msg, expected):
        assert agent.classify(msg) == expected

    def test_allowed_actions_contains_sales(self, agent):
        actions = agent.get_allowed_actions()
        assert "创建销售单" in actions
        assert "查询销售单" in actions

    def test_allowed_actions_excludes_inbound(self, agent):
        actions = agent.get_allowed_actions()
        assert "入库" not in actions
        assert "收料" not in actions

    def test_data_access(self, agent):
        access = agent.get_data_access()
        assert "customers" in access
        assert "sales_orders" in access
        assert "suppliers" not in access

    def test_sales_prompt_contains_actions(self, agent):
        prompt = agent.get_prompt("sales", "卖给张三", "")
        assert "创建销售单" in prompt
        assert "查询销售单" in prompt


# ============================================================
# ProductAgent 测试
# ============================================================

class TestProductAgent:

    @pytest.fixture
    def agent(self):
        return ProductAgent()

    def test_role_id(self, agent):
        assert agent.role_id == "product"

    def test_role_name(self, agent):
        assert agent.role_name == "商品部"

    @pytest.mark.parametrize("msg,expected", [
        ("足金手镯 10g 工费15 入库", "inbound"),
        ("RK20260208001", "inbound"),
        ("查询入库单", "inbound"),
        ("查询库存", "inbound"),
        ("退货 足金手镯 退给金源珠宝", "return"),
        ("退给供应商", "return"),
        ("TH20260222001", "return"),
        ("把商品转到展厅", "return"),
        ("查询供应商", "query"),
        ("供应商分析", "query"),
        ("查询转移单", "query"),
        ("TR20260222001", "query"),
        ("确认入库单RK20260208001", "system"),
        ("新建供应商 金源珠宝", "system"),
        ("怎么入库", "system"),
        ("你好", "system"),
    ])
    def test_classify(self, agent, msg, expected):
        assert agent.classify(msg) == expected

    def test_allowed_actions_contains_inbound(self, agent):
        actions = agent.get_allowed_actions()
        assert "入库" in actions
        assert "退货" in actions
        assert "批量转移" in actions

    def test_allowed_actions_excludes_sales(self, agent):
        actions = agent.get_allowed_actions()
        assert "创建销售单" not in actions
        assert "收料" not in actions

    def test_data_access(self, agent):
        access = agent.get_data_access()
        assert "inbound_orders" in access
        assert "suppliers" in access
        assert "customers" not in access

    def test_inbound_prompt_contains_actions(self, agent):
        prompt = agent.get_prompt("inbound", "入库", "")
        assert "入库" in prompt
        assert "查询入库单" in prompt


# ============================================================
# FinanceAgent 测试
# ============================================================

class TestFinanceAgent:

    @pytest.fixture
    def agent(self):
        return FinanceAgent()

    def test_role_id(self, agent):
        assert agent.role_id == "finance"

    def test_role_name(self, agent):
        assert agent.role_name == "财务"

    @pytest.mark.parametrize("msg,expected", [
        ("张老板交料5克", "finance"),
        ("张老板提5克", "finance"),
        ("付20克给金源珠宝", "finance"),
        ("张三打款5000元", "finance"),
        ("张三的欠款", "finance"),
        ("对账单", "finance"),
        ("凭证查询", "finance"),
        ("暂借足金手镯", "finance"),
        ("帮张三做结算 结料", "settlement"),
        ("JS20260222001", "settlement"),
        ("RK20260208001", "inbound"),
        ("入库 足金手镯", "inbound"),
        ("XS20260222001", "sales"),
        ("卖给张三", "sales"),
        ("退货 足金手镯", "return"),
        ("查询客户张三", "query"),
        ("查询供应商", "query"),
        ("统计分析", "query"),
        ("确认入库单RK20260208001", "system"),
        ("你好", "system"),
    ])
    def test_classify(self, agent, msg, expected):
        assert agent.classify(msg) == expected

    def test_allowed_actions_full(self, agent):
        actions = agent.get_allowed_actions()
        assert "入库" in actions
        assert "创建销售单" in actions
        assert "创建结算单" in actions
        assert "收料" in actions
        assert "付料" in actions
        assert "查询客户" in actions

    def test_data_access_full(self, agent):
        access = agent.get_data_access()
        assert "inventory" in access
        assert "customers" in access
        assert "suppliers" in access
        assert "supplier_gold" in access


# ============================================================
# MaterialAgent 测试
# ============================================================

class TestMaterialAgent:

    @pytest.fixture
    def agent(self):
        return MaterialAgent()

    def test_role_id(self, agent):
        assert agent.role_id == "material"

    def test_role_name(self, agent):
        assert agent.role_name == "料部"

    @pytest.mark.parametrize("msg,expected", [
        ("付20克给金源珠宝", "finance"),
        ("给金源珠宝付款5000元", "finance"),
        ("金料情况", "finance"),
        ("供应商付款", "finance"),
        ("查询供应商", "query"),
        ("查询客户", "query"),
        ("查询库存", "query"),
        ("供应商分析", "query"),
        ("TR20260222001", "query"),
        ("新建供应商 金源珠宝", "system"),
        ("确认转移单TR20260222001", "query"),
        ("你好", "system"),
    ])
    def test_classify(self, agent, msg, expected):
        assert agent.classify(msg) == expected

    def test_allowed_actions(self, agent):
        actions = agent.get_allowed_actions()
        assert "付料" in actions
        assert "供应商付款" in actions
        assert "创建供应商" in actions
        assert "入库" not in actions
        assert "创建销售单" not in actions

    def test_data_access(self, agent):
        access = agent.get_data_access()
        assert "suppliers" in access
        assert "supplier_gold" in access
        assert "inbound_orders" not in access


# ============================================================
# SalesAgent 测试
# ============================================================

class TestSalesAgent:

    @pytest.fixture
    def agent(self):
        return SalesAgent()

    def test_role_id(self, agent):
        assert agent.role_id == "sales"

    def test_role_name(self, agent):
        assert agent.role_name == "业务员"

    @pytest.mark.parametrize("msg,expected", [
        ("查询客户张三", "query"),
        ("张三的欠款", "query"),
        ("XS20260222001", "query"),
        ("今天卖了多少钱", "query"),
        ("销售单", "query"),
        ("查询库存", "query"),
        ("你好", "system"),
        ("怎么查客户", "system"),
    ])
    def test_classify(self, agent, msg, expected):
        assert agent.classify(msg) == expected

    def test_allowed_actions_query_only(self, agent):
        actions = agent.get_allowed_actions()
        assert "查询客户" in actions
        assert "查询销售单" in actions
        assert "查询客户账务" in actions
        assert "创建销售单" not in actions
        assert "入库" not in actions
        assert "收料" not in actions

    def test_data_access(self, agent):
        access = agent.get_data_access()
        assert "customers" in access
        assert "customer_debt" in access
        assert "suppliers" not in access

    def test_query_prompt_warns_no_write(self, agent):
        prompt = agent.get_prompt("query", "卖给张三", "")
        assert "不能创建销售单" in prompt or "只有查询权限" in prompt


# ============================================================
# ManagerAgent 测试
# ============================================================

class TestManagerAgent:

    @pytest.fixture
    def agent(self):
        return ManagerAgent()

    def test_role_id(self, agent):
        assert agent.role_id == "manager"

    def test_role_name(self, agent):
        assert agent.role_name == "管理层"

    @pytest.mark.parametrize("msg,expected", [
        ("入库 足金手镯 10g", "inbound"),
        ("RK20260208001", "inbound"),
        ("查询库存", "inbound"),
        ("卖给张三 足金手镯", "sales"),
        ("XS20260222001", "sales"),
        ("退货 足金手镯", "return"),
        ("张老板交料5克", "finance"),
        ("对账单", "finance"),
        ("暂借足金手镯", "finance"),
        ("帮张三做结算", "settlement"),
        ("JS20260222001", "settlement"),
        ("查询客户张三", "query"),
        ("供应商分析", "query"),
        ("统计分析", "query"),
        ("确认入库单RK20260208001", "system"),
        ("新建客户 张三", "system"),
        ("你好", "system"),
    ])
    def test_classify(self, agent, msg, expected):
        assert agent.classify(msg) == expected

    def test_allowed_actions_full(self, agent):
        actions = agent.get_allowed_actions()
        assert "入库" in actions
        assert "创建销售单" in actions
        assert "创建结算单" in actions
        assert "收料" in actions
        assert "付料" in actions
        assert "生成图表" in actions

    def test_data_access_full(self, agent):
        access = agent.get_data_access()
        assert len(access) == 8


# ============================================================
# 全局注册表测试
# ============================================================

class TestAllAgentsRegistry:

    @pytest.fixture
    def registry(self):
        AgentRegistry._instance = None
        reg = AgentRegistry()
        for cls in ALL_AGENTS:
            reg.register(cls())
        yield reg
        AgentRegistry._instance = None

    def test_all_7_agents_registered(self, registry):
        agents = registry.list_agents()
        assert len(agents) == 7

    @pytest.mark.parametrize("role_id", [
        "counter", "product", "finance", "material", "sales", "manager", "settlement",
    ])
    def test_route_returns_agent(self, registry, role_id):
        agent = registry.route(role_id)
        assert agent is not None
        assert agent.role_id == role_id

    def test_unknown_role_returns_none(self, registry):
        assert registry.route("unknown") is None

    def test_no_duplicate_role_ids(self):
        role_ids = [cls().role_id for cls in ALL_AGENTS]
        assert len(role_ids) == len(set(role_ids))


# ============================================================
# 跨 Agent 对比测试 — 验证分类一致性
# ============================================================

class TestCrossAgentConsistency:
    """验证不同 Agent 对同一消息的分类在各自领域内是合理的"""

    def test_hello_all_agents_return_system(self):
        for cls in ALL_AGENTS:
            agent = cls()
            assert agent.classify("你好") == "system", f"{agent.role_id} failed on '你好'"

    def test_help_all_agents_return_system(self):
        for cls in ALL_AGENTS:
            agent = cls()
            assert agent.classify("怎么用") == "system", f"{agent.role_id} failed on '怎么用'"

    def test_confirm_all_agents_return_system(self):
        for cls in ALL_AGENTS:
            agent = cls()
            result = agent.classify("确认入库单RK20260208001")
            assert result == "system", f"{agent.role_id} returned '{result}' for confirm"
