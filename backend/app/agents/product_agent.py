"""ProductAgent — 商品部角色 Agent

职责范围：
  - 入库（核心操作）
  - 查询入库单
  - 退货给供应商
  - 批量转移 / 创建转移单
  - 管理供应商
  - 查询库存（商品部仓库）

不负责：
  - 销售开单（柜台）
  - 结算（结算专员）
  - 收料/提料（结算/料部）
  - 客户管理（柜台/结算）
"""

import logging
from typing import List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class ProductAgent(BaseAgent):
    """商品部 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skill_names: List[str] = ["system", "return", "inbound", "query"]

    @property
    def role_id(self) -> str:
        return "product"

    @property
    def role_name(self) -> str:
        return "商品部"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的商品部AI助手。"
            "你的核心职责是帮助商品专员完成入库、退货给供应商和库存转移。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # 商品部特有：库存归类到 inbound
        if '库存' in msg:
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
        return list(dict.fromkeys(actions))

    def get_data_access(self) -> List[str]:
        return ["inventory", "transfer_orders", "inbound_orders", "suppliers", "supplier_gold"]

