"""FinanceAgent — 财务角色 Agent

职责范围：
  - 全部财务操作（收料/付料/提料/收款/供应商付款）
  - 结算单管理
  - 入库 / 销售 / 退货（财务有全部权限）
  - 所有查询
  - 审核/确认单据
  - 对账 / 凭证 / 报销

不负责：无限制（财务拥有接近管理层的权限）
"""

import logging
from typing import List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class FinanceAgent(BaseAgent):
    """财务 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skill_names: List[str] = ["system", "return", "settlement", "inbound", "sales", "finance", "query"]

    @property
    def role_id(self) -> str:
        return "finance"

    @property
    def role_name(self) -> str:
        return "财务"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的财务AI助手。"
            "你的核心职责是帮助财务人员完成金料管理、收付款、对账和审核操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # 财务特有：库存归类到 query
        if '库存' in msg and not any(kw in msg for kw in ['入库', '入库单']):
            return "query"

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
        return list(dict.fromkeys(actions))

    def get_data_access(self) -> List[str]:
        return [
            "inventory", "transfer_orders", "inbound_orders", "sales_orders",
            "customers", "customer_debt", "suppliers", "supplier_gold",
        ]

