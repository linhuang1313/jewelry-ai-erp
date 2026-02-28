"""系统类 PromptSkill — 确认/反确认单据、帮助、创建客户/供应商、闲聊"""

import re
from typing import List

from .prompt_skill import PromptSkill


class SystemPromptSkill(PromptSkill):

    @property
    def name(self) -> str:
        return "system"

    @property
    def display_name(self) -> str:
        return "系统"

    GREETING_WORDS = {'你好', '您好', '早上好', '下午好', '晚上好', '嗨', '哈喽', '谢谢', '感谢', '再见', '拜拜'}

    @property
    def keywords(self) -> List[str]:
        return [
            '怎么', '如何', '教我', '帮助', '使用说明',
            '新建客户', '创建客户', '添加客户',
            '新建供应商', '创建供应商', '添加供应商',
        ]

    @property
    def patterns(self) -> List[str]:
        return [
            r'(反确认|确认).*(RK|XS|TH|JS)\d',
            r'(RK|XS|TH|JS)\d.*(反确认|确认)',
        ]

    @property
    def actions(self) -> List[str]:
        return ["创建客户", "创建供应商", "确认单据", "反确认单据", "系统帮助", "闲聊"]

    @property
    def priority(self) -> int:
        return 10

    def matches(self, msg: str) -> bool:
        for pat in self.patterns:
            if re.search(pat, msg):
                return True
        if any(kw in msg for kw in self.keywords):
            return True
        if msg in self.GREETING_WORDS:
            return True
        return False

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

本类别支持的功能：
1. **创建客户**：新建客户信息
2. **创建供应商**：新建供应商
3. **确认单据**：确认某张单据（"确认" + 单号）
4. **反确认单据**：反确认/撤回已确认的单据
5. **系统帮助**：询问系统怎么用
6. **闲聊**：问候、寒暄

请返回 JSON 格式：
- action: "创建客户" / "创建供应商" / "确认单据" / "反确认单据" / "系统帮助" / "闲聊"
- customer_name（创建客户时）, confirm_order_no（确认时）

只返回 JSON，不要其他文字。

示例1：
用户输入："新建客户 张三"
{{"action": "创建客户", "customer_name": "张三", "products": null}}

示例2：
用户输入："你好"
{{"action": "闲聊", "products": null}}"""
