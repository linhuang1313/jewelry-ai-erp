"""销售领域 PromptSkill

处理：创建销售单、查询销售单、销售数据统计查询等销售相关操作。
"""

from typing import List

from .prompt_skill import PromptSkill


class SalesPromptSkill(PromptSkill):

    @property
    def name(self) -> str:
        return "sales"

    @property
    def display_name(self) -> str:
        return "销售"

    @property
    def keywords(self) -> List[str]:
        return ['卖', '销售', '开单', '销售单', '业绩']

    @property
    def patterns(self) -> List[str]:
        return [r'XS\d']

    @property
    def actions(self) -> List[str]:
        return ["创建销售单", "查询销售单", "销售数据查询"]

    @property
    def priority(self) -> int:
        return 40

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

本类别支持的功能（只从以下 action 中选择）：
1. **创建销售单**：卖商品给客户（需要客户名、商品、克重、工费、业务员）
2. **查询销售单**：查询销售单信息，销售单号以 XS 开头
3. **销售数据查询**：查询销售统计数据（今天/本月/业绩等）

请返回 JSON 格式：
- action: "创建销售单" / "查询销售单" / "销售数据查询"

创建销售单字段：
  - customer_name, salesperson, products（商品列表，每个含 product_name, weight, labor_cost）

查询销售单字段：
  - sales_order_no（XS开头）, customer_name, start_date, end_date

销售数据查询字段：
  - sales_query_type: today/month/compare/top_products/salesperson/summary
  - sales_query_salesperson

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
