"""
暂借单管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
import logging

from ..database import get_db
from ..timezone_utils import china_now, to_china_time, format_china_time
from ..models import LoanOrder, LoanOrderLog, Inventory, LocationInventory, Location, Customer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/loan", tags=["暂借管理"])


# ============= Pydantic 模型 =============

class LoanOrderCreate(BaseModel):
    """创建暂借单请求"""
    customer_id: int  # 客户ID
    product_name: str
    weight: float
    labor_cost: float
    salesperson: str
    loan_date: datetime
    remark: Optional[str] = None
    created_by: Optional[str] = None


class LoanOrderConfirm(BaseModel):
    """确认借出请求"""
    operator: str


class LoanOrderReturn(BaseModel):
    """确认归还请求"""
    operator: str
    remark: Optional[str] = None


class LoanOrderCancel(BaseModel):
    """撤销暂借单请求"""
    operator: str
    reason: str  # 撤销原因（必填，用于留痕）


class LoanOrderResponse(BaseModel):
    """暂借单响应"""
    id: int
    loan_no: str
    customer_id: int
    customer_name: str
    product_name: str
    weight: float
    labor_cost: float
    total_labor_cost: float
    salesperson: str
    loan_date: datetime
    status: str
    created_by: Optional[str]
    created_at: datetime
    confirmed_at: Optional[datetime]
    returned_at: Optional[datetime]
    returned_by: Optional[str]
    cancelled_at: Optional[datetime]
    cancelled_by: Optional[str]
    cancel_reason: Optional[str]
    printed_at: Optional[datetime]
    remark: Optional[str]

    class Config:
        from_attributes = True


class LoanOrderLogResponse(BaseModel):
    """暂借单操作日志响应"""
    id: int
    loan_order_id: int
    action: str
    operator: str
    action_time: datetime
    old_status: Optional[str]
    new_status: str
    remark: Optional[str]

    class Config:
        from_attributes = True


# ============= 辅助函数 =============

def generate_loan_no(db: Session) -> str:
    """生成暂借单号：ZJ + 日期 + 4位序号"""
    today = china_now()
    date_str = today.strftime("%Y%m%d")
    prefix = f"ZJ{date_str}"
    
    # 查询今天最大的单号
    last_order = db.query(LoanOrder).filter(
        LoanOrder.loan_no.like(f"{prefix}%")
    ).order_by(LoanOrder.loan_no.desc()).first()
    
    if last_order:
        last_seq = int(last_order.loan_no[-4:])
        new_seq = last_seq + 1
    else:
        new_seq = 1
    
    return f"{prefix}{new_seq:04d}"


def create_log(db: Session, loan_order_id: int, action: str, operator: str, 
               old_status: Optional[str], new_status: str, remark: Optional[str] = None):
    """创建操作日志"""
    log = LoanOrderLog(
        loan_order_id=loan_order_id,
        action=action,
        operator=operator,
        action_time=china_now(),
        old_status=old_status,
        new_status=new_status,
        remark=remark
    )
    db.add(log)


def get_status_label(status: str) -> str:
    """获取状态的中文标签"""
    labels = {
        "pending": "待确认",
        "borrowed": "已借出",
        "returned": "已归还",
        "cancelled": "已撤销"
    }
    return labels.get(status, status)


# ============= 获取暂借单列表 =============

@router.get("/orders", response_model=List[LoanOrderResponse])
async def get_loan_orders(
    status: Optional[str] = Query(None, description="状态筛选: pending/borrowed/returned/cancelled"),
    customer_name: Optional[str] = Query(None, description="客户姓名搜索"),
    product_name: Optional[str] = Query(None, description="产品名称搜索"),
    db: Session = Depends(get_db)
):
    """获取暂借单列表"""
    query = db.query(LoanOrder)
    
    if status:
        query = query.filter(LoanOrder.status == status)
    if customer_name:
        query = query.filter(LoanOrder.customer_name.contains(customer_name))
    if product_name:
        query = query.filter(LoanOrder.product_name.contains(product_name))
    
    orders = query.order_by(LoanOrder.created_at.desc()).all()
    
    return [LoanOrderResponse.model_validate(order) for order in orders]


# ============= 创建暂借单 =============

@router.post("/orders", response_model=LoanOrderResponse)
async def create_loan_order(
    data: LoanOrderCreate,
    db: Session = Depends(get_db)
):
    """创建暂借单"""
    # 验证客户是否存在
    customer = db.query(Customer).filter(Customer.id == data.customer_id).first()
    if not customer:
        raise HTTPException(status_code=400, detail="客户不存在")
    
    # 验证克重和工费
    if data.weight <= 0:
        raise HTTPException(status_code=400, detail="克重必须大于0")
    if data.labor_cost < 0:
        raise HTTPException(status_code=400, detail="工费不能为负数")
    
    # 检查库存是否足够
    inventory = db.query(Inventory).filter(
        Inventory.product_name == data.product_name
    ).first()
    
    if not inventory or inventory.total_weight < data.weight:
        available = inventory.total_weight if inventory else 0
        raise HTTPException(
            status_code=400, 
            detail=f"库存不足：{data.product_name} 当前库存 {available:.2f}克，需要 {data.weight:.2f}克"
        )
    
    # 生成单号
    loan_no = generate_loan_no(db)
    
    # 计算总工费
    total_labor_cost = data.weight * data.labor_cost
    
    # 创建暂借单
    loan_order = LoanOrder(
        loan_no=loan_no,
        customer_id=data.customer_id,
        customer_name=customer.name,  # 自动从客户表获取姓名
        product_name=data.product_name,
        weight=data.weight,
        labor_cost=data.labor_cost,
        total_labor_cost=total_labor_cost,
        salesperson=data.salesperson,
        loan_date=data.loan_date,
        status="pending",
        created_by=data.created_by or "结算专员",
        created_at=china_now(),
        remark=data.remark
    )
    
    db.add(loan_order)
    db.flush()
    
    # 记录操作日志
    create_log(db, loan_order.id, "create", loan_order.created_by, None, "pending", "创建暂借单")
    
    db.commit()
    db.refresh(loan_order)
    
    logger.info(f"创建暂借单: {loan_no}, 客户: {customer.name}, 产品: {data.product_name}, 克重: {data.weight}")
    
    return LoanOrderResponse.model_validate(loan_order)


# ============= 获取暂借单详情 =============

@router.get("/orders/{loan_id}", response_model=LoanOrderResponse)
async def get_loan_order(
    loan_id: int,
    db: Session = Depends(get_db)
):
    """获取暂借单详情"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    return LoanOrderResponse.model_validate(loan_order)


