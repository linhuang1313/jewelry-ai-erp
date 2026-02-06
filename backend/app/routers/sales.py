"""
销售单管理路由
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging
import io

from ..database import get_db
from ..models import SalesOrder, SalesDetail, Customer, Inventory, ProductCode, LocationInventory, Location, OrderStatusLog
from ..schemas import SalesOrderCreate, SalesOrderResponse, SalesDetailResponse

from ..timezone_utils import china_now

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sales", tags=["销售单管理"])


@router.post("/orders")
async def create_sales_order(order_data: SalesOrderCreate, db: Session = Depends(get_db)):
    """创建销售单"""
    try:
        # ==================== 数据验证 ====================
        # 验证商品明细数据
        for item in order_data.items:
            if item.weight <= 0:
                return {
                    "success": False,
                    "message": f"商品 {item.product_name} 的重量必须大于0",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "weight",
                        "value": item.weight
                    }
                }
            if item.labor_cost < 0:
                return {
                    "success": False,
                    "message": f"商品 {item.product_name} 的工费不能为负数",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "labor_cost",
                        "value": item.labor_cost
                    }
                }
        # ==================== 数据验证结束 ====================
        
        # ==================== 商品编码转换 ====================
        # 如果输入的是商品编码，自动转换为商品名称
        for item in order_data.items:
            product_name = item.product_name
            # 检查是否是商品编码（全大写或包含数字）
            if product_name and (product_name.isupper() or any(c.isdigit() for c in product_name)):
                code_record = db.query(ProductCode).filter(ProductCode.code == product_name).first()
                if code_record and code_record.name:
                    # 找到了对应的商品名称，更新 item
                    logger.info(f"商品编码转换: {product_name} -> {code_record.name}")
                    item.product_name = code_record.name
        # ==================== 商品编码转换结束 ====================
        
        # ==================== 库存检查 ====================
        # 在创建客户之前先检查库存，避免创建了客户但销售单创建失败
        inventory_errors = []
        for item in order_data.items:
            # 查询库存（精确匹配商品名称）
            inventory = db.query(Inventory).filter(
                Inventory.product_name == item.product_name
            ).first()
            
            if not inventory:
                # 商品不存在于库存中
                inventory_errors.append({
                    "product_name": item.product_name,
                    "error": "商品不存在于库存中",
                    "required_weight": item.weight,
                    "available_weight": 0.0
                })
            else:
                # 计算可用库存：总库存 - 待结算销售单占用的库存
                # 查询该商品在待结算销售单中的总重量
                reserved_weight = db.query(func.sum(SalesDetail.weight)).join(
                    SalesOrder
                ).filter(
                    SalesDetail.product_name == item.product_name,
                    SalesOrder.status == "draft"
                ).scalar() or 0.0
                
                available_weight = inventory.total_weight - reserved_weight
                
                if available_weight < item.weight:
                    # 库存不足（考虑待结算的销售单）
                    inventory_errors.append({
                        "product_name": item.product_name,
                        "error": "库存不足",
                        "required_weight": item.weight,
                        "available_weight": available_weight,
                        "total_weight": inventory.total_weight,
                        "reserved_weight": reserved_weight
                    })
        
        # 如果有任何商品库存不足，拒绝创建销售单
        if inventory_errors:
            return {
                "success": False,
                "message": "库存检查失败，无法创建销售单",
                "inventory_errors": inventory_errors
            }
        # ==================== 库存检查结束 ====================
        
        # 处理客户（在库存检查通过后）
        customer_id = order_data.customer_id
        customer_name = order_data.customer_name
        
        # 如果没有提供customer_id，尝试根据姓名查找
        if not customer_id:
            customer = db.query(Customer).filter(
                Customer.name == customer_name,
                Customer.status == "active"
            ).first()
            if customer:
                customer_id = customer.id
            else:
                # 客户不存在，自动创建
                customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_name,
                    customer_type="个人"
                )
                db.add(customer)
                db.flush()
                customer_id = customer.id
        
        # 计算总工费和总克重
        # 总工费 = (克重 × 克工费) + (件数 × 件工费)
        def calc_item_total(item):
            gram_cost = item.labor_cost * item.weight
            piece_cost = (item.piece_count or 0) * (item.piece_labor_cost or 0)
            return gram_cost + piece_cost
        
        total_labor_cost = sum(calc_item_total(item) for item in order_data.items)
        total_weight = sum(item.weight for item in order_data.items)
        
        # 生成销售单号（使用中国时间）
        order_no = f"XS{china_now().strftime('%Y%m%d%H%M%S')}"
        
        # 创建销售单
        sales_order = SalesOrder(
            order_no=order_no,
            order_date=order_data.order_date or datetime.now(),
            customer_id=customer_id,
            customer_name=customer_name,
            salesperson=order_data.salesperson,
            store_code=order_data.store_code,
            remark=order_data.remark,
            total_labor_cost=total_labor_cost,
            total_weight=total_weight,
            status="draft"
        )
        db.add(sales_order)
        db.flush()
        
        # 创建销售明细
        details = []
        for item in order_data.items:
            # 计算单项总工费：(克重 × 克工费) + (件数 × 件工费)
            gram_cost = item.labor_cost * item.weight
            piece_cost = (item.piece_count or 0) * (item.piece_labor_cost or 0)
            item_total_cost = gram_cost + piece_cost
            
            detail = SalesDetail(
                order_id=sales_order.id,
                product_name=item.product_name,
                weight=item.weight,
                labor_cost=item.labor_cost,
                piece_count=item.piece_count,
                piece_labor_cost=item.piece_labor_cost,
                total_labor_cost=item_total_cost
            )
            db.add(detail)
            details.append(detail)
        
        # 库存将在确认(confirm)时扣减，创建时不影响库存
        
        # 更新客户统计信息
        if customer_id:
            customer = db.query(Customer).filter(Customer.id == customer_id).first()
            if customer:
                customer.total_purchase_amount += total_labor_cost
                customer.total_purchase_count += 1
                customer.last_purchase_time = sales_order.order_date
        
        db.commit()
        db.refresh(sales_order)
        for detail in details:
            db.refresh(detail)
        
        # 构建响应
        order_response = SalesOrderResponse.model_validate(sales_order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "message": f"销售单创建成功：{order_no}",
            "order": order_response.model_dump(mode='json')
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"创建销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建销售单失败: {str(e)}"
        }


@router.get("/orders")
async def get_sales_orders(
    order_no: Optional[str] = Query(None, description="销售单号（模糊匹配）"),
    customer_name: Optional[str] = None,
    salesperson: Optional[str] = None,
    status: Optional[str] = Query(None, description="状态筛选：draft/confirmed/cancelled"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500, description="返回数量限制"),
    db: Session = Depends(get_db)
):
    """获取销售单列表（已优化：批量查询避免 N+1）"""
    from collections import defaultdict
    
    try:
        query = db.query(SalesOrder)
        
        if order_no:
            query = query.filter(SalesOrder.order_no.contains(order_no))
        if customer_name:
            query = query.filter(SalesOrder.customer_name.contains(customer_name))
        if salesperson:
            query = query.filter(SalesOrder.salesperson == salesperson)
        if status:
            query = query.filter(SalesOrder.status == status)
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                query = query.filter(SalesOrder.order_date >= start_dt)
            except:
                pass
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                query = query.filter(SalesOrder.order_date <= end_dt)
            except:
                pass
        
        orders = query.order_by(desc(SalesOrder.order_date)).limit(limit).all()
        
        if not orders:
            return {"success": True, "orders": []}
        
        # ========== 批量查询优化：避免 N+1 问题 ==========
        order_ids = [o.id for o in orders]
        
        # 批量查询所有销售明细（1 次查询）
        all_details = db.query(SalesDetail).filter(
            SalesDetail.order_id.in_(order_ids)
        ).all()
        
        # 构建映射字典
        details_map = defaultdict(list)
        for d in all_details:
            details_map[d.order_id].append(d)
        
        # 构建结果（使用预加载数据，无额外查询）
        # 直接构建字典，避免 Pydantic model_validate 的性能开销
        result = []
        for order in orders:
            details = details_map.get(order.id, [])
            order_dict = {
                "id": order.id,
                "order_no": order.order_no,
                "order_date": order.order_date.isoformat() if order.order_date else None,
                "customer_name": order.customer_name,
                "customer_id": order.customer_id,
                "salesperson": order.salesperson,
                "store_code": order.store_code,
                "total_weight": float(order.total_weight or 0),
                "total_labor_cost": float(order.total_labor_cost or 0),
                "remark": order.remark,
                "status": order.status,
                "create_time": order.create_time.isoformat() if order.create_time else None,
                "operator": order.operator,
                "details": [
                    {
                        "id": d.id,
                        "product_name": d.product_name,
                        "weight": float(d.weight or 0),
                        "labor_cost": float(d.labor_cost or 0),
                        "total_labor_cost": float(d.total_labor_cost or 0)
                    }
                    for d in details
                ]
            }
            result.append(order_dict)
        
        return {
            "success": True,
            "orders": result
        }
    except Exception as e:
        logger.error(f"查询销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询销售单失败: {str(e)}"
        }


@router.get("/orders/{order_id}")
async def get_sales_order(order_id: int, db: Session = Depends(get_db)):
    """获取销售单详情"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        
        if not order:
            return {
                "success": False,
                "message": "销售单不存在"
            }
        
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
        order_response = SalesOrderResponse.model_validate(order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "order": order_response.model_dump(mode='json')
        }
    except Exception as e:
        logger.error(f"查询销售单详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询销售单详情失败: {str(e)}"
        }


