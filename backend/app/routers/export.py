"""
数据导出路由
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from typing import Optional
import logging
import io
import zipfile

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from ..database import get_db
from ..models import (
    ChatLog, Inventory, InboundOrder, InboundDetail,
    SalesOrder, SalesDetail, Customer, Supplier
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/export", tags=["数据导出"])


def create_excel_response(wb: Workbook, filename: str):
    """创建 Excel 文件响应"""
    from urllib.parse import quote
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    # 对中文文件名进行 URL 编码
    encoded_filename = quote(filename, safe='')
    
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Access-Control-Allow-Origin": "*",
        }
    )


def style_header(ws, row=1):
    """为表头添加样式"""
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    
    for cell in ws[row]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment


def auto_column_width(ws):
    """自动调整列宽"""
    for column in ws.columns:
        max_length = 0
        column_letter = get_column_letter(column[0].column)
        for cell in column:
            try:
                if cell.value:
                    cell_length = len(str(cell.value))
                    if cell_length > max_length:
                        max_length = cell_length
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column_letter].width = adjusted_width


@router.get("/chat-logs")
async def export_chat_logs(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出对话日志为 Excel"""
    try:
        query = db.query(ChatLog).order_by(ChatLog.created_at.desc())
        
        if start_date:
            query = query.filter(func.date(ChatLog.created_at) >= start_date)
        if end_date:
            query = query.filter(func.date(ChatLog.created_at) <= end_date)
        
        logs = query.all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "对话日志"
        
        # 表头
        headers = ["ID", "会话ID", "用户角色", "消息类型", "内容", "意图", "响应时间(ms)", "是否成功", "创建时间"]
        ws.append(headers)
        style_header(ws)
        
        # 数据
        role_names = {"sales": "业务员", "finance": "财务", "product": "商品专员", "manager": "管理层"}
        for log in logs:
            ws.append([
                log.id,
                log.session_id,
                role_names.get(log.user_role, log.user_role),
                "用户" if log.message_type == "user" else "AI助手",
                log.content[:500] if log.content else "",
                log.intent or "",
                log.response_time_ms,
                "是" if log.is_successful else "否",
                log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else ""
            ])
        
        auto_column_width(ws)
        
        filename = f"对话日志_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出对话日志失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory")
async def export_inventory(db: Session = Depends(get_db)):
    """导出库存数据为 Excel"""
    try:
        inventories = db.query(Inventory).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "库存数据"
        
        headers = ["ID", "商品名称", "库存重量(克)", "最后更新时间"]
        ws.append(headers)
        style_header(ws)
        
        for inv in inventories:
            ws.append([
                inv.id,
                inv.product_name,
                inv.total_weight,
                inv.last_update.strftime("%Y-%m-%d %H:%M:%S") if inv.last_update else ""
            ])
        
        auto_column_width(ws)
        
        filename = f"库存数据_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出库存数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inbound")
async def export_inbound(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出入库记录为 Excel"""
    try:
        query = db.query(InboundOrder).order_by(InboundOrder.create_time.desc())
        
        if start_date:
            query = query.filter(func.date(InboundOrder.create_time) >= start_date)
        if end_date:
            query = query.filter(func.date(InboundOrder.create_time) <= end_date)
        
        orders = query.all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "入库记录"
        
        headers = ["入库单号", "商品名称", "重量(克)", "工费(元/克)", "总成本(元)", "供应商", "入库时间", "操作员"]
        ws.append(headers)
        style_header(ws)
        
        for order in orders:
            details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
            for detail in details:
                ws.append([
                    order.order_no,
                    detail.product_name,
                    detail.weight,
                    detail.labor_cost,
                    detail.total_cost,
                    detail.supplier or "",
                    order.create_time.strftime("%Y-%m-%d %H:%M:%S") if order.create_time else "",
                    order.operator or ""
                ])
        
        auto_column_width(ws)
        
        filename = f"入库记录_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出入库记录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sales")
async def export_sales(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出销售订单为 Excel"""
    try:
        query = db.query(SalesOrder).order_by(SalesOrder.order_date.desc())
        
        if start_date:
            query = query.filter(func.date(SalesOrder.order_date) >= start_date)
        if end_date:
            query = query.filter(func.date(SalesOrder.order_date) <= end_date)
        
        orders = query.all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "销售订单"
        
        headers = ["订单号", "客户名称", "商品名称", "重量(克)", "工费(元/克)", "总工费(元)", "业务员", "门店代码", "订单日期"]
        ws.append(headers)
        style_header(ws)
        
        for order in orders:
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
            for detail in details:
                ws.append([
                    order.order_no,
                    customer.name if customer else "",
                    detail.product_name,
                    detail.weight,
                    detail.labor_cost,
                    detail.total_labor_cost,
                    order.salesperson or "",
                    order.store_code or "",
                    order.order_date.strftime("%Y-%m-%d") if order.order_date else ""
                ])
        
        auto_column_width(ws)
        
        filename = f"销售订单_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出销售订单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customer-transactions/{customer_id}")
