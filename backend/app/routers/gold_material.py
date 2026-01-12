"""
金料管理路由
- 收料单管理（从客户收取金料）
- 付料单管理（支付给供应商）
- 金料库存查询
- 客户存料管理
- 客户往来账查询
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, extract, and_
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict
from collections import defaultdict
import logging

from ..database import get_db
from ..timezone_utils import china_now
from ..models import (
    GoldMaterialTransaction,
    CustomerGoldDeposit,
    CustomerGoldDepositTransaction,
    CustomerTransaction,
    SettlementOrder,
    SalesOrder,
    InboundOrder,
    Customer,
    Supplier,
)
from ..schemas import (
    GoldReceiptCreate,
    GoldReceiptUpdate,
    GoldPaymentCreate,
    GoldMaterialTransactionConfirm,
    GoldMaterialTransactionResponse,
    GoldMaterialBalanceResponse,
    CustomerGoldDepositResponse,
    CustomerGoldDepositTransactionResponse,
    CustomerTransactionResponse,
    CustomerAccountSummary,
)
from ..middleware.permissions import has_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gold-material", tags=["金料管理"])


# ==================== 辅助函数 ====================

def build_transaction_response(transaction: GoldMaterialTransaction, db: Session) -> dict:
    """构建金料流转记录响应"""
    settlement_no = None
    inbound_order_no = None
    
    if transaction.settlement_order_id:
        settlement = db.query(SettlementOrder).filter(
            SettlementOrder.id == transaction.settlement_order_id
        ).first()
        if settlement:
            settlement_no = settlement.settlement_no
    
    if transaction.inbound_order_id:
        inbound = db.query(InboundOrder).filter(
            InboundOrder.id == transaction.inbound_order_id
        ).first()
        if inbound:
            inbound_order_no = inbound.order_no
    
    return {
        "id": transaction.id,
        "transaction_no": transaction.transaction_no,
        "transaction_type": transaction.transaction_type,
        "settlement_order_id": transaction.settlement_order_id,
        "settlement_no": settlement_no,
        "customer_id": transaction.customer_id,
        "customer_name": transaction.customer_name,
        "inbound_order_id": transaction.inbound_order_id,
        "inbound_order_no": inbound_order_no,
        "supplier_id": transaction.supplier_id,
        "supplier_name": transaction.supplier_name,
        "gold_weight": transaction.gold_weight,
        "status": transaction.status,
        "created_by": transaction.created_by,
        "confirmed_by": transaction.confirmed_by,
        "confirmed_at": transaction.confirmed_at,
        "created_at": transaction.created_at,
        "receipt_printed_at": transaction.receipt_printed_at,
        "payment_printed_at": transaction.payment_printed_at,
        "remark": transaction.remark,
    }


def get_gold_balance_internal(db: Session) -> dict:
    """内部函数：获取金料库存余额"""
    # 计算总收入（已确认的收料单）
    total_income = db.query(func.sum(GoldMaterialTransaction.gold_weight)).filter(
        GoldMaterialTransaction.transaction_type == 'income',
        GoldMaterialTransaction.status == 'confirmed'
    ).scalar() or 0.0
    
    # 计算总支出（已确认的付料单）
    total_expense = db.query(func.sum(GoldMaterialTransaction.gold_weight)).filter(
        GoldMaterialTransaction.transaction_type == 'expense',
        GoldMaterialTransaction.status == 'confirmed'
    ).scalar() or 0.0
    
    return {
        "total_income": total_income,
        "total_expense": total_expense,
        "current_balance": total_income - total_expense
    }


def get_or_create_customer_deposit(customer_id: int, customer_name: str, db: Session) -> CustomerGoldDeposit:
    """获取或创建客户存料记录"""
    deposit = db.query(CustomerGoldDeposit).filter(
        CustomerGoldDeposit.customer_id == customer_id
    ).first()
    
    if not deposit:
        deposit = CustomerGoldDeposit(
            customer_id=customer_id,
            customer_name=customer_name,
            current_balance=0.0,
            total_deposited=0.0,
            total_used=0.0
        )
        db.add(deposit)
        db.flush()
    
    return deposit


def calculate_settlement_gold_received(settlement_id: int, db: Session) -> float:
    """计算某结算单已收金料总重量"""
    receipts = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.settlement_order_id == settlement_id,
        GoldMaterialTransaction.transaction_type == 'income',
        GoldMaterialTransaction.status != 'cancelled'
    ).all()
    
    return sum(r.gold_weight for r in receipts)


# ==================== 收料单管理 ====================

@router.post("/receipts", response_model=GoldMaterialTransactionResponse)
async def create_gold_receipt(
    data: GoldReceiptCreate,
    user_role: str = Query(default="settlement", description="用户角色"),
    created_by: str = Query(default="结算专员", description="创建人"),
    db: Session = Depends(get_db)
):
    """
    创建收料单（结算专员收到客户原料后创建）
    
    - 验证结算单是否存在且为结料方式
    - 计算欠款和存料
    - 创建金料收入记录和往来账记录
    - 如有超付，更新客户存料
    """
    # 权限检查
    if not has_permission(user_role, 'can_create_gold_receipt'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【创建收料单】的权限")
    
    # 查找结算单
    settlement = db.query(SettlementOrder).filter(
        SettlementOrder.id == data.settlement_order_id
    ).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="结算单不存在")
    
    if settlement.payment_method != 'physical_gold':
        raise HTTPException(status_code=400, detail="该结算单不是结料方式，无法创建收料单")
    
    if settlement.status not in ['pending', 'confirmed', 'printed']:
        raise HTTPException(status_code=400, detail=f"结算单状态为 {settlement.status}，无法创建收料单")
    
    # 获取销售单和客户信息
    sales_order = settlement.sales_order
    if not sales_order:
        raise HTTPException(status_code=400, detail="结算单未关联销售单")
    
    customer_id = sales_order.customer_id
    customer_name = sales_order.customer_name
    
    # 计算该结算单应支付金料和已收金料
    total_due = settlement.physical_gold_weight or 0.0  # 应支付金料重量
    total_received = calculate_settlement_gold_received(settlement.id, db)  # 已收金料重量
    remaining_due = total_due - total_received  # 剩余欠款
    
    # 计算本次支付后的情况
    new_total_received = total_received + data.gold_weight
    
    # 本次支付中用于结清欠款的部分和存入存料的部分
    if data.gold_weight <= remaining_due:
        # 本次支付 <= 剩余欠款，全部用于结清欠款
        payment_for_due = data.gold_weight
        deposit_amount = 0.0
    else:
        # 本次支付 > 剩余欠款，部分结清欠款，部分存入存料
        payment_for_due = remaining_due
        deposit_amount = data.gold_weight - remaining_due
    
    # 计算本次交易后的欠款
    new_remaining_due = max(0.0, remaining_due - data.gold_weight)
    
    # 生成收料单号（SL开头）
    now = china_now()
    count = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.transaction_no.like(f"SL{now.strftime('%Y%m%d')}%")
    ).count()
    receipt_no = f"SL{now.strftime('%Y%m%d')}{count + 1:03d}"
    
    # 创建金料收入记录（收料单）
    transaction = GoldMaterialTransaction(
        transaction_no=receipt_no,
        transaction_type='income',
        settlement_order_id=settlement.id,
        customer_id=customer_id,
        customer_name=customer_name,
        gold_weight=data.gold_weight,
        status="pending",  # 待料部确认收到
        created_by=created_by,
        remark=data.remark
    )
    db.add(transaction)
    db.flush()
    
    # 创建客户往来账记录
    customer_transaction = CustomerTransaction(
        customer_id=customer_id,
        customer_name=customer_name,
        transaction_type='gold_receipt',
        settlement_order_id=settlement.id,
        gold_transaction_id=transaction.id,
        gold_weight=data.gold_weight,
        gold_due_before=remaining_due,
        gold_due_after=new_remaining_due,
        remark=f"收料单：{receipt_no}，结算单：{settlement.settlement_no}。支付欠款：{payment_for_due:.2f}克" + 
               (f"，存入存料：{deposit_amount:.2f}克" if deposit_amount > 0 else "")
    )
    db.add(customer_transaction)
    
    # 如果有超付，更新客户存料记录（预处理，实际在料部确认后才生效）
    # 这里先记录下存料金额，等料部确认后再实际更新存料
    if deposit_amount > 0:
        transaction.remark = (transaction.remark or "") + f" [待确认存料：{deposit_amount:.2f}克]"
    
    db.commit()
    db.refresh(transaction)
    
    logger.info(f"创建收料单: {receipt_no}, 结算单: {settlement.settlement_no}, "
                f"金料重量: {data.gold_weight}克, 支付欠款: {payment_for_due}克, 存入存料: {deposit_amount}克")
    
    return build_transaction_response(transaction, db)


@router.get("/receipts")
async def get_gold_receipts(
    status: Optional[str] = None,
    customer_id: Optional[int] = None,
    user_role: str = Query(default="settlement", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取收料单列表"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看金料记录】的权限")
    
    query = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.transaction_type == 'income'
    )
    
    if status:
        query = query.filter(GoldMaterialTransaction.status == status)
    if customer_id:
        query = query.filter(GoldMaterialTransaction.customer_id == customer_id)
    
    receipts = query.order_by(desc(GoldMaterialTransaction.created_at)).all()
    
    return {
        "success": True,
        "receipts": [build_transaction_response(r, db) for r in receipts],
        "total": len(receipts)
    }


@router.put("/receipts/{receipt_id}")
async def update_gold_receipt(
    receipt_id: int,
    data: GoldReceiptUpdate,
    user_role: str = Query(default="settlement", description="用户角色"),
    db: Session = Depends(get_db)
):
    """修改收料单（仅结算专员，且状态为pending）"""
    # 权限检查
    if not has_permission(user_role, 'can_create_gold_receipt'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【创建收料单】的权限")
    
    transaction = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.id == receipt_id,
        GoldMaterialTransaction.transaction_type == 'income'
    ).first()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="收料单不存在")
    
    if transaction.status != "pending":
        raise HTTPException(status_code=400, detail="只能修改待确认状态的收料单")
    
    # 更新字段
    if data.gold_weight is not None:
        # 重新计算欠款和存料
        if transaction.settlement_order_id:
            settlement = db.query(SettlementOrder).filter(
                SettlementOrder.id == transaction.settlement_order_id
            ).first()
            if settlement:
                total_due = settlement.physical_gold_weight or 0.0
                # 计算其他收料单的已收金料（不包括当前这条）
                other_receipts = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.settlement_order_id == settlement.id,
                    GoldMaterialTransaction.transaction_type == 'income',
                    GoldMaterialTransaction.id != transaction.id,
                    GoldMaterialTransaction.status != 'cancelled'
                ).all()
                other_received = sum(r.gold_weight for r in other_receipts)
                
                # 计算新的总收金料
                new_total_received = other_received + data.gold_weight
                new_remaining_due = max(0.0, total_due - new_total_received)
                
                # 更新客户往来账记录
                customer_transaction = db.query(CustomerTransaction).filter(
                    CustomerTransaction.gold_transaction_id == transaction.id
                ).first()
                if customer_transaction:
                    customer_transaction.gold_weight = data.gold_weight
                    customer_transaction.gold_due_after = new_remaining_due
                    # 重新计算支付欠款和存料
                    if data.gold_weight <= (total_due - other_received):
                        payment_for_due = data.gold_weight
                        deposit_amount = 0.0
                    else:
                        payment_for_due = total_due - other_received
                        deposit_amount = data.gold_weight - payment_for_due
                    
                    customer_transaction.remark = (
                        f"收料单：{transaction.transaction_no}，结算单：{settlement.settlement_no}。"
                        f"支付欠款：{payment_for_due:.2f}克" +
                        (f"，存入存料：{deposit_amount:.2f}克" if deposit_amount > 0 else "")
                    )
        
        transaction.gold_weight = data.gold_weight
    
    if data.remark is not None:
        transaction.remark = data.remark
    
    db.commit()
    db.refresh(transaction)
    
    logger.info(f"修改收料单: {transaction.transaction_no}")
    
    return {
        "success": True,
        "message": "收料单已修改",
        "transaction": build_transaction_response(transaction, db)
    }


@router.post("/receipts/{receipt_id}/cancel")
async def cancel_gold_receipt(
    receipt_id: int,
    user_role: str = Query(default="settlement", description="用户角色"),
    db: Session = Depends(get_db)
):
    """取消收料单（仅结算专员，且状态为pending）"""
    # 权限检查
    if not has_permission(user_role, 'can_create_gold_receipt'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【创建收料单】的权限")
    
    transaction = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.id == receipt_id,
        GoldMaterialTransaction.transaction_type == 'income'
    ).first()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="收料单不存在")
    
    if transaction.status != "pending":
        raise HTTPException(status_code=400, detail="只能取消待确认状态的收料单")
    
    # 取消收料单
    transaction.status = "cancelled"
    
    # 同时取消关联的往来账记录
    customer_transaction = db.query(CustomerTransaction).filter(
        CustomerTransaction.gold_transaction_id == transaction.id
    ).first()
    if customer_transaction:
        customer_transaction.status = "cancelled"
    
    db.commit()
    db.refresh(transaction)
    
    logger.info(f"取消收料单: {transaction.transaction_no}")
    
    return {
        "success": True,
        "message": "收料单已取消",
        "transaction": build_transaction_response(transaction, db)
    }


# ==================== 料部确认收到原料 ====================

@router.post("/transactions/{transaction_id}/receive")
async def confirm_gold_receive(
    transaction_id: int,
    data: GoldMaterialTransactionConfirm,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    料部确认收到原料（从结算同事处）
    
    - 更新金料收入记录状态为confirmed
    - 如有超付存料，更新客户存料记录
    """
    # 权限检查
    if not has_permission(user_role, 'can_confirm_gold_receive'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【确认收到原料】的权限")
    
    transaction = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.id == transaction_id,
        GoldMaterialTransaction.transaction_type == 'income'
    ).first()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="收料单不存在")
    
    if transaction.status != "pending":
        raise HTTPException(status_code=400, detail=f"该记录状态为 {transaction.status}，无法确认")
    
    # 更新状态
    transaction.status = "confirmed"
    transaction.confirmed_by = data.confirmed_by
    transaction.confirmed_at = china_now()
    
    # 检查是否有超付存料需要处理
    if transaction.settlement_order_id and transaction.customer_id:
        settlement = db.query(SettlementOrder).filter(
            SettlementOrder.id == transaction.settlement_order_id
        ).first()
        
        if settlement:
            total_due = settlement.physical_gold_weight or 0.0
            # 重新计算已收金料（不包含当前这条，因为它之前是pending）
            other_receipts = db.query(GoldMaterialTransaction).filter(
                GoldMaterialTransaction.settlement_order_id == settlement.id,
                GoldMaterialTransaction.transaction_type == 'income',
                GoldMaterialTransaction.status == 'confirmed',
                GoldMaterialTransaction.id != transaction.id
            ).all()
            previously_received = sum(r.gold_weight for r in other_receipts)
            
            # 当前确认后的总收金料
            total_received = previously_received + transaction.gold_weight
            
            # 计算存料
            if total_received > total_due:
                deposit_amount = total_received - total_due
                
                # 更新客户存料
                deposit = get_or_create_customer_deposit(
                    transaction.customer_id, 
                    transaction.customer_name, 
                    db
                )
                balance_before = deposit.current_balance
                deposit.current_balance += deposit_amount
                deposit.total_deposited += deposit_amount
                deposit.last_transaction_at = china_now()
                
                # 创建存料交易记录
                deposit_transaction = CustomerGoldDepositTransaction(
                    customer_id=transaction.customer_id,
                    customer_name=transaction.customer_name,
                    transaction_type='deposit',
                    gold_transaction_id=transaction.id,
                    amount=deposit_amount,
                    balance_before=balance_before,
                    balance_after=deposit.current_balance,
                    created_by=data.confirmed_by,
                    remark=f"收料单：{transaction.transaction_no}，超付存入存料"
                )
                db.add(deposit_transaction)
                
                logger.info(f"客户存料更新: 客户={transaction.customer_name}, "
                           f"存入={deposit_amount}克, 新余额={deposit.current_balance}克")
    
    db.commit()
    db.refresh(transaction)
    
    logger.info(f"确认收料单: {transaction.transaction_no}, 确认人: {data.confirmed_by}")
    
    return {
        "success": True,
        "message": "收料单已确认",
        "transaction": build_transaction_response(transaction, db)
    }


