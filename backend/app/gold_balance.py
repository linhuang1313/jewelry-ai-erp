"""客户金料余额计算工具函数（统一口径）

所有获取客户存料/欠料余额的地方都必须调用此模块中的函数，
禁止在各 router 中重复实现计算逻辑。

统一公式：净存料 = 期初余额 + 来料 + 销退退料 - 结算用料 - 提料 - 已确认存料结价
返回值语义：正数=存料，负数=欠料

期初余额（数据迁移）：
  - customer_gold_deposit_transactions 中 created_by='系统迁移' 的记录

金料增加项（存料）：
  - 来料（GoldReceipt）
  - 销退退料（SalesReturnSettlement 的 physical_gold / mixed 退料部分）

金料减少项（消耗）：
  - 结算用料（SettlementOrder 的 physical_gold / mixed 金料部分）
  - 提料（CustomerWithdrawal）
  - 存料结价（DepositSettlement）
"""
import logging
from datetime import datetime
from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

logger = logging.getLogger(__name__)


def calculate_customer_net_gold(
    customer_id: int, 
    db: Session, 
    before_date: Optional[datetime] = None
) -> float:
    """计算单个客户的净金料余额（正数=存料，负数=欠料）
    
    统一公式：净存料 = 期初余额 + 来料 + 销退退料 - 结算用料 - 提料 - 已确认存料结价
    
    Args:
        customer_id: 客户ID
        db: 数据库会话
        before_date: 可选，只计算此日期之前的数据（用于期初余额计算）
        
    Returns:
        净金料余额（克），正数表示存料，负数表示欠料
    """
    from .models import (
        SettlementOrder, SalesOrder, CustomerWithdrawal, DepositSettlement,
        SalesReturnOrder, SalesReturnSettlement,
        CustomerGoldDepositTransaction,
    )
    from .models.finance import GoldReceipt
    
    # ========== 期初余额（数据迁移） ==========
    initial_q = db.query(
        func.coalesce(func.sum(CustomerGoldDepositTransaction.balance_after), 0)
    ).filter(
        CustomerGoldDepositTransaction.customer_id == customer_id,
        CustomerGoldDepositTransaction.created_by == '系统迁移'
    )
    # 取反：Excel 正数=客户欠料，系统正数=客户存料
    initial_gold = -float(initial_q.scalar() or 0)
    
    # ========== 金料增加项 ==========
    
    # 1. 来料（GoldReceipt，status='received'）
    receipts_q = db.query(
        func.coalesce(func.sum(GoldReceipt.gold_weight), 0)
    ).filter(
        GoldReceipt.customer_id == customer_id,
        GoldReceipt.status == 'received'
    )
    if before_date:
        receipts_q = receipts_q.filter(GoldReceipt.created_at < before_date)
    total_receipts = receipts_q.scalar() or 0
    
    # 2. 销退退料（SalesReturnSettlement 的退料部分，已确认）
    total_return_gold = 0.0
    return_settlements_q = db.query(SalesReturnSettlement).join(
        SalesReturnOrder, SalesReturnSettlement.sales_return_order_id == SalesReturnOrder.id
    ).filter(
        SalesReturnOrder.customer_id == customer_id,
        SalesReturnSettlement.status.in_(['confirmed', 'printed'])
    )
    if before_date:
        return_settlements_q = return_settlements_q.filter(SalesReturnSettlement.confirmed_at < before_date)
    for rs in return_settlements_q.all():
        if rs.payment_method == 'physical_gold':
            total_return_gold += rs.physical_gold_weight or 0
        elif rs.payment_method == 'mixed':
            total_return_gold += rs.gold_payment_weight or 0
    
    # ========== 金料减少项 ==========
    
    # 3. 结算用料（结料支付 + 混合支付的金料部分）
    total_settlement_gold = 0.0
    settlements_q = db.query(SettlementOrder).join(SalesOrder).filter(
        SalesOrder.customer_id == customer_id,
        SettlementOrder.status.in_(['confirmed', 'printed'])
    )
    if before_date:
        settlements_q = settlements_q.filter(SettlementOrder.created_at < before_date)
    for s in settlements_q.all():
        if s.payment_method == 'physical_gold':
            total_settlement_gold += s.physical_gold_weight or 0
        elif s.payment_method == 'mixed':
            total_settlement_gold += s.gold_payment_weight or 0
    
    # 4. 提料（CustomerWithdrawal，status in ['pending', 'completed']）
    withdrawals_q = db.query(
        func.coalesce(func.sum(CustomerWithdrawal.gold_weight), 0)
    ).filter(
        CustomerWithdrawal.customer_id == customer_id,
        CustomerWithdrawal.status.in_(['pending', 'completed'])
    )
    if before_date:
        withdrawals_q = withdrawals_q.filter(CustomerWithdrawal.created_at < before_date)
    total_withdrawals = withdrawals_q.scalar() or 0
    
    # 5. 已确认的存料结价（DepositSettlement，status='confirmed'）
    deposit_q = db.query(
        func.coalesce(func.sum(DepositSettlement.gold_weight), 0)
    ).filter(
        DepositSettlement.customer_id == customer_id,
        DepositSettlement.status == 'confirmed'
    )
    if before_date:
        deposit_q = deposit_q.filter(DepositSettlement.confirmed_at < before_date)
    total_deposit_settled = deposit_q.scalar() or 0
    
    # ========== 计算净存料 ==========
    # 净存料 = 期初余额 + (来料 + 销退退料) - (结算用料 + 提料 + 存料结价)
    net_gold = (
        initial_gold
        + float(total_receipts) + total_return_gold
        - total_settlement_gold - float(total_withdrawals) - float(total_deposit_settled)
    )
    
    return round(net_gold, 3)


