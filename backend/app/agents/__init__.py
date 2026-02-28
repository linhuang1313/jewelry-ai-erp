"""
Agent 架构模块 — AI-ERP 2.0 核心

架构概览：
  AgentRegistry（注册表）
    ├── SettlementAgent（结算专员）
    ├── CounterAgent（柜台）
    ├── ProductAgent（商品部）
    ├── FinanceAgent（财务）
    ├── MaterialAgent（料部）
    ├── SalesAgent（业务员）
    └── ManagerAgent（管理层）

每个 Agent 拥有：
  - 专属 system_prompt（角色 Prompt 隔离）
  - 专属 classify() 方法（意图分类）
  - 专属 Skill 列表（可执行的动作）
  - 数据访问权限矩阵
"""

from .base import BaseAgent
from .registry import AgentRegistry
from .settlement_agent import SettlementAgent
from .counter_agent import CounterAgent
from .product_agent import ProductAgent
from .finance_agent import FinanceAgent
from .material_agent import MaterialAgent
from .sales_agent import SalesAgent
from .manager_agent import ManagerAgent

ALL_AGENTS = [
    CounterAgent, ProductAgent, FinanceAgent,
    MaterialAgent, SalesAgent, ManagerAgent,
    SettlementAgent,
]

__all__ = [
    "BaseAgent", "AgentRegistry", "ALL_AGENTS",
    "SettlementAgent", "CounterAgent", "ProductAgent",
    "FinanceAgent", "MaterialAgent", "SalesAgent", "ManagerAgent",
]
