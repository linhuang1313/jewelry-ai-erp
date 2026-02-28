"""通用查询领域 PromptSkill

处理：查询客户、查询供应商、供应商分析、查询库存、查询转移单、统计分析、生成图表。
作为低优先级的兜底 Skill，在其他 Skill 未匹配时捕获通用查询意图。

注意：'库存' 关键词不在本 Skill 的 keywords 中，因为不同 Agent 对 '库存' 的路由不同
（如 ProductAgent 路由到 inbound），由 Agent 的 classify 逻辑单独处理。
"""

from typing import List

from .prompt_skill import PromptSkill


class QueryPromptSkill(PromptSkill):

    @property
    def name(self) -> str:
        return "query"

    @property
    def display_name(self) -> str:
        return "查询"

    @property
    def keywords(self) -> List[str]:
        return ['查询', '统计', '分析', '图表', '可视化', '供应商', '转移单', '调拨', '客户']

    @property
    def patterns(self) -> List[str]:
        return [r'TR\d']

    @property
    def actions(self) -> List[str]:
        return [
            "查询客户", "查询供应商", "供应商分析",
            "查询库存", "查询转移单", "统计分析", "生成图表",
        ]

    @property
    def priority(self) -> int:
        return 60

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

本类别支持的功能（只从以下 action 中选择）：
1. **查询客户**：查询客户信息
2. **查询供应商**：查询供应商信息
3. **供应商分析**：分析供应商数据
4. **查询库存**：查询库存
5. **查询转移单**：查询转移单/调拨单
6. **统计分析**：各类统计
7. **生成图表**：生成可视化图表

请返回 JSON 格式：
- action: 从上述 action 中选择
- customer_name, supplier_name, transfer_order_no 等相关字段

只返回 JSON，不要其他文字。

示例1：
用户输入："查询客户张三"
{{"action": "查询客户", "customer_name": "张三", "products": null}}

示例2：
用户输入："供应商分析"
{{"action": "供应商分析", "products": null}}
"""
