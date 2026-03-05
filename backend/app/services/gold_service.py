"""
金料账户服务 - 提供金料账户一致性检查、对账和修复功能

主要功能：
1. 客户金料账户对账 - 验证 current_balance 与历史交易记录是否一致
2. 供应商金料账户对账 - 验证供应商账户余额
3. 批量对账和修复
4. 金料对账单生成
"""

from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Tuple
from decimal import Decimal
import logging

from ..models import (
    CustomerGoldDeposit,
    CustomerGoldDepositTransaction,
    GoldMaterialTransaction,
    SettlementOrder,
    Customer,
    SupplierGoldAccount,
    SupplierGoldTransaction,
    Supplier,
)
from ..models.finance import GoldReceipt
from ..timezone_utils import china_now

logger = logging.getLogger(__name__)

# 允许的误差范围（克）
TOLERANCE = 0.001


class GoldAccountService:
    """金料账户服务类"""
    
    # ==================== 客户金料账户对账 ====================
    
    @staticmethod
    async def calculate_customer_balance_from_transactions(
        db: Session, 
        customer_id: int
    ) -> Dict:
        """
        从历史交易记录计算客户金料余额
        
        计算逻辑：
        - 收料（来料）：增加余额
        - 结算扣料：减少余额
        - 取料：减少余额
        - 转料转出：减少余额
        - 转料转入：增加余额
        
        Returns:
            {
                "total_receipts": 总收料,
                "total_settlements": 总结算扣料,
                "total_withdrawals": 总取料,
                "total_transfers_out": 总转出,
                "total_transfers_in": 总转入,
                "calculated_balance": 计算余额
            }
        """
        # 1. 计算总收料（从 GoldReceipt 新系统查询）
        total_receipts = db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
            GoldReceipt.customer_id == customer_id,
            GoldReceipt.status == 'received'
        ).scalar() or 0.0
        
        # 2. 计算结算扣料（从 CustomerGoldDepositTransaction 查询）
        total_settlements = db.query(func.coalesce(func.sum(CustomerGoldDepositTransaction.amount), 0)).filter(
            CustomerGoldDepositTransaction.customer_id == customer_id,
            CustomerGoldDepositTransaction.transaction_type == 'use',
            CustomerGoldDepositTransaction.status == 'active'
        ).scalar() or 0.0
        
        # 3. 计算取料（从 CustomerWithdrawal 查询）
        from ..models import CustomerWithdrawal
        total_withdrawals = db.query(func.coalesce(func.sum(CustomerWithdrawal.gold_weight), 0)).filter(
            CustomerWithdrawal.customer_id == customer_id,
            CustomerWithdrawal.status == 'completed'
        ).scalar() or 0.0
        
        # 4. 计算转料（从 CustomerTransfer 查询）
        from ..models import CustomerTransfer
        total_transfers_out = db.query(func.coalesce(func.sum(CustomerTransfer.gold_weight), 0)).filter(
            CustomerTransfer.from_customer_id == customer_id,
            CustomerTransfer.status == 'completed'
        ).scalar() or 0.0
        
        total_transfers_in = db.query(func.coalesce(func.sum(CustomerTransfer.gold_weight), 0)).filter(
            CustomerTransfer.to_customer_id == customer_id,
            CustomerTransfer.status == 'completed'
        ).scalar() or 0.0
        
        # 5. 计算理论余额
        calculated_balance = (
            float(total_receipts) 
            - float(total_settlements) 
            - float(total_withdrawals) 
            - float(total_transfers_out) 
            + float(total_transfers_in)
        )
        
        return {
            "total_receipts": float(total_receipts),
            "total_settlements": float(total_settlements),
            "total_withdrawals": float(total_withdrawals),
            "total_transfers_out": float(total_transfers_out),
            "total_transfers_in": float(total_transfers_in),
            "calculated_balance": round(calculated_balance, 3)
        }
    
    @staticmethod
    async def reconcile_customer_balance(
        db: Session, 
        customer_id: int,
        auto_fix: bool = False
    ) -> Dict:
        """
        对账并检查客户金料余额一致性
        
        Args:
            db: 数据库会话
            customer_id: 客户ID
            auto_fix: 是否自动修复差异
            
        Returns:
            {
                "customer_id": 客户ID,
                "customer_name": 客户名称,
                "recorded_balance": 记录余额,
                "calculated_balance": 计算余额,
                "difference": 差异,
                "is_consistent": 是否一致,
                "auto_fixed": 是否已自动修复,
                "details": 计算明细
            }
        """
        # 获取客户信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"error": f"客户不存在: {customer_id}"}
        
        # 获取当前记录余额
        deposit = db.query(CustomerGoldDeposit).filter(
            CustomerGoldDeposit.customer_id == customer_id
        ).first()
        recorded_balance = deposit.current_balance if deposit else 0.0
        
        # 从交易记录计算余额
        calc_result = await GoldAccountService.calculate_customer_balance_from_transactions(
            db, customer_id
        )
        calculated_balance = calc_result["calculated_balance"]
        
        # 计算差异
        difference = round(calculated_balance - recorded_balance, 3)
        is_consistent = abs(difference) <= TOLERANCE
        
        auto_fixed = False
        fix_log = None
        
        # 自动修复
        if not is_consistent and auto_fix:
            if deposit:
                old_balance = deposit.current_balance
                deposit.current_balance = calculated_balance
                deposit.updated_at = china_now()
                
                # 记录修复日志
                fix_log = {
                    "fixed_at": china_now().isoformat(),
                    "old_balance": old_balance,
                    "new_balance": calculated_balance,
                    "difference": difference
                }
                
                db.commit()
                auto_fixed = True
                
                logger.warning(
                    f"[金料对账] 自动修复客户 {customer.name}(ID:{customer_id}) 余额: "
                    f"{old_balance} -> {calculated_balance}, 差异: {difference}克"
                )
            else:
                # 如果没有记录，创建一个
                new_deposit = CustomerGoldDeposit(
                    customer_id=customer_id,
                    customer_name=customer.name,
                    current_balance=calculated_balance,
                    total_deposited=calc_result["total_receipts"],
                    total_used=calc_result["total_settlements"]
                )
                db.add(new_deposit)
                db.commit()
                auto_fixed = True
                
                logger.info(
                    f"[金料对账] 为客户 {customer.name}(ID:{customer_id}) 创建金料账户, "
                    f"余额: {calculated_balance}克"
                )
        
        return {
            "customer_id": customer_id,
            "customer_name": customer.name,
            "recorded_balance": recorded_balance,
            "calculated_balance": calculated_balance,
            "difference": difference,
            "is_consistent": is_consistent,
            "auto_fixed": auto_fixed,
            "fix_log": fix_log,
            "details": calc_result
        }
    
    @staticmethod
    async def batch_reconcile_customers(
        db: Session,
        auto_fix: bool = False,
        only_inconsistent: bool = False
    ) -> Dict:
        """
        批量对账所有客户金料账户
        
        Args:
            db: 数据库会话
            auto_fix: 是否自动修复差异
            only_inconsistent: 是否只返回不一致的记录
            
        Returns:
            {
                "total_checked": 检查总数,
                "consistent_count": 一致数量,
                "inconsistent_count": 不一致数量,
                "fixed_count": 修复数量,
                "results": 详细结果列表
            }
        """
        # 获取所有有金料账户的客户
        deposits = db.query(CustomerGoldDeposit).all()
        customer_ids = {d.customer_id for d in deposits}
        
        # 也检查有金料交易但没有账户记录的客户
        receipt_customers = db.query(GoldReceipt.customer_id).filter(
            GoldReceipt.customer_id.isnot(None),
            GoldReceipt.status == 'received'
        ).distinct().all()
        for (cid,) in receipt_customers:
            customer_ids.add(cid)
        
        results = []
        consistent_count = 0
        inconsistent_count = 0
        fixed_count = 0
        
        for customer_id in customer_ids:
            result = await GoldAccountService.reconcile_customer_balance(
                db, customer_id, auto_fix
            )
            
            if "error" in result:
                continue
                
            if result["is_consistent"]:
                consistent_count += 1
                if only_inconsistent:
                    continue
            else:
                inconsistent_count += 1
                if result["auto_fixed"]:
                    fixed_count += 1
            
            results.append(result)
        
        return {
            "total_checked": len(customer_ids),
            "consistent_count": consistent_count,
            "inconsistent_count": inconsistent_count,
            "fixed_count": fixed_count,
            "results": results
        }
    
    # ==================== 供应商金料账户对账 ====================
    
    @staticmethod
    async def calculate_supplier_balance_from_transactions(
        db: Session,
        supplier_id: int
    ) -> Dict:
        """
        从历史交易记录计算供应商金料余额
        
        计算逻辑：
        - 收货（供应商发货）：我们欠料增加（余额+）
        - 付料（我们付给供应商）：我们欠料减少（余额-）
        
        Returns:
            {
                "total_received": 总收货,
                "total_paid": 总付料,
                "calculated_balance": 计算余额（正=我们欠供应商）
            }
        """
        # 从 SupplierGoldTransaction 查询
        total_received = db.query(func.coalesce(func.sum(SupplierGoldTransaction.gold_weight), 0)).filter(
            SupplierGoldTransaction.supplier_id == supplier_id,
            SupplierGoldTransaction.transaction_type == 'receive',
            SupplierGoldTransaction.status == 'active'
        ).scalar() or 0.0
        
        total_paid = db.query(func.coalesce(func.sum(SupplierGoldTransaction.gold_weight), 0)).filter(
            SupplierGoldTransaction.supplier_id == supplier_id,
            SupplierGoldTransaction.transaction_type == 'pay',
            SupplierGoldTransaction.status == 'active'
        ).scalar() or 0.0
        
        # 我们欠供应商的 = 收货 - 付料
        calculated_balance = float(total_received) - float(total_paid)
        
        return {
            "total_received": float(total_received),
            "total_paid": float(total_paid),
            "calculated_balance": round(calculated_balance, 3)
        }
    
    @staticmethod
    async def reconcile_supplier_balance(
        db: Session,
        supplier_id: int,
        auto_fix: bool = False
    ) -> Dict:
        """对账供应商金料账户"""
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            return {"error": f"供应商不存在: {supplier_id}"}
        
        account = db.query(SupplierGoldAccount).filter(
            SupplierGoldAccount.supplier_id == supplier_id
        ).first()
        recorded_balance = account.current_balance if account else 0.0
        
        calc_result = await GoldAccountService.calculate_supplier_balance_from_transactions(
            db, supplier_id
        )
        calculated_balance = calc_result["calculated_balance"]
        
        difference = round(calculated_balance - recorded_balance, 3)
        is_consistent = abs(difference) <= TOLERANCE
        
        auto_fixed = False
        
        if not is_consistent and auto_fix:
            if account:
                old_balance = account.current_balance
                account.current_balance = calculated_balance
                account.updated_at = china_now()
                db.commit()
                auto_fixed = True
                
                logger.warning(
                    f"[金料对账] 自动修复供应商 {supplier.name}(ID:{supplier_id}) 余额: "
                    f"{old_balance} -> {calculated_balance}, 差异: {difference}克"
                )
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.name,
            "recorded_balance": recorded_balance,
            "calculated_balance": calculated_balance,
            "difference": difference,
            "is_consistent": is_consistent,
            "auto_fixed": auto_fixed,
            "details": calc_result
        }
    
    # ==================== 金料对账单生成 ====================
    
    @staticmethod
    async def generate_customer_statement(
        db: Session,
        customer_id: int,
        start_date: date,
        end_date: date
    ) -> Dict:
        """
        生成客户金料对账单
        
        Args:
            db: 数据库会话
            customer_id: 客户ID
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            {
                "customer_id": 客户ID,
                "customer_name": 客户名称,
                "period": 期间,
                "opening_balance": 期初余额,
                "transactions": 交易明细列表,
                "closing_balance": 期末余额,
                "summary": 汇总信息
            }
        """
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"error": "客户不存在"}
        
        # 计算期初余额（start_date之前的所有交易）
        from datetime import datetime as dt
        start_datetime = dt.combine(start_date, dt.min.time())
        end_datetime = dt.combine(end_date, dt.max.time())
        
        # 获取期初余额（简化：查询start_date前最后一笔交易的balance_after）
        last_tx_before = db.query(CustomerGoldDepositTransaction).filter(
            CustomerGoldDepositTransaction.customer_id == customer_id,
            CustomerGoldDepositTransaction.created_at < start_datetime,
            CustomerGoldDepositTransaction.status == 'active'
        ).order_by(CustomerGoldDepositTransaction.created_at.desc()).first()
        
        opening_balance = last_tx_before.balance_after if last_tx_before else 0.0
        
        # 获取期间交易明细
        transactions = db.query(CustomerGoldDepositTransaction).filter(
            CustomerGoldDepositTransaction.customer_id == customer_id,
            CustomerGoldDepositTransaction.created_at >= start_datetime,
            CustomerGoldDepositTransaction.created_at <= end_datetime,
            CustomerGoldDepositTransaction.status == 'active'
        ).order_by(CustomerGoldDepositTransaction.created_at).all()
        
        # 构建对账单
        tx_list = []
        running_balance = opening_balance
        total_deposits = 0.0
        total_uses = 0.0
        
        for tx in transactions:
            if tx.transaction_type == 'deposit':
                change = tx.amount
                total_deposits += tx.amount
            else:  # use, refund
                change = -tx.amount
                total_uses += tx.amount
            
            running_balance += change
            
            tx_list.append({
                "id": tx.id,
                "date": tx.created_at.strftime("%Y-%m-%d %H:%M"),
                "type": tx.transaction_type,
                "type_label": {"deposit": "存料", "use": "使用", "refund": "退还"}.get(tx.transaction_type, tx.transaction_type),
                "amount": tx.amount,
                "change": change,
                "balance": round(running_balance, 3),
                "remark": tx.remark
            })
        
        closing_balance = running_balance
        
        return {
            "customer_id": customer_id,
            "customer_name": customer.name,
            "period": f"{start_date} ~ {end_date}",
            "opening_balance": opening_balance,
            "transactions": tx_list,
            "closing_balance": round(closing_balance, 3),
            "summary": {
                "total_deposits": total_deposits,
                "total_uses": total_uses,
                "net_change": round(total_deposits - total_uses, 3),
                "transaction_count": len(tx_list)
            }
        }


# 导出
__all__ = ['GoldAccountService', 'TOLERANCE']
