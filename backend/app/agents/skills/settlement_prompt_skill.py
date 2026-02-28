"""结算类 PromptSkill — 创建/查询结算单"""

import re
from typing import List

from .prompt_skill import PromptSkill


class SettlementPromptSkill(PromptSkill):

    EXCLUSION_TERMS = ['存料结价', '料结价', '存料抵扣']

    @property
    def name(self) -> str:
        return "settlement"

    @property
    def display_name(self) -> str:
        return "结算"

    @property
    def keywords(self) -> List[str]:
        return ['结算', '结算单', '结价', '结料', '混合']

    @property
    def patterns(self) -> List[str]:
        return [r'JS\d']

    @property
    def actions(self) -> List[str]:
        return ["创建结算单", "查询结算单"]

    @property
    def priority(self) -> int:
        return 30

    def matches(self, msg: str) -> bool:
        if any(term in msg for term in self.EXCLUSION_TERMS):
            return False
        return super().matches(msg)

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

本类别支持的功能：
1. **创建结算单**：为客户创建结算单（结价/结料/混合支付）
2. **查询结算单**：按单号/客户/日期查询结算单

请返回 JSON 格式：
- action: "创建结算单" / "查询结算单"
- settlement_customer_name（客户名）
- settlement_payment_method（支付方式：结价/结料/混合）
- settlement_gold_price（金价，结价或混合时需要）
- settlement_order_no（查询时的结算单号）

只返回 JSON，不要其他文字。

示例1：
用户输入："帮张三结算，结价，金价520"
{{"action": "创建结算单", "settlement_customer_name": "张三", "settlement_payment_method": "结价", "settlement_gold_price": 520, "products": null}}

示例2：
用户输入："查一下JS20250101001"
{{"action": "查询结算单", "settlement_order_no": "JS20250101001", "products": null}}"""
