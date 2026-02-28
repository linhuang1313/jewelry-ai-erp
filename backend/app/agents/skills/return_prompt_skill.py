"""退货类 PromptSkill — 退货（退给供应商/产品部）、销退、创建转移单"""

import re
from typing import List

from .prompt_skill import PromptSkill


class ReturnPromptSkill(PromptSkill):

    TRANSFER_KEYWORDS = ['转移', '转到']
    TRANSFER_EXCLUSIONS = ['查询', r'TR\d']

    @property
    def name(self) -> str:
        return "return"

    @property
    def display_name(self) -> str:
        return "退货"

    @property
    def keywords(self) -> List[str]:
        return ['退货', '退给', '退回', '退库', '销退', '客户退', '我要退']

    @property
    def patterns(self) -> List[str]:
        return [r'TH\d']

    @property
    def actions(self) -> List[str]:
        return ["退货", "销退", "创建转移单"]

    @property
    def priority(self) -> int:
        return 20

    def matches(self, msg: str) -> bool:
        if super().matches(msg):
            return True

        single_tui_exclusions = ['查询', '转移单', '调拨']
        if '退' in msg:
            if any(ex in msg for ex in single_tui_exclusions) or re.search(r'TR\d', msg):
                return False
            return True

        for kw in self.TRANSFER_KEYWORDS:
            if kw in msg:
                if '查询' in msg or re.search(r'TR\d', msg):
                    return False
                return True

        return False

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

本类别支持的功能：
1. **退货**：退货给供应商或产品部
2. **销退**：客户退货（销售退货）
3. **创建转移单**：在不同位置之间转移商品

请返回 JSON 格式：
- action: "退货" / "销退" / "创建转移单"
- products（退货商品列表）
- return_reason（退货原因）
- supplier（退给供应商时的供应商名）
- return_target（退货目标：供应商名或"产品部"）
- customer_name（销退时的客户名）

只返回 JSON，不要其他文字。

示例1：
用户输入："把这个金戒指退给供应商老王"
{{"action": "退货", "return_target": "老王", "products": [{{"name": "金戒指"}}], "return_reason": null}}

示例2：
用户输入："客户张三要退货"
{{"action": "销退", "customer_name": "张三", "products": null, "return_reason": null}}

示例3：
用户输入："转移3件商品到柜台B"
{{"action": "创建转移单", "products": null, "return_reason": null}}"""
