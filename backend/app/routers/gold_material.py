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
from sqlalchemy import desc, func
from datetime import datetime
from typing import Optional, List
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

