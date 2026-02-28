"""ManagerAgent — 管理层角色 Agent

职责范围：
  - 全部操作（最高权限）
  - 统计分析 / 图表
  - 所有查询
  - 审核/确认

分类器复用旧 pre_classify 的全部逻辑（最宽泛），但注入管理层视角。
"""

import re
import logging
from typing import List, Optional
from datetime import datetime

from .base import BaseAgent

logger = logging.getLogger(__name__)


class ManagerAgent(BaseAgent):
    """管理层 Agent"""

    @property
    def role_id(self) -> str:
        return "manager"

    @property
    def role_name(self) -> str:
        return "管理层"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的管理层AI助手。"
            "你拥有系统的全部权限，可以执行所有操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        """管理层分类器 — 复用旧 pre_classify 的全部逻辑"""
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

        # 入库
        if any(kw in msg for kw in ['入库', '入库单', '查询入库单', '库存']):
            return "inbound"

        # 暂借
        if any(kw in msg for kw in ['暂借', '借出', '借货', '还货', '归还暂借', '还暂借']):
            return "finance"
        if re.search(r'ZJ\d', msg) or re.search(r'HH\d', msg):
            return "finance"

        # 存料结价
        if '存料结价' in msg or '料结价' in msg or '存料抵扣' in msg:
            return "finance"

        # 结算
        if any(kw in msg for kw in ['结算', '结算单', '结价', '结料', '混合']):
            return "settlement"
        if re.search(r'JS\d', msg):
            return "settlement"

        # 销售
        if any(kw in msg for kw in ['卖', '销售', '开单', '销售单', '业绩']):
            return "sales"

        # 财务
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

        # 创建客户/供应商
        if any(kw in msg for kw in ['新建客户', '创建客户', '添加客户', '新建供应商', '创建供应商', '添加供应商']):
            return "system"

        # 通用查询
        if any(kw in msg for kw in ['查询', '统计', '分析', '图表', '可视化', '供应商', '转移单', '调拨', '客户']):
            return "query"
        if re.search(r'TR\d', msg):
            return "query"

        if '确认' in msg or '反确认' in msg:
            return "system"

        return self._fallback_classify(msg, conversation_history)

    def get_prompt(self, category: str, message: str, context: str) -> str:
        dispatch = {
            "inbound": self._get_inbound_prompt,
            "sales": self._get_sales_prompt,
            "return": self._get_return_prompt,
            "finance": self._get_finance_prompt,
            "settlement": self._get_settlement_prompt,
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
            "供应商分析", "统计分析", "生成图表",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return [
            "inventory", "transfer_orders", "inbound_orders", "sales_orders",
            "customers", "customer_debt", "suppliers", "supplier_gold",
        ]

    def _get_inbound_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：管理层（全部权限）

本类别支持的功能：
1. **入库**：商品入库（商品名、重量、工费、供应商）
2. **查询入库单**：查询入库单信息，单号以 RK 开头
3. **查询库存**：查询库存
4. **批量转移**：按入库单号批量转移商品

请返回 JSON 格式：
- action: "入库" / "查询入库单" / "查询库存" / "批量转移"
- products（入库时）, inbound_order_no（查询时）, batch_transfer_order_no, batch_transfer_target

只返回 JSON，不要其他文字。
"""

    def _get_sales_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：管理层

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

**当前用户角色**：管理层

本类别支持的功能：
1. **退货**：退商品给供应商或商品部
2. **销退**：客户退货给我们
3. **创建转移单**：创建库存转移单

请返回 JSON 格式：
- action: "退货" / "销退" / "创建转移单"
- products, return_reason, supplier/return_target, customer_name

只返回 JSON，不要其他文字。
"""

    def _get_finance_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：管理层

本类别支持的功能：
1. **收料**：客户交料/来料/存料
2. **提料**：客户从存料中取走金料
3. **付料**：付金料给供应商
4. **登记收款**：登记客户付款
5. **供应商付款**：给供应商付工费
6. **查询客户账务**：查询客户欠款/欠料/存料
7. **存料结价**：将客户存料折算成现金
8. **创建暂借单**：客户暂借商品
9. **归还暂借**：归还暂借
10. **查询暂借单**：查询暂借单
11. **查询对账单**：查询对账单
12. **查询凭证**：查询凭证
13. **费用报销**：费用报销
14. **查询金料记录**：查询金料记录

请返回 JSON 格式：
- action: 从上述 action 中选择

只返回 JSON，不要其他文字。
"""

    def _get_settlement_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：管理层

本类别支持的功能：
1. **创建结算单**：给客户做结算
2. **查询结算单**：查询结算单信息，单号以 JS 开头

请返回 JSON 格式：
- action: "创建结算单" / "查询结算单"
- settlement_customer_name, settlement_payment_method, settlement_gold_price, settlement_order_no

只返回 JSON，不要其他文字。
"""

    def _get_query_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：管理层

本类别支持的功能：
1. **查询客户**：查询客户信息
2. **查询供应商**：查询供应商信息
3. **供应商分析**：分析供应商数据
4. **查询库存**：查询库存
5. **查询转移单**：查询转移单
6. **统计分析**：各类统计
7. **生成图表**：生成可视化图表

请返回 JSON 格式：
- action: 从上述 action 中选择

只返回 JSON，不要其他文字。
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：管理层

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

        prompt = f"""用户是珠宝ERP系统的**管理层**，请判断这句话属于以下哪个类别：
- inbound（入库相关：入库、查询入库单、查询库存、批量转移）
- sales（销售相关：创建销售单、查询销售单、销售统计）
- return（退货相关：退货、销退、转移）
- finance（财务相关：收料、付料、提料、收款、供应商付款、对账、凭证、暂借）
- settlement（结算相关：创建结算、查询结算）
- query（通用查询：客户、供应商、统计分析、图表）
- system（系统操作、确认单据、创建客户/供应商、闲聊）

{context_str}用户消息：「{message}」

管理层拥有全部权限，请根据消息内容准确分类。
只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat", max_tokens=20, temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {"inbound", "sales", "return", "finance", "settlement", "query", "system"}
            if result in valid:
                logger.info(f"[ManagerAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[ManagerAgent] AI 兜底分类失败: {e}")
            return "system"