def calculate_batch_net_gold(customer_ids: List[int], db: Session) -> Dict[int, float]:
    """批量计算多个客户的净金料余额（正数=存料，负数=欠料）
    
    与 calculate_customer_net_gold 公式完全一致，
    但使用 GROUP BY 批量查询，适用于客户列表页。
    
    Args:
        customer_ids: 客户ID列表
        db: 数据库会话
        
    Returns:
        字典 {customer_id: net_gold}，未出现在结果中的客户净金料为 0
    """
    if not customer_ids:
        return {}
    
    from .models import (
        SettlementOrder, SalesOrder, CustomerWithdrawal, DepositSettlement,
        SalesReturnOrder, SalesReturnSettlement,
        CustomerGoldDepositTransaction,
    )
    from .models.finance import GoldReceipt
    
    # ========== 期初余额（数据迁移） ==========
    initial_map = {}
    initial_rows = db.query(
        CustomerGoldDepositTransaction.customer_id,
        func.sum(CustomerGoldDepositTransaction.balance_after).label('initial')
    ).filter(
        CustomerGoldDepositTransaction.customer_id.in_(customer_ids),
        CustomerGoldDepositTransaction.created_by == '系统迁移'
    ).group_by(CustomerGoldDepositTransaction.customer_id).all()
    for row in initial_rows:
        # 取反：Excel 正数=客户欠料，系统正数=客户存料
        initial_map[row.customer_id] = -float(row.initial or 0)
    
    # ========== 金料增加项 ==========
    
    # 1. 批量查询来料（GROUP BY customer_id）
    receipts_map = {}
    receipts = db.query(
        GoldReceipt.customer_id,
        func.sum(GoldReceipt.gold_weight).label('total_weight')
    ).filter(
        GoldReceipt.customer_id.in_(customer_ids),
        GoldReceipt.status == 'received'
    ).group_by(GoldReceipt.customer_id).all()
    for row in receipts:
        receipts_map[row.customer_id] = float(row.total_weight or 0)
    
    # 2. 批量查询销退退料（需要逐行判断 payment_method）
    return_gold_map = {}
    return_settlements = db.query(
        SalesReturnOrder.customer_id,
        SalesReturnSettlement.payment_method,
        SalesReturnSettlement.physical_gold_weight,
        SalesReturnSettlement.gold_payment_weight
    ).join(
        SalesReturnSettlement, SalesReturnSettlement.sales_return_order_id == SalesReturnOrder.id
    ).filter(
        SalesReturnOrder.customer_id.in_(customer_ids),
        SalesReturnSettlement.status.in_(['confirmed', 'printed'])
    ).all()
    for row in return_settlements:
        cid = row.customer_id
        if cid not in return_gold_map:
            return_gold_map[cid] = 0.0
        if row.payment_method == 'physical_gold':
            return_gold_map[cid] += row.physical_gold_weight or 0
        elif row.payment_method == 'mixed':
            return_gold_map[cid] += row.gold_payment_weight or 0
    
    # ========== 金料减少项 ==========
    
    # 3. 批量查询结算用料（需要逐行判断 payment_method）
    settlement_gold_map = {}
    settlements = db.query(
        SalesOrder.customer_id,
        SettlementOrder.payment_method,
        SettlementOrder.physical_gold_weight,
        SettlementOrder.gold_payment_weight
    ).join(SettlementOrder, SettlementOrder.sales_order_id == SalesOrder.id).filter(
        SalesOrder.customer_id.in_(customer_ids),
        SettlementOrder.status.in_(['confirmed', 'printed'])
    ).all()
    for row in settlements:
        cid = row.customer_id
        if cid not in settlement_gold_map:
            settlement_gold_map[cid] = 0.0
        if row.payment_method == 'physical_gold':
            settlement_gold_map[cid] += row.physical_gold_weight or 0
        elif row.payment_method == 'mixed':
            settlement_gold_map[cid] += row.gold_payment_weight or 0
    
    # 4. 批量查询提料（GROUP BY customer_id）
    withdrawals_map = {}
    withdrawals = db.query(
        CustomerWithdrawal.customer_id,
        func.sum(CustomerWithdrawal.gold_weight).label('total_weight')
    ).filter(
        CustomerWithdrawal.customer_id.in_(customer_ids),
        CustomerWithdrawal.status.in_(['pending', 'completed'])
    ).group_by(CustomerWithdrawal.customer_id).all()
    for row in withdrawals:
        withdrawals_map[row.customer_id] = float(row.total_weight or 0)
    
    # 5. 批量查询已确认的存料结价（GROUP BY customer_id）
    deposit_settle_map = {}
    deposit_settles = db.query(
        DepositSettlement.customer_id,
        func.sum(DepositSettlement.gold_weight).label('total_weight')
    ).filter(
        DepositSettlement.customer_id.in_(customer_ids),
        DepositSettlement.status == 'confirmed'
    ).group_by(DepositSettlement.customer_id).all()
    for row in deposit_settles:
        deposit_settle_map[row.customer_id] = float(row.total_weight or 0)
    
    # ========== 合并计算 ==========
    # 净存料 = 期初余额 + (来料 + 销退退料) - (结算用料 + 提料 + 存料结价)
    result = {}
    for cid in customer_ids:
        initial = initial_map.get(cid, 0.0)
        receipt = receipts_map.get(cid, 0.0)
        return_gold = return_gold_map.get(cid, 0.0)
        settlement = settlement_gold_map.get(cid, 0.0)
        withdrawal = withdrawals_map.get(cid, 0.0)
        deposit_settled = deposit_settle_map.get(cid, 0.0)
        result[cid] = round(initial + receipt + return_gold - settlement - withdrawal - deposit_settled, 3)
    
    return result


# 向后兼容的别名
calculate_customer_gold_balance = calculate_customer_net_gold