# ==================== 付料单管理 ====================

@router.post("/payments", response_model=GoldMaterialTransactionResponse)
async def create_gold_payment(
    data: GoldPaymentCreate,
    user_role: str = Query(default="material", description="用户角色"),
    created_by: str = Query(default="料部", description="创建人"),
    db: Session = Depends(get_db)
):
    """
    创建付料单（料部支付供应商）
    
    - 验证供应商是否存在
    - 校验金料库存是否足够
    - 创建金料支出记录
    """
    # 权限检查
    if not has_permission(user_role, 'can_create_gold_payment'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【创建付料单】的权限")
    
    # 验证供应商
    supplier = db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    
    # 验证入库单（如果提供）
    inbound_order = None
    if data.inbound_order_id:
        inbound_order = db.query(InboundOrder).filter(
            InboundOrder.id == data.inbound_order_id
        ).first()
        if not inbound_order:
            raise HTTPException(status_code=404, detail="入库单不存在")
        
        # 检查该入库单是否已创建付料单
        existing = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.inbound_order_id == data.inbound_order_id,
            GoldMaterialTransaction.status != 'cancelled'
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"该入库单已创建付料单：{existing.transaction_no}")
    
    # 校验金料库存是否足够
    balance = get_gold_balance_internal(db)
    if data.gold_weight > balance["current_balance"]:
        raise HTTPException(
            status_code=400,
            detail=f"金料库存不足。当前余额：{balance['current_balance']:.2f}克，需要支付：{data.gold_weight:.2f}克"
        )
    
    # 生成付料单号（FL开头）
    now = china_now()
    count = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.transaction_no.like(f"FL{now.strftime('%Y%m%d')}%")
    ).count()
    payment_no = f"FL{now.strftime('%Y%m%d')}{count + 1:03d}"
    
    # 创建金料支出记录（付料单）
    transaction = GoldMaterialTransaction(
        transaction_no=payment_no,
        transaction_type='expense',
        inbound_order_id=data.inbound_order_id,
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        gold_weight=data.gold_weight,
        status="confirmed",  # 付料单直接确认（因为是实际支付）
        created_by=created_by,
        confirmed_by=created_by,
        confirmed_at=china_now(),
        remark=data.remark
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    
    logger.info(f"创建付料单: {payment_no}, 供应商: {supplier.name}, 金料重量: {data.gold_weight}克")
    
    return build_transaction_response(transaction, db)


@router.get("/payments")
async def get_gold_payments(
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取付料单列表"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看金料记录】的权限")
    
    query = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.transaction_type == 'expense'
    )
    
    if status:
        query = query.filter(GoldMaterialTransaction.status == status)
    if supplier_id:
        query = query.filter(GoldMaterialTransaction.supplier_id == supplier_id)
    
    payments = query.order_by(desc(GoldMaterialTransaction.created_at)).all()
    
    return {
        "success": True,
        "payments": [build_transaction_response(p, db) for p in payments],
        "total": len(payments)
    }


