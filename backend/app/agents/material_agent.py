"""MaterialAgent — 料部/金料角色 Agent

职责范围：
  - 付料给供应商（核心操作）
  - 管理供应商
  - 确认转移单
  - 查看供应商金料账户
  - 查询客户/供应商信息

不负责：
  - 入库（商品部）
  - 销售（柜台）
  - 结算（结算专员）
  - 收料/提料（结算专员）
  - 收款（财务）
"""

import re
import logging
from typing import List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class MaterialAgent(BaseAgent):
    """料部 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skill_names: List[str] = ["system", "finance", "query"]

    # 料部只使用 FinancePromptSkill 的子集关键词
    _finance_keywords = ['付料', '金料', '供应商付款', '打款', '付款', '收到']

    @property
    def role_id(self) -> str:
        return "material"

    @property
    def role_name(self) -> str:
        return "料部"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的料部AI助手。"
            "你的核心职责是帮助料部人员完成金料付料、供应商管理和转移确认。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # SystemPromptSkill 优先（确认/帮助/闲聊）
        system_skill = self.skills[0]
        if system_skill.matches(msg):
            return "system"

        # 料部特有：只匹配付料相关的财务关键词（不匹配收料/提料等）
        if any(kw in msg for kw in self._finance_keywords):
            return "finance"
        if re.search(r'付\d', msg):
            return "finance"

        # 供应商管理
        if any(kw in msg for kw in ['新建供应商', '创建供应商', '添加供应商']):
            return "system"

        # 通用查询
        if any(kw in msg for kw in ['查询', '统计', '分析', '供应商', '客户', '库存', '转移单', '调拨']):
            return "query"
        if re.search(r'TR\d', msg):
            return "query"

        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_allowed_actions(self) -> List[str]:
        return [
            "付料", "供应商付款",
            "创建供应商",
            "确认单据", "反确认单据",
            "查询客户", "查询供应商", "查询库存", "查询转移单",
            "供应商分析", "查询金料记录",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return ["customers", "suppliers", "supplier_gold"]

