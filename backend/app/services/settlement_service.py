"""
结算服务层 - 提供结算单的业务逻辑处理

主要功能：
1. 结算确认 - 带完整事务控制
2. 结算撤销 - 支持回滚账务
3. 结算单状态管理
"""

from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import Optional, Dict
import logging

from ..models import (
    SettlementOrder,
    SalesOrder,
    SalesDetail,
    CustomerGoldDeposit,
    CustomerGoldDepositTransaction,
    CustomerTransaction,
)
from ..models.finance import AccountReceivable
from ..timezone_utils import china_now
from .gold_service import GoldAccountService
from ..core.tenant_rules import apply_tenant_rules

logger = logging.getLogger(__name__)


class SettlementService:
    """结算服务类"""
    
    @staticmethod
    @apply_tenant_rules(trigger_point="confirm_settlement")
    async def confirm_settlement_with_transaction(
        db: Session,
        settlement_id: int,
        confirmed_by: str,
        user_role: str = "settlement"
    ) -> Dict:
        """
        确认结算单 - 带完整事务控制
        
        事务包含：
        1. 更新结算单状态
        2. 更新销售单状态
        3. 更新客户金料账户（如果是结料/混合支付）
        4. 创建应收账款记录
        5. 记录审计日志
        
        任一步骤失败，全部回滚
        
        Args:
            db: 数据库会话
            settlement_id: 结算单ID
            confirmed_by: 确认人
            user_role: 用户角色
            
        Returns:
            确认结果
        """
        # ========== 1. 验证结算单 ==========
        settlement = db.query(SettlementOrder).filter(
            SettlementOrder.id == settlement_id
        ).first()
        
        if not settlement:
            raise ValueError(f"结算单不存在: {settlement_id}")
        
        if settlement.status != "pending":
            raise ValueError(f"结算单状态为 {settlement.status}，无法确认")
        
        # 获取关联的销售单
        sales_order = db.query(SalesOrder).filter(
            SalesOrder.id == settlement.sales_order_id
        ).first()
        
        if not sales_order:
            raise ValueError(f"关联的销售单不存在")
        
        try:
            # ========== 2. 更新结算单状态 ==========
            old_status = settlement.status
            settlement.status = "confirmed"
            settlement.confirmed_by = confirmed_by
            settlement.confirmed_at = china_now()
            
            logger.info(f"[结算确认] 步骤1: 更新结算单状态 {old_status} -> confirmed")
            
            # ========== 3. 更新销售单状态 ==========
            sales_order.status = "已结算"
            logger.info(f"[结算确认] 步骤2: 更新销售单状态 -> 已结算")
            
            # ========== 4. 处理金料账户（如果是结料/混合支付）==========
            gold_balance_change = None
            if settlement.payment_method in ["physical_gold", "mixed"]:
                gold_weight = settlement.physical_gold_weight or settlement.gold_payment_weight or 0
                
                if gold_weight > 0 and sales_order.customer_id:
                    # 更新客户金料账户
                    customer_deposit = db.query(CustomerGoldDeposit).filter(
                        CustomerGoldDeposit.customer_id == sales_order.customer_id
                    ).first()
                    
                    if customer_deposit:
                        balance_before = customer_deposit.current_balance
                        customer_deposit.current_balance = round(
                            customer_deposit.current_balance - gold_weight, 3
                        )
                        customer_deposit.total_used = round(
                            customer_deposit.total_used + gold_weight, 3
                        )
                        customer_deposit.last_transaction_at = china_now()
                        
                        gold_balance_change = {
                            "customer_id": sales_order.customer_id,
                            "customer_name": sales_order.customer_name,
                            "balance_before": balance_before,
                            "balance_after": customer_deposit.current_balance,
                            "change": -gold_weight
                        }
                        
                        # 创建金料账户变动记录
                        deposit_tx = CustomerGoldDepositTransaction(
                            customer_id=sales_order.customer_id,
                            customer_name=sales_order.customer_name,
                            transaction_type='use',
                            settlement_order_id=settlement.id,
                            amount=gold_weight,
                            balance_before=balance_before,
                            balance_after=customer_deposit.current_balance,
                            created_by=confirmed_by,
                            remark=f"结算单确认：{settlement.settlement_no}"
                        )
                        db.add(deposit_tx)
                        
                        logger.info(
                            f"[结算确认] 步骤3: 更新金料账户 "
                            f"客户={sales_order.customer_name}, "
                            f"变动={-gold_weight}克, "
                            f"余额: {balance_before} -> {customer_deposit.current_balance}"
                        )
            
            # ========== 5. 创建应收账款 ==========
            receivable_amount = SettlementService._calculate_receivable_amount(settlement)
            receivable_created = False
            
            if receivable_amount > 0:
                now = china_now()
                credit_days = 30
                due_date = now.date() + timedelta(days=credit_days)
                
                account_receivable = AccountReceivable(
                    sales_order_id=settlement.sales_order_id,
                    customer_id=sales_order.customer_id,
                    total_amount=receivable_amount,
                    received_amount=0.0,
                    unpaid_amount=receivable_amount,
                    credit_days=credit_days,
                    credit_start_date=now.date(),
                    due_date=due_date,
                    overdue_days=0,
                    status="unpaid",
                    is_overdue=False,
                    salesperson=sales_order.salesperson,
                    store_code=sales_order.store_code,
                    remark=f"结算单：{settlement.settlement_no}",
                    operator=confirmed_by
                )
                db.add(account_receivable)
                receivable_created = True
                
                logger.info(
                    f"[结算确认] 步骤4: 创建应收账款 "
                    f"金额={receivable_amount}, 账期={credit_days}天"
                )
            
            # ========== 6. 记录审计日志 ==========
            try:
                from ..models.audit import AuditLog, BalanceChangeLog
                import json
                
                # 主审计日志
                audit_log = AuditLog(
                    user_id=confirmed_by,
                    user_role=user_role,
                    action="confirm",
                    entity_type="settlement",
                    entity_id=settlement.id,
                    new_value=json.dumps({
                        "settlement_no": settlement.settlement_no,
                        "customer_name": sales_order.customer_name,
                        "total_amount": settlement.total_amount,
                        "gold_weight": settlement.physical_gold_weight,
                        "receivable_amount": receivable_amount
                    }, ensure_ascii=False),
                    remark=f"确认结算单 {settlement.settlement_no}",
                    created_at=china_now()
                )
                db.add(audit_log)
                
                # 余额变动日志
                if gold_balance_change:
                    balance_log = BalanceChangeLog(
                        account_type="customer_gold",
                        account_id=gold_balance_change["customer_id"],
                        account_name=gold_balance_change["customer_name"],
                        change_type="settlement",
                        change_amount=str(gold_balance_change["change"]),
                        balance_before=str(gold_balance_change["balance_before"]),
                        balance_after=str(gold_balance_change["balance_after"]),
                        reference_type="settlement",
                        reference_id=settlement.id,
                        reference_no=settlement.settlement_no,
                        operator=confirmed_by,
                        operator_role=user_role,
                        remark=f"结算单确认扣料",
                        created_at=china_now()
                    )
                    db.add(balance_log)
                
                logger.info(f"[结算确认] 步骤5: 记录审计日志")
            except ImportError:
                logger.warning("[结算确认] 审计日志模型未导入，跳过审计日志")
            
            # ========== 7. 提交事务 ==========
            db.commit()
            
            logger.info(
                f"[结算确认] 成功! 结算单={settlement.settlement_no}, "
                f"客户={sales_order.customer_name}, "
                f"应收={receivable_amount}"
            )
            
            return {
                "success": True,
                "settlement_id": settlement.id,
                "settlement_no": settlement.settlement_no,
                "status": "confirmed",
                "receivable_amount": receivable_amount,
                "receivable_created": receivable_created,
                "gold_balance_change": gold_balance_change
            }
            
        except Exception as e:
            # 回滚事务
            db.rollback()
            logger.error(f"[结算确认] 失败! 结算单ID={settlement_id}, 错误: {str(e)}")
            raise
    
    @staticmethod
    async def revert_settlement(
        db: Session,
        settlement_id: int,
        reverted_by: str,
        reason: str,
        user_role: str = "manager"
    ) -> Dict:
        """
        撤销已确认的结算单 - 回滚所有账务变动
        
        撤销操作包含：
        1. 将结算单状态改回 pending
        2. 将销售单状态改回 待结算
        3. 恢复客户金料账户余额
        4. 取消应收账款
        5. 记录审计日志
        
        Args:
            db: 数据库会话
            settlement_id: 结算单ID
            reverted_by: 撤销人
            reason: 撤销原因
            user_role: 用户角色
            
        Returns:
            撤销结果
        """
        # 权限检查：只有管理员可以撤销
        if user_role not in ['manager']:
            raise PermissionError("只有管理员可以撤销结算单")
        
        # 查找结算单
        settlement = db.query(SettlementOrder).filter(
            SettlementOrder.id == settlement_id
        ).first()
        
        if not settlement:
            raise ValueError(f"结算单不存在: {settlement_id}")
        
        if settlement.status not in ["confirmed", "printed"]:
            raise ValueError(f"结算单状态为 {settlement.status}，只有已确认/已打印的结算单可以撤销")
        
        # 获取关联的销售单
        sales_order = db.query(SalesOrder).filter(
            SalesOrder.id == settlement.sales_order_id
        ).first()
        
        if not sales_order:
            raise ValueError("关联的销售单不存在")
        
        try:
            old_status = settlement.status
            
            # ========== 1. 恢复客户金料账户 ==========
            gold_restored = None
            if settlement.payment_method in ["physical_gold", "mixed"]:
                gold_weight = settlement.physical_gold_weight or settlement.gold_payment_weight or 0
                
                if gold_weight > 0 and sales_order.customer_id:
                    customer_deposit = db.query(CustomerGoldDeposit).filter(
                        CustomerGoldDeposit.customer_id == sales_order.customer_id
                    ).first()
                    
                    if customer_deposit:
                        balance_before = customer_deposit.current_balance
                        # 恢复余额（加回扣减的金料）
                        customer_deposit.current_balance = round(
                            customer_deposit.current_balance + gold_weight, 3
                        )
                        customer_deposit.total_used = round(
                            max(0, customer_deposit.total_used - gold_weight), 3
                        )
                        customer_deposit.last_transaction_at = china_now()
                        
                        gold_restored = {
                            "customer_id": sales_order.customer_id,
                            "customer_name": sales_order.customer_name,
                            "balance_before": balance_before,
                            "balance_after": customer_deposit.current_balance,
                            "restored": gold_weight
                        }
                        
                        # 创建恢复记录
                        restore_tx = CustomerGoldDepositTransaction(
                            customer_id=sales_order.customer_id,
                            customer_name=sales_order.customer_name,
                            transaction_type='refund',
                            settlement_order_id=settlement.id,
                            amount=gold_weight,
                            balance_before=balance_before,
                            balance_after=customer_deposit.current_balance,
                            created_by=reverted_by,
                            remark=f"撤销结算单：{settlement.settlement_no}，原因：{reason}"
                        )
                        db.add(restore_tx)
                        
                        logger.info(
                            f"[结算撤销] 恢复金料账户: "
                            f"客户={sales_order.customer_name}, "
                            f"恢复={gold_weight}克, "
                            f"余额: {balance_before} -> {customer_deposit.current_balance}"
                        )
            
            # ========== 2. 取消应收账款 ==========
            receivable = db.query(AccountReceivable).filter(
                AccountReceivable.sales_order_id == settlement.sales_order_id
            ).first()
            
            receivable_cancelled = False
            if receivable and receivable.status == 'unpaid':
                receivable.status = 'cancelled'
                receivable_cancelled = True
                logger.info(f"[结算撤销] 取消应收账款")
            
            # ========== 3. 更新结算单状态 ==========
            settlement.status = "pending"
            settlement.confirmed_by = None
            settlement.confirmed_at = None
            # 记录撤销信息到备注
            settlement.remark = (settlement.remark or "") + f"\n[撤销] {china_now().strftime('%Y-%m-%d %H:%M')} 由 {reverted_by} 撤销，原因：{reason}"
            
            # ========== 4. 更新销售单状态 ==========
            sales_order.status = "待结算"
            
            # ========== 5. 记录审计日志 ==========
            try:
                from ..models.audit import AuditLog, BalanceChangeLog
                import json
                
                audit_log = AuditLog(
                    user_id=reverted_by,
                    user_role=user_role,
                    action="revert",
                    entity_type="settlement",
                    entity_id=settlement.id,
                    old_value=json.dumps({"status": old_status}, ensure_ascii=False),
                    new_value=json.dumps({
                        "status": "pending",
                        "reason": reason,
                        "gold_restored": gold_restored,
                        "receivable_cancelled": receivable_cancelled
                    }, ensure_ascii=False),
                    remark=f"撤销结算单 {settlement.settlement_no}，原因：{reason}",
                    created_at=china_now()
                )
                db.add(audit_log)
                
                if gold_restored:
                    balance_log = BalanceChangeLog(
                        account_type="customer_gold",
                        account_id=gold_restored["customer_id"],
                        account_name=gold_restored["customer_name"],
                        change_type="revert",
                        change_amount=str(gold_restored["restored"]),
                        balance_before=str(gold_restored["balance_before"]),
                        balance_after=str(gold_restored["balance_after"]),
                        reference_type="settlement",
                        reference_id=settlement.id,
                        reference_no=settlement.settlement_no,
                        operator=reverted_by,
                        operator_role=user_role,
                        remark=f"撤销结算单恢复金料",
                        created_at=china_now()
                    )
                    db.add(balance_log)
            except ImportError:
                pass
            
            # ========== 6. 提交事务 ==========
            db.commit()
            
            logger.info(
                f"[结算撤销] 成功! 结算单={settlement.settlement_no}, "
                f"撤销人={reverted_by}, 原因={reason}"
            )
            
            return {
                "success": True,
                "settlement_id": settlement.id,
                "settlement_no": settlement.settlement_no,
                "old_status": old_status,
                "new_status": "pending",
                "gold_restored": gold_restored,
                "receivable_cancelled": receivable_cancelled,
                "reason": reason
            }
            
        except Exception as e:
            db.rollback()
            logger.error(f"[结算撤销] 失败! 结算单ID={settlement_id}, 错误: {str(e)}")
            raise
    
    @staticmethod
    def _calculate_receivable_amount(settlement: SettlementOrder) -> float:
        """计算应收账款金额"""
        if settlement.payment_method == "cash_price":
            # 结价：应收全额（料价+工费）
            return settlement.total_amount or 0
        elif settlement.payment_method == "physical_gold":
            # 结料：只应收工费（原料用金料抵扣）
            return settlement.labor_amount or 0
        elif settlement.payment_method == "mixed":
            # 混合支付：结价部分的料价 + 工费
            cash_material_amount = (settlement.cash_payment_weight or 0) * (settlement.gold_price or 0)
            return cash_material_amount + (settlement.labor_amount or 0)
        else:
            return settlement.total_amount or 0


# 导出
__all__ = ['SettlementService']
