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
from ..models import SalesOrder, SalesDetail, Customer, Inventory, ProductCode, LocationInventory, Location
from ..schemas import SalesOrderCreate, SalesOrderResponse, SalesDetailResponse

logger = logging.getLogger(__name__)

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)

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
                    SalesOrder.status == "待结算"
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
            status="待结算"
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
        
        # ==================== 规则A: 创建销售单时立即扣减库存 ====================
        # 获取展厅位置（销售从展厅发生）
        showroom_location = db.query(Location).filter(
            Location.location_type == "showroom",
            Location.is_active == 1
        ).first()
        
        for item in order_data.items:
            # 1. 扣减总库存 (Inventory 表)
            inventory = db.query(Inventory).filter(
                Inventory.product_name == item.product_name
            ).first()
            if inventory:
                inventory.total_weight -= item.weight
                logger.info(f"扣减总库存: {item.product_name} - {item.weight}克, 剩余: {inventory.total_weight}克")
            
            # 2. 扣减展厅库存 (LocationInventory 表)
            if showroom_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == item.product_name,
                    LocationInventory.location_id == showroom_location.id
                ).first()
                if location_inv:
                    location_inv.weight -= item.weight
                    logger.info(f"扣减展厅库存: {item.product_name} - {item.weight}克, 剩余: {location_inv.weight}克")
        # ==================== 库存扣减完成 ====================
        
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
    customer_name: Optional[str] = None,
    salesperson: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取销售单列表"""
    try:
        query = db.query(SalesOrder)
        
        if customer_name:
            query = query.filter(SalesOrder.customer_name.contains(customer_name))
        if salesperson:
            query = query.filter(SalesOrder.salesperson == salesperson)
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
        
        orders = query.order_by(desc(SalesOrder.order_date)).limit(100).all()
        
        # 加载明细
        result = []
        for order in orders:
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            order_response = SalesOrderResponse.model_validate(order)
            order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
            result.append(order_response.model_dump(mode='json'))
        
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
            # HTML 打印格式
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>销售单 - {order.order_no}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Microsoft YaHei', SimSun, sans-serif; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        .header {{ text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }}
        .header h1 {{ font-size: 24px; margin-bottom: 5px; }}
        .header .order-no {{ color: #666; font-size: 14px; }}
        .info-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }}
        .info-item {{ padding: 8px 0; }}
        .info-item label {{ color: #666; font-size: 12px; display: block; }}
        .info-item span {{ font-size: 14px; font-weight: 500; }}
        .details-table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
        .details-table th, .details-table td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
        .details-table th {{ background: #f8f8f8; font-weight: 500; }}
        .details-table td.number {{ text-align: right; }}
        .summary {{ background: #f9f9f9; padding: 15px; border-radius: 6px; margin-top: 20px; }}
        .summary-row {{ display: flex; justify-content: space-between; margin: 5px 0; }}
        .summary-row.total {{ font-size: 16px; font-weight: bold; color: #e74c3c; border-top: 1px solid #ddd; padding-top: 10px; margin-top: 10px; }}
        .remark {{ margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 6px; }}
        .print-btn {{ display: block; margin: 30px auto 0; padding: 12px 40px; background: #3498db; color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }}
        .print-btn:hover {{ background: #2980b9; }}
        @media print {{
            body {{ background: white; padding: 0; }}
            .container {{ box-shadow: none; max-width: 100%; }}
            .print-btn {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>销售单</h1>
            <div class="order-no">单号：{order.order_no}</div>
        </div>
        <div class="info-grid">
            <div class="info-item">
                <label>销售日期</label>
                <span>{order_date_str}</span>
            </div>
            <div class="info-item">
                <label>客户名称</label>
                <span>{order.customer_name or '未知'}</span>
            </div>
            <div class="info-item">
                <label>业务员</label>
                <span>{order.salesperson or '未知'}</span>
            </div>
            <div class="info-item">
                <label>订单状态</label>
                <span>{order.status}</span>
            </div>
        </div>
        <table class="details-table">
            <thead>
                <tr>
                    <th>序号</th>
                    <th>商品名称</th>
                    <th>克重(g)</th>
                    <th>工费(元/克)</th>
                    <th>总工费(元)</th>
                </tr>
            </thead>
            <tbody>
                {"".join(f'''
                <tr>
                    <td>{idx}</td>
                    <td>{detail.product_name}</td>
                    <td class="number">{detail.weight:.2f}</td>
                    <td class="number">{detail.labor_cost:.2f}</td>
                    <td class="number">{detail.total_labor_cost:.2f}</td>
                </tr>
                ''' for idx, detail in enumerate(details, 1))}
            </tbody>
        </table>
        <div class="summary">
            <div class="summary-row">
                <span>商品数量</span>
                <span>{len(details)} 件</span>
            </div>
            <div class="summary-row">
                <span>总克重</span>
                <span>{order.total_weight:.2f} 克</span>
            </div>
            <div class="summary-row total">
                <span>总工费</span>
                <span>¥{order.total_labor_cost:.2f}</span>
            </div>
        </div>
        {f'<div class="remark"><strong>备注：</strong>{order.remark}</div>' if order.remark else ''}
        <button class="print-btn" onclick="window.print()">打印销售单</button>
    </div>
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


@router.post("/orders/{order_id}/cancel")
async def cancel_sales_order(order_id: int, db: Session = Depends(get_db)):
    """取消销售单并回滚库存（仅待结算状态可取消）"""
    try:
        # 查询销售单
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            return {
                "success": False,
                "message": "销售单不存在"
            }
        
        # 只有待结算状态才能取消
        if order.status != "待结算":
            return {
                "success": False,
                "message": f"只有待结算状态的销售单可以取消，当前状态: {order.status}"
            }
        
        # 查询销售明细
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order_id).all()
        
        # ==================== 回滚库存 ====================
        # 获取展厅位置
        showroom_location = db.query(Location).filter(
            Location.location_type == "showroom",
            Location.is_active == 1
        ).first()
        
        for detail in details:
            # 1. 回滚总库存 (Inventory 表)
            inventory = db.query(Inventory).filter(
                Inventory.product_name == detail.product_name
            ).first()
            if inventory:
                inventory.total_weight += detail.weight
                logger.info(f"回滚总库存: {detail.product_name} + {detail.weight}克, 剩余: {inventory.total_weight}克")
            
            # 2. 回滚展厅库存 (LocationInventory 表)
            if showroom_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == detail.product_name,
                    LocationInventory.location_id == showroom_location.id
                ).first()
                if location_inv:
                    location_inv.weight += detail.weight
                    logger.info(f"回滚展厅库存: {detail.product_name} + {detail.weight}克, 剩余: {location_inv.weight}克")
        # ==================== 库存回滚完成 ====================
        
        # 更新销售单状态为已取消
        order.status = "已取消"
        
        # 更新客户统计信息（回滚）
        if order.customer_id:
            customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
            if customer:
                customer.total_purchase_amount -= order.total_labor_cost
                customer.total_purchase_count = max(0, customer.total_purchase_count - 1)
        
        db.commit()
        
        logger.info(f"销售单已取消: {order.order_no}, 库存已回滚")
        
        return {
            "success": True,
            "message": f"销售单 {order.order_no} 已取消，库存已回滚"
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"取消销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"取消销售单失败: {str(e)}"
        }

