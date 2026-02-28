"""CounterAgent — 柜台角色 Agent

职责范围：
  - 创建销售单（核心操作）
  - 查询销售单 / 销售数据
  - 退货给商品部 / 销退（客户退货）
  - 接收库存（转移单）
  - 管理客户
  - 暂借管理
  - 查询库存（展厅）

不负责：
  - 入库（商品部）
  - 退货给供应商（商品部）
  - 收料/付料/提料（结算/料部）
  - 供应商管理（商品部/料部）
"""

import re
import logging
from typing import List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class CounterAgent(BaseAgent):
    """柜台 Agent — 通过 Skill 组合实现分类和 Prompt 生成"""

    skill_names: List[str] = ["system", "return", "sales", "query"]

    @property
    def role_id(self) -> str:
        return "counter"

    @property
    def role_name(self) -> str:
        return "柜台"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的柜台AI助手。"
            "你的核心职责是帮助柜台人员完成销售开单、客户管理和退货处理。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # 暂借归类到 sales（柜台特有逻辑）
        if any(kw in msg for kw in ['暂借', '借出', '借货', '还货', '归还暂借', '还暂借']):
            return "sales"
        if re.search(r'ZJ\d', msg) or re.search(r'HH\d', msg):
            return "sales"

        # 库存归类到 query（柜台视角）
        if '库存' in msg:
            return "query"

        for skill in sorted(self.skills, key=lambda s: s.priority):
            if skill.matches(msg):
                return skill.name

        # 独立的确认兜底（不带单号的简单确认）
        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_allowed_actions(self) -> List[str]:
        actions = []
        for skill in self.skills:
            actions.extend(skill.actions)
        # 柜台特有 actions
        actions.extend(["创建暂借单", "归还暂借", "查询暂借单"])
        return list(dict.fromkeys(actions))

    def get_data_access(self) -> List[str]:
        return ["inventory", "transfer_orders", "sales_orders", "customers"]

