"""
Agent 架构模块 — AI-ERP 2.0 核心

架构概览：
  AgentRegistry（注册表）
    ├── SettlementAgent（结算专员）  ← 试点
    ├── CounterAgent（柜台）         ← 待实现
    ├── ProductAgent（商品部）       ← 待实现
    ├── FinanceAgent（财务）         ← 待实现
    └── DefaultAgent（兜底/管理层）  ← 待实现

每个 Agent 拥有：
  - 专属 system_prompt（角色 Prompt 隔离）
  - 专属 classify() 方法（意图分类）
  - 专属 Skill 列表（可执行的动作）
  - 数据访问权限矩阵
"""

from .base import BaseAgent
from .registry import AgentRegistry

__all__ = ["BaseAgent", "AgentRegistry"]
