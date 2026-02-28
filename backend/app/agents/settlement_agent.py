"""SettlementAgent — 结算专员角色 Agent（试点）

职责范围：
  - 创建/查询结算单
  - 查询销售单（为结算做准备）
  - 查询客户账务（欠款/欠料/存料）
  - @结算 协同（结算确认、提料确认）
  - 查询金料记录
  - 收料/提料操作

不负责（交给其他 Agent 或 fallback）：
  - 入库、退货、转移
  - 供应商管理
  - 系统管理
"""

import re
import logging
from typing import List, Optional
from datetime import datetime, timedelta

from .base import BaseAgent

logger = logging.getLogger(__name__)


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _week_start() -> str:
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    return monday.strftime("%Y-%m-%d")


class SettlementAgent(BaseAgent):
    """结算专员 Agent"""

    @property
    def role_id(self) -> str:
        return "settlement"

    @property
    def role_name(self) -> str:
        return "结算专员"

    @property
    def system_prompt(self) -> str:
        return (
            "你是珠宝ERP系统的结算专员AI助手。"
            "你的核心职责是帮助结算专员完成结算单管理、客户账务查询和金料操作。"
            "你需要理解用户的自然语言输入，并提取相关信息。"
        )

    # ------------------------------------------------------------------
    # 意图分类
    # ------------------------------------------------------------------

    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        """结算专员专属分类器 — 只关心结算相关的意图。

        分类结果：
          - "settlement": 结算相关（创建/查询结算单）
          - "finance": 财务相关（收料/提料/账务/金料记录/对账/暂借）
          - "sales": 销售单查询（为结算做准备）
          - "query": 通用查询（客户/库存）
          - "system": 系统操作/闲聊
        """
        msg = message.strip()

        # 确认/反确认 + 单号
        if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
           re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
            return "system"

        # 帮助类
        if any(kw in msg for kw in ['怎么', '如何', '教我', '帮助', '使用说明']):
            return "system"

        # 存料结价 → finance（必须在结算关键词之前检查）
        if '存料结价' in msg or '料结价' in msg or '存料抵扣' in msg:
            return "finance"

        # 结算关键词（高优先级）
        settlement_keywords = ['结算', '结算单', '结价', '结料', '混合']
        if any(kw in msg for kw in settlement_keywords):
            return "settlement"
        if re.search(r'JS\d', msg):
            return "settlement"

        # 金料/财务关键词
        finance_keywords = [
            '来料', '交料', '存料', '收料', '付料', '提料',
            '收款', '打款', '付款', '欠款', '欠料', '账务',
            '金料', '余额', '对账', '对账单', '月结',
            '暂借', '借出', '借货', '还货', '归还',
            '凭证', '报销', '费用',
        ]
        if any(kw in msg for kw in finance_keywords):
            return "finance"
        if re.search(r'付\d', msg) or re.search(r'提\d', msg):
            return "finance"
        if re.search(r'ZJ\d', msg) or re.search(r'HH\d', msg):
            return "finance"

        # 销售单查询（结算专员需要查销售单来做结算）
        sales_keywords = ['销售', '销售单', '开单', '业绩']
        if any(kw in msg for kw in sales_keywords):
            return "sales"
        if re.search(r'XS\d', msg):
            return "sales"

        # 通用查询
        query_keywords = ['查询', '统计', '分析', '客户', '库存', '供应商']
        if any(kw in msg for kw in query_keywords):
            return "query"
        if re.search(r'TR\d', msg):
            return "query"

        # 兜底：调 AI 做轻量级分类
        return self._fallback_classify(msg, conversation_history)

    # ------------------------------------------------------------------
    # Prompt 生成
    # ------------------------------------------------------------------

    def get_prompt(self, category: str, message: str, context: str) -> str:
        """根据分类生成结算专员专属 Prompt。

        核心优化点：
          - 只包含结算专员能执行的 action
          - 示例数量大幅减少（从全局 60+ 减到 ~20）
          - token 消耗降低约 60%
        """
        dispatch = {
            "settlement": self._get_settlement_prompt,
            "finance": self._get_finance_prompt,
            "sales": self._get_sales_prompt,
            "query": self._get_query_prompt,
            "system": self._get_system_prompt,
        }
        prompt_fn = dispatch.get(category, self._get_system_prompt)
        return prompt_fn(message, context)

    def get_allowed_actions(self) -> List[str]:
        return [
            "创建结算单", "查询结算单",
            "查询销售单", "销售数据查询",
            "收料", "提料", "查询客户账务", "存料结价",
            "创建暂借单", "归还暂借", "查询暂借单",
            "查询对账单", "查询凭证",
            "查询金料记录",
            "确认单据", "反确认单据",
            "查询客户", "查询库存",
            "系统帮助", "闲聊",
        ]

    def get_data_access(self) -> List[str]:
        return [
            "inventory", "transfer_orders", "sales_orders",
            "customers", "customer_debt",
        ]

    # ------------------------------------------------------------------
    # 内部 Prompt 生成器
    # ------------------------------------------------------------------

    def _get_settlement_prompt(self, message: str, context: str) -> str:
        """结算核心 Prompt — 创建/查询结算单"""
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：结算专员（主要负责：创建结算单、确认结算、客户账务管理）

