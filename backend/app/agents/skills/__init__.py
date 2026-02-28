"""
Skill 模块 — Agent 可调用的原子能力

Skill 是 Agent 执行具体业务操作的最小单元。
每个 Skill 封装一个独立的业务动作（如"创建结算单"、"查询客户账务"）。

架构：
  Agent.get_allowed_actions() → 返回 Skill 名称列表
  Agent 收到用户意图后 → 查找对应 Skill → 调用 Skill.execute()
"""

from .base_skill import BaseSkill

__all__ = ["BaseSkill"]