async def export_customer_transactions(
    customer_id: int, 
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出指定客户的往来账目为 Excel"""
    from ..models.finance import GoldReceipt
    from sqlalchemy import desc
    
    try:
        # 解析日期参数
        filter_start = None
        filter_end = None
        if date_start:
            try:
                filter_start = datetime.strptime(date_start, "%Y-%m-%d")
            except:
                pass
        if date_end:
            try:
                filter_end = datetime.strptime(date_end, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            except:
                pass
        
        # 获取客户信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="客户不存在")
        
        transactions_list = []
        
        # 1. 销售记录
        try:
            sales_query = db.query(SalesOrder).filter(
                SalesOrder.customer_name == customer.name,
                SalesOrder.status != "已取消"
            )
            if filter_start:
                sales_query = sales_query.filter(SalesOrder.create_time >= filter_start)
            if filter_end:
                sales_query = sales_query.filter(SalesOrder.create_time <= filter_end)
            sales_orders = sales_query.order_by(desc(SalesOrder.create_time)).limit(100).all()
            
            for order in sales_orders:
                transactions_list.append({
                    "type": "销售结算",
                    "order_no": order.order_no or "",
                    "description": "工费",
                    "amount": -(order.total_labor_cost or 0),
                    "gold_weight": 0,
                    "created_at": order.create_time,
                    "remark": order.remark or ""
                })
        except Exception as e:
            logger.warning(f"查询销售记录时出错: {e}")
            sales_orders = []
        
        # 2. 收料记录
        try:
            receipts_query = db.query(GoldReceipt).filter(
                GoldReceipt.customer_id == customer_id,
                GoldReceipt.status == 'received'
            )
            if filter_start:
                receipts_query = receipts_query.filter(GoldReceipt.received_at >= filter_start)
            if filter_end:
                receipts_query = receipts_query.filter(GoldReceipt.received_at <= filter_end)
            gold_receipts = receipts_query.order_by(desc(GoldReceipt.received_at)).limit(100).all()
            
            for receipt in gold_receipts:
                transactions_list.append({
                    "type": "客户来料",
                    "order_no": receipt.receipt_no or "",
                    "description": f"收料 {receipt.gold_weight or 0}克",
                    "amount": 0,
                    "gold_weight": receipt.gold_weight or 0,
                    "created_at": receipt.received_at or receipt.created_at,
                    "remark": receipt.remark or ""
                })
        except Exception as e:
            logger.warning(f"查询收料记录时出错: {e}")
        
        # 3. 结算记录
        try:
            from ..models import SettlementOrder
            for order in sales_orders[:50]:
                settlement_query = db.query(SettlementOrder).filter(
                    SettlementOrder.sales_order_id == order.id,
                    SettlementOrder.status.in_(['confirmed', 'printed'])
                )
                if filter_start:
                    settlement_query = settlement_query.filter(SettlementOrder.created_at >= filter_start)
                if filter_end:
                    settlement_query = settlement_query.filter(SettlementOrder.created_at <= filter_end)
                settlements = settlement_query.all()
                
                for s in settlements:
                    if s.payment_method == 'cash_price':
                        type_label = "欠料结价"
                        method_desc = f"结价 ¥{s.gold_price or 0}/克"
                        gold_change = 0
                        amount_change = -(s.total_amount or 0)
                    elif s.payment_method == 'physical_gold':
                        type_label = "欠料结料"
                        method_desc = f"结料 {s.physical_gold_weight or 0}克"
                        gold_change = -(s.physical_gold_weight or 0)
                        amount_change = 0
                    else:
                        type_label = "混合结算"
                        method_desc = f"结料{s.gold_payment_weight or 0}克+结价{s.cash_payment_weight or 0}克"
                        gold_change = -(s.gold_payment_weight or 0)
                        cash_amount = (s.cash_payment_weight or 0) * (s.gold_price or 0)
                        amount_change = -cash_amount
                    
                    transactions_list.append({
                        "type": type_label,
                        "order_no": s.settlement_no or "",
                        "description": method_desc,
                        "amount": amount_change,
                        "gold_weight": gold_change,
                        "created_at": s.created_at,
                        "remark": order.remark or ""
                    })
        except Exception as e:
            logger.warning(f"查询结算记录时出错: {e}")
        
        # 4. 收款记录
        try:
            from ..models import PaymentRecord
            payments_query = db.query(PaymentRecord).filter(
                PaymentRecord.customer_id == customer_id
            )
            if filter_start:
                payments_query = payments_query.filter(PaymentRecord.create_time >= filter_start)
            if filter_end:
                payments_query = payments_query.filter(PaymentRecord.create_time <= filter_end)
            payments = payments_query.order_by(desc(PaymentRecord.create_time)).limit(100).all()
            
            for p in payments:
                transactions_list.append({
                    "type": "客户来款",
                    "order_no": f"PY{p.id:06d}",
                    "description": f"收款 ¥{p.amount:.2f}",
                    "amount": p.amount or 0,
                    "gold_weight": 0,
                    "created_at": p.create_time,
                    "remark": p.remark or ""
                })
        except Exception as e:
            logger.warning(f"查询收款记录时出错: {e}")
        
        # 5. 提料记录
        try:
            from ..models.finance import CustomerWithdrawal
            withdrawals_query = db.query(CustomerWithdrawal).filter(
                CustomerWithdrawal.customer_id == customer_id,
                CustomerWithdrawal.status == 'completed'
            )
            if filter_start:
                withdrawals_query = withdrawals_query.filter(CustomerWithdrawal.completed_at >= filter_start)
            if filter_end:
                withdrawals_query = withdrawals_query.filter(CustomerWithdrawal.completed_at <= filter_end)
            withdrawals = withdrawals_query.order_by(desc(CustomerWithdrawal.completed_at)).limit(100).all()
            
            for w in withdrawals:
                transactions_list.append({
                    "type": "客户提料",
                    "order_no": w.withdrawal_no or "",
                    "description": f"提料 {w.gold_weight or 0}克",
                    "amount": 0,
                    "gold_weight": -(w.gold_weight or 0),
                    "created_at": w.completed_at or w.created_at,
                    "remark": w.remark or ""
                })
        except Exception as e:
            logger.warning(f"查询提料记录时出错: {e}")
        
        # 按时间排序（使用安全的排序方式）
        def safe_sort_key(x):
            created = x.get("created_at")
            if created is None:
                return datetime.min
            if isinstance(created, datetime):
                return created
            return datetime.min
        
        # 创建 Excel
        wb = Workbook()
        ws = wb.active
        # 工作表名称限制31字符，去除特殊字符
        safe_name = customer.name[:15].replace("/", "-").replace("\\", "-").replace("*", "").replace("?", "").replace("[", "").replace("]", "")
        ws.title = f"{safe_name}往来账目"
        
        # ===== 完整表头 =====
        # 第1行：公司名称
        ws.append(["深圳市梵贝琳珠宝有限公司"])
        ws.merge_cells('A1:G1')
        ws['A1'].font = Font(bold=True, size=16)
        ws['A1'].alignment = Alignment(horizontal='center')
        
        # 第2行：报表标题
        ws.append(["客户往来账明细表"])
        ws.merge_cells('A2:G2')
        ws['A2'].font = Font(bold=True, size=14)
        ws['A2'].alignment = Alignment(horizontal='center')
        
        # 第3行：日期范围
        date_range_text = "统计日期："
        if date_start and date_end:
            date_range_text += f"{date_start} 至 {date_end}"
        elif date_start:
            date_range_text += f"{date_start} 起"
        elif date_end:
            date_range_text += f"截至 {date_end}"
        else:
            date_range_text += "全部"
        ws.append([date_range_text])
        ws.merge_cells('A3:G3')
        ws['A3'].alignment = Alignment(horizontal='center')
        
        # 第4行：客户信息
        ws.append([f"往来客户：{customer.name}（{customer.customer_no}）"])
        ws.merge_cells('A4:G4')
        ws['A4'].alignment = Alignment(horizontal='center')
        
        # 第5行：导出时间
        ws.append([f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"])
        ws.merge_cells('A5:G5')
        ws['A5'].alignment = Alignment(horizontal='center')
        
        # 第6行：空行
        ws.append([])
        
        # 第7行：表头
        headers = ["序号", "发生日期", "往来类型", "往来单号", "足金(克)", "欠款金额(元)", "单据备注"]
        ws.append(headers)
        style_header(ws, row=7)
        
        # 数据（按时间正序排列，从早到晚）
        transactions_list.sort(key=safe_sort_key, reverse=False)
        
        for idx, tx in enumerate(transactions_list, 1):
            # 安全格式化时间（只显示日期）
            created_at = tx.get("created_at")
            if created_at:
                try:
                    if hasattr(created_at, 'strftime'):
                        time_str = created_at.strftime("%Y-%m-%d")
                    else:
                        time_str = str(created_at)[:10]
                except:
                    time_str = str(created_at)[:10] if created_at else ""
            else:
                time_str = ""
            
            # 金重和金额处理：0显示为空
            gold_weight = tx.get("gold_weight")
            if gold_weight == 0:
                gold_weight = ""
            amount = tx.get("amount")
            if amount == 0:
                amount = ""
            
            ws.append([
                idx,  # 序号
                time_str,  # 发生日期
                tx.get("type", ""),  # 往来类型
                tx.get("order_no", ""),  # 往来单号
                gold_weight,  # 足金(克)
                amount,  # 欠款金额(元)
                tx.get("remark", "")  # 单据备注
            ])
        
        auto_column_width(ws)
        
        filename = f"{customer.name}_往来账目_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        logger.error(f"导出客户往来账目失败: {e}\n{error_detail}")
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.get("/customers")
async def export_customers(db: Session = Depends(get_db)):
    """导出客户列表为 Excel"""
    try:
        customers = db.query(Customer).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "客户列表"
        
        headers = ["ID", "客户编号", "客户名称", "电话", "地址", "创建时间"]
        ws.append(headers)
        style_header(ws)
        
        for cust in customers:
            ws.append([
                cust.id,
                cust.customer_no,
                cust.name,
                cust.phone or "",
                cust.address or "",
                cust.create_time.strftime("%Y-%m-%d %H:%M:%S") if cust.create_time else ""
            ])
        
        auto_column_width(ws)
        
        filename = f"客户列表_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出客户列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suppliers")
async def export_suppliers(db: Session = Depends(get_db)):
    """导出供应商列表为 Excel"""
    try:
        suppliers = db.query(Supplier).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "供应商列表"
        
        headers = ["ID", "供应商编号", "供应商名称", "联系人", "电话", "地址", "总供货金额(元)", "总供货重量(克)", "供货次数", "最后供货时间", "状态"]
        ws.append(headers)
        style_header(ws)
        
        for sup in suppliers:
            ws.append([
                sup.id,
                sup.supplier_no,
                sup.name,
                sup.contact_person or "",
                sup.phone or "",
                sup.address or "",
                sup.total_supply_amount or 0,
                sup.total_supply_weight or 0,
                sup.total_supply_count or 0,
                sup.last_supply_time.strftime("%Y-%m-%d %H:%M:%S") if sup.last_supply_time else "",
                "活跃" if sup.status == "active" else "停用"
            ])
        
        auto_column_width(ws)
        
        filename = f"供应商列表_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出供应商列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all")
async def export_all_data(db: Session = Depends(get_db)):
    """一键导出全部数据为 ZIP 包"""
    try:
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # 1. 导出对话日志
            wb = Workbook()
            ws = wb.active
            ws.title = "对话日志"
            ws.append(["ID", "会话ID", "用户角色", "消息类型", "内容", "意图", "响应时间(ms)", "是否成功", "创建时间"])
            style_header(ws)
            role_names = {"sales": "业务员", "finance": "财务", "product": "商品专员", "manager": "管理层"}
            for log in db.query(ChatLog).order_by(ChatLog.created_at.desc()).all():
                ws.append([
                    log.id, log.session_id, role_names.get(log.user_role, log.user_role),
                    "用户" if log.message_type == "user" else "AI助手",
                    log.content[:500] if log.content else "", log.intent or "", log.response_time_ms,
                    "是" if log.is_successful else "否",
                    log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else ""
                ])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("对话日志.xlsx", excel_buffer.getvalue())
            
            # 2. 导出库存数据
            wb = Workbook()
            ws = wb.active
            ws.title = "库存数据"
            ws.append(["ID", "商品名称", "库存重量(克)", "最后更新时间"])
            style_header(ws)
            for inv in db.query(Inventory).all():
                ws.append([inv.id, inv.product_name, inv.total_weight,
                          inv.last_update.strftime("%Y-%m-%d %H:%M:%S") if inv.last_update else ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("库存数据.xlsx", excel_buffer.getvalue())
            
            # 3. 导出入库记录
            wb = Workbook()
            ws = wb.active
            ws.title = "入库记录"
            ws.append(["入库单号", "商品名称", "重量(克)", "工费(元/克)", "总成本(元)", "供应商", "入库时间", "操作员"])
            style_header(ws)
            for order in db.query(InboundOrder).all():
                for detail in db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all():
                    ws.append([order.order_no, detail.product_name, detail.weight, detail.labor_cost,
                              detail.total_cost, detail.supplier or "",
                              order.create_time.strftime("%Y-%m-%d %H:%M:%S") if order.create_time else "",
                              order.operator or ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("入库记录.xlsx", excel_buffer.getvalue())
            
            # 4. 导出销售订单
            wb = Workbook()
            ws = wb.active
            ws.title = "销售订单"
            ws.append(["订单号", "客户名称", "商品名称", "重量(克)", "工费(元/克)", "总工费(元)", "业务员", "门店代码", "订单日期"])
            style_header(ws)
            for order in db.query(SalesOrder).all():
                customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
                for detail in db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all():
                    ws.append([order.order_no, customer.name if customer else "", detail.product_name,
                              detail.weight, detail.labor_cost, detail.total_labor_cost,
                              order.salesperson or "", order.store_code or "",
                              order.order_date.strftime("%Y-%m-%d") if order.order_date else ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("销售订单.xlsx", excel_buffer.getvalue())
            
            # 5. 导出客户列表
            wb = Workbook()
            ws = wb.active
            ws.title = "客户列表"
            ws.append(["ID", "客户编号", "客户名称", "电话", "地址", "创建时间"])
            style_header(ws)
            for cust in db.query(Customer).all():
                ws.append([cust.id, cust.customer_no, cust.name, cust.phone or "", cust.address or "",
                          cust.create_time.strftime("%Y-%m-%d %H:%M:%S") if cust.create_time else ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("客户列表.xlsx", excel_buffer.getvalue())
            
            # 6. 导出供应商列表
            wb = Workbook()
            ws = wb.active
            ws.title = "供应商列表"
            ws.append(["ID", "供应商编号", "供应商名称", "联系人", "电话", "地址", "总供货金额(元)", "总供货重量(克)", "供货次数", "最后供货时间", "状态"])
            style_header(ws)
            for sup in db.query(Supplier).all():
                ws.append([sup.id, sup.supplier_no, sup.name, sup.contact_person or "", sup.phone or "",
                          sup.address or "", sup.total_supply_amount or 0, sup.total_supply_weight or 0,
                          sup.total_supply_count or 0,
                          sup.last_supply_time.strftime("%Y-%m-%d %H:%M:%S") if sup.last_supply_time else "",
                          "活跃" if sup.status == "active" else "停用"])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("供应商列表.xlsx", excel_buffer.getvalue())
        
        zip_buffer.seek(0)
        
        filename = f"珠宝ERP数据备份_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        return Response(
            content=zip_buffer.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Allow-Origin": "*",
            }
        )
        
    except Exception as e:
        logger.error(f"导出全部数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_export_stats(db: Session = Depends(get_db)):
    """获取可导出数据的统计信息"""
    try:
        return {
            "success": True,
            "data": {
                "chat_logs": db.query(func.count(ChatLog.id)).scalar() or 0,
                "inventory": db.query(func.count(Inventory.id)).scalar() or 0,
                "inbound_orders": db.query(func.count(InboundOrder.id)).scalar() or 0,
                "sales_orders": db.query(func.count(SalesOrder.id)).scalar() or 0,
                "customers": db.query(func.count(Customer.id)).scalar() or 0,
                "suppliers": db.query(func.count(Supplier.id)).scalar() or 0,
            }
        }
    except Exception as e:
        logger.error(f"获取导出统计失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}

