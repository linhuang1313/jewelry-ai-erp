"""
结算单管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
import logging

from ..database import get_db
from ..timezone_utils import china_now
from ..models import (
    SettlementOrder, 
    SalesOrder, 
    SalesDetail,
    GoldMaterialTransaction,
    CustomerGoldDeposit,
    CustomerGoldDepositTransaction,
    CustomerTransaction,
)
from ..schemas import (
    SettlementOrderCreate,
    SettlementOrderConfirm,
    SettlementOrderResponse,
    SalesOrderResponse,
    SalesDetailResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settlement", tags=["结算管理"])


# ============= 获取待结算销售单 =============

@router.get("/pending-sales", response_model=List[SalesOrderResponse])
async def get_pending_sales_orders(
    db: Session = Depends(get_db)
):
    """获取待结算的销售单列表"""
    # 查找状态为"待结算"且没有结算单的销售单
    orders = db.query(SalesOrder).filter(
        SalesOrder.status == "待结算"
    ).order_by(SalesOrder.create_time.desc()).all()
    
    result = []
    for order in orders:
        # 检查是否已有结算单
        existing_settlement = db.query(SettlementOrder).filter(
            SettlementOrder.sales_order_id == order.id
        ).first()
        
        if not existing_settlement:
            # 加载明细
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            order_dict = {
                "id": order.id,
                "order_no": order.order_no,
                "order_date": order.order_date,
                "customer_name": order.customer_name,
                "salesperson": order.salesperson,
                "store_code": order.store_code,
                "total_labor_cost": order.total_labor_cost,
                "total_weight": order.total_weight,
                "remark": order.remark,
                "status": order.status,
                "create_time": order.create_time,
                "operator": order.operator,
                "details": [
                    SalesDetailResponse(
                        id=d.id,
                        product_name=d.product_name,
                        weight=d.weight,
                        labor_cost=d.labor_cost,
                        total_labor_cost=d.total_labor_cost
                    ) for d in details
                ]
            }
            result.append(SalesOrderResponse(**order_dict))
    
    return result


# ============= 结算单 CRUD =============

@router.get("/orders", response_model=List[SettlementOrderResponse])
async def get_settlement_orders(
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取结算单列表"""
    query = db.query(SettlementOrder)
    
    if status:
        query = query.filter(SettlementOrder.status == status)
    
    orders = query.order_by(SettlementOrder.created_at.desc()).all()
    
    result = []
    for order in orders:
        # 加载关联的销售单
        sales_order = db.query(SalesOrder).filter(SalesOrder.id == order.sales_order_id).first()
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order.sales_order_id).all() if sales_order else []
        
        sales_order_response = None
        if sales_order:
            sales_order_response = SalesOrderResponse(
                id=sales_order.id,
                order_no=sales_order.order_no,
                order_date=sales_order.order_date,
                customer_name=sales_order.customer_name,
                salesperson=sales_order.salesperson,
                store_code=sales_order.store_code,
                total_labor_cost=sales_order.total_labor_cost,
                total_weight=sales_order.total_weight,
                remark=sales_order.remark,
                status=sales_order.status,
                create_time=sales_order.create_time,
                operator=sales_order.operator,
                details=[
                    SalesDetailResponse(
                        id=d.id,
                        product_name=d.product_name,
                        weight=d.weight,
                        labor_cost=d.labor_cost,
                        total_labor_cost=d.total_labor_cost
                    ) for d in details
                ]
            )
        
        result.append(SettlementOrderResponse(
            id=order.id,
            settlement_no=order.settlement_no,
            sales_order_id=order.sales_order_id,
            payment_method=order.payment_method,
            gold_price=order.gold_price,
            physical_gold_weight=order.physical_gold_weight,
            total_weight=order.total_weight,
            material_amount=order.material_amount,
            labor_amount=order.labor_amount,
            total_amount=order.total_amount,
            status=order.status,
            created_by=order.created_by,
            confirmed_by=order.confirmed_by,
            confirmed_at=order.confirmed_at,
            printed_at=order.printed_at,
            remark=order.remark,
            created_at=order.created_at,
            sales_order=sales_order_response
        ))
    
    return result


