"""财务领域 PromptSkill

处理：收料/提料/付料、客户收款、供应商付款、客户账务查询、
存料结价、暂借单、对账、凭证、费用报销、金料记录等财务相关操作。
"""

from typing import List

from .prompt_skill import PromptSkill


class FinancePromptSkill(PromptSkill):

    @property
    def name(self) -> str:
        return "finance"

    @property
    def display_name(self) -> str:
        return "财务"

    @property
    def keywords(self) -> List[str]:
        return [
            '来料', '交料', '存料', '收料', '付料', '提料',
            '收款', '打款', '付款', '欠款', '欠料', '账务',
            '供应商付款', '金料', '收到', '欠', '多少钱',
            '对账', '账单', '余额', '对账单', '月结',
            '报销', '费用', '凭证', '收款凭证', '付款凭证',
            '暂借', '借出', '借货', '还货', '归还暂借', '还暂借',
            '存料结价', '料结价', '存料抵扣',
        ]

    @property
    def patterns(self) -> List[str]:
        return [r'付\d', r'提\d', r'ZJ\d', r'HH\d']

    @property
    def actions(self) -> List[str]:
        return [
            "收料", "提料", "付料", "登记收款", "供应商付款",
            "查询客户账务", "存料结价", "创建暂借单", "归还暂借",
            "查询暂借单", "查询对账单", "查询凭证", "费用报销",
            "查询金料记录",
        ]

    @property
    def priority(self) -> int:
        return 45

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

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
暂借字段：loan_customer_name, loan_items, loan_salesperson
对账单字段：reconciliation_customer_name, reconciliation_month
凭证字段：voucher_query_type, voucher_date_start, voucher_date_end
金料记录字段：gold_record_type, gold_record_customer_name, gold_record_date_start, gold_record_date_end

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
