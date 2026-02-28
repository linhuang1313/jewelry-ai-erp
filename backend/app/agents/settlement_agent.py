"""SettlementAgent — 结算专员角色 Agent

职责范围：
  - 创建/查询结算单
  - 查询销售单（为结算做准备）
  - 查询客户账务（欠款/欠料/存料）
  - @结算 协同（结算确认、提料确认）
  - 查询金料记录
  - 收料/提料操作

不负责（交给其他 Agent 或 fallback）：
  - 入库、退货、转移
  - 供应商管理
  - 系统管理
"""

import logging
from typing import List, Optional
from datetime import datetime, timedelta

from .base import BaseAgent

logger = logging.getLogger(__name__)


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _week_start() -> str:
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    return monday.strftime("%Y-%m-%d")


class SettlementAgent(BaseAgent):
    """结算专员 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skill_names: List[str] = ["system", "settlement", "sales", "finance", "query"]

    @property
    def role_id(self) -> str:
        return "settlement"

    @property
    def role_name(self) -> str:
        return "结算专员"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的结算专员AI助手。"
            "你的核心职责是帮助结算专员完成结算单管理、客户账务查询和金料操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        for skill in sorted(self.skills, key=lambda s: s.priority):
            if skill.matches(msg):
                return skill.name

        return self._fallback_classify(msg, conversation_history)

    def get_prompt(self, category: str, message: str, context: str) -> str:
        if category == "sales":
            return self._get_sales_query_only_prompt(message, context)
        return super().get_prompt(category, message, context)

    def _get_sales_query_only_prompt(self, message: str, context: str) -> str:
        """结算专员的销售 Prompt — 只包含查询，不包含创建销售单"""
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：结算专员（查询销售单是为了做结算准备，不负责创建销售单）

本类别支持的功能：
1. **查询销售单**：查询销售单信息，销售单号以 XS 开头
2. **销售数据查询**：查询销售统计数据

请返回 JSON 格式：
- action: "查询销售单" / "销售数据查询"

查询销售单字段：
  - sales_order_no: 销售单号（XS开头）
  - customer_name: 客户姓名

销售数据查询字段：
  - sales_query_type: today/month/compare/top_products/salesperson/summary
  - sales_query_salesperson: 业务员姓名

只返回 JSON，不要其他文字。

示例1：
用户输入："查询销售单XS20260111162534"
{{"action": "查询销售单", "sales_order_no": "XS20260111162534", "products": null}}

示例2：
用户输入："今天卖了多少钱"
{{"action": "销售数据查询", "sales_query_type": "today", "products": null}}
"""

    # 结算专员不能执行的 actions（来自 SalesPromptSkill 等）
    _excluded_actions = {"创建销售单", "入库", "退货", "销退", "批量转移", "创建转移单",
                         "付料", "登记收款", "供应商付款", "费用报销",
                         "创建供应商", "供应商分析", "统计分析", "生成图表"}

    def get_allowed_actions(self) -> List[str]:
        actions = []
        for skill in self.skills:
            for action in skill.actions:
                if action not in self._excluded_actions:
                    actions.append(action)
        return list(dict.fromkeys(actions))

    def get_data_access(self) -> List[str]:
        return [
            "inventory", "transfer_orders", "sales_orders",
            "customers", "customer_debt",
        ]

