"""
结算单管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, HTMLResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
import logging
import io

from ..database import get_db
from ..timezone_utils import china_now, to_china_time, format_china_time
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
            # 混合支付专用字段
            gold_payment_weight=order.gold_payment_weight,
            cash_payment_weight=order.cash_payment_weight,
            # 客户历史余额信息
            previous_cash_debt=order.previous_cash_debt or 0.0,
            previous_gold_debt=order.previous_gold_debt or 0.0,
            gold_deposit_balance=order.gold_deposit_balance or 0.0,
            cash_deposit_balance=order.cash_deposit_balance or 0.0,
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
    elif data.payment_method == "mixed":
        # ==================== 混合支付 ====================
        # 验证必填参数
        if not data.gold_price or data.gold_price <= 0:
            raise HTTPException(status_code=400, detail="混合支付需要填写当日金价")
        if data.gold_payment_weight is None or data.gold_payment_weight < 0:
            raise HTTPException(status_code=400, detail="混合支付需要填写结料部分的克重")
        if data.cash_payment_weight is None or data.cash_payment_weight < 0:
            raise HTTPException(status_code=400, detail="混合支付需要填写结价部分的克重")
        
        # 计算支付差额（支付克重 - 应付克重）
        total_input = (data.gold_payment_weight or 0) + (data.cash_payment_weight or 0)
        weight_difference = total_input - sales_order.total_weight
        
        # 灵活支付：少付时需要前端确认
        if weight_difference < -0.01 and not data.confirmed_underpay:
            raise HTTPException(
                status_code=400,
                detail=f"支付不足：支付克重({total_input:.2f}克) 小于 应付克重({sales_order.total_weight:.2f}克)，差额{abs(weight_difference):.2f}克。请确认后重试。"
            )
        
        # 计算金额：结价部分按金价换算成现金
        material_amount = data.gold_price * (data.cash_payment_weight or 0)
        # 客户需要支付的金料 = 结料部分的克重
        actual_gold_due = data.gold_payment_weight or 0
        
        logger.info(f"混合支付: 结料{data.gold_payment_weight}克 + 结价{data.cash_payment_weight}克×{data.gold_price}元/克 = 料费¥{material_amount}, 差额={weight_difference:.2f}克")
        # ==================== 混合支付结束 ====================
    else:
        raise HTTPException(status_code=400, detail="无效的支付方式，请选择：cash_price(结价)、physical_gold(结料)或 mixed(混合支付)")
    
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
    
    # ========== 查询客户历史余额信息 ==========
    previous_cash_debt = 0.0  # 上次现金欠款
    previous_gold_debt = 0.0  # 上次金料欠款
    gold_deposit_balance = 0.0  # 存料余额
    cash_deposit_balance = 0.0  # 存款余额
    
    if customer_id:
        # 查询存料余额
        customer_deposit = db.query(CustomerGoldDeposit).filter(
            CustomerGoldDeposit.customer_id == customer_id
        ).first()
        if customer_deposit:
            gold_deposit_balance = customer_deposit.current_balance or 0.0
        
        # 查询上次金料欠款（从客户往来账中获取最后一条记录）
        last_transaction = db.query(CustomerTransaction).filter(
            CustomerTransaction.customer_id == customer_id,
            CustomerTransaction.status == "active"
        ).order_by(CustomerTransaction.created_at.desc()).first()
        if last_transaction:
            previous_gold_debt = last_transaction.gold_due_after or 0.0
        
        # 查询现金欠款（从应收账款表获取）
        from ..models.finance import AccountReceivable
        try:
            account_receivable = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id
            ).first()
            if account_receivable:
                previous_cash_debt = account_receivable.balance or 0.0
        except Exception as e:
            logger.warning(f"查询应收账款失败: {e}")
    
    logger.info(f"[结算单] 客户余额快照 - 现金欠款: {previous_cash_debt}, 金料欠款: {previous_gold_debt}, 存料: {gold_deposit_balance}")
    # ========== 客户余额查询结束 ==========
    
    # 创建结算单
    # 确定客户需支付的金料重量
    if data.payment_method == "physical_gold":
        physical_gold_weight = actual_gold_due
    elif data.payment_method == "mixed":
        physical_gold_weight = actual_gold_due  # 混合支付时，结料部分的克重
    else:
        physical_gold_weight = None
    
    # ========== 计算支付差额和状态 ==========
    payment_difference = 0.0
    payment_status = "full"
    
    if data.payment_method == "mixed":
        # 混合支付：基于克重计算差额
        total_input = (data.gold_payment_weight or 0) + (data.cash_payment_weight or 0)
        payment_difference = total_input - sales_order.total_weight
    elif data.payment_method == "physical_gold":
        # 结料支付：基于金料重量计算差额
        if data.physical_gold_weight:
            payment_difference = data.physical_gold_weight - sales_order.total_weight
    # 结价支付暂不支持差额（需要额外参数）
    
    # 设置支付状态
    if payment_difference > 0.01:
        payment_status = "overpaid"  # 多付
    elif payment_difference < -0.01:
        payment_status = "underpaid"  # 少付
    else:
        payment_status = "full"  # 全额
    
    logger.info(f"[结算单] 支付差额: {payment_difference:.2f}克, 状态: {payment_status}")
    # ========== 支付差额计算结束 ==========
    
    settlement = SettlementOrder(
        settlement_no=settlement_no,
        sales_order_id=data.sales_order_id,
        payment_method=data.payment_method,
        gold_price=data.gold_price,
        physical_gold_weight=physical_gold_weight,  # 客户实际需支付的金料重量
        # 混合支付专用字段
        gold_payment_weight=data.gold_payment_weight if data.payment_method == "mixed" else None,
        cash_payment_weight=data.cash_payment_weight if data.payment_method == "mixed" else None,
        total_weight=sales_order.total_weight,
        material_amount=material_amount,
        labor_amount=labor_amount,
        total_amount=total_amount,
        # 客户历史余额快照
        previous_cash_debt=previous_cash_debt,
        previous_gold_debt=previous_gold_debt,
        gold_deposit_balance=gold_deposit_balance,
        cash_deposit_balance=cash_deposit_balance,
        # 灵活支付状态
        payment_difference=payment_difference,
        payment_status=payment_status,
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
        # 混合支付专用字段
        gold_payment_weight=settlement.gold_payment_weight,
        cash_payment_weight=settlement.cash_payment_weight,
        # 客户历史余额信息
        previous_cash_debt=settlement.previous_cash_debt or 0.0,
        previous_gold_debt=settlement.previous_gold_debt or 0.0,
        gold_deposit_balance=settlement.gold_deposit_balance or 0.0,
        cash_deposit_balance=settlement.cash_deposit_balance or 0.0,
        status=settlement.status,
        created_by=settlement.created_by,
        confirmed_by=settlement.confirmed_by,
        confirmed_at=settlement.confirmed_at,
        printed_at=settlement.printed_at,
        remark=settlement.remark,
        created_at=settlement.created_at,
        sales_order=None,
        gold_received=0.0,
        gold_remaining_due=actual_gold_due if data.payment_method in ["physical_gold", "mixed"] else None,
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
    
    # ========== 创建应收账款记录 ==========
    from ..models.finance import AccountReceivable
    from datetime import timedelta
    
    # 根据支付方式计算应收金额
    if settlement.payment_method == "cash_price":
        # 结价：应收全额（料价+工费）
        receivable_amount = settlement.total_amount or 0
    elif settlement.payment_method == "physical_gold":
        # 结料：只应收工费（原料用金料抵扣）
        receivable_amount = settlement.labor_amount or 0
    elif settlement.payment_method == "mixed":
        # 混合支付：结价部分的料价 + 工费
        # cash_payment_weight 是结价部分的克重，需要换算成金额
        cash_material_amount = (settlement.cash_payment_weight or 0) * (settlement.gold_price or 0)
        receivable_amount = cash_material_amount + (settlement.labor_amount or 0)
    else:
        receivable_amount = settlement.total_amount or 0
    
    # 只有应收金额大于0才创建记录
    if receivable_amount > 0 and sales_order:
        now = china_now()
        credit_days = 30  # 默认账期30天
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
            remark=f"结算单：{settlement.settlement_no}，支付方式：{settlement.payment_method}",
            operator=data.confirmed_by
        )
        db.add(account_receivable)
        logger.info(f"创建应收账款: 客户ID={sales_order.customer_id}, 金额={receivable_amount}, 结算单={settlement.settlement_no}")
    # ========== 应收账款创建结束 ==========
    
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
        # 混合支付专用字段
        gold_payment_weight=settlement.gold_payment_weight,
        cash_payment_weight=settlement.cash_payment_weight,
        previous_cash_debt=settlement.previous_cash_debt or 0.0,
        previous_gold_debt=settlement.previous_gold_debt or 0.0,
        gold_deposit_balance=settlement.gold_deposit_balance or 0.0,
        cash_deposit_balance=settlement.cash_deposit_balance or 0.0,
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
        # 混合支付专用字段
        gold_payment_weight=settlement.gold_payment_weight,
        cash_payment_weight=settlement.cash_payment_weight,
        previous_cash_debt=settlement.previous_cash_debt or 0.0,
        previous_gold_debt=settlement.previous_gold_debt or 0.0,
        gold_deposit_balance=settlement.gold_deposit_balance or 0.0,
        cash_deposit_balance=settlement.cash_deposit_balance or 0.0,
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
    
    # 结料或混合支付时，计算金料收取信息
    if settlement.payment_method in ["physical_gold", "mixed"]:
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
        # 混合支付专用字段
        gold_payment_weight=settlement.gold_payment_weight,
        cash_payment_weight=settlement.cash_payment_weight,
        previous_cash_debt=settlement.previous_cash_debt or 0.0,
        previous_gold_debt=settlement.previous_gold_debt or 0.0,
        gold_deposit_balance=settlement.gold_deposit_balance or 0.0,
        cash_deposit_balance=settlement.cash_deposit_balance or 0.0,
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


# ============= 结算单下载/打印 =============

@router.options("/orders/{settlement_id}/download")
async def download_settlement_order_options(settlement_id: int):
    """处理CORS预检请求"""
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/orders/{settlement_id}/download")
async def download_settlement_order(
    settlement_id: int,
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印结算单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载结算单请求: settlement_id={settlement_id}, format={format}")
        
        # 查询结算单
        settlement = db.query(SettlementOrder).filter(SettlementOrder.id == settlement_id).first()
        if not settlement:
            raise HTTPException(status_code=404, detail="结算单不存在")
        
        # 查询关联的销售单
        sales_order = db.query(SalesOrder).filter(SalesOrder.id == settlement.sales_order_id).first()
        details = db.query(SalesDetail).filter(SalesDetail.order_id == settlement.sales_order_id).all() if sales_order else []
        
        logger.info(f"找到结算单: settlement_no={settlement.settlement_no}, 明细数={len(details)}")
        
        # 时间格式化
        if settlement.created_at:
            china_time = to_china_time(settlement.created_at)
            created_at_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
        else:
            created_at_str = "未知"
        
        if settlement.confirmed_at:
            confirmed_china_time = to_china_time(settlement.confirmed_at)
            confirmed_at_str = format_china_time(confirmed_china_time, '%Y-%m-%d %H:%M:%S')
        else:
            confirmed_at_str = "未确认"
        
        # 支付方式转换
        if settlement.payment_method == "cash_price":
            payment_method_str = "结价"
        elif settlement.payment_method == "mixed":
            payment_method_str = "混合支付（部分结料+部分结价）"
        else:
            payment_method_str = "结料"
        
        # 状态转换
        status_map = {
            "pending": "待确认",
            "confirmed": "已确认",
            "printed": "已打印"
        }
        status_str = status_map.get(settlement.status, settlement.status)
        
        if format == "pdf":
            try:
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                
                # 自定义纸张尺寸：241mm × 140mm 横向（针式打印机）
                PAGE_WIDTH = 241 * mm
                PAGE_HEIGHT = 140 * mm
                
                buffer = io.BytesIO()
                p = canvas.Canvas(buffer, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
                width, height = PAGE_WIDTH, PAGE_HEIGHT
                
                # 使用 CID 字体
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    chinese_font = 'STSong-Light'
                except Exception as cid_error:
                    logger.warning(f"注册CID字体失败: {cid_error}")
                    chinese_font = None
                
                # 页边距
                left_margin = 8 * mm
                right_margin = width - 8 * mm
                top_margin = height - 5 * mm
                
                # 获取客户信息
                customer_name = sales_order.customer_name if sales_order else '未知'
                customer_phone = ""
                if sales_order and sales_order.customer_id:
                    from ..models import Customer
                    customer = db.query(Customer).filter(Customer.id == sales_order.customer_id).first()
                    if customer:
                        customer_phone = customer.phone or ""
                salesperson = sales_order.salesperson if sales_order else '未知'
                store_code = sales_order.store_code if sales_order else ""
                
                # 当前打印时间
                print_time = format_china_time(china_now(), '%Y/%m/%d %H:%M')
                settlement_date = format_china_time(to_china_time(settlement.created_at), '%Y-%m-%d') if settlement.created_at else "未知"
                
                # === 标题区 ===
                if chinese_font:
                    p.setFont(chinese_font, 14)
                else:
                    p.setFont("Helvetica-Bold", 14)
                p.drawCentredString(width / 2, top_margin, "深圳市梵贝琳珠宝有限公司")
                
                y = top_margin - 14
                if chinese_font:
                    p.setFont(chinese_font, 12)
                else:
                    p.setFont("Helvetica-Bold", 12)
                p.drawCentredString(width / 2, y, "销售结算单")
                
                # === 基本信息行 ===
                y -= 14
                if chinese_font:
                    p.setFont(chinese_font, 7)
                else:
                    p.setFont("Helvetica", 7)
                
                # 第一行：单号、时间、打印人、打印日期
                p.drawString(left_margin, y, f"结算单号：{settlement.settlement_no}")
                p.drawString(left_margin + 55*mm, y, f"结算时间：{settlement_date}")
                p.drawString(left_margin + 110*mm, y, f"打 印 人：{salesperson}")
                p.drawString(left_margin + 155*mm, y, f"打印日期：{print_time}")
                
                # 第二行：客户、电话
                y -= 9
                p.drawString(left_margin, y, f"结算客户：{customer_name[:15]}")
                p.drawString(left_margin + 55*mm, y, f"客户电话：{customer_phone}")
                
                # 第三行：备注
                y -= 9
                remark_text = settlement.remark or store_code or ""
                p.drawString(left_margin, y, f"结算备注：{remark_text[:30]}")
                
                # === 饰品出货表 ===
                y -= 12
                if chinese_font:
                    p.setFont(chinese_font, 7)
                p.setFillColorRGB(0.9, 0.9, 0.9)
                p.rect(left_margin, y - 2, right_margin - left_margin, 10, fill=1)
                p.setFillColorRGB(0, 0, 0)
                if chinese_font:
                    p.setFont(chinese_font, 7)
                p.drawString(left_margin + 2, y, "【饰品出货】")
                
                # 表头
                y -= 12
                col_widths = [12, 50, 18, 22, 22, 22, 18, 18, 22, 25, 25]  # mm
                col_x = [left_margin]
                for w in col_widths[:-1]:
                    col_x.append(col_x[-1] + w*mm)
                
                headers = ["优惠", "饰品名称", "数量", "重量", "出货方式", "金价", "工价", "附工价", "工费小计", "销售金额", "备注"]
                if chinese_font:
                    p.setFont(chinese_font, 6)
                else:
                    p.setFont("Helvetica", 6)
                
                # 绘制表头边框和文字
                p.line(left_margin, y + 8, right_margin, y + 8)
                for i, header in enumerate(headers):
                    p.drawString(col_x[i] + 1, y, header)
                p.line(left_margin, y - 2, right_margin, y - 2)
                
                # 表格数据行
                y -= 10
                total_qty = 0
                total_weight = 0.0
                total_labor = 0.0
                total_sales = 0.0
                gold_price = settlement.gold_price or 0
                
                for detail in details:
                    weight = detail.weight or 0
                    labor_cost = detail.labor_cost or 0
                    total_labor_cost = detail.total_labor_cost or 0
                    material_cost = gold_price * weight if settlement.payment_method in ["cash_price", "mixed"] else 0
                    sales_amount = material_cost + total_labor_cost
                    
                    total_qty += 1
                    total_weight += weight
                    total_labor += total_labor_cost
                    total_sales += sales_amount
                    
                    product_name = detail.product_name[:14] if len(detail.product_name) > 14 else detail.product_name
                    
                    if chinese_font:
                        p.setFont(chinese_font, 6)
                    p.drawString(col_x[0] + 1, y, "")  # 优惠
                    p.drawString(col_x[1] + 1, y, product_name)
                    p.setFont("Helvetica", 6)
                    p.drawRightString(col_x[2] + 16*mm, y, "1")
                    p.drawRightString(col_x[3] + 20*mm, y, f"{weight:.2f}")
                    if chinese_font:
                        p.setFont(chinese_font, 6)
                    p.drawString(col_x[4] + 2, y, "重量")
                    p.setFont("Helvetica", 6)
                    p.drawRightString(col_x[5] + 20*mm, y, f"{gold_price:.2f}")
                    p.drawRightString(col_x[6] + 16*mm, y, f"{labor_cost:.2f}")
                    p.drawRightString(col_x[7] + 16*mm, y, "")  # 附工价
                    p.drawRightString(col_x[8] + 20*mm, y, f"{total_labor_cost:.2f}")
                    p.drawRightString(col_x[9] + 23*mm, y, f"{sales_amount:.2f}")
                    
                    y -= 8
                    if y < 25 * mm:  # 防止超出页面
                        break
                
                # 总计行
                p.line(left_margin, y + 6, right_margin, y + 6)
                if chinese_font:
                    p.setFont(chinese_font, 6)
                p.drawRightString(col_x[1] + 48*mm, y, "总 计")
                p.setFont("Helvetica", 6)
                p.drawRightString(col_x[2] + 16*mm, y, str(total_qty))
                p.drawRightString(col_x[3] + 20*mm, y, f"{total_weight:.2f}")
                p.drawRightString(col_x[8] + 20*mm, y, f"{total_labor:.2f}")
                p.drawRightString(col_x[9] + 23*mm, y, f"{total_sales:.2f}")
                p.line(left_margin, y - 2, right_margin, y - 2)
                
                # 汇总行
                y -= 10
                if chinese_font:
                    p.setFont(chinese_font, 7)
                p.drawRightString(right_margin - 80*mm, y, f"优惠额：0.00")
                p.drawRightString(right_margin - 40*mm, y, f"结算金额：{settlement.total_amount:.2f}")
                p.drawRightString(right_margin, y, f"本单应收：{settlement.total_amount:.2f}")
                
                # === 结算汇总表 ===
                y -= 12
                p.setFillColorRGB(0.9, 0.9, 0.9)
                p.rect(left_margin, y - 2, right_margin - left_margin, 10, fill=1)
                p.setFillColorRGB(0, 0, 0)
                if chinese_font:
                    p.setFont(chinese_font, 7)
                p.drawString(left_margin + 2, y, "【结算汇总】")
                
                y -= 12
                # 汇总表头
                sum_headers = ["序号", "结算项目", "上次结存", "本次结算", "本次结退", "本次客来", "欠料结价", "本次结存", "本次汇总"]
                sum_widths = [12, 25, 28, 28, 25, 25, 25, 28, 28]
                sum_x = [left_margin]
                for w in sum_widths[:-1]:
                    sum_x.append(sum_x[-1] + w*mm)
                
                if chinese_font:
                    p.setFont(chinese_font, 6)
                p.line(left_margin, y + 8, right_margin, y + 8)
                for i, h in enumerate(sum_headers):
                    p.drawString(sum_x[i] + 1, y, h)
                p.line(left_margin, y - 2, right_margin, y - 2)
                
                # 汇总数据
                prev_cash = settlement.previous_cash_debt or 0
                prev_gold = settlement.previous_gold_debt or 0
                current_cash = settlement.total_amount or 0
                current_gold = settlement.physical_gold_weight or 0
                new_cash = prev_cash + current_cash
                new_gold = prev_gold + current_gold
                
                y -= 9
                p.drawString(sum_x[0] + 3, y, "1")
                if chinese_font:
                    p.setFont(chinese_font, 6)
                p.drawString(sum_x[1] + 1, y, "欠款(元)")
                p.setFont("Helvetica", 6)
                p.drawRightString(sum_x[2] + 26*mm, y, f"{prev_cash:,.2f}")
                p.drawRightString(sum_x[3] + 26*mm, y, f"{current_cash:,.2f}")
                p.drawRightString(sum_x[7] + 26*mm, y, f"{new_cash:,.2f}")
                p.drawRightString(sum_x[8] + 26*mm, y, f"{new_cash:,.2f}")
                
                y -= 8
                p.drawString(sum_x[0] + 3, y, "2")
                if chinese_font:
                    p.setFont(chinese_font, 6)
                p.drawString(sum_x[1] + 1, y, "足金(克)")
                p.setFont("Helvetica", 6)
                p.drawRightString(sum_x[2] + 26*mm, y, f"{prev_gold:.3f}")
                p.drawRightString(sum_x[3] + 26*mm, y, f"{current_gold:.3f}")
                p.drawRightString(sum_x[7] + 26*mm, y, f"{new_gold:.3f}")
                p.drawRightString(sum_x[8] + 26*mm, y, f"{new_gold:.3f}")
                p.line(left_margin, y - 2, right_margin, y - 2)
                
                # === 敬告客户 ===
                y -= 14
                if chinese_font:
                    p.setFont(chinese_font, 6)
                notice = "【敬告客户】我公司所售饰品均通过严格检测。为了保障您的利益，请将以上饰品送当地检测部门检测后再上柜销售。"
                p.drawString(left_margin, y, notice)
                
                # === 签名区 ===
                y -= 12
                if chinese_font:
                    p.setFont(chinese_font, 7)
                p.drawString(left_margin, y, f"制单人：{salesperson}")
                p.drawString(left_margin + 70*mm, y, f"复核人：{settlement.confirmed_by or ''}")
                p.drawString(left_margin + 140*mm, y, "客户确认：")
                
                # 页码
                y -= 10
                p.drawRightString(right_margin, y, "第 1-1 页")
                
                p.save()
                buffer.seek(0)
                
                filename = f"settlement_{settlement.settlement_no}.pdf"
                return StreamingResponse(
                    buffer,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{filename}"',
                        "Access-Control-Allow-Origin": "*",
                    }
                )
            except Exception as pdf_error:
                logger.error(f"生成结算单PDF失败: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
        
        elif format == "html":
            # HTML 打印格式 - 参考用户提供的结算单格式
            customer_name = sales_order.customer_name if sales_order else "未知"
            customer_phone = ""
            if sales_order and sales_order.customer_id:
                from ..models import Customer
                customer = db.query(Customer).filter(Customer.id == sales_order.customer_id).first()
                if customer:
                    customer_phone = customer.phone or ""
            salesperson = sales_order.salesperson if sales_order else "未知"
            store_code = sales_order.store_code if sales_order else ""
            
            # 当前打印时间
            print_time = format_china_time(china_now(), '%Y/%m/%d %H:%M')
            settlement_date = format_china_time(to_china_time(settlement.created_at), '%Y-%m-%d') if settlement.created_at else "未知"
            
            # 生成饰品出货表格行
            detail_rows_html = ""
            total_quantity = 0
            total_weight = 0.0
            total_labor_cost = 0.0
            total_sales_amount = 0.0
            
            for idx, detail in enumerate(details, 1):
                weight = detail.weight or 0
                labor_cost = detail.labor_cost or 0
                total_labor = detail.total_labor_cost or 0
                gold_price = settlement.gold_price or 0
                # 销售金额 = 金价*重量 + 工费
                material_cost = gold_price * weight if settlement.payment_method in ["cash_price", "mixed"] else 0
                sales_amount = material_cost + total_labor
                
                total_quantity += 1
                total_weight += weight
                total_labor_cost += total_labor
                total_sales_amount += sales_amount
                
                # 出货方式
                if settlement.payment_method == "cash_price":
                    delivery_method = "重量"
                elif settlement.payment_method == "physical_gold":
                    delivery_method = "重量"
                else:
                    delivery_method = "重量"
                
                detail_rows_html += f'''
                <tr>
                    <td></td>
                    <td class="left">{detail.product_name}</td>
                    <td class="center">1</td>
                    <td class="right">{weight:.2f}</td>
                    <td class="center">{delivery_method}</td>
                    <td class="right">{gold_price:.2f}</td>
                    <td class="right">{labor_cost:.2f}</td>
                    <td class="right"></td>
                    <td class="right">{total_labor:.2f}</td>
                    <td class="right">{sales_amount:.2f}</td>
                    <td></td>
                </tr>'''
            
            # 结算明细表格（结料/结价部分）
            settlement_detail_rows = ""
            if settlement.payment_method == "physical_gold":
                # 全部结料
                settlement_detail_rows = f'''
                <tr>
                    <td class="center">1</td>
                    <td>出货结料</td>
                    <td>足金</td>
                    <td class="right">{settlement.total_weight:.3f}</td>
                    <td>足金</td>
                    <td class="right">{settlement.total_weight:.3f}</td>
                    <td class="right">{settlement.total_weight:.3f}</td>
                    <td class="right"></td>
                    <td class="right"></td>
                    <td class="right"></td>
                    <td class="right">{settlement.labor_amount/settlement.total_weight:.2f}</td>
                    <td class="right"></td>
                    <td class="right">{settlement.labor_amount:.2f}</td>
                </tr>'''
            elif settlement.payment_method == "cash_price":
                # 全部结价
                settlement_detail_rows = f'''
                <tr>
                    <td class="center">1</td>
                    <td>出货结料</td>
                    <td>足金</td>
                    <td class="right">{settlement.total_weight:.3f}</td>
                    <td>足金</td>
                    <td class="right">{settlement.total_weight:.3f}</td>
                    <td class="right"></td>
                    <td class="right">{settlement.total_weight:.3f}</td>
                    <td class="right">{settlement.gold_price:.2f}</td>
                    <td class="right">{settlement.material_amount:.2f}</td>
                    <td class="right">{settlement.labor_amount/settlement.total_weight:.2f}</td>
                    <td class="right"></td>
                    <td class="right">{settlement.labor_amount:.2f}</td>
                </tr>'''
            elif settlement.payment_method == "mixed":
                # 混合支付 - 分两行显示
                gold_weight = settlement.gold_payment_weight or 0
                cash_weight = settlement.cash_payment_weight or 0
                labor_per_gram = settlement.labor_amount / settlement.total_weight if settlement.total_weight > 0 else 0
                gold_labor = gold_weight * labor_per_gram
                cash_labor = cash_weight * labor_per_gram
                cash_material = cash_weight * (settlement.gold_price or 0)
                
                settlement_detail_rows = f'''
                <tr>
                    <td class="center">1</td>
                    <td>出货结料</td>
                    <td>足金</td>
                    <td class="right">{gold_weight:.3f}</td>
                    <td>足金</td>
                    <td class="right">{gold_weight:.3f}</td>
                    <td class="right">{gold_weight:.3f}</td>
                    <td class="right"></td>
                    <td class="right"></td>
                    <td class="right"></td>
                    <td class="right">{labor_per_gram:.2f}</td>
                    <td class="right"></td>
                    <td class="right">{gold_labor:.2f}</td>
                </tr>
                <tr>
                    <td class="center">2</td>
                    <td>出货结价</td>
                    <td>足金</td>
                    <td class="right">{cash_weight:.3f}</td>
                    <td>足金</td>
                    <td class="right">{cash_weight:.3f}</td>
                    <td class="right"></td>
                    <td class="right">{cash_weight:.3f}</td>
                    <td class="right">{settlement.gold_price:.2f}</td>
                    <td class="right">{cash_material:.2f}</td>
                    <td class="right">{labor_per_gram:.2f}</td>
                    <td class="right"></td>
                    <td class="right">{cash_labor:.2f}</td>
                </tr>'''
            
            # 结算汇总
            prev_cash = settlement.previous_cash_debt or 0
            prev_gold = settlement.previous_gold_debt or 0
            current_cash = settlement.total_amount or 0
            current_gold = settlement.physical_gold_weight or 0
            new_cash_balance = prev_cash + current_cash
            new_gold_balance = prev_gold + current_gold
            
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>销售结算单 - {settlement.settlement_no}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ 
            font-family: 'SimSun', 'Microsoft YaHei', sans-serif; 
            font-size: 12px;
            line-height: 1.4;
            background: #fff;
        }}
        .page {{
            width: 241mm;
            min-height: 140mm;
            padding: 8mm 10mm;
            margin: 0 auto;
            background: white;
        }}
        .header {{
            text-align: center;
            margin-bottom: 8px;
        }}
        .company-name {{
            font-size: 18px;
            font-weight: bold;
            letter-spacing: 2px;
        }}
        .doc-title {{
            font-size: 16px;
            font-weight: bold;
            margin: 5px 0;
            text-decoration: underline;
        }}
        .header-info {{
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-bottom: 5px;
        }}
        .info-row {{
            display: flex;
            font-size: 11px;
            margin-bottom: 3px;
        }}
        .info-row .item {{
            margin-right: 20px;
        }}
        .section-title {{
            font-weight: bold;
            background: #f0f0f0;
            padding: 2px 5px;
            margin: 8px 0 3px 0;
            font-size: 11px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
        }}
        table th, table td {{
            border: 1px solid #333;
            padding: 2px 4px;
            text-align: center;
        }}
        table th {{
            background: #f8f8f8;
            font-weight: normal;
        }}
        .left {{ text-align: left; }}
        .right {{ text-align: right; }}
        .center {{ text-align: center; }}
        .total-row {{
            font-weight: bold;
            background: #f8f8f8;
        }}
        .summary-row {{
            display: flex;
            justify-content: flex-end;
            gap: 30px;
            margin: 5px 0;
            font-size: 11px;
        }}
        .notice {{
            font-size: 10px;
            margin: 10px 0;
            padding: 5px;
            border: 1px solid #ccc;
        }}
        .notice-title {{
            font-weight: bold;
        }}
        .signature-row {{
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
            font-size: 11px;
        }}
        .signature-item {{
            display: flex;
            gap: 50px;
        }}
        .page-num {{
            text-align: right;
            font-size: 10px;
            margin-top: 5px;
        }}
        .print-btn {{
            display: block;
            margin: 20px auto;
            padding: 10px 30px;
            background: #3498db;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 14px;
            cursor: pointer;
        }}
        .print-btn:hover {{ background: #2980b9; }}
        @media print {{
            body {{ background: white; }}
            .page {{ 
                width: 241mm;
                min-height: 140mm;
                padding: 5mm 8mm;
                margin: 0;
            }}
            .print-btn {{ display: none; }}
        }}
        @media screen {{
            body {{ background: #f5f5f5; padding: 20px; }}
            .page {{ box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        }}
    </style>
</head>
<body>
    <div class="page">
        <!-- 标题区 -->
        <div class="header">
            <div class="company-name">深圳市梵贝琳珠宝有限公司</div>
            <div class="doc-title">销售结算单</div>
        </div>
        
        <!-- 基本信息 -->
        <div class="header-info">
            <span>结算单号：{settlement.settlement_no}</span>
            <span>结算时间：{settlement_date}</span>
            <span>打 印 人：{salesperson}</span>
            <span>打印日期：{print_time}</span>
        </div>
        <div class="info-row">
            <span class="item">结算客户：{customer_name}</span>
            <span class="item">客户电话：{customer_phone}</span>
        </div>
        <div class="info-row">
            <span class="item">结算备注：{settlement.remark or store_code or ''}</span>
        </div>
        
        <!-- 饰品出货表 -->
        <div class="section-title">【饰品出货】</div>
        <table>
            <thead>
                <tr>
                    <th style="width:30px">优惠</th>
                    <th style="width:auto">饰品名称</th>
                    <th style="width:35px">数量</th>
                    <th style="width:50px">重量</th>
                    <th style="width:50px">出货方式</th>
                    <th style="width:55px">金价</th>
                    <th style="width:45px">工价</th>
                    <th style="width:45px">附工价</th>
                    <th style="width:55px">工费小计</th>
                    <th style="width:60px">销售金额</th>
                    <th style="width:60px">销售小备注</th>
                </tr>
            </thead>
            <tbody>
                {detail_rows_html}
                <tr class="total-row">
                    <td colspan="2" class="right">总 计</td>
                    <td class="center">{total_quantity}</td>
                    <td class="right">{total_weight:.2f}</td>
                    <td colspan="4"></td>
                    <td class="right">{total_labor_cost:.2f}</td>
                    <td class="right">{total_sales_amount:.2f}</td>
                    <td></td>
                </tr>
            </tbody>
        </table>
        <div class="summary-row">
            <span>优惠额：0.00</span>
            <span>结算金额：<b>{settlement.total_amount:.2f}</b></span>
            <span>本单应收：<b>{settlement.total_amount:.2f}</b></span>
        </div>
        
        <!-- 结算明细表 -->
        <div class="section-title">【结算明细】</div>
        <table>
            <thead>
                <tr>
                    <th style="width:25px">序</th>
                    <th style="width:60px">结算项目</th>
                    <th style="width:40px">成色</th>
                    <th style="width:50px">重量</th>
                    <th style="width:50px">结算成色</th>
                    <th style="width:55px">应结重量</th>
                    <th style="width:55px">结料重量</th>
                    <th style="width:55px">结价重量</th>
                    <th style="width:50px">金价</th>
                    <th style="width:60px">结料金额</th>
                    <th style="width:45px">工价</th>
                    <th style="width:45px">附工价</th>
                    <th style="width:55px">工费小计</th>
                </tr>
            </thead>
            <tbody>
                {settlement_detail_rows}
            </tbody>
        </table>
        
        <!-- 结算汇总表 -->
        <div class="section-title">【结算汇总】</div>
        <table>
            <thead>
                <tr>
                    <th style="width:30px">序号</th>
                    <th style="width:60px">结算项目</th>
                    <th style="width:70px">上次结存</th>
                    <th style="width:70px">本次结算</th>
                    <th style="width:55px">本次结退</th>
                    <th style="width:55px">本次客来</th>
                    <th style="width:55px">欠料结价</th>
                    <th style="width:70px">本次结存</th>
                    <th style="width:70px">本次汇总</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="center">1</td>
                    <td>欠款（元）</td>
                    <td class="right">{prev_cash:,.2f}元</td>
                    <td class="right">{current_cash:,.2f}元</td>
                    <td class="right">元</td>
                    <td class="right">元</td>
                    <td class="right">元</td>
                    <td class="right">{new_cash_balance:,.2f}元</td>
                    <td class="right">{new_cash_balance:,.2f}元</td>
                </tr>
                <tr>
                    <td class="center">2</td>
                    <td>足金（克）</td>
                    <td class="right">{prev_gold:.3f}克</td>
                    <td class="right">{current_gold:.3f}克</td>
                    <td class="right">克</td>
                    <td class="right">克</td>
                    <td class="right">克</td>
                    <td class="right">{new_gold_balance:.3f}克</td>
                    <td class="right">{new_gold_balance:.3f}克</td>
                </tr>
            </tbody>
        </table>
        
        <!-- 敬告客户 -->
        <div class="notice">
            <span class="notice-title">【敬告客户】</span>
            我公司所售饰品均通过严格检测。为了保障您的利益，请将以上饰品送当地检测部门检测后再上柜销售。如发现成色不足由我公司负责免费调换；未经当地检测部门检测就直接上柜销售的饰品，如发生经济纠纷与我公司无关。
        </div>
        
        <!-- 签名区 -->
        <div class="signature-row">
            <span>制单人：{salesperson}</span>
            <span>复核人：{settlement.confirmed_by or ''}</span>
            <span>客户确认：</span>
        </div>
        
        <div class="page-num">第 1-1 页</div>
    </div>
    
    <button class="print-btn" onclick="window.print()">打印结算单</button>
</body>
</html>
"""
            return HTMLResponse(
                content=html_content,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式，请使用 pdf 或 html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成结算单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成结算单失败: {str(e)}")


@router.post("/orders/{settlement_id}/revert")
async def revert_settlement_order(
    settlement_id: int,
    user_role: str = Query(default="settlement", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    撤销结算单（重新结算）
    - 将结算单状态改回 pending
    - 删除已创建的应收账款记录
    - 保留原结算单号
    """
    # 权限检查：仅 settlement 和 manager 可以操作
    if user_role not in ["settlement", "manager"]:
        raise HTTPException(status_code=403, detail="权限不足：只有结算专员和管理层可以撤销结算单")
    
    # 查询结算单
    settlement = db.query(SettlementOrder).filter(SettlementOrder.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="结算单不存在")
    
    # 只能撤销已确认的结算单
    if settlement.status not in ["confirmed", "printed"]:
        raise HTTPException(status_code=400, detail=f"结算单状态为 {settlement.status}，无法撤销")
    
    try:
        # 1. 删除关联的应收账款记录
        from ..models.finance import AccountReceivable
        
        deleted_count = db.query(AccountReceivable).filter(
            AccountReceivable.sales_order_id == settlement.sales_order_id
        ).delete(synchronize_session=False)
        
        logger.info(f"撤销结算单 {settlement.settlement_no}：删除了 {deleted_count} 条应收账款记录")
        
        # 2. 将结算单状态改回 pending
        old_status = settlement.status
        settlement.status = "pending"
        settlement.confirmed_by = None
        settlement.confirmed_at = None
        
        # 3. 销售单状态改回待结算
        sales_order = db.query(SalesOrder).filter(SalesOrder.id == settlement.sales_order_id).first()
        if sales_order:
            sales_order.status = "待结算"
        
        db.commit()
        
        logger.info(f"结算单 {settlement.settlement_no} 撤销成功: {old_status} -> pending")
        
        return {
            "success": True,
            "message": f"结算单 {settlement.settlement_no} 已撤销，可以重新选择支付方式进行结算",
            "settlement_id": settlement.id,
            "settlement_no": settlement.settlement_no
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"撤销结算单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"撤销结算单失败: {str(e)}")