本类别支持的功能（只从以下 action 中选择）：
1. **创建结算单**：给客户做结算（需要客户名 + 结算方式：结料/结价/混合）
2. **查询结算单**：查询结算单信息，结算单号以 JS 开头

**关键词区分**：
- "结算" + 客户名 + 结算方式/金价 → "创建结算单"
- "查询结算"/"JS开头单号" → "查询结算单"
- "结价" + 客户名 + 克重 + 金价 → 可能是"存料结价"（finance 类别），但如果明确说"结算"则是创建结算单

请返回 JSON 格式，包含以下字段：
- action: "创建结算单" / "查询结算单"

创建结算单字段：
  - settlement_customer_name: 客户姓名（必填）
  - settlement_sales_order_no: 关联销售单号（XS开头，可选）
  - settlement_payment_method: 结算方式（必填："结料"/"结价"/"混合"）
  - settlement_gold_price: 当日金价（结价或混合时必填，数字，单位元/克）
  - settlement_remark: 备注（可选）

查询结算单字段：
  - settlement_order_no: 结算单号（JS开头，可选）
  - settlement_customer_name: 客户姓名（可选）
  - start_date: 开始日期（YYYY-MM-DD，可选）
  - end_date: 结束日期（YYYY-MM-DD，可选）

只返回 JSON，不要其他文字。

示例1（结料）：
用户输入："帮张三做一笔结算，结料"
{{"action": "创建结算单", "settlement_customer_name": "张三", "settlement_payment_method": "结料", "products": null}}

示例2（结价）：
用户输入："给李老板结算一下，结价，金价550"
{{"action": "创建结算单", "settlement_customer_name": "李老板", "settlement_payment_method": "结价", "settlement_gold_price": 550, "products": null}}

示例3（指定销售单）：
用户输入："XS20260222001 做结算 结料"
{{"action": "创建结算单", "settlement_sales_order_no": "XS20260222001", "settlement_payment_method": "结料", "products": null}}

示例4（查询-单号）：
用户输入："查询结算单JS20260222001"
{{"action": "查询结算单", "settlement_order_no": "JS20260222001", "products": null}}

示例5（查询-按客户）：
用户输入："查一下张三的结算单"
{{"action": "查询结算单", "settlement_customer_name": "张三", "products": null}}

示例6（JS开头直接输入）：
用户输入："JS20260222001"
{{"action": "查询结算单", "settlement_order_no": "JS20260222001", "products": null}}
"""

    def _get_finance_prompt(self, message: str, context: str) -> str:
        """结算专员的财务 Prompt — 只包含结算专员需要的财务操作"""
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：结算专员

本类别支持的功能（只从以下 action 中选择）：
1. **收料**：客户交料/来料/存料
2. **提料**：客户从存料中取走金料
3. **查询客户账务**：查询客户的欠款、欠料、存料
4. **存料结价**：将客户存料折算成现金抵扣欠款
5. **创建暂借单**：客户暂借商品
6. **归还暂借**：客户归还暂借商品
7. **查询暂借单**：查询暂借单信息
8. **查询对账单**：生成/查询客户对账单
9. **查询凭证**：查询 FBL 凭证
10. **查询金料记录**：查询收料/付料/提料的历史记录

**关键词区分**：
- "来料"/"交料"/"存料" + 客户名 + 克重 → "收料"
- "XX提X克" → "提料"
- "XX欠款"/"XX账务" → "查询客户账务"
- "XX结价X克" → "存料结价"
- "暂借"/"借出" → "创建暂借单"
- "归还"/"还货" → "归还暂借"
- "对账单" → "查询对账单"
- "凭证" → "查询凭证"
- "提料记录"/"收料记录"/"今天有多少人提料" → "查询金料记录"

请返回 JSON 格式：
- action: 从上述 action 中选择

收料字段：
  - receipt_customer_name, receipt_gold_weight, receipt_gold_fineness, receipt_remark

提料字段：
  - withdrawal_customer_name, withdrawal_gold_weight, withdrawal_remark

查询客户账务字段：
  - debt_customer_name, debt_query_type, date_start, date_end

存料结价字段：
  - deposit_settle_customer_name, deposit_settle_gold_weight, deposit_settle_gold_price, deposit_settle_remark

暂借字段：
  - loan_customer_name, loan_items, loan_salesperson, loan_remark

归还暂借字段：
  - loan_customer_name, loan_order_no, loan_remark

查询暂借单字段：
  - loan_order_no, loan_customer_name

查询对账单字段：
  - reconciliation_customer_name, reconciliation_month

查询凭证字段：
  - voucher_query_type, voucher_date_start, voucher_date_end, voucher_keyword

查询金料记录字段：
  - gold_record_type, gold_record_customer_name, gold_record_date_start, gold_record_date_end

只返回 JSON，不要其他文字。

示例-收料：
用户输入："张老板交料5克"
{{"action": "收料", "receipt_customer_name": "张老板", "receipt_gold_weight": 5, "products": null}}

示例-提料：
用户输入："张老板提5克"
{{"action": "提料", "withdrawal_customer_name": "张老板", "withdrawal_gold_weight": 5, "products": null}}

示例-账务：
用户输入："张老板的欠款情况"
{{"action": "查询客户账务", "debt_customer_name": "张老板", "debt_query_type": "all", "products": null}}

示例-存料结价：
用户输入："张老板存料结价3克 金价800"
{{"action": "存料结价", "deposit_settle_customer_name": "张老板", "deposit_settle_gold_weight": 3, "deposit_settle_gold_price": 800, "products": null}}

示例-暂借：
用户输入："张三暂借足金手镯 10克 工费8元"
{{"action": "创建暂借单", "loan_customer_name": "张三", "loan_items": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 8}}], "products": null}}

示例-查询金料记录：
用户输入："今天有多少人提料"
{{"action": "查询金料记录", "gold_record_type": "提料", "gold_record_date_start": "{_today()}", "gold_record_date_end": "{_today()}", "products": null}}
"""

    def _get_sales_prompt(self, message: str, context: str) -> str:
        """结算专员的销售 Prompt — 只包含查询，不包含创建销售单"""
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：结算专员（查询销售单是为了做结算准备，不负责创建销售单）

