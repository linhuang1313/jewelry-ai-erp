"""BaseSkill — Skill 抽象基类

每个 Skill 封装一个原子业务操作。
当前阶段（Phase 1）Skill 只是对现有 chat_handlers.py 中函数的薄封装，
后续阶段会逐步将业务逻辑从 handler 迁移到 Skill 内部。
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List
from sqlalchemy.orm import Session


class BaseSkill(ABC):
    """Skill 抽象基类"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Skill 名称，与 action 名称对应（如 "创建结算单"）"""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Skill 描述，用于 Agent 选择 Skill 时的参考"""
        ...

    @property
    @abstractmethod
    def required_fields(self) -> List[str]:
        """执行该 Skill 所需的必填字段"""
        ...

    @abstractmethod
    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """执行 Skill

        Args:
            params: AI 解析出的参数字典
            db: 数据库会话

        Returns:
            执行结果字典，至少包含 success, action, message
        """
        ...

    def validate(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """校验参数是否满足必填要求

        Returns:
            {"valid": True} 或 {"valid": False, "missing": [...]}
        """
        missing = [f for f in self.required_fields if not params.get(f)]
        if missing:
            return {"valid": False, "missing": missing}
        return {"valid": True}
