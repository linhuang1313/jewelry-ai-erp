"""结算专员 Skill 集合

Phase 1: 薄封装 — 调用现有 chat_handlers.py 中的函数
Phase 2: 逐步将业务逻辑迁移到 Skill 内部
"""

from typing import Dict, Any, List
from sqlalchemy.orm import Session

from .base_skill import BaseSkill


class CreateSettlementSkill(BaseSkill):
    """创建结算单"""

    @property
    def name(self) -> str:
        return "创建结算单"

    @property
    def description(self) -> str:
        return "为客户创建结算单（结价/结料/混合支付）"

    @property
    def required_fields(self) -> List[str]:
        return ["settlement_customer_name", "settlement_payment_method"]

    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        from ...routers.chat_handlers import handle_create_settlement
        return await handle_create_settlement(params, db)


class QuerySettlementSkill(BaseSkill):
    """查询结算单"""

    @property
    def name(self) -> str:
        return "查询结算单"

    @property
    def description(self) -> str:
        return "按单号/客户/日期查询结算单"

    @property
    def required_fields(self) -> List[str]:
        return []

    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        from ...routers.chat_handlers import handle_query_settlement
        return await handle_query_settlement(params, db)


class QueryCustomerDebtSkill(BaseSkill):
    """查询客户账务"""

    @property
    def name(self) -> str:
        return "查询客户账务"

    @property
    def description(self) -> str:
        return "查询客户的欠款、欠料、存料等财务信息"

    @property
    def required_fields(self) -> List[str]:
        return ["debt_customer_name"]

    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        # 查询客户账务走 ai_analyzer 的 collect_all_data 路径，
        # 这里只是标记 — 实际执行在 chat.py 的分析流程中
        return {"success": True, "action": "查询客户账务", "route": "analyzer"}


class GoldReceiptSkill(BaseSkill):
    """收料（客户交料）"""

    @property
    def name(self) -> str:
        return "收料"

    @property
    def description(self) -> str:
        return "客户交料/来料/存料"

    @property
    def required_fields(self) -> List[str]:
        return ["receipt_customer_name", "receipt_gold_weight"]

    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        from ...routers.chat_handlers import handle_gold_receipt
        return await handle_gold_receipt(params, db)


class GoldWithdrawalSkill(BaseSkill):
    """提料（客户取料）"""

    @property
    def name(self) -> str:
        return "提料"

    @property
    def description(self) -> str:
        return "客户从存料中取走金料"

    @property
    def required_fields(self) -> List[str]:
        return ["withdrawal_customer_name", "withdrawal_gold_weight"]

    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        from ...routers.chat_handlers import handle_gold_withdrawal
        return await handle_gold_withdrawal(params, db)


class DepositSettlementSkill(BaseSkill):
    """存料结价"""

    @property
    def name(self) -> str:
        return "存料结价"

    @property
    def description(self) -> str:
        return "将客户存料折算成现金抵扣欠款"

    @property
    def required_fields(self) -> List[str]:
        return ["deposit_settle_customer_name", "deposit_settle_gold_weight", "deposit_settle_gold_price"]

    async def execute(self, params: Dict[str, Any], db: Session) -> Dict[str, Any]:
        from ...routers.chat_handlers import handle_deposit_settlement
        return await handle_deposit_settlement(params, db)


# Skill 注册表 — 结算专员可用的所有 Skill
SETTLEMENT_SKILLS = {
    "创建结算单": CreateSettlementSkill(),
    "查询结算单": QuerySettlementSkill(),
    "查询客户账务": QueryCustomerDebtSkill(),
    "收料": GoldReceiptSkill(),
    "提料": GoldWithdrawalSkill(),
    "存料结价": DepositSettlementSkill(),
}