@router.options("/orders/{order_id}/download")
async def download_sales_order_options(order_id: int):
    """处理CORS预检请求"""
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/orders/{order_id}/download")
async def download_sales_order(
    order_id: int,
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印销售单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载销售单请求: order_id={order_id}, format={format}")
        
        # 查询销售单
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="销售单不存在")
        
        # 查询销售明细
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order_id).all()
        if not details:
            raise HTTPException(status_code=404, detail="销售单明细不存在")
        
        logger.info(f"找到销售单: order_no={order.order_no}, 明细数={len(details)}")
        
        # 时间格式化
        from ..timezone_utils import to_china_time, format_china_time
        if order.order_date:
            china_time = to_china_time(order.order_date)
            order_date_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
        else:
            order_date_str = "未知"
        
        if format == "pdf":
            try:
                import math
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                
                # ========== 动态高度计算（针式打印机 241mm x 140mm倍数） ==========
                PAGE_WIDTH = 241 * mm
                # 基础高度（页头页尾固定部分）+ 每行明细高度
                base_height = 80 * mm    # 页头页尾固定部分
                row_height = 9 * mm      # 每行明细高度
                detail_count = len(details)
                content_height = base_height + (row_height * detail_count)
                
                # 按140mm倍数向上取整（最小140mm）
                min_unit = 140 * mm
                PAGE_HEIGHT = max(min_unit, math.ceil(content_height / min_unit) * min_unit)
                # ========== 动态高度计算完成 ==========
                
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
                top_margin = height - 6 * mm
                
                # 标题（居中）
                if chinese_font:
                    p.setFont(chinese_font, 12)
                else:
                    p.setFont("Helvetica-Bold", 12)
                p.drawCentredString(width / 2, top_margin, "销售单")
                
                # 基本信息（紧凑两列布局）
                y = top_margin - 14
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica", 8)
                
                customer_name = (order.customer_name or '未知')[:10]
                salesperson = (order.salesperson or '未知')[:6]
                p.drawString(left_margin, y, f"单号：{order.order_no}")
                p.drawString(width/2, y, f"日期：{order_date_str}")
                y -= 10
                p.drawString(left_margin, y, f"客户：{customer_name}  业务员：{salesperson}")
                p.drawString(width/2, y, f"状态：{order.status}")
                y -= 12
                
                # 分隔线
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 商品明细表头
                col_x = [left_margin, 55*mm, 85*mm, 115*mm, 145*mm]
                if chinese_font:
                    p.setFont(chinese_font, 7)
                else:
                    p.setFont("Helvetica-Bold", 7)
                p.drawString(col_x[0], y, "商品名称")
                p.drawString(col_x[1], y, "克重(g)")
                p.drawString(col_x[2], y, "工费/克")
                p.drawString(col_x[3], y, "总工费")
                y -= 8
                p.line(left_margin, y, right_margin, y)
                y -= 8
                
                # 商品明细行
                for detail in details:
                    product_name = detail.product_name[:12] if len(detail.product_name) > 12 else detail.product_name
                    if chinese_font:
                        p.setFont(chinese_font, 7)
                    p.drawString(col_x[0], y, product_name)
                    p.setFont("Helvetica", 7)
                    p.drawString(col_x[1], y, f"{detail.weight:.2f}")
                    p.drawString(col_x[2], y, f"{detail.labor_cost:.1f}")
                    p.drawString(col_x[3], y, f"{detail.total_labor_cost:.2f}")
                    y -= 9
                
                y -= 3
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 汇总
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica-Bold", 8)
                p.drawString(left_margin, y, f"合计：总克重 {order.total_weight:.2f}g  |  总工费 ¥{order.total_labor_cost:.2f}")
                y -= 10
                
                # 备注
                if order.remark:
                    if chinese_font:
                        p.setFont(chinese_font, 7)
                    remark_text = order.remark[:30] if len(order.remark) > 30 else order.remark
                    p.drawString(left_margin, y, f"备注：{remark_text}")
                
                p.save()
                buffer.seek(0)
                
                filename = f"sales_order_{order.order_no}.pdf"
                return StreamingResponse(
                    buffer,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{filename}"',
                        "Access-Control-Allow-Origin": "*",
                    }
                )
            except Exception as pdf_error:
                logger.error(f"生成销售单PDF失败: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
        
        elif format == "html":
            # HTML 打印格式 - 针式打印机 241mm 宽度
            print_time = format_china_time(china_now(), '%Y/%m/%d %H:%M')
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>销售单 - {order.order_no}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Microsoft YaHei', 'SimHei', sans-serif; padding: 10px; background: #f5f5f5; font-size: 11px; }}
        .container {{ width: 241mm; min-height: 140mm; margin: 0 auto; background: white; padding: 6mm 8mm; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        .header {{ text-align: center; border-bottom: 1px solid #333; padding-bottom: 8px; margin-bottom: 10px; }}
        .header h1 {{ font-size: 16px; margin-bottom: 5px; }}
        .header-info {{ display: flex; justify-content: space-between; font-size: 10px; margin-top: 5px; }}
        .info-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px 15px; margin-bottom: 10px; font-size: 10px; }}
        .info-item label {{ color: #666; }}
        .info-item span {{ font-weight: 500; }}
        .details-table {{ width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }}
        .details-table th, .details-table td {{ border: 1px solid #999; padding: 4px 6px; }}
        .details-table th {{ background: #f0f0f0; font-weight: bold; text-align: center; }}
        .details-table td {{ text-align: center; }}
        .details-table td.left {{ text-align: left; }}
        .details-table td.right {{ text-align: right; }}
        .summary {{ display: flex; justify-content: flex-end; gap: 30px; margin: 10px 0; font-size: 11px; }}
        .summary .total {{ font-weight: bold; color: #c00; }}
        .remark {{ margin-top: 8px; padding: 6px 10px; background: #fffef0; border: 1px solid #e0d080; border-radius: 3px; font-size: 10px; }}
        .footer {{ margin-top: 15px; display: flex; justify-content: space-between; font-size: 10px; }}
        .signature {{ border-bottom: 1px solid #333; width: 100px; display: inline-block; margin-left: 5px; }}
        .print-btn {{ display: block; margin: 15px auto 0; padding: 8px 25px; background: #3498db; color: white; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; }}
        .print-btn:hover {{ background: #2980b9; }}
        @media print {{
            @page {{ size: 241mm auto; margin: 0; }}
            body {{ background: white; padding: 0; }}
            .container {{ box-shadow: none; width: 241mm; padding: 5mm 8mm; }}
            .print-btn {{ display: none; }}
        }}
        @media screen {{
            body {{ background: #f0f0f0; padding: 15px; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>销 售 单</h1>
            <div class="header-info">
                <span>单号：{order.order_no}</span>
                <span>日期：{order_date_str}</span>
                <span>状态：{order.status}</span>
            </div>
        </div>
        <div class="info-grid">
            <div class="info-item">
                <label>客户：</label>
                <span>{order.customer_name or '未知'}</span>
            </div>
            <div class="info-item">
                <label>业务员：</label>
                <span>{order.salesperson or '未知'}</span>
            </div>
        </div>
        <table class="details-table">
            <thead>
                <tr>
                    <th style="width:8%">序号</th>
                    <th style="width:35%">商品名称</th>
                    <th style="width:15%">克重(g)</th>
                    <th style="width:17%">工费(元/克)</th>
                    <th style="width:20%">总工费(元)</th>
                </tr>
            </thead>
            <tbody>
                {"".join(f'''
                <tr>
                    <td>{idx}</td>
                    <td class="left">{detail.product_name}</td>
                    <td class="right">{detail.weight:.2f}</td>
                    <td class="right">{detail.labor_cost:.2f}</td>
                    <td class="right">{detail.total_labor_cost:.2f}</td>
                </tr>
                ''' for idx, detail in enumerate(details, 1))}
                <tr style="font-weight: bold; background: #f8f8f8;">
                    <td colspan="2" class="left">合计：{len(details)} 件</td>
                    <td class="right">{order.total_weight:.2f}</td>
                    <td></td>
                    <td class="right" style="color: #c00;">¥{order.total_labor_cost:.2f}</td>
                </tr>
            </tbody>
        </table>
        {f'<div class="remark"><strong>备注：</strong>{order.remark}</div>' if order.remark else ''}
        <div class="footer">
            <span>制单人：{order.salesperson or ''}</span>
            <span>客户签字：<span class="signature"></span></span>
            <span>打印时间：{print_time}</span>
        </div>
    </div>
    <button class="print-btn" onclick="window.print()">打印销售单</button>
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
        logger.error(f"生成销售单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成销售单失败: {str(e)}")


@router.post("/orders/{order_id}/confirm")
async def confirm_sales_order(
    order_id: int,
    confirmed_by: str = Query(default="系统管理员", description="确认人"),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """确认销售单（库存生效）"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            return {"success": False, "message": "销售单不存在"}
        if order.status != "draft":
            return {"success": False, "message": f"销售单状态为 {order.status}，只有未确认的销售单才能确认"}
        
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order_id).all()
        if not details:
            return {"success": False, "message": "销售单没有商品明细"}
        
        # 验证库存
        for detail in details:
            inventory = db.query(Inventory).filter(Inventory.product_name == detail.product_name).first()
            if not inventory or inventory.total_weight < detail.weight:
                available = inventory.total_weight if inventory else 0
                return {"success": False, "message": f"库存不足：{detail.product_name} 仅有 {available:.2f}g，需要 {detail.weight}g"}
        
        # 扣减库存
        showroom_location = db.query(Location).filter(Location.location_type == "showroom", Location.is_active == 1).first()
        
        for detail in details:
            # 扣减总库存
            inventory = db.query(Inventory).filter(Inventory.product_name == detail.product_name).first()
            if inventory:
                inventory.total_weight = round(inventory.total_weight - detail.weight, 3)
            
            # 扣减展厅库存
            if showroom_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == detail.product_name,
                    LocationInventory.location_id == showroom_location.id
                ).first()
                if location_inv:
                    location_inv.weight -= detail.weight
        
        order.status = "confirmed"
        
        status_log = OrderStatusLog(order_type="sales", order_id=order_id, action="confirm", old_status="draft", new_status="confirmed", operated_by=confirmed_by)
        db.add(status_log)
        
        db.commit()
        logger.info(f"销售单已确认: {order.order_no}, 确认人: {confirmed_by}")
        
        return {"success": True, "message": f"销售单 {order.order_no} 已确认，库存已扣减"}
    
    except Exception as e:
        db.rollback()
        logger.error(f"确认销售单失败: {e}", exc_info=True)
        return {"success": False, "message": f"确认销售单失败: {str(e)}"}


@router.post("/orders/{order_id}/unconfirm")
async def unconfirm_sales_order(
    order_id: int,
    operated_by: str = Query(default="系统管理员", description="操作人"),
    user_role: str = Query(default="manager", description="用户角色"),
    remark: str = Query(default="", description="反确认原因"),
    db: Session = Depends(get_db)
):
    """反确认销售单（回滚库存）"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            return {"success": False, "message": "销售单不存在"}
        if order.status != "confirmed":
            return {"success": False, "message": f"销售单状态为 {order.status}，只有已确认的销售单才能反确认"}
        
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order_id).all()
        
        showroom_location = db.query(Location).filter(Location.location_type == "showroom", Location.is_active == 1).first()
        
        for detail in details:
            # 回滚总库存
            inventory = db.query(Inventory).filter(Inventory.product_name == detail.product_name).first()
            if inventory:
                inventory.total_weight = round(inventory.total_weight + detail.weight, 3)
            
            # 回滚展厅库存
            if showroom_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == detail.product_name,
                    LocationInventory.location_id == showroom_location.id
                ).first()
                if location_inv:
                    location_inv.weight += detail.weight
        
        order.status = "draft"
        
        status_log = OrderStatusLog(order_type="sales", order_id=order_id, action="unconfirm", old_status="confirmed", new_status="draft", operated_by=operated_by, remark=remark or None)
        db.add(status_log)
        
        db.commit()
        logger.info(f"销售单已反确认: {order.order_no}, 操作人: {operated_by}")
        
        return {"success": True, "message": f"销售单 {order.order_no} 已反确认，库存已回滚"}
    
    except Exception as e:
        db.rollback()
        logger.error(f"反确认销售单失败: {e}", exc_info=True)
        return {"success": False, "message": f"反确认销售单失败: {str(e)}"}


@router.post("/orders/{order_id}/cancel")
async def cancel_sales_order(order_id: int, db: Session = Depends(get_db)):
    """取消销售单（仅draft状态可直接取消，confirmed需先反确认）"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            return {"success": False, "message": "销售单不存在"}
        
        if order.status == "cancelled":
            return {"success": False, "message": "销售单已经是取消状态"}
        
        if order.status == "confirmed":
            return {"success": False, "message": "已确认的销售单请先反确认再取消"}
        
        if order.status != "draft":
            return {"success": False, "message": f"销售单状态为 {order.status}，无法取消"}
        
        # draft状态直接取消，无需回滚库存（创建时未扣减库存）
        order.status = "cancelled"
        
        # 更新客户统计信息（回滚）
        if order.customer_id:
            customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
            if customer:
                customer.total_purchase_amount -= order.total_labor_cost
                customer.total_purchase_count = max(0, customer.total_purchase_count - 1)
        
        status_log = OrderStatusLog(order_type="sales", order_id=order_id, action="cancel", old_status="draft", new_status="cancelled", operated_by="系统管理员")
        db.add(status_log)
        
        db.commit()
        
        logger.info(f"销售单已取消: {order.order_no}")
        
        return {"success": True, "message": f"销售单 {order.order_no} 已取消"}
    
    except Exception as e:
        db.rollback()
        logger.error(f"取消销售单失败: {e}", exc_info=True)
        return {"success": False, "message": f"取消销售单失败: {str(e)}"}


@router.put("/orders/{order_id}")
async def update_sales_order(
    order_id: int,
    updates: dict,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """编辑销售单（仅未确认状态可编辑）"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            return {"success": False, "message": "销售单不存在"}
        if order.status != "draft":
            return {"success": False, "message": "只有未确认的销售单才能编辑，请先反确认"}
        
        if "remark" in updates:
            order.remark = updates["remark"]
        if "salesperson" in updates:
            order.salesperson = updates["salesperson"]
        
        db.commit()
        return {"success": True, "message": "销售单已更新"}
    
    except Exception as e:
        db.rollback()
        logger.error(f"编辑销售单失败: {e}", exc_info=True)
        return {"success": False, "message": f"编辑销售单失败: {str(e)}"}

