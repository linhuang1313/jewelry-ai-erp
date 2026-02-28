"""AgentRegistry — Agent 注册表

负责：
  1. 注册/管理所有角色 Agent
  2. 根据 user_role 路由到对应 Agent
  3. 提供 fallback 到旧架构的兼容机制
"""

import logging
from typing import Dict, Optional
from .base import BaseAgent

logger = logging.getLogger(__name__)


class AgentRegistry:
    """Agent 注册表 — 单例模式"""

    _instance: Optional["AgentRegistry"] = None
    _agents: Dict[str, BaseAgent]

    def __new__(cls) -> "AgentRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._agents = {}
        return cls._instance

    def register(self, agent: BaseAgent) -> None:
        """注册一个 Agent"""
        if agent.role_id in self._agents:
            logger.warning(f"Agent '{agent.role_id}' 已注册，将被覆盖")
        self._agents[agent.role_id] = agent
        logger.info(f"Agent 已注册: {agent.role_id} ({agent.role_name})")

    def get(self, role_id: str) -> Optional[BaseAgent]:
        """根据 role_id 获取 Agent，未注册则返回 None"""
        return self._agents.get(role_id)

    def has(self, role_id: str) -> bool:
        """检查某角色是否已注册 Agent"""
        return role_id in self._agents

    def list_agents(self) -> Dict[str, str]:
        """列出所有已注册的 Agent: {role_id: role_name}"""
        return {rid: agent.role_name for rid, agent in self._agents.items()}

    def route(self, user_role: str) -> Optional[BaseAgent]:
        """根据用户角色路由到对应 Agent。

        路由策略：
          1. 精确匹配 user_role → Agent
          2. 未注册的角色 → 返回 None（调用方 fallback 到旧架构）

        这样可以渐进式迁移：先注册结算专员，其他角色仍走旧路径。
        """
        agent = self._agents.get(user_role)
        if agent:
            logger.info(f"路由: role={user_role} → {agent}")
        else:
            logger.debug(f"路由: role={user_role} → 未注册，fallback 到旧架构")
        return agent


# 全局注册表实例
registry = AgentRegistry()