# ============= 确认借出 =============

@router.post("/orders/{loan_id}/confirm", response_model=LoanOrderResponse)
async def confirm_loan_order(
    loan_id: int,
    data: LoanOrderConfirm,
    db: Session = Depends(get_db)
):
    """确认借出 - 扣减库存"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    if loan_order.status != "pending":
        raise HTTPException(status_code=400, detail=f"当前状态为 {get_status_label(loan_order.status)}，无法确认借出")
    
    # 检查库存是否足够
    inventory = db.query(Inventory).filter(
        Inventory.product_name == loan_order.product_name
    ).first()
    
    if not inventory or inventory.total_weight < loan_order.weight:
        available = inventory.total_weight if inventory else 0
        raise HTTPException(
            status_code=400, 
            detail=f"库存不足：当前库存 {available:.2f}克，需要 {loan_order.weight:.2f}克"
        )
    
    # 扣减总库存
    inventory.total_weight = round(inventory.total_weight - loan_order.weight, 3)
    inventory.last_update = china_now()
    
    # 扣减展厅库存（优先从展厅扣减）
    showroom_locations = db.query(Location).filter(
        Location.location_type == "showroom",
        Location.is_active == 1
    ).all()
    
    remaining_weight = loan_order.weight
    for location in showroom_locations:
        if remaining_weight <= 0:
            break
        
        loc_inv = db.query(LocationInventory).filter(
            LocationInventory.location_id == location.id,
            LocationInventory.product_name == loan_order.product_name
        ).first()
        
        if loc_inv and loc_inv.weight > 0:
            deduct = min(loc_inv.weight, remaining_weight)
            loc_inv.weight -= deduct
            loc_inv.last_update = china_now()
            remaining_weight -= deduct
    
    # 如果展厅库存不够，从仓库扣减
    if remaining_weight > 0:
        warehouse_locations = db.query(Location).filter(
            Location.location_type == "warehouse",
            Location.is_active == 1
        ).all()
        
        for location in warehouse_locations:
            if remaining_weight <= 0:
                break
            
            loc_inv = db.query(LocationInventory).filter(
                LocationInventory.location_id == location.id,
                LocationInventory.product_name == loan_order.product_name
            ).first()
            
            if loc_inv and loc_inv.weight > 0:
                deduct = min(loc_inv.weight, remaining_weight)
                loc_inv.weight -= deduct
                loc_inv.last_update = china_now()
                remaining_weight -= deduct
    
    # 更新暂借单状态
    old_status = loan_order.status
    loan_order.status = "borrowed"
    loan_order.confirmed_at = china_now()
    
    # 记录操作日志
    create_log(db, loan_order.id, "confirm", data.operator, old_status, "borrowed", 
               f"确认借出，扣减库存 {loan_order.weight:.2f}克")
    
    db.commit()
    db.refresh(loan_order)
    
    logger.info(f"确认借出暂借单: {loan_order.loan_no}, 扣减库存: {loan_order.weight}克")
    
    return LoanOrderResponse.model_validate(loan_order)


# ============= 确认归还 =============

@router.post("/orders/{loan_id}/return", response_model=LoanOrderResponse)
async def return_loan_order(
    loan_id: int,
    data: LoanOrderReturn,
    db: Session = Depends(get_db)
):
    """确认归还 - 恢复库存"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    if loan_order.status != "borrowed":
        raise HTTPException(status_code=400, detail=f"当前状态为 {get_status_label(loan_order.status)}，无法归还")
    
    # 恢复总库存
    inventory = db.query(Inventory).filter(
        Inventory.product_name == loan_order.product_name
    ).first()
    
    if inventory:
        inventory.total_weight = round(inventory.total_weight + loan_order.weight, 3)
        inventory.last_update = china_now()
    else:
        # 如果库存记录不存在，创建一个新的
        inventory = Inventory(
            product_name=loan_order.product_name,
            total_weight=loan_order.weight,
            last_update=china_now()
        )
        db.add(inventory)
    
    # 恢复到默认展厅库存
    default_showroom = db.query(Location).filter(
        Location.location_type == "showroom",
        Location.is_active == 1
    ).first()
    
    if default_showroom:
        loc_inv = db.query(LocationInventory).filter(
            LocationInventory.location_id == default_showroom.id,
            LocationInventory.product_name == loan_order.product_name
        ).first()
        
        if loc_inv:
            loc_inv.weight += loan_order.weight
            loc_inv.last_update = china_now()
        else:
            loc_inv = LocationInventory(
                location_id=default_showroom.id,
                product_name=loan_order.product_name,
                weight=loan_order.weight,
                last_update=china_now()
            )
            db.add(loc_inv)
    
    # 更新暂借单状态
    old_status = loan_order.status
    loan_order.status = "returned"
    loan_order.returned_at = china_now()
    loan_order.returned_by = data.operator
    
    # 记录操作日志
    create_log(db, loan_order.id, "return", data.operator, old_status, "returned", 
               data.remark or f"确认归还，恢复库存 {loan_order.weight:.2f}克")
    
    db.commit()
    db.refresh(loan_order)
    
    logger.info(f"确认归还暂借单: {loan_order.loan_no}, 恢复库存: {loan_order.weight}克")
    
    return LoanOrderResponse.model_validate(loan_order)


