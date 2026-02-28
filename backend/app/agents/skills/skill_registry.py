"""SkillRegistry — PromptSkill 全局注册表

负责：
  1. 注册/管理所有 PromptSkill 实例（全局唯一）
  2. 按名称查找 Skill
  3. 查找匹配消息的所有 Skill（按优先级排序）
  4. 启动时自动注册所有内置 Skill
"""

import logging
from typing import Dict, List, Optional

from .prompt_skill import PromptSkill

logger = logging.getLogger(__name__)


class SkillRegistry:
    """PromptSkill 全局注册表 — 单例模式"""

    _instance: Optional["SkillRegistry"] = None
    _skills: Dict[str, PromptSkill]

    def __new__(cls) -> "SkillRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._skills = {}
        return cls._instance

    def register(self, skill: PromptSkill) -> None:
        """注册一个 PromptSkill"""
        if skill.name in self._skills:
            logger.warning(f"PromptSkill '{skill.name}' 已注册，将被覆盖")
        self._skills[skill.name] = skill
        logger.info(f"PromptSkill 已注册: {skill.name} ({skill.display_name})")

    def get(self, name: str) -> Optional[PromptSkill]:
        """按名称获取 Skill"""
        return self._skills.get(name)

    def has(self, name: str) -> bool:
        return name in self._skills

    def list_skills(self) -> Dict[str, str]:
        """列出所有已注册的 Skill: {name: display_name}"""
        return {name: skill.display_name for name, skill in self._skills.items()}

    def find_matching(self, msg: str) -> List[PromptSkill]:
        """查找所有匹配消息的 Skill，按优先级排序（数字小的在前）"""
        matched = [s for s in self._skills.values() if s.matches(msg)]
        return sorted(matched, key=lambda s: s.priority)

    def get_by_names(self, names: List[str]) -> List[PromptSkill]:
        """按名称列表获取多个 Skill，保持输入顺序"""
        return [self._skills[n] for n in names if n in self._skills]

    def all_skills(self) -> List[PromptSkill]:
        """返回所有已注册的 Skill，按优先级排序"""
        return sorted(self._skills.values(), key=lambda s: s.priority)


def _register_builtin_skills(reg: SkillRegistry) -> None:
    """注册所有内置 PromptSkill"""
    from .system_prompt_skill import SystemPromptSkill
    from .return_prompt_skill import ReturnPromptSkill
    from .settlement_prompt_skill import SettlementPromptSkill
    from .inbound_prompt_skill import InboundPromptSkill
    from .sales_prompt_skill import SalesPromptSkill
    from .finance_prompt_skill import FinancePromptSkill
    from .query_prompt_skill import QueryPromptSkill

    for skill_cls in [
        SystemPromptSkill, ReturnPromptSkill, SettlementPromptSkill,
        InboundPromptSkill, SalesPromptSkill, FinancePromptSkill,
        QueryPromptSkill,
    ]:
        reg.register(skill_cls())


# 全局注册表实例
skill_registry = SkillRegistry()
_register_builtin_skills(skill_registry)
