"""BaseAgent — 所有角色 Agent 的抽象基类

每个角色 Agent 必须实现：
  - role_id: 角色标识（如 "settlement"）
  - role_name: 角色中文名（如 "结算专员"）
  - system_prompt: 角色专属的系统 Prompt
  - classify(): 对用户输入进行意图分类
  - get_prompt(): 根据分类结果生成完整 Prompt
  - get_allowed_actions(): 返回该角色可执行的动作列表
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """角色 Agent 抽象基类"""

    @property
    @abstractmethod
    def role_id(self) -> str:
        """角色标识，如 'settlement'"""
        ...

    @property
    @abstractmethod
    def role_name(self) -> str:
        """角色中文名，如 '结算专员'"""
        ...

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """角色专属系统 Prompt（注入 LLM 的 system message）"""
        ...

    @abstractmethod
    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        """对用户输入进行意图分类，返回 category 字符串。

        与旧架构的 pre_classify() 对应，但每个 Agent 只关心自己领域的分类。
        """
        ...

    @abstractmethod
    def get_prompt(self, category: str, message: str, context: str) -> str:
        """根据分类结果生成完整的 LLM Prompt。

        与旧架构的 get_category_prompt() 对应，但只包含该角色相关的 action 和示例。
        """
        ...

    @abstractmethod
    def get_allowed_actions(self) -> List[str]:
        """返回该角色可执行的动作列表。

        用于权限校验和 Prompt 生成（只展示可执行的 action）。
        """
        ...

    @abstractmethod
    def get_data_access(self) -> List[str]:
        """返回该角色可访问的数据类型列表。

        与旧架构的 ROLE_DATA_ACCESS 对应，但内聚到 Agent 内部。
        """
        ...

    def can_handle(self, action: str) -> bool:
        """判断该 Agent 是否能处理某个 action"""
        return action in self.get_allowed_actions()

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} role={self.role_id}>"
