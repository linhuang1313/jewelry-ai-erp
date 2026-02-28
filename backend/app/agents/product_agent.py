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

logger = logging.getLogger(__name__)


class ProductAgent(BaseAgent):
    """商品部 Agent"""

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

        if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
           re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
            return "system"

        if any(kw in msg for kw in ['怎么', '如何', '教我', '帮助', '使用说明']):
            return "system"

        # 退货给供应商
        if any(kw in msg for kw in ['退货', '退给', '退回', '退库']):
            return "return"
        if '退' in msg and not re.search(r'(查询|转移单|调拨|TR\d)', msg):
            return "return"

        # 转移
        if ('转移' in msg or '转到' in msg) and not re.search(r'(查询|TR\d)', msg):
            return "return"

        # RK 单号 → 入库
        if re.search(r'RK\d', msg):
            return "inbound"
        if re.search(r'TH\d', msg):
            return "return"

        # 入库关键词
        if any(kw in msg for kw in ['入库', '入库单', '查询入库单']):
            return "inbound"

        # 库存查询（商品部视角）
        if '库存' in msg:
            return "inbound"

        # 供应商管理
        if any(kw in msg for kw in ['新建供应商', '创建供应商', '添加供应商']):
            return "system"

        # 通用查询
        if any(kw in msg for kw in ['查询', '统计', '分析', '图表', '供应商', '转移单', '调拨']):
            return "query"
        if re.search(r'TR\d', msg):
            return "query"

        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_prompt(self, category: str, message: str, context: str) -> str:
        dispatch = {
            "inbound": self._get_inbound_prompt,
            "return": self._get_return_prompt,
            "query": self._get_query_prompt,
            "system": self._get_system_prompt,
        }
        return dispatch.get(category, self._get_system_prompt)(message, context)

    def get_allowed_actions(self) -> List[str]:
        return [
            "入库", "查询入库单",
            "退货", "批量转移", "创建转移单",
            "创建供应商",
            "确认单据", "反确认单据",
            "查询库存", "查询供应商", "查询转移单", "供应商分析", "统计分析",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return ["inventory", "transfer_orders", "inbound_orders", "suppliers", "supplier_gold"]

    def _get_inbound_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：商品部（主要负责：入库、库存管理）

本类别支持的功能（只从以下 action 中选择）：
1. **入库**：商品入库（需要商品名、重量、工费、供应商）
2. **查询入库单**：查询入库单信息，入库单号以 RK 开头
3. **查询库存**：查询商品部仓库库存
4. **批量转移**：按入库单号批量转移商品到目标位置

请返回 JSON 格式：
- action: "入库" / "查询入库单" / "查询库存" / "批量转移"

入库字段：
  - products: 商品列表（product_name, weight, labor_cost, supplier, piece_count, piece_labor_cost）

查询入库单字段：
  - inbound_order_no（RK开头）, supplier, start_date, end_date

批量转移字段：
  - batch_transfer_order_no（RK开头）, batch_transfer_target（目标位置）

只返回 JSON，不要其他文字。

示例1（入库）：
用户输入："足金手镯 10g 工费15 供应商金源珠宝"
{{"action": "入库", "products": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 15, "supplier": "金源珠宝"}}]}}

示例2（查询入库单）：
用户输入："RK20260208001"
{{"action": "查询入库单", "inbound_order_no": "RK20260208001", "products": null}}

示例3（批量转移）：
用户输入："把RK20260208001转到展厅"
{{"action": "批量转移", "batch_transfer_order_no": "RK20260208001", "batch_transfer_target": "展厅", "products": null}}
"""

    def _get_return_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：商品部（可以退货给供应商、创建转移单）

本类别支持的功能：
1. **退货**：退商品给供应商（"退给XX供应商"/"退货"）
2. **创建转移单**：创建库存转移单

请返回 JSON 格式：
- action: "退货" / "创建转移单"
- products: 商品列表（product_name, weight, labor_cost）
- return_reason, supplier（退货时）
- transfer_target（转移时）

只返回 JSON，不要其他文字。

示例（退给供应商）：
用户输入："退货 足金手镯 10g 退给金源珠宝 质量问题"
{{"action": "退货", "supplier": "金源珠宝", "return_reason": "质量问题", "products": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 0}}]}}
"""

    def _get_query_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：商品部

本类别支持的功能：
1. **查询供应商**：查询供应商信息
2. **供应商分析**：分析供应商数据
3. **查询转移单**：查询转移单/调拨单
4. **统计分析**：入库/库存统计

请返回 JSON 格式：
- action: "查询供应商" / "供应商分析" / "查询转移单" / "统计分析"

只返回 JSON，不要其他文字。
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：商品部

本类别支持的功能：
1. **创建供应商**：新建供应商
2. **确认单据**：确认某张单据
3. **反确认单据**：反确认/撤回
4. **系统帮助**：询问系统怎么用
5. **闲聊**：问候、寒暄

请返回 JSON 格式：
- action: "创建供应商" / "确认单据" / "反确认单据" / "系统帮助" / "闲聊"

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

        prompt = f"""用户是珠宝ERP系统的**商品专员**，请判断这句话属于以下哪个类别：
- inbound（入库相关：入库、查询入库单、查询库存、批量转移）
- return（退货相关：退货给供应商、创建转移单）
- query（通用查询：供应商、转移单、统计分析）
- system（系统操作、确认单据、创建供应商、闲聊）

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
            valid = {"inbound", "return", "query", "system"}
            if result in valid:
                logger.info(f"[ProductAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[ProductAgent] AI 兜底分类失败: {e}")
            return "system"