本类别支持的功能：
1. **查询销售单**：查询销售单信息，销售单号以 XS 开头
2. **销售数据查询**：查询销售统计数据

请返回 JSON 格式：
- action: "查询销售单" / "销售数据查询"

查询销售单字段：
  - sales_order_no: 销售单号（XS开头）
  - customer_name: 客户姓名

销售数据查询字段：
  - sales_query_type: today/month/compare/top_products/salesperson/summary
  - sales_query_days: 查询天数
  - sales_query_salesperson: 业务员姓名

只返回 JSON，不要其他文字。

示例1：
用户输入："查询销售单XS20260111162534"
{{"action": "查询销售单", "sales_order_no": "XS20260111162534", "products": null}}

示例2：
用户输入："查一下张三的销售单"
{{"action": "查询销售单", "customer_name": "张三", "products": null}}

示例3：
用户输入："今天卖了多少钱"
{{"action": "销售数据查询", "sales_query_type": "today", "products": null}}
"""

    def _get_query_prompt(self, message: str, context: str) -> str:
        """结算专员的通用查询 Prompt"""
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：结算专员

本类别支持的功能：
1. **查询客户**：查询客户信息
2. **查询库存**：查询展厅库存

请返回 JSON 格式：
- action: "查询客户" / "查询库存"
- customer_name: 客户姓名（查询客户时）

只返回 JSON，不要其他文字。

示例1：
用户输入："查询客户张三"
{{"action": "查询客户", "customer_name": "张三", "products": null}}

示例2：
用户输入："查询库存"
{{"action": "查询库存", "products": null}}
"""

    def _get_system_prompt(self, message: str, context: str) -> str:
        """结算专员的系统/闲聊 Prompt"""
        return f"""{self.system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：结算专员

本类别支持的功能：
1. **确认单据**：确认某张单据（"确认" + 单号）
2. **反确认单据**：反确认/撤回已确认的单据
3. **系统帮助**：询问系统怎么用
4. **闲聊**：问候、寒暄、感谢

请返回 JSON 格式：
- action: "确认单据" / "反确认单据" / "系统帮助" / "闲聊"
- confirm_order_no: 单据编号（确认/反确认时）

只返回 JSON，不要其他文字。

示例1：
用户输入："确认结算单JS20260222001"
{{"action": "确认单据", "confirm_order_no": "JS20260222001", "products": null}}

示例2：
用户输入："你好"
{{"action": "闲聊", "products": null}}
"""

    # ------------------------------------------------------------------
    # AI 兜底分类
    # ------------------------------------------------------------------

    def _fallback_classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        """结算专员专属 AI 兜底分类 — 分类范围更窄，更精准"""
        context_str = ""
        if conversation_history:
            context_str = "最近对话：\n"
            for h in conversation_history[-4:]:
                role = "用户" if h.get("role") == "user" else "系统"
                context_str += f"  {role}: {h.get('content', '')[:150]}\n"
            context_str += "\n"

        prompt = f"""用户是珠宝ERP系统的**结算专员**，请判断这句话属于以下哪个类别：
- settlement（结算单相关：创建结算、查询结算、结价、结料）
- finance（财务相关：收料、提料、账务、存料、暂借、对账、凭证）
- sales（销售单查询：查销售单、销售统计）
- query（通用查询：客户信息、库存）
- system（系统操作、确认单据、闲聊）

{context_str}用户消息：「{message}」

重要：结算专员最常做的是结算和客户账务，优先考虑 settlement 和 finance。
只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat",
                max_tokens=20,
                temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {"settlement", "finance", "sales", "query", "system"}
            if result in valid:
                logger.info(f"[SettlementAgent] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[SettlementAgent] AI 兜底分类失败: {e}")
            return "system"
