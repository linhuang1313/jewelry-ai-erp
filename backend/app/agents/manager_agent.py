"""ManagerAgent — 管理层角色 Agent

职责范围：
  - 全部操作（最高权限）
  - 统计分析 / 图表
  - 所有查询
  - 审核/确认

分类器拥有全部 Skill，是最宽泛的 Agent。
"""

import logging
from typing import List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class ManagerAgent(BaseAgent):
    """管理层 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skill_names: List[str] = ["system", "return", "settlement", "inbound", "sales", "finance", "query"]

    @property
    def role_id(self) -> str:
        return "manager"

    @property
    def role_name(self) -> str:
        return "管理层"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的管理层AI助手。"
            "你拥有系统的全部权限，可以执行所有操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # 管理层特有：入库关键词包含 '库存'
        if '库存' in msg and not any(kw in msg for kw in ['退', '转移', '销售']):
            return "inbound"

        for skill in sorted(self.skills, key=lambda s: s.priority):
            if skill.matches(msg):
                return skill.name

        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_allowed_actions(self) -> List[str]:
        actions = []
        for skill in self.skills:
            actions.extend(skill.actions)
        actions.append("生成图表")
        return list(dict.fromkeys(actions))

    def get_data_access(self) -> List[str]:
        return [
            "inventory", "transfer_orders", "inbound_orders", "sales_orders",
            "customers", "customer_debt", "suppliers", "supplier_gold",
        ]

