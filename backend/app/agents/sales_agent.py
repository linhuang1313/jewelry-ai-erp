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
    """业务员 Agent"""

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

        if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
           re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
            return "system"

        if any(kw in msg for kw in ['怎么', '如何', '教我', '帮助', '使用说明']):
            return "system"

        # 销售单查询
        if re.search(r'XS\d', msg):
            return "query"
        if any(kw in msg for kw in ['销售', '销售单', '业绩', '卖']):
            return "query"

        # 客户账务
        if any(kw in msg for kw in ['欠款', '欠料', '账务', '欠', '多少钱', '余额']):
            return "query"

        # 通用查询
        if any(kw in msg for kw in ['查询', '客户', '库存', '统计']):
            return "query"

        return self._fallback_classify(msg, conversation_history)

    def get_prompt(self, category: str, message: str, context: str) -> str:
        dispatch = {
            "query": self._get_query_prompt,
            "system": self._get_system_prompt,
        }
        return dispatch.get(category, self._get_system_prompt)(message, context)

    def get_allowed_actions(self) -> List[str]:
        return [
            "查询客户", "查询客户账务",
            "查询销售单", "销售数据查询",
            "查询库存",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return ["inventory", "sales_orders", "customers", "customer_debt"]

    def _get_query_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：业务员（只有查询权限，不能创建销售单或执行写操作）

本类别支持的功能（只从以下 action 中选择）：
1. **查询客户**：查询客户信息
2. **查询客户账务**：查询客户欠款/欠料/存料
3. **查询销售单**：查询销售单信息，单号以 XS 开头
4. **销售数据查询**：查询销售统计数据
5. **查询库存**：查询库存

**重要**：业务员不能创建销售单，如果用户想开单，返回"闲聊"并提示联系柜台。

请返回 JSON 格式：
- action: 从上述 action 中选择

查询客户字段：customer_name
查询客户账务字段：debt_customer_name, debt_query_type, date_start, date_end
查询销售单字段：sales_order_no, customer_name, start_date, end_date
销售数据查询字段：sales_query_type, sales_query_salesperson

只返回 JSON，不要其他文字。

示例1（查询客户）：
用户输入："查询客户张三"
{{"action": "查询客户", "customer_name": "张三", "products": null}}

示例2（客户账务）：
用户输入："张三的欠款"
{{"action": "查询客户账务", "debt_customer_name": "张三", "debt_query_type": "all", "products": null}}

示例3（销售统计）：
用户输入："今天卖了多少钱"
{{"action": "销售数据查询", "sales_query_type": "today", "products": null}}

示例4（想开单）：
用户输入："卖给张三 足金手镯 10g"
{{"action": "闲聊", "message": "您是业务员角色，暂无开单权限。请联系柜台人员开单。", "products": null}}
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：业务员

本类别支持的功能：
1. **系统帮助**：询问系统怎么用
2. **闲聊**：问候、寒暄

请返回 JSON 格式：
- action: "系统帮助" / "闲聊"

只返回 JSON，不要其他文字。
"""

    def _fallback_classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        context_str = ""
        if conversation_history:
            context_str = "最近对话：\n"
            for h in conversation_history[-4:]:
                role = "用户" if h.get("role") == "user" else "系统"
                context_str += f"  {role}: {h.get('content', '')[:150]}\n"
            context_str += "\n"

        prompt = f"""用户是珠宝ERP系统的**业务员**，请判断这句话属于以下哪个类别：
- query（查询相关：查询客户、查询销售单、查询账务、查询库存、销售统计）
- system（系统操作、闲聊）

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
            valid = {"query", "system"}
            if result in valid:
                logger.info(f"[SalesAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[SalesAgent] AI 兜底分类失败: {e}")
            return "system"
