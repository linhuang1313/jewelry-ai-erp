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

import re
import logging
from typing import List, Optional

from .base import BaseAgent
from .skills.prompt_skill import PromptSkill
from .skills.system_prompt_skill import SystemPromptSkill
from .skills.inbound_prompt_skill import InboundPromptSkill
from .skills.return_prompt_skill import ReturnPromptSkill
from .skills.query_prompt_skill import QueryPromptSkill

logger = logging.getLogger(__name__)


class ProductAgent(BaseAgent):
    """商品部 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skills: List[PromptSkill] = [
        SystemPromptSkill(),
        ReturnPromptSkill(),
        InboundPromptSkill(),
        QueryPromptSkill(),
    ]

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

    def get_prompt(self, category: str, message: str, context: str) -> str:
        for skill in self.skills:
            if skill.name == category:
                return skill.get_prompt(message, context, self.role_name, self.system_prompt)
        return self.skills[0].get_prompt(message, context, self.role_name, self.system_prompt)

    def get_allowed_actions(self) -> List[str]:
        actions = []
        for skill in self.skills:
            actions.extend(skill.actions)
        return list(dict.fromkeys(actions))

    def get_data_access(self) -> List[str]:
        return ["inventory", "transfer_orders", "inbound_orders", "suppliers", "supplier_gold"]

    def _fallback_classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        context_str = ""
        if conversation_history:
            context_str = "最近对话：\n"
            for h in conversation_history[-4:]:
                role = "用户" if h.get("role") == "user" else "系统"
                context_str += f"  {role}: {h.get('content', '')[:150]}\n"
            context_str += "\n"

        prompt = f"""用户是珠宝ERP系统的**商品专员**，请判断这句话属于以下哪个类别：
{chr(10).join(f'- {s.name}（{s.display_name}）' for s in self.skills)}

{context_str}用户消息：「{message}」

重要：商品专员最常做的是入库，优先考虑 inbound。
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
                logger.info(f"[ProductAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[ProductAgent] AI 兜底分类失败: {e}")
            return "system"