# ============= 撤销暂借单 =============

@router.post("/orders/{loan_id}/cancel", response_model=LoanOrderResponse)
async def cancel_loan_order(
    loan_id: int,
    data: LoanOrderCancel,
    db: Session = Depends(get_db)
):
    """撤销暂借单 - 如果已借出则恢复库存，记录撤销原因（留痕）"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    if loan_order.status in ["returned", "cancelled"]:
        raise HTTPException(status_code=400, detail=f"当前状态为 {get_status_label(loan_order.status)}，无法撤销")
    
    old_status = loan_order.status
    
    # 如果已借出，需要恢复库存
    if loan_order.status == "borrowed":
        # 恢复总库存
        inventory = db.query(Inventory).filter(
            Inventory.product_name == loan_order.product_name
        ).first()
        
        if inventory:
            inventory.total_weight = round(inventory.total_weight + loan_order.weight, 3)
            inventory.last_update = china_now()
        else:
            inventory = Inventory(
                product_name=loan_order.product_name,
                total_weight=loan_order.weight,
                last_update=china_now()
            )
            db.add(inventory)
        
        # 恢复到默认展厅库存
        default_showroom = db.query(Location).filter(
            Location.location_type == "showroom",
            Location.is_active == 1
        ).first()
        
        if default_showroom:
            loc_inv = db.query(LocationInventory).filter(
                LocationInventory.location_id == default_showroom.id,
                LocationInventory.product_name == loan_order.product_name
            ).first()
            
            if loc_inv:
                loc_inv.weight += loan_order.weight
                loc_inv.last_update = china_now()
            else:
                loc_inv = LocationInventory(
                    location_id=default_showroom.id,
                    product_name=loan_order.product_name,
                    weight=loan_order.weight,
                    last_update=china_now()
                )
                db.add(loc_inv)
        
        logger.info(f"撤销暂借单，恢复库存: {loan_order.loan_no}, {loan_order.weight}克")
    
    # 更新暂借单状态
    loan_order.status = "cancelled"
    loan_order.cancelled_at = china_now()
    loan_order.cancelled_by = data.operator
    loan_order.cancel_reason = data.reason  # 记录撤销原因（留痕）
    
    # 记录操作日志（详细留痕）
    log_remark = f"撤销原因：{data.reason}"
    if old_status == "borrowed":
        log_remark += f"，已恢复库存 {loan_order.weight:.2f}克"
    
    create_log(db, loan_order.id, "cancel", data.operator, old_status, "cancelled", log_remark)
    
    db.commit()
    db.refresh(loan_order)
    
    logger.info(f"撤销暂借单: {loan_order.loan_no}, 原因: {data.reason}")
    
    return LoanOrderResponse.model_validate(loan_order)


# ============= 获取操作日志 =============

@router.get("/orders/{loan_id}/logs", response_model=List[LoanOrderLogResponse])
async def get_loan_order_logs(
    loan_id: int,
    db: Session = Depends(get_db)
):
    """获取暂借单操作日志"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    logs = db.query(LoanOrderLog).filter(
        LoanOrderLog.loan_order_id == loan_id
    ).order_by(LoanOrderLog.action_time.desc()).all()
    
    return [LoanOrderLogResponse.model_validate(log) for log in logs]


