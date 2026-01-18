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
    
    创建一笔完整的收款记录，然后FIFO方式更新应收账款余额
    """
    try:
        from ..models.finance import AccountReceivable, PaymentRecord
        from ..models import Customer
        from datetime import date, datetime
        from ..timezone_utils import china_now
        
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
        
        # 生成收款单号 SK + 时间戳
        now = china_now()
        payment_no = f"SK{now.strftime('%Y%m%d%H%M%S')}"
        
        # ========== 创建一笔完整的收款记录 ==========
        payment = PaymentRecord(
            payment_no=payment_no,
            account_receivable_id=None,  # 不关联具体应收账款
            customer_id=customer_id,
            payment_date=pay_date,
            amount=amount,  # 实际收款金额
            payment_method=payment_method,
            remark=remark or "收款登记",
            operator="财务"
        )
        db.add(payment)
        db.flush()
        
        # ========== FIFO方式更新应收账款余额 ==========
        unpaid_receivables = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer_id,
            AccountReceivable.status.in_(["unpaid", "overdue"]),
            AccountReceivable.unpaid_amount > 0
        ).order_by(AccountReceivable.credit_start_date.asc()).all()
        
        remaining_amount = amount
        offset_details = []  # 冲抵明细
        
        for receivable in unpaid_receivables:
            if remaining_amount <= 0:
                break
            
            # 计算本次可冲抵金额
            offset_amount = min(remaining_amount, receivable.unpaid_amount)
            
            # 更新应收账款
            receivable.received_amount += offset_amount
            receivable.unpaid_amount = receivable.total_amount - receivable.received_amount
            
            # 更新状态
            if receivable.unpaid_amount <= 0:
                receivable.status = "paid"
            
            offset_details.append({
                "receivable_id": receivable.id,
                "amount": offset_amount
            })
            
            remaining_amount -= offset_amount
        
        # 如果还有剩余金额（预收款），更新最新一笔应收账款的余额
        prepayment = 0
        if remaining_amount > 0:
            latest_receivable = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id
            ).order_by(AccountReceivable.credit_start_date.desc()).first()
            
            if latest_receivable:
                latest_receivable.received_amount += remaining_amount
                latest_receivable.unpaid_amount = latest_receivable.total_amount - latest_receivable.received_amount
                prepayment = remaining_amount
                logger.info(f"预收款: 客户={customer.name}, 金额={remaining_amount}")
        
        db.commit()
        db.refresh(payment)
        
        message = f"收款登记成功，收款单号：{payment_no}，金额：¥{amount:.2f}"
        if prepayment > 0:
            message += f"（含预收款¥{prepayment:.2f}）"
        
        logger.info(f"收款成功: 客户={customer.name}, 单号={payment_no}, 金额={amount}, 冲抵{len(offset_details)}笔应收账款")
        
        return ApiResponse(
            success=True,
            data={
                "payment_id": payment.id,
                "payment_no": payment_no,
                "total_paid": amount,
                "prepayment": prepayment,
                "offset_count": len(offset_details),
                "offset_details": offset_details,
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
    返回合并的往来账明细表
    """
    try:
        service = FinanceService(db)
        statement = await service.generate_statement(statement_data)
        
        # 解析明细数据
        sales_details = json.loads(statement.sales_details) if statement.sales_details else []
        payment_details = json.loads(statement.payment_details) if statement.payment_details else []
        
        # 获取合并的往来明细（如果存在）
        transactions = getattr(statement, '_transactions', [])
        opening_gold = getattr(statement, '_opening_gold', 0.0)
        closing_gold = getattr(statement, '_closing_gold', 0.0)
        total_gold = getattr(statement, '_total_gold', 0.0)
        total_cash = getattr(statement, '_total_cash', 0.0)
        
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
                    "openingGold": round(opening_gold, 3),
                    "totalSales": statement.period_sales_amount,
                    "totalPayments": statement.period_payment_amount,
                    "totalGold": round(total_gold, 3),
                    "totalCash": round(total_cash, 2),
                    "closingBalance": statement.closing_balance,
                    "closingGold": round(closing_gold, 3)
                },
                "transactions": transactions,  # 合并的往来明细
                "salesDetails": sales_details,  # 保持向后兼容
                "paymentDetails": payment_details,  # 保持向后兼容
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


