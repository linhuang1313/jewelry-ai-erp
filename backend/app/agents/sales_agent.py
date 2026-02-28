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
from .skills.prompt_skill import PromptSkill
from .skills.system_prompt_skill import SystemPromptSkill
from .skills.query_prompt_skill import QueryPromptSkill

logger = logging.getLogger(__name__)


class SalesAgent(BaseAgent):
    """业务员 Agent — 通过 Skill 组合实现分类和 Prompt 生成

    业务员是最受限的角色，只有 query 和 system 两个 Skill。
    """

    skills: List[PromptSkill] = [
        SystemPromptSkill(),
        QueryPromptSkill(),
    ]

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

    def get_prompt(self, category: str, message: str, context: str) -> str:
        for skill in self.skills:
            if skill.name == category:
                return skill.get_prompt(message, context, self.role_name, self.system_prompt)
        return self.skills[0].get_prompt(message, context, self.role_name, self.system_prompt)

    def get_allowed_actions(self) -> List[str]:
        return [
            "查询客户", "查询客户账务",
            "查询销售单", "销售数据查询",
            "查询库存",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return ["inventory", "sales_orders", "customers", "customer_debt"]

    def _fallback_classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        context_str = ""
        if conversation_history:
            context_str = "最近对话：\n"
            for h in conversation_history[-4:]:
                role = "用户" if h.get("role") == "user" else "系统"
                context_str += f"  {role}: {h.get('content', '')[:150]}\n"
            context_str += "\n"

        prompt = f"""用户是珠宝ERP系统的**业务员**，请判断这句话属于以下哪个类别：
{chr(10).join(f'- {s.name}（{s.display_name}）' for s in self.skills)}

{context_str}用户消息：「{message}」

重要：业务员只有查询权限，大部分操作都归为 query。
只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat", max_tokens=20, temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {s.name for s in self.skills}
            if result in valid:
                logger.info(f"[SalesAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[SalesAgent] AI 兜底分类失败: {e}")
            return "system"
