"""
Skill 模块 — Agent 可调用的原子能力 + PromptSkill 分类/Prompt 生成

架构：
  PromptSkill — 分类关键词 + Prompt 生成（Phase 3）
    ├── SystemPromptSkill（系统/确认/闲聊）
    ├── ReturnPromptSkill（退货/销退/转移）
    ├── SettlementPromptSkill（结算单）
    ├── InboundPromptSkill（入库）
    ├── SalesPromptSkill（销售）
    ├── FinancePromptSkill（财务/金料）
    └── QueryPromptSkill（通用查询）

  SkillRegistry — 全局 PromptSkill 注册表
  BaseSkill — 执行层 Skill 基类（Phase 1）
"""

from .base_skill import BaseSkill
from .prompt_skill import PromptSkill
from .skill_registry import SkillRegistry, skill_registry

from .system_prompt_skill import SystemPromptSkill
from .return_prompt_skill import ReturnPromptSkill
from .settlement_prompt_skill import SettlementPromptSkill
from .inbound_prompt_skill import InboundPromptSkill
from .sales_prompt_skill import SalesPromptSkill
from .finance_prompt_skill import FinancePromptSkill
from .query_prompt_skill import QueryPromptSkill

ALL_PROMPT_SKILLS = [
    SystemPromptSkill, ReturnPromptSkill, SettlementPromptSkill,
    InboundPromptSkill, SalesPromptSkill, FinancePromptSkill,
    QueryPromptSkill,
]

__all__ = [
    "BaseSkill", "PromptSkill", "SkillRegistry", "skill_registry",
    "ALL_PROMPT_SKILLS",
    "SystemPromptSkill", "ReturnPromptSkill", "SettlementPromptSkill",
    "InboundPromptSkill", "SalesPromptSkill", "FinancePromptSkill",
    "QueryPromptSkill",
]