# ==================== 金料库存查询 ====================

@router.get("/balance", response_model=GoldMaterialBalanceResponse)
async def get_gold_balance(
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取金料库存余额"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看金料记录】的权限")
    
    balance = get_gold_balance_internal(db)
    
    return GoldMaterialBalanceResponse(
        total_income=balance["total_income"],
        total_expense=balance["total_expense"],
        current_balance=balance["current_balance"]
    )


# ==================== 客户存料管理 ====================

@router.get("/customers/{customer_id}/deposit")
async def get_customer_deposit(
    customer_id: int,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户存料信息"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material') and not has_permission(user_role, 'can_view_customers'):
        raise HTTPException(status_code=403, detail="权限不足")
    
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    
    # 获取或创建存料记录
    deposit = get_or_create_customer_deposit(customer_id, customer.name, db)
    db.commit()
    
    # 获取最近的存料交易记录
    recent_transactions = db.query(CustomerGoldDepositTransaction).filter(
        CustomerGoldDepositTransaction.customer_id == customer_id,
        CustomerGoldDepositTransaction.status == "active"
    ).order_by(desc(CustomerGoldDepositTransaction.created_at)).limit(20).all()
    
    return {
        "success": True,
        "customer": {
            "id": customer.id,
            "name": customer.name,
        },
        "deposit": {
            "current_balance": deposit.current_balance,
            "total_deposited": deposit.total_deposited,
            "total_used": deposit.total_used,
            "last_transaction_at": deposit.last_transaction_at,
        },
        "recent_transactions": [
            {
                "id": t.id,
                "transaction_type": t.transaction_type,
                "amount": t.amount,
                "balance_before": t.balance_before,
                "balance_after": t.balance_after,
                "created_at": t.created_at,
                "created_by": t.created_by,
                "remark": t.remark
            }
            for t in recent_transactions
        ]
    }


# ==================== 客户往来账查询 ====================

@router.get("/customers/{customer_id}/transactions")
async def get_customer_transactions(
    customer_id: int,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户往来账记录"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material') and not has_permission(user_role, 'can_view_customers'):
        raise HTTPException(status_code=403, detail="权限不足")
    
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    
    # 获取所有往来账记录
    transactions = db.query(CustomerTransaction).filter(
        CustomerTransaction.customer_id == customer_id,
        CustomerTransaction.status == "active"
    ).order_by(desc(CustomerTransaction.created_at)).all()
    
    # 计算当前欠款
    # 方法：从结算单计算
    settlements = db.query(SettlementOrder).join(SalesOrder).filter(
        SalesOrder.customer_id == customer_id,
        SettlementOrder.payment_method == 'physical_gold',
        SettlementOrder.status.in_(['pending', 'confirmed', 'printed'])
    ).all()
    
    total_due = 0.0  # 应支付总重量
    total_received = 0.0  # 已收总重量
    
    for settlement in settlements:
        total_due += settlement.physical_gold_weight or 0.0
        # 查询该结算单的所有已确认收料单
        receipts = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.settlement_order_id == settlement.id,
            GoldMaterialTransaction.transaction_type == 'income',
            GoldMaterialTransaction.status == 'confirmed'
        ).all()
        total_received += sum(r.gold_weight for r in receipts)
    
    current_due = max(0.0, total_due - total_received)  # 当前欠款（不能为负）
    
    # 获取存料信息
    deposit = db.query(CustomerGoldDeposit).filter(
        CustomerGoldDeposit.customer_id == customer_id
    ).first()
    
    current_deposit = deposit.current_balance if deposit else 0.0
    total_deposited = deposit.total_deposited if deposit else 0.0
    total_used = deposit.total_used if deposit else 0.0
    
    # 构建交易记录响应
    transaction_list = []
    for t in transactions:
        # 获取关联单据号
        related_order_no = None
        if t.sales_order_id:
            sales = db.query(SalesOrder).filter(SalesOrder.id == t.sales_order_id).first()
            if sales:
                related_order_no = sales.order_no
        elif t.settlement_order_id:
            settlement = db.query(SettlementOrder).filter(SettlementOrder.id == t.settlement_order_id).first()
            if settlement:
                related_order_no = settlement.settlement_no
        elif t.gold_transaction_id:
            gold_trans = db.query(GoldMaterialTransaction).filter(
                GoldMaterialTransaction.id == t.gold_transaction_id
            ).first()
            if gold_trans:
                related_order_no = gold_trans.transaction_no
        
        transaction_list.append({
            "id": t.id,
            "customer_id": t.customer_id,
            "customer_name": t.customer_name,
            "transaction_type": t.transaction_type,
            "sales_order_id": t.sales_order_id,
            "settlement_order_id": t.settlement_order_id,
            "gold_transaction_id": t.gold_transaction_id,
            "related_order_no": related_order_no,
            "amount": t.amount,
            "gold_weight": t.gold_weight,
            "gold_due_before": t.gold_due_before,
            "gold_due_after": t.gold_due_after,
            "status": t.status,
            "created_at": t.created_at,
            "remark": t.remark
        })
    
    return {
        "success": True,
        "customer": {
            "id": customer.id,
            "name": customer.name,
        },
        "summary": {
            "current_gold_due": current_due,
            "total_gold_due": total_due,
            "total_gold_received": total_received,
            "current_deposit": current_deposit,
            "total_deposited": total_deposited,
            "total_used": total_used,
        },
        "transactions": transaction_list
    }


# ==================== 取消金料流转记录 ====================

@router.post("/transactions/{transaction_id}/cancel")
async def cancel_transaction(
    transaction_id: int,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """取消金料流转记录（仅待确认状态可取消）"""
    # 权限检查
    if not has_permission(user_role, 'can_manage_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【管理金料流转】的权限")
    
    transaction = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.id == transaction_id
    ).first()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if transaction.status != "pending":
        raise HTTPException(status_code=400, detail="只能取消待确认的记录")
    
    transaction.status = "cancelled"
    
    # 同时取消关联的往来账记录
    if transaction.transaction_type == 'income':
        customer_transaction = db.query(CustomerTransaction).filter(
            CustomerTransaction.gold_transaction_id == transaction.id
        ).first()
        if customer_transaction:
            customer_transaction.status = "cancelled"
    
    db.commit()
    
    logger.info(f"取消金料流转记录: {transaction.transaction_no}")
    
    return {
        "success": True,
        "message": "已取消",
        "transaction": build_transaction_response(transaction, db)
    }


@router.post("/transactions/{transaction_id}/revoke")
async def revoke_gold_confirm(
    transaction_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    撤销料部确认（仅管理层）
    
    - 将confirmed状态回退到pending
    - 回滚客户存料更新（如果有）
    """
    # 权限检查（仅管理层）
    if not has_permission(user_role, 'can_manage_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：只有管理层可以撤销确认")
    
    transaction = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.id == transaction_id,
        GoldMaterialTransaction.transaction_type == 'income'
    ).first()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="收料单不存在")
    
    if transaction.status != "confirmed":
        raise HTTPException(status_code=400, detail="只能撤销已确认的记录")
    
    # 回滚存料更新（如果有）
    if transaction.settlement_order_id and transaction.customer_id:
        settlement = db.query(SettlementOrder).filter(
            SettlementOrder.id == transaction.settlement_order_id
        ).first()
        
        if settlement:
            total_due = settlement.physical_gold_weight or 0.0
            # 计算其他已确认收料单的已收金料（不包括当前这条）
            other_receipts = db.query(GoldMaterialTransaction).filter(
                GoldMaterialTransaction.settlement_order_id == settlement.id,
                GoldMaterialTransaction.transaction_type == 'income',
                GoldMaterialTransaction.status == 'confirmed',
                GoldMaterialTransaction.id != transaction.id
            ).all()
            other_received = sum(r.gold_weight for r in other_receipts)
            
            # 当前撤销后的总收金料
            total_received_after_revoke = other_received
            
            # 计算需要回滚的存料
            if total_received_after_revoke < total_due:
                # 撤销后总收金料 < 应支付，说明之前有存料，需要回滚
                # 计算之前确认时的存料
                total_received_before_revoke = other_received + transaction.gold_weight
                if total_received_before_revoke > total_due:
                    deposit_to_revoke = total_received_before_revoke - total_due
                    
                    # 回滚客户存料
                    deposit = db.query(CustomerGoldDeposit).filter(
                        CustomerGoldDeposit.customer_id == transaction.customer_id
                    ).first()
                    
                    if deposit and deposit.current_balance >= deposit_to_revoke:
                        deposit.current_balance -= deposit_to_revoke
                        deposit.total_deposited -= deposit_to_revoke
                        
                        # 取消存料交易记录
                        deposit_transaction = db.query(CustomerGoldDepositTransaction).filter(
                            CustomerGoldDepositTransaction.gold_transaction_id == transaction.id,
                            CustomerGoldDepositTransaction.transaction_type == 'deposit',
                            CustomerGoldDepositTransaction.status == 'active'
                        ).first()
                        if deposit_transaction:
                            deposit_transaction.status = "cancelled"
                        
                        logger.info(f"回滚客户存料: 客户={transaction.customer_name}, "
                                   f"回滚={deposit_to_revoke}克, 新余额={deposit.current_balance}克")
    
    # 回退状态
    transaction.status = "pending"
    transaction.confirmed_by = None
    transaction.confirmed_at = None
    
    db.commit()
    db.refresh(transaction)
    
    logger.info(f"撤销确认收料单: {transaction.transaction_no}, 操作人: {user_role}")
    
    return {
        "success": True,
        "message": "已撤销确认",
        "transaction": build_transaction_response(transaction, db)
    }


# ==================== 获取所有金料流转记录 ====================

@router.get("/transactions")
async def get_all_transactions(
    transaction_type: Optional[str] = None,
    status: Optional[str] = None,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取所有金料流转记录"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看金料记录】的权限")
    
    query = db.query(GoldMaterialTransaction)
    
    if transaction_type:
        query = query.filter(GoldMaterialTransaction.transaction_type == transaction_type)
    if status:
        query = query.filter(GoldMaterialTransaction.status == status)
    
    transactions = query.order_by(desc(GoldMaterialTransaction.created_at)).all()
    
    return {
        "success": True,
        "transactions": [build_transaction_response(t, db) for t in transactions],
        "total": len(transactions)
    }


# ==================== 收料单打印和下载 ====================

@router.options("/receipts/{receipt_id}/download")
async def download_receipt_options(receipt_id: int):
    """处理CORS预检请求"""
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/receipts/{receipt_id}/download")
async def download_receipt(
    receipt_id: int,
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印收料单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载收料单请求: receipt_id={receipt_id}, format={format}")
        
        # 查询收料单
        transaction = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.id == receipt_id,
            GoldMaterialTransaction.transaction_type == 'income'
        ).first()
        if not transaction:
            raise HTTPException(status_code=404, detail="收料单不存在")
        
        # 获取关联信息
        settlement = None
        customer = None
        if transaction.settlement_order_id:
            settlement = db.query(SettlementOrder).filter(
                SettlementOrder.id == transaction.settlement_order_id
            ).first()
        if transaction.customer_id:
            customer = db.query(Customer).filter(
                Customer.id == transaction.customer_id
            ).first()
        
        if format == "pdf":
            try:
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                import io
                from ..timezone_utils import to_china_time, format_china_time
                
                # 生成PDF
                buffer = io.BytesIO()
                p = canvas.Canvas(buffer, pagesize=A4)
                width, height = A4
                
                # 使用 CID 字体
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    chinese_font = 'STSong-Light'
                except Exception as cid_error:
                    logger.warning(f"注册CID字体失败: {cid_error}")
                    chinese_font = None
                
                # 标题
                if chinese_font:
                    p.setFont(chinese_font, 18)
                else:
                    p.setFont("Helvetica-Bold", 18)
                p.drawString(50, height - 50, "收料单")
                
                # 收料单信息
                font_size = 12
                y = height - 100
                if chinese_font:
                    p.setFont(chinese_font, font_size)
                else:
                    p.setFont("Helvetica", font_size)
                
                # 收料单号
                p.drawString(50, y, f"收料单号：{transaction.transaction_no}")
                y -= 25
                
                # 结算单号
                if settlement:
                    p.drawString(50, y, f"结算单号：{settlement.settlement_no}")
                    y -= 25
                
                # 客户名称
                if transaction.customer_name:
                    p.drawString(50, y, f"客户名称：{transaction.customer_name}")
                    y -= 25
                
                # 金料重量
                p.drawString(50, y, f"金料重量：{transaction.gold_weight:.2f} 克")
                y -= 25
                
                # 状态
                status_map = {
                    "pending": "待确认",
                    "confirmed": "已确认",
                    "cancelled": "已取消"
                }
                status_str = status_map.get(transaction.status, transaction.status)
                p.drawString(50, y, f"状态：{status_str}")
                y -= 25
                
                # 创建时间
                if transaction.created_at:
                    china_time = to_china_time(transaction.created_at)
                    create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
                else:
                    create_time_str = "未知"
                p.drawString(50, y, f"创建时间：{create_time_str}")
                y -= 25
                
                # 创建人
                if transaction.created_by:
                    p.drawString(50, y, f"创建人：{transaction.created_by}")
                    y -= 25
                
                # 确认信息
                if transaction.confirmed_by:
                    p.drawString(50, y, f"确认人：{transaction.confirmed_by}")
                    y -= 25
                if transaction.confirmed_at:
                    china_time = to_china_time(transaction.confirmed_at)
                    confirm_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
                    p.drawString(50, y, f"确认时间：{confirm_time_str}")
                    y -= 25
                
                # 备注
                if transaction.remark:
                    p.drawString(50, y, f"备注：{transaction.remark}")
                    y -= 25
                
                # 打印时间
                print_time = format_china_time(china_now(), '%Y-%m-%d %H:%M:%S')
                p.drawString(50, 50, f"打印时间：{print_time}")
                
                p.save()
                buffer.seek(0)
                
                filename = f"receipt_{transaction.transaction_no}.pdf"
                
                from fastapi.responses import StreamingResponse
                return StreamingResponse(
                    buffer,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{filename}"',
                        "Access-Control-Allow-Origin": "*",
                    }
                )
            except Exception as pdf_error:
                logger.error(f"生成PDF失败: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
        
        elif format == "html":
            # 生成HTML（用于打印）
            from fastapi.responses import HTMLResponse
            from ..timezone_utils import to_china_time, format_china_time
            
            # 格式化时间
            if transaction.created_at:
                china_time = to_china_time(transaction.created_at)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            else:
                create_time_str = "未知"
            
            confirm_time_str = None
            if transaction.confirmed_at:
                china_time = to_china_time(transaction.confirmed_at)
                confirm_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            
            status_map = {
                "pending": "待确认",
                "confirmed": "已确认",
                "cancelled": "已取消"
            }
            status_str = status_map.get(transaction.status, transaction.status)
            
            html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>收料单 - {transaction.transaction_no}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Microsoft YaHei', Arial, sans-serif; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 800px; margin: 0 auto; background: white; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        .header {{ text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }}
        .header h1 {{ font-size: 28px; color: #333; margin-bottom: 10px; }}
        .info-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }}
        .info-item {{ margin-bottom: 15px; }}
        .info-label {{ font-weight: bold; color: #666; margin-bottom: 5px; font-size: 14px; }}
        .info-value {{ color: #333; font-size: 16px; }}
        .full-width {{ grid-column: 1 / -1; }}
        .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #999; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>收料单</h1>
        </div>
        
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">收料单号</div>
                <div class="info-value">{transaction.transaction_no}</div>
            </div>
            {f'<div class="info-item"><div class="info-label">结算单号</div><div class="info-value">{settlement.settlement_no}</div></div>' if settlement else ''}
            {f'<div class="info-item"><div class="info-label">客户名称</div><div class="info-value">{transaction.customer_name or "-"}</div></div>' if transaction.customer_name else ''}
            <div class="info-item">
                <div class="info-label">金料重量</div>
                <div class="info-value">{transaction.gold_weight:.2f} 克</div>
            </div>
            <div class="info-item">
                <div class="info-label">状态</div>
                <div class="info-value">{status_str}</div>
            </div>
            <div class="info-item">
                <div class="info-label">创建时间</div>
                <div class="info-value">{create_time_str}</div>
            </div>
            {f'<div class="info-item"><div class="info-label">创建人</div><div class="info-value">{transaction.created_by or "-"}</div></div>' if transaction.created_by else ''}
            {f'<div class="info-item"><div class="info-label">确认人</div><div class="info-value">{transaction.confirmed_by or "-"}</div></div>' if transaction.confirmed_by else ''}
            {f'<div class="info-item"><div class="info-label">确认时间</div><div class="info-value">{confirm_time_str or "-"}</div></div>' if confirm_time_str else ''}
            {f'<div class="info-item full-width"><div class="info-label">备注</div><div class="info-value">{transaction.remark or "-"}</div></div>' if transaction.remark else ''}
        </div>
        
        <div class="footer">
            <p>打印时间：{format_china_time(china_now(), '%Y-%m-%d %H:%M:%S')}</p>
        </div>
    </div>
</body>
</html>
"""
            
            return HTMLResponse(
                content=html_content,
                headers={
                    "Access-Control-Allow-Origin": "*",
                }
            )
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式，请使用 pdf 或 html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成收料单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成收料单失败: {str(e)}")


# ==================== 付料单打印和下载 ====================

@router.options("/payments/{payment_id}/download")
async def download_payment_options(payment_id: int):
    """处理CORS预检请求"""
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/payments/{payment_id}/download")
async def download_payment(
    payment_id: int,
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印付料单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载付料单请求: payment_id={payment_id}, format={format}")
        
        # 查询付料单
        transaction = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.id == payment_id,
            GoldMaterialTransaction.transaction_type == 'expense'
        ).first()
        if not transaction:
            raise HTTPException(status_code=404, detail="付料单不存在")
        
        # 获取关联信息
        supplier = None
        inbound = None
        if transaction.supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == transaction.supplier_id).first()
        if transaction.inbound_order_id:
            inbound = db.query(InboundOrder).filter(InboundOrder.id == transaction.inbound_order_id).first()
        
        if format == "pdf":
            try:
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                import io
                from ..timezone_utils import to_china_time, format_china_time
                
                # 生成PDF
                buffer = io.BytesIO()
                p = canvas.Canvas(buffer, pagesize=A4)
                width, height = A4
                
                # 使用 CID 字体
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    chinese_font = 'STSong-Light'
                except Exception as cid_error:
                    logger.warning(f"注册CID字体失败: {cid_error}")
                    chinese_font = None
                
                # 标题
                if chinese_font:
                    p.setFont(chinese_font, 18)
                else:
                    p.setFont("Helvetica-Bold", 18)
                p.drawString(50, height - 50, "付料单")
                
                # 付料单信息
                font_size = 12
                y = height - 100
                if chinese_font:
                    p.setFont(chinese_font, font_size)
                else:
                    p.setFont("Helvetica", font_size)
                
                # 付料单号
                p.drawString(50, y, f"付料单号：{transaction.transaction_no}")
                y -= 25
                
                # 供应商
                if transaction.supplier_name:
                    p.drawString(50, y, f"供应商：{transaction.supplier_name}")
                    y -= 25
                
                # 入库单号
                if inbound:
                    p.drawString(50, y, f"入库单号：{inbound.order_no}")
                    y -= 25
                
                # 金料重量
                p.drawString(50, y, f"金料重量：{transaction.gold_weight:.2f} 克")
                y -= 25
                
                # 状态
                status_map = {
                    "pending": "待确认",
                    "confirmed": "已确认",
                    "cancelled": "已取消"
                }
                status_str = status_map.get(transaction.status, transaction.status)
                p.drawString(50, y, f"状态：{status_str}")
                y -= 25
                
                # 创建时间
                if transaction.created_at:
                    china_time = to_china_time(transaction.created_at)
                    create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
                else:
                    create_time_str = "未知"
                p.drawString(50, y, f"创建时间：{create_time_str}")
                y -= 25
                
                # 创建人
                if transaction.created_by:
                    p.drawString(50, y, f"创建人：{transaction.created_by}")
                    y -= 25
                
                # 确认信息
                if transaction.confirmed_by:
                    p.drawString(50, y, f"确认人：{transaction.confirmed_by}")
                    y -= 25
                if transaction.confirmed_at:
                    china_time = to_china_time(transaction.confirmed_at)
                    confirm_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
                    p.drawString(50, y, f"确认时间：{confirm_time_str}")
                    y -= 25
                
                # 备注
                if transaction.remark:
                    p.drawString(50, y, f"备注：{transaction.remark}")
                    y -= 25
                
                # 打印时间
                print_time = format_china_time(china_now(), '%Y-%m-%d %H:%M:%S')
                p.drawString(50, 50, f"打印时间：{print_time}")
                
                p.save()
                buffer.seek(0)
                
                filename = f"payment_{transaction.transaction_no}.pdf"
                
                from fastapi.responses import StreamingResponse
                return StreamingResponse(
                    buffer,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{filename}"',
                        "Access-Control-Allow-Origin": "*",
                    }
                )
            except Exception as pdf_error:
                logger.error(f"生成PDF失败: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
        
        elif format == "html":
            # 生成HTML（用于打印）
            from fastapi.responses import HTMLResponse
            from ..timezone_utils import to_china_time, format_china_time
            
            # 格式化时间
            if transaction.created_at:
                china_time = to_china_time(transaction.created_at)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            else:
                create_time_str = "未知"
            
            confirm_time_str = None
            if transaction.confirmed_at:
                china_time = to_china_time(transaction.confirmed_at)
                confirm_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            
            status_map = {
                "pending": "待确认",
                "confirmed": "已确认",
                "cancelled": "已取消"
            }
            status_str = status_map.get(transaction.status, transaction.status)
            
            html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>付料单 - {transaction.transaction_no}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Microsoft YaHei', Arial, sans-serif; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 800px; margin: 0 auto; background: white; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        .header {{ text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }}
        .header h1 {{ font-size: 28px; color: #333; margin-bottom: 10px; }}
        .info-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }}
        .info-item {{ margin-bottom: 15px; }}
        .info-label {{ font-weight: bold; color: #666; margin-bottom: 5px; font-size: 14px; }}
        .info-value {{ color: #333; font-size: 16px; }}
        .full-width {{ grid-column: 1 / -1; }}
        .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #999; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>付料单</h1>
        </div>
        
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">付料单号</div>
                <div class="info-value">{transaction.transaction_no}</div>
            </div>
            {f'<div class="info-item"><div class="info-label">供应商</div><div class="info-value">{transaction.supplier_name or "-"}</div></div>' if transaction.supplier_name else ''}
            {f'<div class="info-item"><div class="info-label">入库单号</div><div class="info-value">{inbound.order_no}</div></div>' if inbound else ''}
            <div class="info-item">
                <div class="info-label">金料重量</div>
                <div class="info-value">{transaction.gold_weight:.2f} 克</div>
            </div>
            <div class="info-item">
                <div class="info-label">状态</div>
                <div class="info-value">{status_str}</div>
            </div>
            <div class="info-item">
                <div class="info-label">创建时间</div>
                <div class="info-value">{create_time_str}</div>
            </div>
            {f'<div class="info-item"><div class="info-label">创建人</div><div class="info-value">{transaction.created_by or "-"}</div></div>' if transaction.created_by else ''}
            {f'<div class="info-item"><div class="info-label">确认人</div><div class="info-value">{transaction.confirmed_by or "-"}</div></div>' if transaction.confirmed_by else ''}
            {f'<div class="info-item"><div class="info-label">确认时间</div><div class="info-value">{confirm_time_str or "-"}</div></div>' if confirm_time_str else ''}
            {f'<div class="info-item full-width"><div class="info-label">备注</div><div class="info-value">{transaction.remark or "-"}</div></div>' if transaction.remark else ''}
        </div>
        
        <div class="footer">
            <p>打印时间：{format_china_time(china_now(), '%Y-%m-%d %H:%M:%S')}</p>
        </div>
    </div>
</body>
</html>
"""
            
            return HTMLResponse(
                content=html_content,
                headers={
                    "Access-Control-Allow-Origin": "*",
                }
            )
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式，请使用 pdf 或 html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成付料单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成付料单失败: {str(e)}")


# ==================== 每日金料进出台账 ====================

@router.get("/ledger")
async def get_gold_ledger(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取每日金料进出台账（按日期分组）
    
    - 按日期分组展示每日的收入、支出、净额
    - 支持日期范围筛选
    """
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看金料记录】的权限")
    
    # 解析日期
    try:
        if start_date:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d').date()
        else:
            start_dt = date.today() - timedelta(days=30)  # 默认最近30天
        
        if end_date:
            end_dt = datetime.strptime(end_date, '%Y-%m-%d').date()
        else:
            end_dt = date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式错误，请使用 YYYY-MM-DD 格式")
    
    # 查询所有已确认的金料流转记录
    transactions = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.status == 'confirmed',
        func.date(GoldMaterialTransaction.confirmed_at) >= start_dt,
        func.date(GoldMaterialTransaction.confirmed_at) <= end_dt
    ).order_by(GoldMaterialTransaction.confirmed_at).all()
    
    # 按日期分组
    from collections import defaultdict
    ledger_by_date: Dict[str, Dict] = defaultdict(lambda: {
        "date": None,
        "income": 0.0,  # 收入
        "expense": 0.0,  # 支出
        "net": 0.0,  # 净额
        "transactions": []
    })
    
    for t in transactions:
        if not t.confirmed_at:
            continue
        
        date_str = t.confirmed_at.date().strftime('%Y-%m-%d')
        ledger_by_date[date_str]["date"] = date_str
        
        if t.transaction_type == 'income':
            ledger_by_date[date_str]["income"] += t.gold_weight
        elif t.transaction_type == 'expense':
            ledger_by_date[date_str]["expense"] += t.gold_weight
        
        ledger_by_date[date_str]["net"] = (
            ledger_by_date[date_str]["income"] - ledger_by_date[date_str]["expense"]
        )
        
        ledger_by_date[date_str]["transactions"].append({
            "id": t.id,
            "transaction_no": t.transaction_no,
            "transaction_type": t.transaction_type,
            "gold_weight": t.gold_weight,
            "customer_name": t.customer_name,
            "supplier_name": t.supplier_name,
            "confirmed_at": t.confirmed_at.isoformat() if t.confirmed_at else None
        })
    
    # 转换为列表并排序
    ledger_list = sorted(
        ledger_by_date.values(),
        key=lambda x: x["date"],
        reverse=True
    )
    
    # 计算总计
    total_income = sum(day["income"] for day in ledger_list)
    total_expense = sum(day["expense"] for day in ledger_list)
    total_net = total_income - total_expense
    
    return {
        "success": True,
        "start_date": start_date or start_dt.strftime('%Y-%m-%d'),
        "end_date": end_date or end_dt.strftime('%Y-%m-%d'),
        "ledger": ledger_list,
        "summary": {
            "total_income": total_income,
            "total_expense": total_expense,
            "total_net": total_net,
            "days_count": len(ledger_list)
        }
    }


@router.get("/ledger/export")
async def export_gold_ledger(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = Query("excel", pattern="^(excel|pdf)$"),
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """导出每日金料进出台账（Excel或PDF）"""
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看金料记录】的权限")
    
    # 获取台账数据
    ledger_data = await get_gold_ledger(start_date, end_date, user_role, db)
    
    if format == "excel":
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, Alignment, PatternFill
            import io
            
            wb = Workbook()
            ws = wb.active
            ws.title = "金料进出台账"
            
            # 标题
            ws.merge_cells('A1:F1')
            ws['A1'] = f"金料进出台账 ({ledger_data['start_date']} 至 {ledger_data['end_date']})"
            ws['A1'].font = Font(size=16, bold=True)
            ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
            
            # 表头
            headers = ['日期', '收入（克）', '支出（克）', '净额（克）', '收入笔数', '支出笔数']
            for col, header in enumerate(headers, start=1):
                cell = ws.cell(row=2, column=col)
                cell.value = header
                cell.font = Font(bold=True)
                cell.fill = PatternFill(start_color='CCCCCC', end_color='CCCCCC', fill_type='solid')
                cell.alignment = Alignment(horizontal='center', vertical='center')
            
            # 数据
            row = 3
            for day in ledger_data['ledger']:
                income_count = sum(1 for t in day['transactions'] if t['transaction_type'] == 'income')
                expense_count = sum(1 for t in day['transactions'] if t['transaction_type'] == 'expense')
                
                ws.cell(row=row, column=1).value = day['date']
                ws.cell(row=row, column=2).value = day['income']
                ws.cell(row=row, column=3).value = day['expense']
                ws.cell(row=row, column=4).value = day['net']
                ws.cell(row=row, column=5).value = income_count
                ws.cell(row=row, column=6).value = expense_count
                
                # 设置数字格式
                for col in [2, 3, 4]:
                    ws.cell(row=row, column=col).number_format = '0.00'
                
                row += 1
            
            # 总计行
            ws.cell(row=row, column=1).value = "总计"
            ws.cell(row=row, column=1).font = Font(bold=True)
            ws.cell(row=row, column=2).value = ledger_data['summary']['total_income']
            ws.cell(row=row, column=2).font = Font(bold=True)
            ws.cell(row=row, column=2).number_format = '0.00'
            ws.cell(row=row, column=3).value = ledger_data['summary']['total_expense']
            ws.cell(row=row, column=3).font = Font(bold=True)
            ws.cell(row=row, column=3).number_format = '0.00'
            ws.cell(row=row, column=4).value = ledger_data['summary']['total_net']
            ws.cell(row=row, column=4).font = Font(bold=True)
            ws.cell(row=row, column=4).number_format = '0.00'
            
            # 调整列宽
            ws.column_dimensions['A'].width = 15
            for col in ['B', 'C', 'D', 'E', 'F']:
                ws.column_dimensions[col].width = 15
            
            # 保存到内存
            buffer = io.BytesIO()
            wb.save(buffer)
            buffer.seek(0)
            
            filename = f"gold_ledger_{ledger_data['start_date']}_{ledger_data['end_date']}.xlsx"
            
            from fastapi.responses import StreamingResponse
            return StreamingResponse(
                buffer,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Access-Control-Allow-Origin": "*",
                }
            )
        except Exception as e:
            logger.error(f"生成Excel失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"生成Excel失败: {str(e)}")
    
    elif format == "pdf":
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.pdfgen import canvas
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            import io
            from ..timezone_utils import format_china_time
            
            buffer = io.BytesIO()
            p = canvas.Canvas(buffer, pagesize=A4)
            width, height = A4
            
            # 使用 CID 字体
            try:
                pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                chinese_font = 'STSong-Light'
            except Exception:
                chinese_font = None
            
            # 标题
            if chinese_font:
                p.setFont(chinese_font, 16)
            else:
                p.setFont("Helvetica-Bold", 16)
            title = f"金料进出台账 ({ledger_data['start_date']} 至 {ledger_data['end_date']})"
            p.drawString(50, height - 50, title)
            
            # 表头
            y = height - 100
            if chinese_font:
                p.setFont(chinese_font, 12)
            else:
                p.setFont("Helvetica-Bold", 12)
            
            p.drawString(50, y, "日期")
            p.drawString(150, y, "收入（克）")
            p.drawString(250, y, "支出（克）")
            p.drawString(350, y, "净额（克）")
            
            # 数据
            y -= 25
            if chinese_font:
                p.setFont(chinese_font, 10)
            else:
                p.setFont("Helvetica", 10)
            
            for day in ledger_data['ledger']:
                if y < 100:  # 换页
                    p.showPage()
                    y = height - 50
                
                p.drawString(50, y, day['date'])
                p.drawString(150, y, f"{day['income']:.2f}")
                p.drawString(250, y, f"{day['expense']:.2f}")
                p.drawString(350, y, f"{day['net']:.2f}")
                y -= 20
            
            # 总计
            y -= 10
            if chinese_font:
                p.setFont(chinese_font, 12)
            else:
                p.setFont("Helvetica-Bold", 12)
            p.drawString(50, y, "总计")
            p.drawString(150, y, f"{ledger_data['summary']['total_income']:.2f}")
            p.drawString(250, y, f"{ledger_data['summary']['total_expense']:.2f}")
            p.drawString(350, y, f"{ledger_data['summary']['total_net']:.2f}")
            
            # 打印时间
            print_time = format_china_time(china_now(), '%Y-%m-%d %H:%M:%S')
            p.drawString(50, 50, f"打印时间：{print_time}")
            
            p.save()
            buffer.seek(0)
            
            filename = f"gold_ledger_{ledger_data['start_date']}_{ledger_data['end_date']}.pdf"
            
            from fastapi.responses import StreamingResponse
            return StreamingResponse(
                buffer,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Access-Control-Allow-Origin": "*",
                }
            )
        except Exception as e:
            logger.error(f"生成PDF失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(e)}")
    
    else:
        raise HTTPException(status_code=400, detail="不支持的格式，请使用 excel 或 pdf")

