"""SalesAgent — 业务员角色 Agent

职责范围：
  - 查询客户信息（核心操作）
  - 查询销售单 / 销售数据
  - 查询客户账务
  - 查询库存（受限）

不负责（最受限角色）：
  - 入库、退货、转移
  - 创建销售单（只能查询）
  - 收料/付料/提料
  - 结算
  - 供应商管理
"""

import re
import logging
from typing import List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class SalesAgent(BaseAgent):
    """业务员 Agent — 通过 Skill 组合实现分类和 Prompt 生成

    业务员是最受限的角色，只有 query 和 system 两个 Skill。
    """

    skill_names: List[str] = ["system", "query"]

    @property
    def role_id(self) -> str:
        return "sales"

    @property
    def role_name(self) -> str:
        return "业务员"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的业务员AI助手。"
            "你的核心职责是帮助业务员查询客户信息、销售数据和客户账务。"
            "注意：业务员只有查询权限，不能创建销售单或执行其他写操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # SystemPromptSkill 优先（确认/帮助/闲聊）
        system_skill = self.skills[0]
        if system_skill.matches(msg):
            return "system"

        # 业务员特有：几乎所有业务消息都归类为 query
        if re.search(r'XS\d', msg):
            return "query"
        if any(kw in msg for kw in ['销售', '销售单', '业绩', '卖']):
            return "query"
        if any(kw in msg for kw in ['欠款', '欠料', '账务', '欠', '多少钱', '余额']):
            return "query"
        if any(kw in msg for kw in ['查询', '客户', '库存', '统计']):
            return "query"

        return self._fallback_classify(msg, conversation_history)

    def get_allowed_actions(self) -> List[str]:
        return [
            "查询客户", "查询客户账务",
            "查询销售单", "销售数据查询",
            "查询库存",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return ["inventory", "sales_orders", "customers", "customer_debt"]

