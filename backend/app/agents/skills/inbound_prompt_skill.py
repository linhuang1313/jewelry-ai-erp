"""入库类 PromptSkill — 入库、查询入库单、查询库存、批量转移"""

from typing import List

from .prompt_skill import PromptSkill


class InboundPromptSkill(PromptSkill):

    @property
    def name(self) -> str:
        return "inbound"

    @property
    def display_name(self) -> str:
        return "入库"

    @property
    def keywords(self) -> List[str]:
        return ['入库', '入库单', '查询入库单']

    @property
    def patterns(self) -> List[str]:
        return [r'RK\d']

    @property
    def actions(self) -> List[str]:
        return ["入库", "查询入库单", "查询库存", "批量转移"]

    @property
    def priority(self) -> int:
        return 40

    def get_prompt(self, message: str, context: str, role_name: str, system_prompt: str) -> str:
        return f"""{system_prompt}
{context}
用户当前输入：{message}

**当前用户角色**：{role_name}

本类别支持的功能：
1. **入库**：将商品入库到仓库（需要商品信息）
2. **查询入库单**：按单号/日期/供应商查询入库单
3. **查询库存**：查询当前库存情况
4. **批量转移**：将多件商品从一个位置转移到另一个位置

请返回 JSON 格式：
- action: "入库" / "查询入库单" / "查询库存" / "批量转移"
- products（入库时的商品列表）
- inbound_order_no（查询入库单时的单号）
- batch_transfer_from（批量转移的来源位置）
- batch_transfer_to（批量转移的目标位置）
- batch_transfer_products（批量转移的商品列表）

只返回 JSON，不要其他文字。

示例1：
用户输入："入库一个金戒指 5g"
{{"action": "入库", "products": [{{"name": "金戒指", "weight": 5.0}}]}}

示例2：
用户输入："查一下RK20250101001"
{{"action": "查询入库单", "inbound_order_no": "RK20250101001", "products": null}}

示例3：
用户输入："把柜台A的东西都转到柜台B"
{{"action": "批量转移", "batch_transfer_from": "柜台A", "batch_transfer_to": "柜台B", "products": null}}"""