# ============= 标记已打印 =============

@router.post("/orders/{loan_id}/print", response_model=LoanOrderResponse)
async def mark_loan_printed(
    loan_id: int,
    db: Session = Depends(get_db)
):
    """标记暂借单为已打印"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    loan_order.printed_at = china_now()
    
    db.commit()
    db.refresh(loan_order)
    
    logger.info(f"打印暂借单: {loan_order.loan_no}")
    
    return LoanOrderResponse.model_validate(loan_order)


# ============= 下载/打印暂借单 =============

@router.get("/orders/{loan_id}/download")
async def download_loan_order(
    loan_id: int,
    format: str = Query("html", pattern="^(html|pdf)$"),
    db: Session = Depends(get_db)
):
    """
    下载或打印暂借单
    - format=html: 网页打印格式
    - format=pdf: PDF下载格式
    - 纸张规格：241mm x 动态高度（140mm倍数，针式打印机）
    """
    import io
    import math
    from fastapi.responses import StreamingResponse
    
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    # 格式化日期
    loan_date_str = format_china_time(to_china_time(loan_order.loan_date), '%Y-%m-%d') if loan_order.loan_date else ""
    created_at_str = format_china_time(to_china_time(loan_order.created_at), '%Y-%m-%d %H:%M') if loan_order.created_at else ""
    print_time = format_china_time(china_now(), '%Y/%m/%d %H:%M')
    
    # 状态标签
    status_label = get_status_label(loan_order.status)
    
    # ========== PDF 格式 ==========
    if format == "pdf":
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.units import mm
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            
            # 针式打印机纸张尺寸：241mm x 140mm（最小高度）
            PAGE_WIDTH = 241 * mm
            # 动态高度计算：暂借单通常只有1行明细，固定使用140mm
            PAGE_HEIGHT = 140 * mm
            
            buffer = io.BytesIO()
            p = canvas.Canvas(buffer, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
            width, height = PAGE_WIDTH, PAGE_HEIGHT
            
            # 注册中文字体
            chinese_font = None
            try:
                pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                chinese_font = 'STSong-Light'
            except Exception as e:
                logger.warning(f"注册CID字体失败: {e}")
            
            # 页边距
            left_margin = 8 * mm
            right_margin = width - 8 * mm
            top_margin = height - 6 * mm
            
            # ===== 标题 =====
            if chinese_font:
                p.setFont(chinese_font, 14)
            else:
                p.setFont("Helvetica-Bold", 14)
            p.drawCentredString(width / 2, top_margin, "暂 借 单")
            
            # ===== 基本信息（紧凑两列布局） =====
            y = top_margin - 16
            if chinese_font:
                p.setFont(chinese_font, 9)
            else:
                p.setFont("Helvetica", 9)
            
            # 第一行
            p.drawString(left_margin, y, f"单号：{loan_order.loan_no}")
            p.drawString(width/2, y, f"日期：{loan_date_str}")
            y -= 12
            
            # 第二行
            p.drawString(left_margin, y, f"客户：{loan_order.customer_name}")
            p.drawString(width/2, y, f"业务员：{loan_order.salesperson}")
            y -= 12
            
            # 第三行
            p.drawString(left_margin, y, f"经办人：{loan_order.created_by or '-'}")
            p.drawString(width/2, y, f"状态：{status_label}")
            y -= 14
            
            # 分隔线
            p.line(left_margin, y, right_margin, y)
            y -= 12
            
            # ===== 产品信息表格 =====
            if chinese_font:
                p.setFont(chinese_font, 8)
            else:
                p.setFont("Helvetica-Bold", 8)
            
            # 表头
            col_widths = [70, 45, 45, 55]  # mm: 产品品类、克重、工费、工费小计
            col_x = [left_margin]
            for w in col_widths[:-1]:
                col_x.append(col_x[-1] + w * mm)
            
            headers = ["产品品类", "克重(克)", "工费(元/克)", "工费小计(元)"]
            for i, header in enumerate(headers):
                col_center = col_x[i] + (col_widths[i] * mm) / 2
                p.drawCentredString(col_center, y, header)
            
            y -= 4
            p.line(left_margin, y, left_margin + sum(col_widths) * mm, y)
            y -= 12
            
            # 数据行
            if chinese_font:
                p.setFont(chinese_font, 9)
            else:
                p.setFont("Helvetica", 9)
            
            product_name = loan_order.product_name[:18] if len(loan_order.product_name) > 18 else loan_order.product_name
            p.drawString(col_x[0] + 2, y, product_name)
            p.setFont("Helvetica", 9)
            p.drawCentredString(col_x[1] + col_widths[1] * mm / 2, y, f"{loan_order.weight:.2f}")
            p.drawCentredString(col_x[2] + col_widths[2] * mm / 2, y, f"{loan_order.labor_cost:.2f}")
            p.drawCentredString(col_x[3] + col_widths[3] * mm / 2, y, f"{loan_order.total_labor_cost:.2f}")
            
            y -= 4
            p.line(left_margin, y, left_margin + sum(col_widths) * mm, y)
            y -= 14
            
            # ===== 备注 =====
            if loan_order.remark:
                if chinese_font:
                    p.setFont(chinese_font, 8)
                remark_text = loan_order.remark[:50] if len(loan_order.remark) > 50 else loan_order.remark
                p.drawString(left_margin, y, f"备注：{remark_text}")
                y -= 12
            
            # ===== 签名区域 =====
            y -= 8
            if chinese_font:
                p.setFont(chinese_font, 8)
            p.drawString(left_margin, y, "经办人签字：____________")
            p.drawString(width/2, y, "日期：____年____月____日")
            
            # ===== 页脚 =====
            if chinese_font:
                p.setFont(chinese_font, 7)
            else:
                p.setFont("Helvetica", 7)
            p.drawString(left_margin, 5 * mm, f"打印时间：{print_time}")
            
            p.save()
            buffer.seek(0)
            
            filename = f"loan_order_{loan_order.loan_no}.pdf"
            return StreamingResponse(
                buffer,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Access-Control-Allow-Origin": "*",
                }
            )
        except Exception as pdf_error:
            logger.error(f"生成暂借单PDF失败: {pdf_error}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
    
    # ========== HTML 格式（针式打印机 241mm 宽度） ==========
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>暂借单 - {loan_order.loan_no}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ 
            font-family: "Microsoft YaHei", "SimHei", Arial, sans-serif; 
            font-size: 11px;
            color: #333;
        }}
        .page {{
            width: 241mm;
            min-height: 140mm;
            padding: 6mm 8mm;
            margin: 0 auto;
            background: white;
        }}
        .header {{
            text-align: center;
            margin-bottom: 10px;
            border-bottom: 1px solid #333;
            padding-bottom: 8px;
        }}
        .header h1 {{
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        .header-info {{
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            margin-top: 6px;
        }}
        .info-section {{
            margin-bottom: 10px;
        }}
        .info-section h3 {{
            font-size: 11px;
            border-bottom: 1px solid #999;
            padding-bottom: 3px;
            margin-bottom: 6px;
        }}
        .info-row {{
            display: flex;
            margin-bottom: 5px;
        }}
        .info-item {{
            flex: 1;
            display: flex;
        }}
        .info-label {{
            font-weight: bold;
            min-width: 70px;
        }}
        .info-value {{
            flex: 1;
        }}
        .product-table {{
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
        }}
        .product-table th, .product-table td {{
            border: 1px solid #999;
            padding: 5px;
            text-align: center;
            font-size: 10px;
        }}
        .product-table th {{
            background: #f0f0f0;
            font-weight: bold;
        }}
        .product-table .amount {{
            font-weight: bold;
            color: #c00;
        }}
        .signature-section {{
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px dashed #999;
            display: flex;
            justify-content: space-between;
        }}
        .signature-box {{
            text-align: center;
        }}
        .signature-line {{
            border-bottom: 1px solid #333;
            width: 120px;
            height: 25px;
            display: inline-block;
        }}
        .signature-label {{
            font-size: 9px;
        }}
        .status-badge {{
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: bold;
        }}
        .status-pending {{ background: #fff3cd; color: #856404; }}
        .status-borrowed {{ background: #cce5ff; color: #004085; }}
        .status-returned {{ background: #d4edda; color: #155724; }}
        .status-cancelled {{ background: #f8d7da; color: #721c24; }}
        .print-btn {{
            display: block;
            margin: 15px auto;
            padding: 8px 25px;
            background: #1a4d8c;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 12px;
            cursor: pointer;
        }}
        .print-btn:hover {{ background: #0d3a6a; }}
        .footer {{
            margin-top: 10px;
            text-align: center;
            font-size: 9px;
            color: #666;
        }}
        @media print {{
            @page {{ size: 241mm auto; margin: 0; }}
            body {{ background: white; }}
            .page {{ 
                width: 241mm;
                padding: 5mm 8mm;
                margin: 0;
            }}
            .print-btn {{ display: none; }}
        }}
        @media screen {{
            body {{ background: #f0f0f0; padding: 15px; }}
            .page {{ box-shadow: 0 0 10px rgba(0,0,0,0.1); }}
        }}
    </style>
</head>
<body>
    <div class="page">
        <div class="header">
            <h1>暂 借 单</h1>
            <div class="header-info">
                <span>单号：{loan_order.loan_no}</span>
                <span>日期：{loan_date_str}</span>
                <span>状态：<span class="status-badge status-{loan_order.status}">{status_label}</span></span>
            </div>
        </div>
        
        <div class="info-section">
            <div class="info-row">
                <div class="info-item">
                    <span class="info-label">客户姓名：</span>
                    <span class="info-value">{loan_order.customer_name}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">业务员：</span>
                    <span class="info-value">{loan_order.salesperson}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">经办人：</span>
                    <span class="info-value">{loan_order.created_by or '-'}</span>
                </div>
            </div>
        </div>
        
        <table class="product-table">
            <thead>
                <tr>
                    <th>产品品类</th>
                    <th>克重(克)</th>
                    <th>工费(元/克)</th>
                    <th>工费小计(元)</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{loan_order.product_name}</td>
                    <td>{loan_order.weight:.2f}</td>
                    <td>{loan_order.labor_cost:.2f}</td>
                    <td class="amount">{loan_order.total_labor_cost:.2f}</td>
                </tr>
            </tbody>
        </table>
        
        {f'<div class="info-section" style="font-size: 10px;"><strong>备注：</strong>{loan_order.remark}</div>' if loan_order.remark else ''}
        
        <div class="signature-section">
            <div class="signature-box">
                <div class="signature-line"></div>
                <div class="signature-label">经办人签字</div>
            </div>
            <div class="signature-box">
                <div class="signature-label">日期：____年____月____日</div>
            </div>
        </div>
        
        <div class="footer">打印时间：{print_time}</div>
    </div>
    
    <button class="print-btn" onclick="window.print()">打印暂借单</button>
</body>
</html>
"""
    
    return HTMLResponse(content=html_content)


