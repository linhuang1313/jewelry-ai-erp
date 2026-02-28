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
from datetime import datetime

from .base import BaseAgent

logger = logging.getLogger(__name__)


class CounterAgent(BaseAgent):
    """柜台 Agent"""

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

        if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
           re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
            return "system"

        if any(kw in msg for kw in ['怎么', '如何', '教我', '帮助', '使用说明']):
            return "system"

        # 退货 / 销退
        if any(kw in msg for kw in ['退货', '退给', '退回', '退库', '销退', '客户退', '我要退']):
            return "return"
        if '退' in msg and not re.search(r'(查询|转移单|调拨|TR\d)', msg):
            return "return"

        # 转移（接收库存）
        if ('转移' in msg or '转到' in msg) and not re.search(r'(查询|TR\d)', msg):
            return "return"

        if re.search(r'XS\d', msg):
            return "sales"
        if re.search(r'TH\d', msg):
            return "return"

        # 暂借
        if any(kw in msg for kw in ['暂借', '借出', '借货', '还货', '归还暂借', '还暂借']):
            return "sales"
        if re.search(r'ZJ\d', msg) or re.search(r'HH\d', msg):
            return "sales"

        # 销售关键词
        if any(kw in msg for kw in ['卖', '销售', '开单', '销售单', '业绩']):
            return "sales"

        # 客户管理
        if any(kw in msg for kw in ['新建客户', '创建客户', '添加客户']):
            return "system"

        # 库存 / 查询
        if '库存' in msg:
            return "query"
        if any(kw in msg for kw in ['查询', '统计', '客户', '转移单', '调拨']):
            return "query"
        if re.search(r'TR\d', msg):
            return "query"

        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_prompt(self, category: str, message: str, context: str) -> str:
        dispatch = {
            "sales": self._get_sales_prompt,
            "return": self._get_return_prompt,
            "query": self._get_query_prompt,
            "system": self._get_system_prompt,
        }
        return dispatch.get(category, self._get_system_prompt)(message, context)

    def get_allowed_actions(self) -> List[str]:
        return [
            "创建销售单", "查询销售单", "销售数据查询",
            "退货", "销退",
            "创建客户",
            "创建暂借单", "归还暂借", "查询暂借单",
            "确认单据", "反确认单据",
            "查询客户", "查询库存", "查询转移单",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return ["inventory", "transfer_orders", "sales_orders", "customers"]

    def _get_sales_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：柜台（主要负责：销售开单、客户管理）

本类别支持的功能（只从以下 action 中选择）：
1. **创建销售单**：卖商品给客户（需要客户名、商品、克重、工费、业务员）
2. **查询销售单**：查询销售单信息，销售单号以 XS 开头
3. **销售数据查询**：查询销售统计数据（今天/本月/业绩等）
4. **创建暂借单**：客户暂借商品
5. **归还暂借**：客户归还暂借商品
6. **查询暂借单**：查询暂借单信息

请返回 JSON 格式：
- action: 从上述 action 中选择

创建销售单字段：
  - customer_name, salesperson, products（商品列表，每个含 product_name, weight, labor_cost）

查询销售单字段：
  - sales_order_no（XS开头）, customer_name, start_date, end_date

销售数据查询字段：
  - sales_query_type: today/month/compare/top_products/salesperson/summary
  - sales_query_salesperson

暂借字段：
  - loan_customer_name, loan_items, loan_salesperson

只返回 JSON，不要其他文字。

示例1（创建销售单）：
用户输入："卖给张三 足金手镯 10g 工费15"
{{"action": "创建销售单", "customer_name": "张三", "products": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 15}}]}}

示例2（查询销售单）：
用户输入："XS20260222001"
{{"action": "查询销售单", "sales_order_no": "XS20260222001", "products": null}}

示例3（销售统计）：
用户输入："今天卖了多少钱"
{{"action": "销售数据查询", "sales_query_type": "today", "products": null}}
"""

    def _get_return_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：柜台（可以退货给商品部、处理客户退货/销退）

本类别支持的功能：
1. **退货**：退商品给商品部（"退给商品部"/"退库"）
2. **销退**：客户退货给我们（"客户退货"/"销退"）

**关键词区分**：
- "退给商品部"/"退库" → "退货"
- "客户退"/"销退" → "销退"

请返回 JSON 格式：
- action: "退货" / "销退"
- products: 商品列表（product_name, weight, labor_cost）
- return_reason: 退货原因
- return_target: 退货目标（"商品部"等）
- customer_name: 客户名（销退时）

只返回 JSON，不要其他文字。

示例1（退给商品部）：
用户输入："退给商品部 古法戒指 5g"
{{"action": "退货", "return_target": "商品部", "products": [{{"product_name": "古法戒指", "weight": 5, "labor_cost": 0}}]}}

示例2（客户退货）：
用户输入："张三要退货 足金手镯 10g"
{{"action": "销退", "customer_name": "张三", "products": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 0}}]}}
"""

    def _get_query_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：柜台

本类别支持的功能：
1. **查询客户**：查询客户信息
2. **查询库存**：查询展厅库存
3. **查询转移单**：查询转移单/调拨单信息

请返回 JSON 格式：
- action: "查询客户" / "查询库存" / "查询转移单"
- customer_name, transfer_no 等相关字段

只返回 JSON，不要其他文字。
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：柜台

本类别支持的功能：
1. **创建客户**：新建客户信息
2. **确认单据**：确认某张单据（"确认" + 单号）
3. **反确认单据**：反确认/撤回已确认的单据
4. **系统帮助**：询问系统怎么用
5. **闲聊**：问候、寒暄

请返回 JSON 格式：
- action: "创建客户" / "确认单据" / "反确认单据" / "系统帮助" / "闲聊"
- customer_name（创建客户时）, confirm_order_no（确认时）

只返回 JSON，不要其他文字。

示例1：
用户输入："新建客户 张三"
{{"action": "创建客户", "customer_name": "张三", "products": null}}

示例2：
用户输入："你好"
{{"action": "闲聊", "products": null}}
"""

    def _fallback_classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        context_str = ""
        if conversation_history:
            context_str = "最近对话：\n"
            for h in conversation_history[-4:]:
                role = "用户" if h.get("role") == "user" else "系统"
                context_str += f"  {role}: {h.get('content', '')[:150]}\n"
            context_str += "\n"

        prompt = f"""用户是珠宝ERP系统的**柜台人员**，请判断这句话属于以下哪个类别：
- sales（销售相关：创建销售单、查询销售单、暂借）
- return（退货相关：退给商品部、客户退货/销退）
- query（通用查询：客户信息、库存、转移单）
- system（系统操作、确认单据、创建客户、闲聊）

{context_str}用户消息：「{message}」

重要：柜台人员最常做的是销售开单，优先考虑 sales。
只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat", max_tokens=20, temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {"sales", "return", "query", "system"}
            if result in valid:
                logger.info(f"[CounterAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[CounterAgent] AI 兜底分类失败: {e}")
            return "system"
