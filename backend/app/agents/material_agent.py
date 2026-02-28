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
    """料部 Agent"""

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

        if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
           re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
            return "system"

        if any(kw in msg for kw in ['怎么', '如何', '教我', '帮助', '使用说明']):
            return "system"

        # 金料/付料核心关键词
        finance_keywords = [
            '付料', '金料', '供应商付款',
            '打款', '付款', '收到',
        ]
        if any(kw in msg for kw in finance_keywords):
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

    def get_prompt(self, category: str, message: str, context: str) -> str:
        dispatch = {
            "finance": self._get_finance_prompt,
            "query": self._get_query_prompt,
            "system": self._get_system_prompt,
        }
        return dispatch.get(category, self._get_system_prompt)(message, context)

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

    def _get_finance_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：料部（主要负责：付料给供应商、供应商付款）

本类别支持的功能（只从以下 action 中选择）：
1. **付料**：付金料给供应商
2. **供应商付款**：给供应商付工费（现金）
3. **查询金料记录**：查询付料历史记录

请返回 JSON 格式：
- action: "付料" / "供应商付款" / "查询金料记录"

付料字段：
  - gold_payment_supplier_name: 供应商名称
  - gold_payment_weight: 金料重量（克）
  - gold_payment_remark: 备注

供应商付款字段：
  - supplier_payment_name: 供应商名称
  - supplier_payment_amount: 付款金额
  - supplier_payment_method: 付款方式

只返回 JSON，不要其他文字。

示例1（付料）：
用户输入："付20克给金源珠宝"
{{"action": "付料", "gold_payment_supplier_name": "金源珠宝", "gold_payment_weight": 20, "products": null}}

示例2（供应商付款）：
用户输入："给金源珠宝付款5000元"
{{"action": "供应商付款", "supplier_payment_name": "金源珠宝", "supplier_payment_amount": 5000, "products": null}}
"""

    def _get_query_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：料部

本类别支持的功能：
1. **查询供应商**：查询供应商信息
2. **供应商分析**：分析供应商数据
3. **查询客户**：查询客户信息
4. **查询库存**：查询库存
5. **查询转移单**：查询转移单/调拨单

请返回 JSON 格式：
- action: "查询供应商" / "供应商分析" / "查询客户" / "查询库存" / "查询转移单"

只返回 JSON，不要其他文字。
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：料部

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

        prompt = f"""用户是珠宝ERP系统的**料部人员**，请判断这句话属于以下哪个类别：
- finance（金料相关：付料给供应商、供应商付款、查询金料记录）
- query（通用查询：供应商、客户、库存、转移单）
- system（系统操作、确认单据、创建供应商、闲聊）

{context_str}用户消息：「{message}」

重要：料部人员最常做的是付料和供应商管理，优先考虑 finance。
只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat", max_tokens=20, temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {"finance", "query", "system"}
            if result in valid:
                logger.info(f"[MaterialAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[MaterialAgent] AI 兜底分类失败: {e}")
            return "system"