# ============= 借货统计报表 =============

@router.get("/statistics")
async def get_loan_statistics(
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """获取借货统计报表（按时间范围）"""
    try:
        from datetime import datetime, timedelta
        from sqlalchemy import func, and_
        
        # 解析日期
        start_dt = datetime.strptime(start_date, '%Y-%m-%d')
        end_dt = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)  # 包含结束日期当天
        
        # 基础查询：指定时间范围内的所有暂借单
        base_query = db.query(LoanOrder).filter(
            LoanOrder.created_at >= start_dt,
            LoanOrder.created_at < end_dt
        )
        
        all_orders = base_query.all()
        
        # 汇总统计
        total_borrowed_count = len([o for o in all_orders if o.status in ['borrowed', 'returned']])
        total_returned_count = len([o for o in all_orders if o.status == 'returned'])
        outstanding_count = len([o for o in all_orders if o.status == 'borrowed'])
        cancelled_count = len([o for o in all_orders if o.status == 'cancelled'])
        pending_count = len([o for o in all_orders if o.status == 'pending'])
        
        total_borrowed_weight = sum(o.weight for o in all_orders if o.status in ['borrowed', 'returned'])
        total_returned_weight = sum(o.weight for o in all_orders if o.status == 'returned')
        outstanding_weight = sum(o.weight for o in all_orders if o.status == 'borrowed')
        
        total_borrowed_labor = sum(o.total_labor_cost for o in all_orders if o.status in ['borrowed', 'returned'])
        total_returned_labor = sum(o.total_labor_cost for o in all_orders if o.status == 'returned')
        outstanding_labor = sum(o.total_labor_cost for o in all_orders if o.status == 'borrowed')
        
        # 按天统计
        daily_breakdown = {}
        for order in all_orders:
            if order.status in ['borrowed', 'returned', 'pending']:
                date_key = order.created_at.strftime('%Y-%m-%d')
                if date_key not in daily_breakdown:
                    daily_breakdown[date_key] = {
                        'date': date_key,
                        'borrowed_count': 0,
                        'returned_count': 0,
                        'borrowed_weight': 0.0,
                        'returned_weight': 0.0,
                        'borrowed_labor': 0.0,
                        'returned_labor': 0.0
                    }
                
                if order.status in ['borrowed', 'returned']:
                    daily_breakdown[date_key]['borrowed_count'] += 1
                    daily_breakdown[date_key]['borrowed_weight'] += order.weight
                    daily_breakdown[date_key]['borrowed_labor'] += order.total_labor_cost
                
                if order.status == 'returned':
                    daily_breakdown[date_key]['returned_count'] += 1
                    daily_breakdown[date_key]['returned_weight'] += order.weight
                    daily_breakdown[date_key]['returned_labor'] += order.total_labor_cost
        
        # 转换为列表并排序
        daily_list = sorted(daily_breakdown.values(), key=lambda x: x['date'])
        
        return {
            "success": True,
            "data": {
                "period": {
                    "start_date": start_date,
                    "end_date": end_date
                },
                "summary": {
                    "total_borrowed_count": total_borrowed_count,
                    "total_returned_count": total_returned_count,
                    "outstanding_count": outstanding_count,
                    "pending_count": pending_count,
                    "cancelled_count": cancelled_count,
                    "total_borrowed_weight": round(total_borrowed_weight, 2),
                    "total_returned_weight": round(total_returned_weight, 2),
                    "outstanding_weight": round(outstanding_weight, 2),
                    "total_borrowed_labor": round(total_borrowed_labor, 2),
                    "total_returned_labor": round(total_returned_labor, 2),
                    "outstanding_labor": round(outstanding_labor, 2)
                },
                "daily_breakdown": daily_list
            }
        }
    except Exception as e:
        logger.error(f"获取借货统计失败: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/statistics/export")
