# -*- coding: utf-8 -*-
"""PromptSkill 单元测试 — 测试所有 7 个 PromptSkill 的 matches() 和基本属性"""

import pytest

from app.agents.skills.system_prompt_skill import SystemPromptSkill
from app.agents.skills.settlement_prompt_skill import SettlementPromptSkill
from app.agents.skills.finance_prompt_skill import FinancePromptSkill
from app.agents.skills.sales_prompt_skill import SalesPromptSkill
from app.agents.skills.inbound_prompt_skill import InboundPromptSkill
from app.agents.skills.return_prompt_skill import ReturnPromptSkill
from app.agents.skills.query_prompt_skill import QueryPromptSkill


class TestSystemPromptSkill:
    skill = SystemPromptSkill()

    def test_name(self):
        assert self.skill.name == "system"

    def test_priority(self):
        assert self.skill.priority == 10

    @pytest.mark.parametrize("msg,expected", [
        ("确认销售单XS20260222001", True),
        ("XS20260222001反确认", True),
        ("反确认入库单RK20260208001", True),
        ("怎么开单", True),
        ("如何查询", True),
        ("帮助", True),
        ("新建客户 张三", True),
        ("创建供应商 金源珠宝", True),
        ("你好", True),
        ("您好", True),
        ("谢谢", True),
        ("足金手镯 10g", False),
        ("查询库存", False),
        ("张老板交料5克", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected

    def test_get_prompt_contains_role(self):
        prompt = self.skill.get_prompt("你好", "", "柜台", "系统提示")
        assert "柜台" in prompt
        assert "闲聊" in prompt


class TestSettlementPromptSkill:
    skill = SettlementPromptSkill()

    def test_name(self):
        assert self.skill.name == "settlement"

    def test_priority(self):
        assert self.skill.priority == 30

    @pytest.mark.parametrize("msg,expected", [
        ("帮张三结算", True),
        ("查询结算单", True),
        ("JS20260222001", True),
        ("结价550", True),
        ("结料", True),
        ("混合结算", True),
        ("存料结价3克", False),
        ("料结价", False),
        ("存料抵扣", False),
        ("查询库存", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected

    def test_get_prompt_contains_settlement_fields(self):
        prompt = self.skill.get_prompt("帮张三结算", "", "结算专员", "系统提示")
        assert "创建结算单" in prompt
        assert "查询结算单" in prompt


class TestFinancePromptSkill:
    skill = FinancePromptSkill()

    def test_name(self):
        assert self.skill.name == "finance"

    def test_priority(self):
        assert self.skill.priority == 45

    @pytest.mark.parametrize("msg,expected", [
        ("张老板交料5克", True),
        ("张老板提5克", True),
        ("付20克给金源珠宝", True),
        ("张三的欠款", True),
        ("对账单", True),
        ("凭证查询", True),
        ("暂借足金手镯", True),
        ("归还暂借", True),
        ("存料结价3克", True),
        ("ZJ20260222001", True),
        ("HH20260222001", True),
        ("查询库存", False),
        ("入库", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected

    def test_actions_count(self):
        assert len(self.skill.actions) == 14


class TestSalesPromptSkill:
    skill = SalesPromptSkill()

    def test_name(self):
        assert self.skill.name == "sales"

    def test_priority(self):
        assert self.skill.priority == 40

    @pytest.mark.parametrize("msg,expected", [
        ("卖给张三 足金手镯", True),
        ("销售单", True),
        ("XS20260222001", True),
        ("开单", True),
        ("业绩", True),
        ("查询库存", False),
        ("退货", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected


class TestInboundPromptSkill:
    skill = InboundPromptSkill()

    def test_name(self):
        assert self.skill.name == "inbound"

    def test_priority(self):
        assert self.skill.priority == 40

    @pytest.mark.parametrize("msg,expected", [
        ("入库 足金手镯 10g", True),
        ("查询入库单", True),
        ("RK20260208001", True),
        ("退货", False),
        ("销售单", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected


class TestReturnPromptSkill:
    skill = ReturnPromptSkill()

    def test_name(self):
        assert self.skill.name == "return"

    def test_priority(self):
        assert self.skill.priority == 20

    @pytest.mark.parametrize("msg,expected", [
        ("退货 足金手镯", True),
        ("退给供应商", True),
        ("客户退货", True),
        ("销退", True),
        ("TH20260222001", True),
        ("退库", True),
        ("我要退", True),
        ("把商品转到展厅", True),
        ("转移到柜台B", True),
        ("退一下", True),
        ("查询退货单", True),
        ("查询转移单", False),
        ("TR20260222001退", False),
        ("入库", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected


class TestQueryPromptSkill:
    skill = QueryPromptSkill()

    def test_name(self):
        assert self.skill.name == "query"

    def test_priority(self):
        assert self.skill.priority == 60

    @pytest.mark.parametrize("msg,expected", [
        ("查询客户张三", True),
        ("统计分析", True),
        ("供应商分析", True),
        ("查询转移单", True),
        ("TR20260222001", True),
        ("图表", True),
        ("入库", False),
        ("退货", False),
    ])
    def test_matches(self, msg, expected):
        assert self.skill.matches(msg) == expected


class TestSkillPriorityOrder:
    """测试 Skill 优先级排序正确性"""

    all_skills = [
        SystemPromptSkill(),
        ReturnPromptSkill(),
        SettlementPromptSkill(),
        InboundPromptSkill(),
        SalesPromptSkill(),
        FinancePromptSkill(),
        QueryPromptSkill(),
    ]

    def test_priority_order(self):
        sorted_skills = sorted(self.all_skills, key=lambda s: s.priority)
        names = [s.name for s in sorted_skills]
        assert names.index("system") < names.index("return")
        assert names.index("return") < names.index("settlement")
        assert names.index("settlement") < names.index("finance")
        assert names.index("finance") < names.index("query")

    def test_confirm_matches_system_first(self):
        """确认消息应该被 SystemPromptSkill 最先匹配"""
        msg = "确认销售单XS20260222001"
        for skill in sorted(self.all_skills, key=lambda s: s.priority):
            if skill.matches(msg):
                assert skill.name == "system"
                break

    def test_settlement_excludes_deposit_settle(self):
        """存料结价不应该匹配结算 Skill"""
        msg = "存料结价3克 金价800"
        settlement = SettlementPromptSkill()
        finance = FinancePromptSkill()
        assert not settlement.matches(msg)
        assert finance.matches(msg)

    def test_return_with_query_handled_by_priority(self):
        """含查询+退货的消息在 Skill 层面都匹配，由 Agent 优先级决定路由"""
        msg = "查询退货单"
        return_skill = ReturnPromptSkill()
        query_skill = QueryPromptSkill()
        assert return_skill.matches(msg)
        assert query_skill.matches(msg)
        assert query_skill.priority > return_skill.priority

    def test_all_skills_have_unique_names(self):
        names = [s.name for s in self.all_skills]
        assert len(names) == len(set(names))

    def test_all_skills_have_actions(self):
        for skill in self.all_skills:
            assert len(skill.actions) > 0, f"{skill.name} has no actions"

    def test_all_skills_generate_prompt(self):
        for skill in self.all_skills:
            prompt = skill.get_prompt("测试消息", "上下文", "测试角色", "系统提示")
            assert len(prompt) > 50, f"{skill.name} prompt too short"
            assert "测试角色" in prompt or "测试消息" in prompt


class TestSkillComposition:
    """测试 Agent 的 Skill 组合模式"""

    def test_settlement_agent_skills(self):
        from app.agents.settlement_agent import SettlementAgent
        agent = SettlementAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "settlement", "sales", "finance", "query"}

    def test_counter_agent_skills(self):
        from app.agents.counter_agent import CounterAgent
        agent = CounterAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "return", "sales", "query"}

    def test_product_agent_skills(self):
        from app.agents.product_agent import ProductAgent
        agent = ProductAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "return", "inbound", "query"}

    def test_finance_agent_skills(self):
        from app.agents.finance_agent import FinanceAgent
        agent = FinanceAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "return", "settlement", "inbound", "sales", "finance", "query"}

    def test_material_agent_skills(self):
        from app.agents.material_agent import MaterialAgent
        agent = MaterialAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "finance", "query"}

    def test_sales_agent_skills(self):
        from app.agents.sales_agent import SalesAgent
        agent = SalesAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "query"}

    def test_manager_agent_skills(self):
        from app.agents.manager_agent import ManagerAgent
        agent = ManagerAgent()
        skill_names = {s.name for s in agent.skills}
        assert skill_names == {"system", "return", "settlement", "inbound", "sales", "finance", "query"}


class TestSkillRegistry:
    """SkillRegistry 全局注册表测试"""

    def test_singleton(self):
        from app.agents.skills.skill_registry import SkillRegistry
        r1 = SkillRegistry()
        r2 = SkillRegistry()
        assert r1 is r2

    def test_all_7_skills_registered(self):
        from app.agents.skills.skill_registry import skill_registry
        skills = skill_registry.list_skills()
        assert len(skills) == 7
        assert set(skills.keys()) == {"system", "return", "settlement", "inbound", "sales", "finance", "query"}

    def test_get_by_name(self):
        from app.agents.skills.skill_registry import skill_registry
        system = skill_registry.get("system")
        assert system is not None
        assert system.name == "system"

    def test_get_unknown_returns_none(self):
        from app.agents.skills.skill_registry import skill_registry
        assert skill_registry.get("unknown") is None

    def test_has(self):
        from app.agents.skills.skill_registry import skill_registry
        assert skill_registry.has("finance")
        assert not skill_registry.has("nonexistent")

    def test_get_by_names(self):
        from app.agents.skills.skill_registry import skill_registry
        skills = skill_registry.get_by_names(["system", "finance", "query"])
        assert len(skills) == 3
        assert [s.name for s in skills] == ["system", "finance", "query"]

    def test_get_by_names_ignores_unknown(self):
        from app.agents.skills.skill_registry import skill_registry
        skills = skill_registry.get_by_names(["system", "nonexistent", "query"])
        assert len(skills) == 2
        assert [s.name for s in skills] == ["system", "query"]

    def test_find_matching(self):
        from app.agents.skills.skill_registry import skill_registry
        matched = skill_registry.find_matching("确认销售单XS20260222001")
        assert len(matched) >= 1
        assert matched[0].name == "system"

    def test_find_matching_priority_order(self):
        from app.agents.skills.skill_registry import skill_registry
        matched = skill_registry.find_matching("退货给供应商")
        names = [s.name for s in matched]
        assert "return" in names
        if "query" in names:
            assert names.index("return") < names.index("query")

    def test_all_skills_sorted_by_priority(self):
        from app.agents.skills.skill_registry import skill_registry
        all_skills = skill_registry.all_skills()
        priorities = [s.priority for s in all_skills]
        assert priorities == sorted(priorities)

    def test_agents_share_skill_instances(self):
        """所有 Agent 通过 SkillRegistry 共享同一组 Skill 实例"""
        from app.agents.skills.skill_registry import skill_registry
        from app.agents.settlement_agent import SettlementAgent
        from app.agents.finance_agent import FinanceAgent

        settlement = SettlementAgent()
        finance = FinanceAgent()

        s_system = next(s for s in settlement.skills if s.name == "system")
        f_system = next(s for s in finance.skills if s.name == "system")
        assert s_system is f_system

    def test_dynamic_skill_discovery(self):
        """测试动态发现：给定消息，找到所有匹配的 Skill"""
        from app.agents.skills.skill_registry import skill_registry
        matched = skill_registry.find_matching("张老板交料5克")
        skill_names = {s.name for s in matched}
        assert "finance" in skill_names


class TestBaseAgentFallback:
    """测试 BaseAgent 的 _fallback_classify 默认实现"""

    def test_fallback_returns_system_on_error(self):
        from app.agents.counter_agent import CounterAgent
        agent = CounterAgent()
        result = agent._fallback_classify("一些随机文本无法匹配任何关键词")
        assert isinstance(result, str)

    def test_fallback_uses_skills_list(self):
        """_fallback_classify 应该使用 Agent 的 skills 列表生成分类选项"""
        from app.agents.settlement_agent import SettlementAgent
        agent = SettlementAgent()
        valid_categories = {s.name for s in agent.skills}
        result = agent._fallback_classify("测试消息")
        assert result in valid_categories or result == "system"