@router.options("/statement/excel")
async def export_statement_excel_options():
    """处理CORS预检请求"""
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "3600",
        }
    )


@router.post("/statement/excel")
async def export_statement_excel(
    customer_id: int = Query(..., description="客户ID"),
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    导出对账单为 Excel 文件
    """
    from fastapi.responses import StreamingResponse
    from io import BytesIO
    from datetime import datetime
    
    try:
        import openpyxl
        from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        return ApiResponse(success=False, error="服务器未安装 openpyxl 库")
    
    try:
        from ..models import Customer, SalesOrder, SettlementOrder
        from ..models.finance import GoldReceipt, PaymentRecord
        
        # 验证客户
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return ApiResponse(success=False, error="客户不存在")
        
        # 解析日期
        period_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        period_end = datetime.strptime(end_date, "%Y-%m-%d").date()
        
        # ========== 获取往来明细 ==========
        transactions = []
        
        # 1. 销售结算记录
        settlements = db.query(SettlementOrder).join(SalesOrder).filter(
            SalesOrder.customer_id == customer_id,
            SettlementOrder.status.in_(['confirmed', 'printed']),
            SettlementOrder.created_at >= datetime.combine(period_start, datetime.min.time()),
            SettlementOrder.created_at <= datetime.combine(period_end, datetime.max.time())
        ).all()
        
        for s in settlements:
            gold_amount = 0.0
            cash_amount = 0.0
            if s.payment_method == 'physical_gold':
                gold_amount = s.physical_gold_weight or 0.0
            elif s.payment_method == 'cash_price':
                cash_amount = s.total_amount or 0.0
            elif s.payment_method == 'mixed':
                gold_amount = s.gold_payment_weight or 0.0
                cash_amount = s.cash_payment_weight or 0.0
            
            remark_parts = []
            if s.sales_order and s.sales_order.salesperson:
                remark_parts.append(s.sales_order.salesperson)
            if s.sales_order and s.sales_order.store_code:
                remark_parts.append(s.sales_order.store_code)
            
            transactions.append({
                "date": s.created_at.strftime("%Y-%m-%d") if s.created_at else "",
                "type": "销售结算",
                "order_no": s.settlement_no,
                "gold_amount": round(gold_amount, 3),
                "cash_amount": round(cash_amount, 2),
                "remark": ' '.join(remark_parts)
            })
        
        # 2. 客户来料记录
        receipts = db.query(GoldReceipt).filter(
            GoldReceipt.customer_id == customer_id,
            GoldReceipt.status == 'received',
            GoldReceipt.created_at >= datetime.combine(period_start, datetime.min.time()),
            GoldReceipt.created_at <= datetime.combine(period_end, datetime.max.time())
        ).all()
        
        for r in receipts:
            transactions.append({
                "date": r.received_at.strftime("%Y-%m-%d") if r.received_at else (r.created_at.strftime("%Y-%m-%d") if r.created_at else ""),
                "type": "客户来料",
                "order_no": r.receipt_no or "",
                "gold_amount": round(-(r.gold_weight or 0), 3),
                "cash_amount": 0.0,
                "remark": r.gold_fineness or ""
            })
        
        # 3. 客户来款记录
        payments = db.query(PaymentRecord).filter(
            PaymentRecord.customer_id == customer_id,
            PaymentRecord.payment_date >= period_start,
            PaymentRecord.payment_date <= period_end
        ).all()
        
        for p in payments:
            payment_method_label = {
                'bank_transfer': '银行转账',
                'cash': '现金',
                'wechat': '微信',
                'alipay': '支付宝',
                'card': '刷卡'
            }.get(p.payment_method, p.payment_method or "")
            
            transactions.append({
                "date": p.payment_date.strftime("%Y-%m-%d") if p.payment_date else "",
                "type": "客户来款",
                "order_no": p.payment_no or f"SK{p.id}",
                "gold_amount": 0.0,
                "cash_amount": round(-(p.amount or 0), 2),
                "remark": payment_method_label
            })
        
        # 按日期排序
        transactions.sort(key=lambda x: x.get("date") or "0000-00-00")
        
        # 计算合计
        total_gold = sum(t["gold_amount"] for t in transactions)
        total_cash = sum(t["cash_amount"] for t in transactions)
        
        # ========== 创建 Excel ==========
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "客户往来账明细表"
        
        # 样式
        header_font = Font(bold=True, size=16, color="006400")
        title_font = Font(bold=True, size=11)
        header_fill = PatternFill(start_color="E0E0E0", end_color="E0E0E0", fill_type="solid")
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        center_align = Alignment(horizontal='center', vertical='center')
        right_align = Alignment(horizontal='right', vertical='center')
        
        # 标题
        ws.merge_cells('A1:G1')
        ws['A1'] = "客户往来账明细表"
        ws['A1'].font = header_font
        ws['A1'].alignment = center_align
        
        # 信息行
        ws['A3'] = f"统计日期：{start_date} 到 {end_date}"
        ws['E3'] = f"打印日期：{datetime.now().strftime('%Y-%m-%d %H:%M')}"
        ws['A4'] = f"往来客户：{customer.name}"
        ws['E4'] = f"客户编号：{customer.customer_no or ''}"
        
        # 表头
        headers = ['序号', '发生日期', '往来类型', '往来单号', '足金', '欠款金额', '单据备注']
        col_widths = [8, 12, 12, 20, 12, 15, 25]
        
        for col, (header, width) in enumerate(zip(headers, col_widths), 1):
            cell = ws.cell(row=6, column=col, value=header)
            cell.font = title_font
            cell.fill = header_fill
            cell.border = thin_border
            cell.alignment = center_align
            ws.column_dimensions[get_column_letter(col)].width = width
        
        # 数据行
        row = 7
        for i, tx in enumerate(transactions, 1):
            ws.cell(row=row, column=1, value=i).border = thin_border
            ws.cell(row=row, column=2, value=tx["date"]).border = thin_border
            ws.cell(row=row, column=3, value=tx["type"]).border = thin_border
            ws.cell(row=row, column=4, value=tx["order_no"]).border = thin_border
            
            gold_cell = ws.cell(row=row, column=5, value=tx["gold_amount"] if tx["gold_amount"] != 0 else "")
            gold_cell.border = thin_border
            gold_cell.alignment = right_align
            if tx["gold_amount"] < 0:
                gold_cell.font = Font(color="0000FF")
            elif tx["gold_amount"] > 0:
                gold_cell.font = Font(color="FF8C00")
            
            cash_cell = ws.cell(row=row, column=6, value=tx["cash_amount"] if tx["cash_amount"] != 0 else "")
            cash_cell.border = thin_border
            cash_cell.alignment = right_align
            if tx["cash_amount"] < 0:
                cash_cell.font = Font(color="008000")
            elif tx["cash_amount"] > 0:
                cash_cell.font = Font(color="FF0000")
            
            ws.cell(row=row, column=7, value=tx["remark"]).border = thin_border
            row += 1
        
        # 合计行
        ws.cell(row=row, column=1, value="合计").border = thin_border
        ws.cell(row=row, column=2, value="").border = thin_border
        ws.cell(row=row, column=3, value="").border = thin_border
        ws.cell(row=row, column=4, value="").border = thin_border
        ws.cell(row=row, column=5, value=round(total_gold, 3)).border = thin_border
        ws.cell(row=row, column=6, value=round(total_cash, 2)).border = thin_border
        ws.cell(row=row, column=7, value="").border = thin_border
        
        for col in range(1, 8):
            ws.cell(row=row, column=col).font = title_font
            ws.cell(row=row, column=col).fill = header_fill
        
        # 保存到内存
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        
        filename = f"客户往来账_{customer.name}_{start_date}_{end_date}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Expose-Headers": "Content-Disposition",
            }
        )
        
    except Exception as e:
        logger.error(f"导出Excel失败: {e}", exc_info=True)
        return ApiResponse(success=False, error=f"导出失败: {str(e)}")


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



