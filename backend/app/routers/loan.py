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
from ..models import LoanOrder, LoanOrderLog, Inventory, LocationInventory, Location

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/loan", tags=["暂借管理"])


# ============= Pydantic 模型 =============

class LoanOrderCreate(BaseModel):
    """创建暂借单请求"""
    borrower_type: str  # customer/internal/supplier
    borrower_name: str
    borrower_contact: Optional[str] = None
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
    borrower_type: str
    borrower_name: str
    borrower_contact: Optional[str]
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


def get_borrower_type_label(borrower_type: str) -> str:
    """获取借出对象类型的中文标签"""
    labels = {
        "customer": "客户",
        "internal": "内部",
        "supplier": "供应商"
    }
    return labels.get(borrower_type, borrower_type)


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
    borrower_name: Optional[str] = Query(None, description="借出对象姓名搜索"),
    product_name: Optional[str] = Query(None, description="产品名称搜索"),
    db: Session = Depends(get_db)
):
    """获取暂借单列表"""
    query = db.query(LoanOrder)
    
    if status:
        query = query.filter(LoanOrder.status == status)
    if borrower_name:
        query = query.filter(LoanOrder.borrower_name.contains(borrower_name))
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
    # 验证借出对象类型
    if data.borrower_type not in ["customer", "internal", "supplier"]:
        raise HTTPException(status_code=400, detail="无效的借出对象类型")
    
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
        borrower_type=data.borrower_type,
        borrower_name=data.borrower_name,
        borrower_contact=data.borrower_contact,
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
    
    logger.info(f"创建暂借单: {loan_no}, 借出对象: {data.borrower_name}, 产品: {data.product_name}, 克重: {data.weight}")
    
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
    inventory.total_weight -= loan_order.weight
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
        inventory.total_weight += loan_order.weight
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
            inventory.total_weight += loan_order.weight
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
    format: str = Query("html", pattern="^(html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印暂借单（HTML格式）"""
    loan_order = db.query(LoanOrder).filter(LoanOrder.id == loan_id).first()
    
    if not loan_order:
        raise HTTPException(status_code=404, detail="暂借单不存在")
    
    # 格式化日期
    loan_date_str = format_china_time(to_china_time(loan_order.loan_date), '%Y-%m-%d') if loan_order.loan_date else ""
    created_at_str = format_china_time(to_china_time(loan_order.created_at), '%Y-%m-%d %H:%M') if loan_order.created_at else ""
    print_time = format_china_time(china_now(), '%Y/%m/%d %H:%M')
    
    # 借出对象类型标签
    borrower_type_label = get_borrower_type_label(loan_order.borrower_type)
    status_label = get_status_label(loan_order.status)
    
    # 生成 HTML
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
            font-size: 12px;
            color: #333;
        }}
        .page {{
            width: 210mm;
            min-height: 148mm;
            padding: 10mm 15mm;
            margin: 0 auto;
            background: white;
        }}
        .header {{
            text-align: center;
            margin-bottom: 15px;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
        }}
        .header h1 {{
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        .header-info {{
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-top: 10px;
        }}
        .info-section {{
            margin-bottom: 15px;
        }}
        .info-section h3 {{
            font-size: 13px;
            border-bottom: 1px solid #999;
            padding-bottom: 5px;
            margin-bottom: 10px;
        }}
        .info-row {{
            display: flex;
            margin-bottom: 8px;
        }}
        .info-item {{
            flex: 1;
            display: flex;
        }}
        .info-label {{
            font-weight: bold;
            min-width: 80px;
        }}
        .info-value {{
            flex: 1;
        }}
        .product-table {{
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
        }}
        .product-table th, .product-table td {{
            border: 1px solid #999;
            padding: 8px;
            text-align: center;
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
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px dashed #999;
        }}
        .signature-box {{
            display: inline-block;
            width: 200px;
            text-align: center;
        }}
        .signature-line {{
            border-bottom: 1px solid #333;
            height: 40px;
            margin-bottom: 5px;
        }}
        .signature-label {{
            font-size: 11px;
        }}
        .status-badge {{
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
        }}
        .status-pending {{ background: #fff3cd; color: #856404; }}
        .status-borrowed {{ background: #cce5ff; color: #004085; }}
        .status-returned {{ background: #d4edda; color: #155724; }}
        .status-cancelled {{ background: #f8d7da; color: #721c24; }}
        .print-btn {{
            display: block;
            margin: 20px auto;
            padding: 10px 30px;
            background: #1a4d8c;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 14px;
            cursor: pointer;
        }}
        .print-btn:hover {{ background: #0d3a6a; }}
        @media print {{
            body {{ background: white; }}
            .page {{ 
                width: 210mm;
                padding: 8mm 10mm;
                margin: 0;
            }}
            .print-btn {{ display: none; }}
        }}
        @media screen {{
            body {{ background: #f0f0f0; padding: 20px; }}
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
                <span>打印时间：{print_time}</span>
            </div>
        </div>
        
        <div class="info-section">
            <h3>借出对象信息</h3>
            <div class="info-row">
                <div class="info-item">
                    <span class="info-label">对象类型：</span>
                    <span class="info-value">{borrower_type_label}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">姓名：</span>
                    <span class="info-value">{loan_order.borrower_name}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">联系方式：</span>
                    <span class="info-value">{loan_order.borrower_contact or '-'}</span>
                </div>
            </div>
            <div class="info-row">
                <div class="info-item">
                    <span class="info-label">业务员：</span>
                    <span class="info-value">{loan_order.salesperson}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">经办人：</span>
                    <span class="info-value">{loan_order.created_by or '-'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">创建时间：</span>
                    <span class="info-value">{created_at_str}</span>
                </div>
            </div>
        </div>
        
        <div class="info-section">
            <h3>产品信息</h3>
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
        </div>
        
        {f'<div class="info-section"><h3>备注</h3><p>{loan_order.remark}</p></div>' if loan_order.remark else ''}
        
        <div class="signature-section">
            <div class="signature-box">
                <div class="signature-line"></div>
                <div class="signature-label">经办人（签字）</div>
                <div class="signature-label" style="margin-top: 5px;">日期：____年____月____日</div>
            </div>
        </div>
    </div>
    
    <button class="print-btn" onclick="window.print()">打印暂借单</button>
</body>
</html>
"""
    
    return HTMLResponse(content=html_content)
