"""
财务对账模块 - API路由
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from ..database import get_db
from ..services.finance_service import FinanceService
from ..models import SalesOrder
from ..schemas.finance import (
    AccountReceivableResponse,
    PaymentRecordCreate,
    PaymentRecordResponse,
    ReminderRecordCreate,
    ReminderRecordResponse,
    ReconciliationStatementCreate,
    ReconciliationStatementResponse,
    ReconciliationSalesDetail,
    ReconciliationPaymentDetail,
    FinanceStatistics,
    ApiResponse,
    ReceivableListResponse,
    StatisticsResponse,
    CustomerReference,
    SalesOrderReference,
)
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/finance", tags=["财务对账"])


@router.get("/receivables", response_model=ReceivableListResponse)
async def get_receivables(
    filter_type: str = Query("all", description="筛选类型: all/unpaid/overdue/due_this_month"),
    search: Optional[str] = Query(None, description="搜索客户名称"),
    sort_by: str = Query("overdue_days", description="排序字段: amount/overdue_days/due_date"),
    sort_order: str = Query("desc", description="排序方向: asc/desc"),
    start_date: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    sales_order_no: Optional[str] = Query(None, description="销售单号"),
    settlement_no: Optional[str] = Query(None, description="结算单号"),
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(100, ge=1, le=1000, description="返回记录数"),
    db: Session = Depends(get_db)
):
    """
    获取应收账款列表
    
    - **filter_type**: 筛选类型
        - all: 全部
        - unpaid: 未付清
        - overdue: 已逾期
        - due_this_month: 本月到期
    - **search**: 按客户名称搜索
    - **sort_by**: 排序字段 (amount/overdue_days/due_date)
    - **sort_order**: 排序方向 (asc/desc)
    - **start_date**: 开始日期 (按销售日期筛选)
    - **end_date**: 结束日期 (按销售日期筛选)
    - **sales_order_no**: 销售单号
    - **settlement_no**: 结算单号
    """
    try:
        service = FinanceService(db)
        receivables = await service.get_receivables(
            filter_type=filter_type,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
            start_date=start_date,
            end_date=end_date,
            sales_order_no=sales_order_no,
            settlement_no=settlement_no,
            skip=skip,
            limit=limit
        )
        total = await service.get_receivable_count(filter_type)
        
        # 转换为响应格式
        response_data = []
        for r in receivables:
            customer_ref = None
            if r.customer:
                customer_ref = CustomerReference(
                    id=r.customer.id,
                    customer_no=r.customer.customer_no,
                    name=r.customer.name,
                    phone=r.customer.phone,
                    wechat=r.customer.wechat
                )
            
            sales_order_ref = None
            if r.sales_order:
                sales_order_ref = SalesOrderReference(
                    id=r.sales_order.id,
                    order_no=r.sales_order.order_no,
                    order_date=r.sales_order.order_date,
                    salesperson=r.sales_order.salesperson,
                    store_code=r.sales_order.store_code,
                    total_amount=r.sales_order.total_labor_cost
                )
            
            response_data.append(AccountReceivableResponse(
                id=r.id,
                sales_order_id=r.sales_order_id,
                customer_id=r.customer_id,
                total_amount=r.total_amount,
                received_amount=r.received_amount,
                unpaid_amount=r.unpaid_amount,
                credit_days=r.credit_days,
                credit_start_date=r.credit_start_date,
                due_date=r.due_date,
                overdue_days=r.overdue_days,
                status=r.status,
                is_overdue=r.is_overdue,
                salesperson=r.salesperson,
                store_code=r.store_code,
                contract_no=r.contract_no,
                invoice_no=r.invoice_no,
                expected_payment_date=r.expected_payment_date,
                remark=r.remark,
                create_time=r.create_time,
                update_time=r.update_time,
                operator=r.operator,
                last_updater=r.last_updater,
                customer=customer_ref,
                sales_order=sales_order_ref
            ))
        
        return ReceivableListResponse(
            success=True,
            data=response_data,
            total=total
        )
        
    except Exception as e:
        logger.error(f"获取应收账款列表失败: {e}", exc_info=True)
        return ReceivableListResponse(
            success=False,
            data=[],
            total=0,
            error=str(e)
        )


@router.post("/payment", response_model=ApiResponse)
async def record_payment(
    payment_data: PaymentRecordCreate,
    db: Session = Depends(get_db)
):
    """
    记录收款
    
    在事务中处理，自动更新应收账款状态
    """
    try:
        service = FinanceService(db)
        payment = await service.record_payment(payment_data)
        
        return ApiResponse(
            success=True,
            data={
                "payment_id": payment.id,
                "amount": payment.amount,
                "message": "收款记录成功"
            },
            message="收款记录成功"
        )
        
    except ValueError as e:
        logger.warning(f"收款验证失败: {e}")
        return ApiResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(f"记录收款失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=f"记录收款失败: {str(e)}"
        )


@router.post("/payment/chat", response_model=ApiResponse)
async def record_payment_from_chat(
    customer_id: int,
    amount: float,
    payment_method: str = "bank_transfer",
    payment_date: str = None,
    remark: str = "",
    db: Session = Depends(get_db)
):
    """
    从聊天界面登记收款
    
    自动查找客户最旧的未付清应收账款进行冲抵
    """
    try:
        from ..models.finance import AccountReceivable, PaymentRecord
        from ..models import Customer
        from datetime import date, datetime
        
        # 验证客户存在
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return ApiResponse(
                success=False,
                error=f"客户不存在: ID={customer_id}"
            )
        
        # 解析日期
        if payment_date:
            try:
                pay_date = datetime.strptime(payment_date, "%Y-%m-%d").date()
            except:
                pay_date = date.today()
        else:
            pay_date = date.today()
        
        # 查找客户所有应收账款（按日期升序，先冲抵最旧的）
        # 包括未付清的和已付清的（用于记录预收款）
        unpaid_receivables = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer_id,
            AccountReceivable.status.in_(["unpaid", "overdue"]),
            AccountReceivable.unpaid_amount > 0
        ).order_by(AccountReceivable.credit_start_date.asc()).all()
        
        # 获取最新的一笔应收账款记录（用于记录预收款）
        latest_receivable = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer_id
        ).order_by(AccountReceivable.credit_start_date.desc()).first()
        
        # 如果客户没有任何应收账款记录，创建一个用于记录预收款
        if not latest_receivable and not unpaid_receivables:
            latest_receivable = AccountReceivable(
                customer_id=customer_id,
                sales_order_id=None,
                total_amount=0,
                received_amount=0,
                unpaid_amount=0,
                credit_start_date=pay_date,
                due_date=pay_date,
                status="paid"
            )
            db.add(latest_receivable)
            db.flush()
        
        remaining_amount = amount
        created_payments = []
        
        # FIFO方式冲抵未付清的应收账款
        for receivable in unpaid_receivables:
            if remaining_amount <= 0:
                break
            
            # 计算本次可冲抵金额
            pay_amount = min(remaining_amount, receivable.unpaid_amount)
            
            # 创建收款记录
            payment = PaymentRecord(
                account_receivable_id=receivable.id,
                customer_id=customer_id,
                payment_date=pay_date,
                amount=pay_amount,
                payment_method=payment_method,
                remark=remark or f"聊天收款登记",
                operator="财务"
            )
            db.add(payment)
            
            # 更新应收账款
            receivable.received_amount += pay_amount
            receivable.unpaid_amount = receivable.total_amount - receivable.received_amount
            
            # 更新状态
            if receivable.unpaid_amount <= 0:
                receivable.status = "paid"
            
            created_payments.append({
                "receivable_id": receivable.id,
                "amount": pay_amount
            })
            
            remaining_amount -= pay_amount
        
        # 如果还有剩余金额（超额收款/预收款），记录在最新的应收账款中
        if remaining_amount > 0 and latest_receivable:
            # 创建预收款记录
            payment = PaymentRecord(
                account_receivable_id=latest_receivable.id,
                customer_id=customer_id,
                payment_date=pay_date,
                amount=remaining_amount,
                payment_method=payment_method,
                remark=(remark or "聊天收款登记") + " (预收款)",
                operator="财务"
            )
            db.add(payment)
            
            # 更新应收账款（余额变为负数表示预收款）
            latest_receivable.received_amount += remaining_amount
            latest_receivable.unpaid_amount = latest_receivable.total_amount - latest_receivable.received_amount
            # 状态保持为 paid，但余额为负数
            if latest_receivable.status != "paid":
                latest_receivable.status = "paid"
            
            created_payments.append({
                "receivable_id": latest_receivable.id,
                "amount": remaining_amount,
                "is_prepayment": True
            })
            
            logger.info(f"预收款记录: 客户={customer.name}, 金额={remaining_amount}")
            remaining_amount = 0
        
        db.commit()
        
        total_paid = amount
        prepayment = sum(p.get("amount", 0) for p in created_payments if p.get("is_prepayment"))
        
        message = f"收款登记成功，共冲抵{len([p for p in created_payments if not p.get('is_prepayment')])}笔应收账款"
        if prepayment > 0:
            message += f"，预收款¥{prepayment:.2f}"
        message += f"，合计¥{total_paid:.2f}"
        
        logger.info(f"聊天收款成功: 客户={customer.name}, 金额={total_paid}, 冲抵记录数={len(created_payments)}")
        
        return ApiResponse(
            success=True,
            data={
                "payment_count": len(created_payments),
                "total_paid": total_paid,
                "remaining": 0,
                "prepayment": prepayment,
                "payments": created_payments,
                "message": message
            },
            message="收款登记成功"
        )
        
    except Exception as e:
        db.rollback()
        logger.error(f"聊天收款失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=f"收款登记失败: {str(e)}"
        )


@router.post("/reminder", response_model=ApiResponse)
async def record_reminder(
    reminder_data: ReminderRecordCreate,
    db: Session = Depends(get_db)
):
    """
    记录催款
    """
    try:
        service = FinanceService(db)
        reminder = await service.record_reminder(reminder_data)
        
        return ApiResponse(
            success=True,
            data={
                "reminder_id": reminder.id,
                "message": "催款记录成功"
            },
            message="催款记录成功"
        )
        
    except ValueError as e:
        logger.warning(f"催款验证失败: {e}")
        return ApiResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(f"记录催款失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=f"记录催款失败: {str(e)}"
        )


@router.post("/statement", response_model=ApiResponse)
async def generate_statement(
    statement_data: ReconciliationStatementCreate,
    db: Session = Depends(get_db)
):
    """
    生成对账单
    
    自动计算期初欠款、本期销售、本期收款、期末欠款
    """
    try:
        service = FinanceService(db)
        statement = await service.generate_statement(statement_data)
        
        # 解析明细数据
        sales_details = json.loads(statement.sales_details) if statement.sales_details else []
        payment_details = json.loads(statement.payment_details) if statement.payment_details else []
        
        # 获取客户信息
        customer_ref = None
        if statement.customer:
            customer_ref = {
                "id": statement.customer.id,
                "customer_no": statement.customer.customer_no,
                "name": statement.customer.name,
                "phone": statement.customer.phone
            }
        
        return ApiResponse(
            success=True,
            data={
                "statement_no": statement.statement_no,
                "customer": customer_ref,
                "period": {
                    "start": statement.period_start_date.isoformat(),
                    "end": statement.period_end_date.isoformat()
                },
                "summary": {
                    "openingBalance": statement.opening_balance,
                    "totalSales": statement.period_sales_amount,
                    "totalPayments": statement.period_payment_amount,
                    "closingBalance": statement.closing_balance
                },
                "salesDetails": sales_details,
                "paymentDetails": payment_details,
                "generatedAt": statement.create_time.isoformat()
            },
            message="对账单生成成功"
        )
        
    except ValueError as e:
        logger.warning(f"生成对账单验证失败: {e}")
        return ApiResponse(
            success=False,
            error=str(e)
        )
    except Exception as e:
        logger.error(f"生成对账单失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=f"生成对账单失败: {str(e)}"
        )


@router.get("/statistics", response_model=StatisticsResponse)
async def get_statistics(db: Session = Depends(get_db)):
    """
    获取财务统计
    
    返回:
    - 总应收账款
    - 本月回款
    - 逾期金额
    - 逾期客户数
    - 环比变化百分比
    """
    try:
        service = FinanceService(db)
        statistics = await service.get_statistics()
        
        return StatisticsResponse(
            success=True,
            data=statistics
        )
        
    except Exception as e:
        logger.error(f"获取财务统计失败: {e}", exc_info=True)
        return StatisticsResponse(
            success=False,
            error=str(e)
        )


@router.get("/receivables/{receivable_id}", response_model=ApiResponse)
async def get_receivable_detail(
    receivable_id: int,
    db: Session = Depends(get_db)
):
    """
    获取应收账款详情
    """
    try:
        from ..models.finance import AccountReceivable
        
        receivable = db.query(AccountReceivable).filter(
            AccountReceivable.id == receivable_id
        ).first()
        
        if not receivable:
            return ApiResponse(
                success=False,
                error=f"应收账款不存在: {receivable_id}"
            )
        
        customer_ref = None
        if receivable.customer:
            customer_ref = {
                "id": receivable.customer.id,
                "customer_no": receivable.customer.customer_no,
                "name": receivable.customer.name,
                "phone": receivable.customer.phone
            }
        
        sales_order_ref = None
        if receivable.sales_order:
            sales_order_ref = {
                "id": receivable.sales_order.id,
                "order_no": receivable.sales_order.order_no,
                "order_date": receivable.sales_order.order_date.isoformat(),
                "salesperson": receivable.sales_order.salesperson,
                "total_amount": receivable.sales_order.total_labor_cost
            }
        
        return ApiResponse(
            success=True,
            data={
                "id": receivable.id,
                "sales_order_id": receivable.sales_order_id,
                "customer_id": receivable.customer_id,
                "total_amount": receivable.total_amount,
                "received_amount": receivable.received_amount,
                "unpaid_amount": receivable.unpaid_amount,
                "credit_days": receivable.credit_days,
                "credit_start_date": receivable.credit_start_date.isoformat(),
                "due_date": receivable.due_date.isoformat(),
                "overdue_days": receivable.overdue_days,
                "status": receivable.status,
                "is_overdue": receivable.is_overdue,
                "salesperson": receivable.salesperson,
                "store_code": receivable.store_code,
                "customer": customer_ref,
                "sales_order": sales_order_ref
            }
        )
        
    except Exception as e:
        logger.error(f"获取应收账款详情失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=str(e)
        )


@router.get("/payments", response_model=ApiResponse)
async def get_payment_records(
    customer_id: Optional[int] = Query(None, description="客户ID"),
    receivable_id: Optional[int] = Query(None, description="应收账款ID"),
    start_date: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    sales_order_no: Optional[str] = Query(None, description="销售单号"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """
    获取收款记录列表
    
    - **start_date**: 开始日期 (按收款日期筛选)
    - **end_date**: 结束日期 (按收款日期筛选)
    - **sales_order_no**: 销售单号
    """
    try:
        from ..models.finance import PaymentRecord, AccountReceivable
        from datetime import datetime
        
        query = db.query(PaymentRecord)
        
        if customer_id:
            query = query.filter(PaymentRecord.customer_id == customer_id)
        if receivable_id:
            query = query.filter(PaymentRecord.account_receivable_id == receivable_id)
        
        # 时间范围筛选（按收款日期）
        if start_date:
            try:
                start = datetime.strptime(start_date, "%Y-%m-%d").date()
                query = query.filter(PaymentRecord.payment_date >= start)
            except ValueError:
                pass
        
        if end_date:
            try:
                end = datetime.strptime(end_date, "%Y-%m-%d").date()
                query = query.filter(PaymentRecord.payment_date <= end)
            except ValueError:
                pass
        
        # 销售单号筛选（需要联表）
        if sales_order_no:
            query = query.join(
                AccountReceivable, 
                PaymentRecord.account_receivable_id == AccountReceivable.id
            ).join(
                SalesOrder,
                AccountReceivable.sales_order_id == SalesOrder.id
            ).filter(SalesOrder.order_no.contains(sales_order_no))
        
        payments = query.order_by(PaymentRecord.payment_date.desc()).offset(skip).limit(limit).all()
        
        data = []
        for p in payments:
            customer_ref = None
            if p.customer:
                customer_ref = {
                    "id": p.customer.id,
                    "customer_no": p.customer.customer_no,
                    "name": p.customer.name
                }
            
            data.append({
                "id": p.id,
                "account_receivable_id": p.account_receivable_id,
                "customer_id": p.customer_id,
                "payment_date": p.payment_date.isoformat(),
                "amount": p.amount,
                "payment_method": p.payment_method,
                "voucher_images": p.voucher_images,
                "bank_name": p.bank_name,
                "remark": p.remark,
                "operator": p.operator,
                "create_time": p.create_time.isoformat(),
                "customer": customer_ref
            })
        
        return ApiResponse(
            success=True,
            data={"records": data, "total": len(data)}
        )
        
    except Exception as e:
        logger.error(f"获取收款记录失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=str(e)
        )


@router.get("/reminders", response_model=ApiResponse)
async def get_reminder_records(
    customer_id: Optional[int] = Query(None, description="客户ID"),
    receivable_id: Optional[int] = Query(None, description="应收账款ID"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """
    获取催款记录列表
    """
    try:
        from ..models.finance import ReminderRecord
        
        query = db.query(ReminderRecord)
        
        if customer_id:
            query = query.filter(ReminderRecord.customer_id == customer_id)
        if receivable_id:
            query = query.filter(ReminderRecord.account_receivable_id == receivable_id)
        
        reminders = query.order_by(ReminderRecord.reminder_date.desc()).offset(skip).limit(limit).all()
        
        data = []
        for r in reminders:
            customer_ref = None
            if r.customer:
                customer_ref = {
                    "id": r.customer.id,
                    "customer_no": r.customer.customer_no,
                    "name": r.customer.name
                }
            
            data.append({
                "id": r.id,
                "account_receivable_id": r.account_receivable_id,
                "customer_id": r.customer_id,
                "reminder_date": r.reminder_date.isoformat(),
                "reminder_person": r.reminder_person,
                "reminder_method": r.reminder_method,
                "reminder_content": r.reminder_content,
                "customer_feedback": r.customer_feedback,
                "promised_payment_date": r.promised_payment_date.isoformat() if r.promised_payment_date else None,
                "status": r.status,
                "create_time": r.create_time.isoformat(),
                "customer": customer_ref
            })
        
        return ApiResponse(
            success=True,
            data={"records": data, "total": len(data)}
        )
        
    except Exception as e:
        logger.error(f"获取催款记录失败: {e}", exc_info=True)
        return ApiResponse(
            success=False,
            error=str(e)
        )



