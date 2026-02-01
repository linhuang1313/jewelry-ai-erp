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
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
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
async def export_customer_transactions(customer_id: int, db: Session = Depends(get_db)):
    """导出指定客户的往来账目为 Excel"""
    from ..models.finance import GoldReceipt
    from sqlalchemy import desc
    
    try:
        # 获取客户信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="客户不存在")
        
        transactions_list = []
        
        # 1. 销售记录
        try:
            sales_orders = db.query(SalesOrder).filter(
                SalesOrder.customer_name == customer.name,
                SalesOrder.status != "已取消"
            ).order_by(desc(SalesOrder.create_time)).limit(50).all()
            
            for order in sales_orders:
                transactions_list.append({
                    "type": "销售",
                    "order_no": order.order_no or "",
                    "description": "工费",
                    "amount": -(order.total_labor_cost or 0),
                    "gold_weight": 0,
                    "created_at": order.create_time
                })
        except Exception as e:
            logger.warning(f"查询销售记录时出错: {e}")
            sales_orders = []
        
        # 2. 收料记录
        try:
            gold_receipts = db.query(GoldReceipt).filter(
                GoldReceipt.customer_id == customer_id,
                GoldReceipt.status == 'received'
            ).order_by(desc(GoldReceipt.received_at)).limit(50).all()
            
            for receipt in gold_receipts:
                transactions_list.append({
                    "type": "客户来料",
                    "order_no": receipt.receipt_no or "",
                    "description": "收料",
                    "amount": 0,
                    "gold_weight": receipt.gold_weight or 0,
                    "created_at": receipt.received_at or receipt.created_at
                })
        except Exception as e:
            logger.warning(f"查询收料记录时出错: {e}")
        
        # 3. 结算记录
        try:
            from ..models import SettlementOrder
            for order in sales_orders[:20]:
                settlements = db.query(SettlementOrder).filter(
                    SettlementOrder.sales_order_id == order.id,
                    SettlementOrder.status.in_(['confirmed', 'printed'])
                ).all()
                for s in settlements:
                    if s.payment_method == 'cash_price':
                        method_desc = f"结价 ¥{s.gold_price or 0}/克"
                        gold_change = 0
                        amount_change = -(s.total_amount or 0)
                    elif s.payment_method == 'physical_gold':
                        method_desc = f"结料 {s.physical_gold_weight or 0}克"
                        gold_change = -(s.physical_gold_weight or 0)
                        amount_change = 0
                    else:
                        method_desc = "混合支付"
                        gold_change = -(s.gold_payment_weight or 0)
                        cash_amount = (s.cash_payment_weight or 0) * (s.gold_price or 0)
                        amount_change = -cash_amount
                    
                    transactions_list.append({
                        "type": "结算",
                        "order_no": s.settlement_no or "",
                        "description": method_desc,
                        "amount": amount_change,
                        "gold_weight": gold_change,
                        "created_at": s.created_at
                    })
        except Exception as e:
            logger.warning(f"查询结算记录时出错: {e}")
        
        # 按时间排序（使用安全的排序方式）
        def safe_sort_key(x):
            created = x.get("created_at")
            if created is None:
                return datetime.min
            if isinstance(created, datetime):
                return created
            return datetime.min
        
        transactions_list.sort(key=safe_sort_key, reverse=True)
        
        # 创建 Excel
        wb = Workbook()
        ws = wb.active
        # 工作表名称限制31字符，去除特殊字符
        safe_name = customer.name[:15].replace("/", "-").replace("\\", "-").replace("*", "").replace("?", "").replace("[", "").replace("]", "")
        ws.title = f"{safe_name}往来账目"
        
        # 客户信息
        ws.append([f"客户：{customer.name}"])
        ws.append([f"客户编号：{customer.customer_no}"])
        ws.append([f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"])
        ws.append([])  # 空行
        
        # 表头
        headers = ["类型", "单号", "说明", "金额(元)", "金重(克)", "时间"]
        ws.append(headers)
        style_header(ws, row=5)
        
        # 数据
        for tx in transactions_list:
            # 安全格式化时间
            created_at = tx.get("created_at")
            if created_at:
                try:
                    if hasattr(created_at, 'strftime'):
                        time_str = created_at.strftime("%Y-%m-%d %H:%M:%S")
                    else:
                        time_str = str(created_at)
                except:
                    time_str = str(created_at) if created_at else ""
            else:
                time_str = ""
            
            ws.append([
                tx.get("type", ""),
                tx.get("order_no", ""),
                tx.get("description", ""),
                tx.get("amount") if tx.get("amount") else "",
                tx.get("gold_weight") if tx.get("gold_weight") else "",
                time_str
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

