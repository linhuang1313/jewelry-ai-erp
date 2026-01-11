"""
结算单管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import logging

from ..database import get_db
from ..models import SettlementOrder, SalesOrder, SalesDetail
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
    db: Session = Depends(get_db)
):
    """创建结算单（结算专员创建）"""
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
    
    # 验证支付方式
    if data.payment_method == "cash_price":
        if not data.gold_price or data.gold_price <= 0:
            raise HTTPException(status_code=400, detail="结价支付需要填写当日金价")
        material_amount = data.gold_price * sales_order.total_weight
    elif data.payment_method == "physical_gold":
        if not data.physical_gold_weight or data.physical_gold_weight <= 0:
            raise HTTPException(status_code=400, detail="实物抵扣需要填写客户提供的黄金重量")
        material_amount = 0  # 实物抵扣，原料金额为0
    else:
        raise HTTPException(status_code=400, detail="无效的支付方式")
    
    # 生成结算单号
    now = datetime.now()
    count = db.query(SettlementOrder).filter(
        SettlementOrder.settlement_no.like(f"JS{now.strftime('%Y%m%d')}%")
    ).count()
    settlement_no = f"JS{now.strftime('%Y%m%d')}{count + 1:03d}"
    
    # 计算金额
    labor_amount = sales_order.total_labor_cost
    total_amount = material_amount + labor_amount
    
    # 创建结算单
    settlement = SettlementOrder(
        settlement_no=settlement_no,
        sales_order_id=data.sales_order_id,
        payment_method=data.payment_method,
        gold_price=data.gold_price,
        physical_gold_weight=data.physical_gold_weight,
        total_weight=sales_order.total_weight,
        material_amount=material_amount,
        labor_amount=labor_amount,
        total_amount=total_amount,
        status="pending",
        created_by=created_by,
        remark=data.remark
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    
    logger.info(f"创建结算单: {settlement_no}, 销售单: {sales_order.order_no}, 支付方式: {data.payment_method}")
    
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
    settlement.confirmed_at = datetime.now()
    
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
    settlement.printed_at = datetime.now()
    
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


@router.get("/orders/{settlement_id}", response_model=SettlementOrderResponse)
async def get_settlement_order(
    settlement_id: int,
    db: Session = Depends(get_db)
):
    """获取结算单详情"""
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
        sales_order=sales_order_response
    )