@router.post("/orders", response_model=SettlementOrderResponse)
async def create_settlement_order(
    data: SettlementOrderCreate,
    created_by: str = "结算专员",
    user_role: str = Query(default="settlement", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    创建结算单（结算专员创建）
    
    支持两种支付方式：
    1. cash_price（结价）：将原料按金价换算成金额支付
    2. physical_gold（结料）：直接支付原料金料
       - 支持 use_deposit 参数：使用客户的存料抵扣
    """
    # 权限检查
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_create_settlement'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【创建结算单】的权限")
    
    # 查找销售单
    sales_order = db.query(SalesOrder).filter(SalesOrder.id == data.sales_order_id).first()
    if not sales_order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    
    # 检查是否已有结算单
    existing = db.query(SettlementOrder).filter(
        SettlementOrder.sales_order_id == data.sales_order_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该销售单已有结算单")
    
    customer_id = sales_order.customer_id
    customer_name = sales_order.customer_name
    deposit_used = 0.0  # 使用的存料金额
    
    # 验证支付方式
    if data.payment_method == "cash_price":
        if not data.gold_price or data.gold_price <= 0:
            raise HTTPException(status_code=400, detail="结价支付需要填写当日金价")
        material_amount = data.gold_price * sales_order.total_weight
        actual_gold_due = 0.0  # 结价不需要支付金料
    elif data.payment_method == "physical_gold":
        material_amount = 0  # 结料，原料金额为0
        
        # 计算应支付金料 = 销售总重量
        total_gold_due = sales_order.total_weight
        
        # 如果要使用存料抵扣
        if data.use_deposit and data.use_deposit > 0:
            if not customer_id:
                raise HTTPException(status_code=400, detail="该销售单未关联客户，无法使用存料")
            
            # 查找客户存料
            customer_deposit = db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == customer_id
            ).first()
            
            if not customer_deposit or customer_deposit.current_balance <= 0:
                raise HTTPException(status_code=400, detail="该客户没有可用存料")
            
            if data.use_deposit > customer_deposit.current_balance:
                raise HTTPException(
                    status_code=400,
                    detail=f"存料余额不足。可用存料：{customer_deposit.current_balance:.2f}克，要求使用：{data.use_deposit:.2f}克"
                )
            
            if data.use_deposit > total_gold_due:
                raise HTTPException(
                    status_code=400,
                    detail=f"使用存料不能超过应支付金料。应支付：{total_gold_due:.2f}克，要求使用：{data.use_deposit:.2f}克"
                )
            
            deposit_used = data.use_deposit
            # 实际需要支付的金料 = 总重量 - 使用存料
            actual_gold_due = total_gold_due - deposit_used
        else:
            actual_gold_due = total_gold_due
        
        # physical_gold_weight 存储客户实际需要支付的金料重量
        # 如果使用了存料抵扣，这个值会小于销售总重量
    else:
        raise HTTPException(status_code=400, detail="无效的支付方式")
    
    # 生成结算单号
    now = china_now()
    count = db.query(SettlementOrder).filter(
        SettlementOrder.settlement_no.like(f"JS{now.strftime('%Y%m%d')}%")
    ).count()
    settlement_no = f"JS{now.strftime('%Y%m%d')}{count + 1:03d}"
    
    # 计算金额
    labor_amount = sales_order.total_labor_cost
    total_amount = material_amount + labor_amount
    
    # 构建备注信息
    remark = data.remark or ""
    if deposit_used > 0:
        remark = f"使用存料抵扣：{deposit_used:.2f}克。" + remark
    
    # 创建结算单
    settlement = SettlementOrder(
        settlement_no=settlement_no,
        sales_order_id=data.sales_order_id,
        payment_method=data.payment_method,
        gold_price=data.gold_price,
        physical_gold_weight=actual_gold_due if data.payment_method == "physical_gold" else None,  # 实际需支付金料
        total_weight=sales_order.total_weight,
        material_amount=material_amount,
        labor_amount=labor_amount,
        total_amount=total_amount,
        status="pending",
        created_by=created_by,
        remark=remark
    )
    db.add(settlement)
    db.flush()
    
    # 如果使用了存料抵扣，更新客户存料记录
    if deposit_used > 0 and customer_id:
        customer_deposit = db.query(CustomerGoldDeposit).filter(
            CustomerGoldDeposit.customer_id == customer_id
        ).first()
        
        if customer_deposit:
            balance_before = customer_deposit.current_balance
            customer_deposit.current_balance -= deposit_used
            customer_deposit.total_used += deposit_used
            customer_deposit.last_transaction_at = now
            
            # 创建存料使用记录
            deposit_transaction = CustomerGoldDepositTransaction(
                customer_id=customer_id,
                customer_name=customer_name,
                transaction_type='use',
                settlement_order_id=settlement.id,
                amount=deposit_used,
                balance_before=balance_before,
                balance_after=customer_deposit.current_balance,
                created_by=created_by,
                remark=f"结算单：{settlement_no}，使用存料抵扣"
            )
            db.add(deposit_transaction)
            
            logger.info(f"客户存料使用: 客户={customer_name}, 使用={deposit_used}克, 新余额={customer_deposit.current_balance}克")
    
    # 创建客户往来账记录
    if customer_id:
        customer_transaction = CustomerTransaction(
            customer_id=customer_id,
            customer_name=customer_name,
            transaction_type='settlement',
            settlement_order_id=settlement.id,
            amount=total_amount,
            gold_weight=actual_gold_due if data.payment_method == "physical_gold" else 0,
            gold_due_before=0,  # 创建结算单时是新的欠款
            gold_due_after=actual_gold_due if data.payment_method == "physical_gold" else 0,
            remark=f"结算单：{settlement_no}，支付方式：{'结料' if data.payment_method == 'physical_gold' else '结价'}"
        )
        db.add(customer_transaction)
    
    db.commit()
    db.refresh(settlement)
    
    logger.info(f"创建结算单: {settlement_no}, 销售单: {sales_order.order_no}, "
                f"支付方式: {data.payment_method}, 使用存料: {deposit_used}克")
    
    return SettlementOrderResponse(
        id=settlement.id,
        settlement_no=settlement.settlement_no,
        sales_order_id=settlement.sales_order_id,
        payment_method=settlement.payment_method,
        gold_price=settlement.gold_price,
        physical_gold_weight=settlement.physical_gold_weight,
        total_weight=settlement.total_weight,
        material_amount=settlement.material_amount,
        labor_amount=settlement.labor_amount,
        total_amount=settlement.total_amount,
        status=settlement.status,
        created_by=settlement.created_by,
        confirmed_by=settlement.confirmed_by,
        confirmed_at=settlement.confirmed_at,
        printed_at=settlement.printed_at,
        remark=settlement.remark,
        created_at=settlement.created_at,
        sales_order=None,
        gold_received=0.0,
        gold_remaining_due=actual_gold_due if data.payment_method == "physical_gold" else None,
        deposit_used=deposit_used if deposit_used > 0 else None
    )


@router.post("/orders/{settlement_id}/confirm", response_model=SettlementOrderResponse)
async def confirm_settlement_order(
    settlement_id: int,
    data: SettlementOrderConfirm,
    db: Session = Depends(get_db)
):
    """确认结算单（结算专员确认）"""
    settlement = db.query(SettlementOrder).filter(SettlementOrder.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="结算单不存在")
    
    if settlement.status != "pending":
        raise HTTPException(status_code=400, detail=f"结算单状态为 {settlement.status}，无法确认")
    
    # 更新结算单状态
    settlement.status = "confirmed"
    settlement.confirmed_by = data.confirmed_by
    settlement.confirmed_at = china_now()
    
    # 更新销售单状态为已结算
    sales_order = db.query(SalesOrder).filter(SalesOrder.id == settlement.sales_order_id).first()
    if sales_order:
        sales_order.status = "已结算"
    
    db.commit()
    db.refresh(settlement)
    
    logger.info(f"确认结算单: {settlement.settlement_no}, 确认人: {data.confirmed_by}")
    
    return SettlementOrderResponse(
        id=settlement.id,
        settlement_no=settlement.settlement_no,
        sales_order_id=settlement.sales_order_id,
        payment_method=settlement.payment_method,
        gold_price=settlement.gold_price,
        physical_gold_weight=settlement.physical_gold_weight,
        total_weight=settlement.total_weight,
        material_amount=settlement.material_amount,
        labor_amount=settlement.labor_amount,
        total_amount=settlement.total_amount,
        status=settlement.status,
        created_by=settlement.created_by,
        confirmed_by=settlement.confirmed_by,
        confirmed_at=settlement.confirmed_at,
        printed_at=settlement.printed_at,
        remark=settlement.remark,
        created_at=settlement.created_at,
        sales_order=None
    )


@router.post("/orders/{settlement_id}/print", response_model=SettlementOrderResponse)
async def mark_settlement_printed(
    settlement_id: int,
    db: Session = Depends(get_db)
):
    """标记结算单为已打印"""
    settlement = db.query(SettlementOrder).filter(SettlementOrder.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="结算单不存在")
    
    if settlement.status not in ["confirmed", "printed"]:
        raise HTTPException(status_code=400, detail="请先确认结算单")
    
    settlement.status = "printed"
    settlement.printed_at = china_now()
    
    db.commit()
    db.refresh(settlement)
    
    logger.info(f"打印结算单: {settlement.settlement_no}")
    
    return SettlementOrderResponse(
        id=settlement.id,
        settlement_no=settlement.settlement_no,
        sales_order_id=settlement.sales_order_id,
        payment_method=settlement.payment_method,
        gold_price=settlement.gold_price,
        physical_gold_weight=settlement.physical_gold_weight,
        total_weight=settlement.total_weight,
        material_amount=settlement.material_amount,
        labor_amount=settlement.labor_amount,
        total_amount=settlement.total_amount,
        status=settlement.status,
        created_by=settlement.created_by,
        confirmed_by=settlement.confirmed_by,
        confirmed_at=settlement.confirmed_at,
        printed_at=settlement.printed_at,
        remark=settlement.remark,
        created_at=settlement.created_at,
        sales_order=None
    )


def calculate_gold_received(settlement_id: int, db: Session) -> float:
    """计算某结算单已收金料总重量"""
    receipts = db.query(GoldMaterialTransaction).filter(
        GoldMaterialTransaction.settlement_order_id == settlement_id,
        GoldMaterialTransaction.transaction_type == 'income',
        GoldMaterialTransaction.status.in_(['pending', 'confirmed'])  # 包括待确认和已确认
    ).all()
    
    return sum(r.gold_weight for r in receipts)


def get_deposit_used(settlement_id: int, db: Session) -> float:
    """获取结算单使用的存料金额"""
    deposit_transaction = db.query(CustomerGoldDepositTransaction).filter(
        CustomerGoldDepositTransaction.settlement_order_id == settlement_id,
        CustomerGoldDepositTransaction.transaction_type == 'use',
        CustomerGoldDepositTransaction.status == 'active'
    ).first()
    
    return deposit_transaction.amount if deposit_transaction else 0.0


@router.get("/orders/{settlement_id}", response_model=SettlementOrderResponse)
async def get_settlement_order(
    settlement_id: int,
    db: Session = Depends(get_db)
):
    """获取结算单详情（包含金料收取信息）"""
    settlement = db.query(SettlementOrder).filter(SettlementOrder.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="结算单不存在")
    
    # 加载关联的销售单
    sales_order = db.query(SalesOrder).filter(SalesOrder.id == settlement.sales_order_id).first()
    details = db.query(SalesDetail).filter(SalesDetail.order_id == settlement.sales_order_id).all() if sales_order else []
    
    sales_order_response = None
    if sales_order:
        sales_order_response = SalesOrderResponse(
            id=sales_order.id,
            order_no=sales_order.order_no,
            order_date=sales_order.order_date,
            customer_name=sales_order.customer_name,
            salesperson=sales_order.salesperson,
            store_code=sales_order.store_code,
            total_labor_cost=sales_order.total_labor_cost,
            total_weight=sales_order.total_weight,
            remark=sales_order.remark,
            status=sales_order.status,
            create_time=sales_order.create_time,
            operator=sales_order.operator,
            details=[
                SalesDetailResponse(
                    id=d.id,
                    product_name=d.product_name,
                    weight=d.weight,
                    labor_cost=d.labor_cost,
                    total_labor_cost=d.total_labor_cost
                ) for d in details
            ]
        )
    
    # 计算金料收取信息（仅结料时）
    gold_received = None
    gold_remaining_due = None
    deposit_used = None
    
    if settlement.payment_method == "physical_gold":
        gold_received = calculate_gold_received(settlement.id, db)
        gold_due = settlement.physical_gold_weight or 0.0
        gold_remaining_due = max(0.0, gold_due - gold_received)
        deposit_used = get_deposit_used(settlement.id, db)
    
    return SettlementOrderResponse(
        id=settlement.id,
        settlement_no=settlement.settlement_no,
        sales_order_id=settlement.sales_order_id,
        payment_method=settlement.payment_method,
        gold_price=settlement.gold_price,
        physical_gold_weight=settlement.physical_gold_weight,
        total_weight=settlement.total_weight,
        material_amount=settlement.material_amount,
        labor_amount=settlement.labor_amount,
        total_amount=settlement.total_amount,
        status=settlement.status,
        created_by=settlement.created_by,
        confirmed_by=settlement.confirmed_by,
        confirmed_at=settlement.confirmed_at,
        printed_at=settlement.printed_at,
        remark=settlement.remark,
        created_at=settlement.created_at,
        sales_order=sales_order_response,
        gold_received=gold_received,
        gold_remaining_due=gold_remaining_due,
        deposit_used=deposit_used
    )