async def export_loan_statistics(
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """导出借货统计报表（Excel格式）"""
    try:
        from datetime import datetime, timedelta
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
        import io
        
        # 获取统计数据
        stats_response = await get_loan_statistics(start_date, end_date, db)
        if not stats_response.get("success"):
            raise HTTPException(status_code=500, detail="获取统计数据失败")
        
        stats = stats_response["data"]
        summary = stats["summary"]
        daily_breakdown = stats["daily_breakdown"]
        
        # 创建Excel工作簿
        wb = Workbook()
        ws = wb.active
        ws.title = "借货统计报表"
        
        # 样式定义
        header_font = Font(bold=True, size=14)
        subheader_font = Font(bold=True, size=11)
        header_fill = PatternFill(start_color='CCCCCC', end_color='CCCCCC', fill_type='solid')
        center_align = Alignment(horizontal='center', vertical='center')
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        # 标题
        ws.merge_cells('A1:G1')
        ws['A1'] = f"借货统计报表 ({start_date} 至 {end_date})"
        ws['A1'].font = header_font
        ws['A1'].alignment = center_align
        
        # 汇总信息
        row = 3
        ws[f'A{row}'] = "汇总统计"
        ws[f'A{row}'].font = subheader_font
        row += 1
        
        summary_data = [
            ("借出笔数", summary["total_borrowed_count"], "笔"),
            ("归还笔数", summary["total_returned_count"], "笔"),
            ("未归还笔数", summary["outstanding_count"], "笔"),
            ("借出总克重", summary["total_borrowed_weight"], "克"),
            ("归还总克重", summary["total_returned_weight"], "克"),
            ("未归还克重", summary["outstanding_weight"], "克"),
            ("借出总工费", summary["total_borrowed_labor"], "元"),
            ("归还总工费", summary["total_returned_labor"], "元"),
            ("未归还工费", summary["outstanding_labor"], "元"),
        ]
        
        for item_name, item_value, item_unit in summary_data:
            ws[f'A{row}'] = item_name
            ws[f'B{row}'] = item_value
            ws[f'C{row}'] = item_unit
            row += 1
        
        # 每日明细标题
        row += 1
        ws[f'A{row}'] = "每日明细"
        ws[f'A{row}'].font = subheader_font
        row += 1
        
        # 表头
        headers = ["日期", "借出笔数", "归还笔数", "借出克重", "归还克重", "借出工费", "归还工费"]
        for col, header in enumerate(headers, start=1):
            cell = ws.cell(row=row, column=col, value=header)
            cell.font = Font(bold=True)
            cell.fill = header_fill
            cell.alignment = center_align
            cell.border = thin_border
        row += 1
        
        # 每日数据
        for day in daily_breakdown:
            ws.cell(row=row, column=1, value=day['date']).border = thin_border
            ws.cell(row=row, column=2, value=day['borrowed_count']).border = thin_border
            ws.cell(row=row, column=3, value=day['returned_count']).border = thin_border
            ws.cell(row=row, column=4, value=round(day['borrowed_weight'], 2)).border = thin_border
            ws.cell(row=row, column=5, value=round(day['returned_weight'], 2)).border = thin_border
            ws.cell(row=row, column=6, value=round(day['borrowed_labor'], 2)).border = thin_border
            ws.cell(row=row, column=7, value=round(day['returned_labor'], 2)).border = thin_border
            row += 1
        
        # 调整列宽
        ws.column_dimensions['A'].width = 15
        for col in ['B', 'C', 'D', 'E', 'F', 'G']:
            ws.column_dimensions[col].width = 12
        
        # 保存到缓冲区
        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        
        from fastapi.responses import Response
        filename = f"loan_statistics_{start_date}_{end_date}.xlsx"
        
        return Response(
            content=buffer.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出借货统计失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")
