"""FinanceAgent — 财务角色 Agent

职责范围：
  - 全部财务操作（收料/付料/提料/收款/供应商付款）
  - 结算单管理
  - 入库 / 销售 / 退货（财务有全部权限）
  - 所有查询
  - 审核/确认单据
  - 对账 / 凭证 / 报销

不负责：无限制（财务拥有接近管理层的权限）
"""

import re
import logging
from typing import List, Optional
from datetime import datetime

from .base import BaseAgent

logger = logging.getLogger(__name__)


class FinanceAgent(BaseAgent):
    """财务 Agent"""

    @property
    def role_id(self) -> str:
        return "finance"

    @property
    def role_name(self) -> str:
        return "财务"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的财务AI助手。"
            "你的核心职责是帮助财务人员完成金料管理、收付款、对账和审核操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        msg = message.strip()

        # 确认/反确认
        if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
           re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
            return "system"

        if any(kw in msg for kw in ['怎么', '如何', '教我', '帮助', '使用说明']):
            return "system"

        # 退货
        if any(kw in msg for kw in ['退货', '退给', '退回', '退库', '销退', '客户退', '我要退']):
            return "return"
        if '退' in msg and not re.search(r'(查询|转移单|调拨|TR\d)', msg):
            return "return"
        if ('转移' in msg or '转到' in msg) and not re.search(r'(查询|TR\d)', msg):
            return "return"

        # 单号路由
        if re.search(r'RK\d', msg):
            return "inbound"
        if re.search(r'XS\d', msg):
            return "sales"
        if re.search(r'TH\d', msg):
            return "return"

        # 存料结价（在结算之前检查）
        if '存料结价' in msg or '料结价' in msg or '存料抵扣' in msg:
            return "finance"

        # 结算
        if any(kw in msg for kw in ['结算', '结算单', '结价', '结料', '混合']):
            return "settlement"
        if re.search(r'JS\d', msg):
            return "settlement"

        # 入库
        if any(kw in msg for kw in ['入库', '入库单', '查询入库单']):
            return "inbound"

        # 暂借
        if any(kw in msg for kw in ['暂借', '借出', '借货', '还货', '归还暂借', '还暂借']):
            return "finance"
        if re.search(r'ZJ\d', msg) or re.search(r'HH\d', msg):
            return "finance"

        # 销售
        if any(kw in msg for kw in ['卖', '销售', '开单', '销售单', '业绩']):
            return "sales"

        # 财务核心关键词
        finance_keywords = [
            '来料', '交料', '存料', '收料', '付料', '提料',
            '收款', '打款', '付款', '欠款', '欠料', '账务',
            '供应商付款', '金料', '收到',
            '欠', '多少钱', '对账', '账单', '余额',
            '对账单', '月结', '报销', '费用',
            '凭证', '收款凭证', '付款凭证',
        ]
        if any(kw in msg for kw in finance_keywords):
            return "finance"
        if re.search(r'付\d', msg) or re.search(r'提\d', msg):
            return "finance"

        # 库存
        if '库存' in msg:
            return "query"

        # 创建客户/供应商
        if any(kw in msg for kw in ['新建客户', '创建客户', '添加客户', '新建供应商', '创建供应商', '添加供应商']):
            return "system"

        # 通用查询
        if any(kw in msg for kw in ['查询', '统计', '分析', '图表', '供应商', '转移单', '调拨', '客户']):
            return "query"
        if re.search(r'TR\d', msg):
            return "query"

        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_prompt(self, category: str, message: str, context: str) -> str:
        dispatch = {
            "finance": self._get_finance_prompt,
            "settlement": self._get_settlement_prompt,
            "inbound": self._get_inbound_prompt,
            "sales": self._get_sales_prompt,
            "return": self._get_return_prompt,
            "query": self._get_query_prompt,
            "system": self._get_system_prompt,
        }
        return dispatch.get(category, self._get_system_prompt)(message, context)

    def get_allowed_actions(self) -> List[str]:
        return [
            "入库", "查询入库单",
            "创建销售单", "查询销售单", "销售数据查询",
            "创建结算单", "查询结算单",
            "退货", "销退", "批量转移", "创建转移单",
            "收料", "提料", "付料", "登记收款", "供应商付款",
            "查询客户账务", "存料结价",
            "创建暂借单", "归还暂借", "查询暂借单",
            "查询对账单", "查询凭证", "费用报销",
            "查询金料记录",
            "创建客户", "创建供应商",
            "确认单据", "反确认单据",
            "查询客户", "查询供应商", "查询库存", "查询转移单",
            "供应商分析", "统计分析",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return [
            "inventory", "transfer_orders", "inbound_orders", "sales_orders",
            "customers", "customer_debt", "suppliers", "supplier_gold",
        ]

    def _get_finance_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务（全权限财务操作）

本类别支持的功能（只从以下 action 中选择）：
1. **收料**：客户交料/来料/存料
2. **提料**：客户从存料中取走金料
3. **付料**：付金料给供应商
4. **登记收款**：登记客户付款
5. **供应商付款**：给供应商付工费
6. **查询客户账务**：查询客户欠款/欠料/存料
7. **存料结价**：将客户存料折算成现金抵扣欠款
8. **创建暂借单**：客户暂借商品
9. **归还暂借**：客户归还暂借商品
10. **查询暂借单**：查询暂借单信息
11. **查询对账单**：生成/查询客户对账单
12. **查询凭证**：查询 FBL 凭证
13. **费用报销**：提交费用报销
14. **查询金料记录**：查询收料/付料/提料历史

请返回 JSON 格式：
- action: 从上述 action 中选择

收料字段：receipt_customer_name, receipt_gold_weight, receipt_gold_fineness, receipt_remark
提料字段：withdrawal_customer_name, withdrawal_gold_weight, withdrawal_remark
付料字段：gold_payment_supplier_name, gold_payment_weight, gold_payment_remark
登记收款字段：payment_customer_name, payment_amount, payment_method
供应商付款字段：supplier_payment_name, supplier_payment_amount, supplier_payment_method
查询客户账务字段：debt_customer_name, debt_query_type, date_start, date_end
存料结价字段：deposit_settle_customer_name, deposit_settle_gold_weight, deposit_settle_gold_price

只返回 JSON，不要其他文字。

示例-收料：
用户输入："张老板交料5克"
{{"action": "收料", "receipt_customer_name": "张老板", "receipt_gold_weight": 5, "products": null}}

示例-付料：
用户输入："付20克给金源珠宝"
{{"action": "付料", "gold_payment_supplier_name": "金源珠宝", "gold_payment_weight": 20, "products": null}}

示例-账务：
用户输入："张老板的欠款情况"
{{"action": "查询客户账务", "debt_customer_name": "张老板", "debt_query_type": "all", "products": null}}
"""

    def _get_settlement_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务

本类别支持的功能：
1. **创建结算单**：给客户做结算（客户名 + 结算方式：结料/结价/混合）
2. **查询结算单**：查询结算单信息，单号以 JS 开头

请返回 JSON 格式：
- action: "创建结算单" / "查询结算单"
- settlement_customer_name, settlement_payment_method, settlement_gold_price, settlement_order_no

只返回 JSON，不要其他文字。
"""

    def _get_inbound_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务

本类别支持的功能：
1. **入库**：商品入库
2. **查询入库单**：查询入库单信息，单号以 RK 开头

请返回 JSON 格式：
- action: "入库" / "查询入库单"
- products（入库时）, inbound_order_no（查询时）

只返回 JSON，不要其他文字。
"""

    def _get_sales_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务

本类别支持的功能：
1. **创建销售单**：卖商品给客户
2. **查询销售单**：查询销售单信息，单号以 XS 开头
3. **销售数据查询**：查询销售统计

请返回 JSON 格式：
- action: "创建销售单" / "查询销售单" / "销售数据查询"

只返回 JSON，不要其他文字。
"""

    def _get_return_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务

本类别支持的功能：
1. **退货**：退商品给供应商或商品部
2. **销退**：客户退货给我们

请返回 JSON 格式：
- action: "退货" / "销退"
- products, return_reason, supplier/return_target, customer_name

只返回 JSON，不要其他文字。
"""

    def _get_query_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务

本类别支持的功能：
1. **查询客户**：查询客户信息
2. **查询供应商**：查询供应商信息
3. **供应商分析**：分析供应商数据
4. **查询库存**：查询库存
5. **查询转移单**：查询转移单/调拨单
6. **统计分析**：各类统计

请返回 JSON 格式：
- action: 从上述 action 中选择

只返回 JSON，不要其他文字。
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：财务

本类别支持的功能：
1. **创建客户**：新建客户
2. **创建供应商**：新建供应商
3. **确认单据**：确认某张单据
4. **反确认单据**：反确认/撤回
5. **系统帮助**：询问系统怎么用
6. **闲聊**：问候、寒暄

请返回 JSON 格式：
- action: "创建客户" / "创建供应商" / "确认单据" / "反确认单据" / "系统帮助" / "闲聊"

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

        prompt = f"""用户是珠宝ERP系统的**财务人员**，请判断这句话属于以下哪个类别：
- finance（财务相关：收料、付料、提料、收款、供应商付款、对账、凭证、暂借、报销）
- settlement（结算相关：创建结算、查询结算）
- inbound（入库相关：入库、查询入库单）
- sales（销售相关：创建销售单、查询销售单）
- return（退货相关：退货、销退）
- query（通用查询：客户、供应商、库存、转移单、统计）
- system（系统操作、确认单据、创建客户/供应商、闲聊）

{context_str}用户消息：「{message}」

重要：财务人员最常做的是财务操作，优先考虑 finance。
只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat", max_tokens=20, temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {"finance", "settlement", "inbound", "sales", "return", "query", "system"}
            if result in valid:
                logger.info(f"[FinanceAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[FinanceAgent] AI 兜底分类失败: {e}")
            return "system"
