"""PromptSkill — 分类 + Prompt 生成的 Skill 基类

每个 PromptSkill 封装一个业务领域的：
  - 关键词列表（用于 classify 匹配）
  - 正则模式（用于单号等模式匹配）
  - action 列表（该领域包含的操作）
  - Prompt 生成逻辑（为 LLM 生成角色专属 Prompt）

Agent 通过组合多个 PromptSkill 来实现 classify / get_prompt / get_allowed_actions。
"""

import re
import logging
from abc import ABC, abstractmethod
from typing import List, Optional

logger = logging.getLogger(__name__)


class PromptSkill(ABC):
    """分类 + Prompt 生成的 Skill 基类"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Skill 标识，与 classify 返回的 category 对应（如 "finance"）"""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """中文显示名（如 "财务"）"""
        ...

    @property
    @abstractmethod
    def keywords(self) -> List[str]:
        """分类关键词列表"""
        ...

    @property
    def patterns(self) -> List[str]:
        """正则模式列表（如 [r'JS\\d', r'付\\d']），默认空"""
        return []

    @property
    def negative_patterns(self) -> List[str]:
        """排除模式 — 匹配时不算命中（如退货中排除查询场景），默认空"""
        return []

    @property
    @abstractmethod
    def actions(self) -> List[str]:
        """该 Skill 包含的 action 列表"""
        ...

    @property
    def priority(self) -> int:
        """匹配优先级，数字越小越优先。默认 50。"""
        return 50

    def matches(self, msg: str) -> bool:
        """检查消息是否匹配该 Skill 的关键词或正则模式"""
        if any(kw in msg for kw in self.keywords):
            return True
        for pat in self.patterns:
            if re.search(pat, msg):
                return True
        return False

    @abstractmethod
    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        """生成该领域的完整 LLM Prompt

        Args:
            message: 用户输入
            context: 对话上下文
            role_name: 当前角色中文名（如 "柜台"）
            system_prompt: Agent 的 system_prompt
        """
        ...

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name}>"
