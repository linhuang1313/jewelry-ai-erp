"""
閿€鍞崟绠＄悊璺敱
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

# 涓浗鏃跺尯 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """鑾峰彇涓浗鏃堕棿锛圲TC+8锛?""
    return datetime.now(CHINA_TZ)

router = APIRouter(prefix="/api/sales", tags=["閿€鍞崟绠＄悊"])


@router.post("/orders")
async def create_sales_order(order_data: SalesOrderCreate, db: Session = Depends(get_db)):
    """鍒涘缓閿€鍞崟"""
    try:
        # ==================== 鏁版嵁楠岃瘉 ====================
        # 楠岃瘉鍟嗗搧鏄庣粏鏁版嵁
        for item in order_data.items:
            if item.weight <= 0:
                return {
                    "success": False,
                    "message": f"鍟嗗搧 {item.product_name} 鐨勯噸閲忓繀椤诲ぇ浜?",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "weight",
                        "value": item.weight
                    }
                }
            if item.labor_cost < 0:
                return {
                    "success": False,
                    "message": f"鍟嗗搧 {item.product_name} 鐨勫伐璐逛笉鑳戒负璐熸暟",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "labor_cost",
                        "value": item.labor_cost
                    }
                }
        # ==================== 鏁版嵁楠岃瘉缁撴潫 ====================
        
        # ==================== 鍟嗗搧缂栫爜杞崲 ====================
        # 濡傛灉杈撳叆鐨勬槸鍟嗗搧缂栫爜锛岃嚜鍔ㄨ浆鎹负鍟嗗搧鍚嶇О
        for item in order_data.items:
            product_name = item.product_name
            # 妫€鏌ユ槸鍚︽槸鍟嗗搧缂栫爜锛堝叏澶у啓鎴栧寘鍚暟瀛楋級
            if product_name and (product_name.isupper() or any(c.isdigit() for c in product_name)):
                code_record = db.query(ProductCode).filter(ProductCode.code == product_name).first()
                if code_record and code_record.name:
                    # 鎵惧埌浜嗗搴旂殑鍟嗗搧鍚嶇О锛屾洿鏂?item
                    logger.info(f"鍟嗗搧缂栫爜杞崲: {product_name} -> {code_record.name}")
                    item.product_name = code_record.name
        # ==================== 鍟嗗搧缂栫爜杞崲缁撴潫 ====================
        
        # ==================== 搴撳瓨妫€鏌?====================
        # 鍦ㄥ垱寤哄鎴蜂箣鍓嶅厛妫€鏌ュ簱瀛橈紝閬垮厤鍒涘缓浜嗗鎴蜂絾閿€鍞崟鍒涘缓澶辫触
        inventory_errors = []
        for item in order_data.items:
            # 鏌ヨ搴撳瓨锛堢簿纭尮閰嶅晢鍝佸悕绉帮級
            inventory = db.query(Inventory).filter(
                Inventory.product_name == item.product_name
            ).first()
            
            if not inventory:
                # 鍟嗗搧涓嶅瓨鍦ㄤ簬搴撳瓨涓?
                inventory_errors.append({
                    "product_name": item.product_name,
                    "error": "鍟嗗搧涓嶅瓨鍦ㄤ簬搴撳瓨涓?,
                    "required_weight": item.weight,
                    "available_weight": 0.0
                })
            else:
                # 璁＄畻鍙敤搴撳瓨锛氭€诲簱瀛?- 寰呯粨绠楅攢鍞崟鍗犵敤鐨勫簱瀛?
                # 鏌ヨ璇ュ晢鍝佸湪寰呯粨绠楅攢鍞崟涓殑鎬婚噸閲?
                reserved_weight = db.query(func.sum(SalesDetail.weight)).join(
                    SalesOrder
                ).filter(
                    SalesDetail.product_name == item.product_name,
                    SalesOrder.status == "寰呯粨绠?
                ).scalar() or 0.0
                
                available_weight = inventory.total_weight - reserved_weight
                
                if available_weight < item.weight:
                    # 搴撳瓨涓嶈冻锛堣€冭檻寰呯粨绠楃殑閿€鍞崟锛?
                    inventory_errors.append({
                        "product_name": item.product_name,
                        "error": "搴撳瓨涓嶈冻",
                        "required_weight": item.weight,
                        "available_weight": available_weight,
                        "total_weight": inventory.total_weight,
                        "reserved_weight": reserved_weight
                    })
        
        # 濡傛灉鏈変换浣曞晢鍝佸簱瀛樹笉瓒筹紝鎷掔粷鍒涘缓閿€鍞崟
        if inventory_errors:
            return {
                "success": False,
                "message": "搴撳瓨妫€鏌ュけ璐ワ紝鏃犳硶鍒涘缓閿€鍞崟",
                "inventory_errors": inventory_errors
            }
        # ==================== 搴撳瓨妫€鏌ョ粨鏉?====================
        
        # 澶勭悊瀹㈡埛锛堝湪搴撳瓨妫€鏌ラ€氳繃鍚庯級
        customer_id = order_data.customer_id
        customer_name = order_data.customer_name
        
        # 濡傛灉娌℃湁鎻愪緵customer_id锛屽皾璇曟牴鎹鍚嶆煡鎵?
        if not customer_id:
            customer = db.query(Customer).filter(
                Customer.name == customer_name,
                Customer.status == "active"
            ).first()
            if customer:
                customer_id = customer.id
            else:
                # 瀹㈡埛涓嶅瓨鍦紝鑷姩鍒涘缓
                customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_name,
                    customer_type="涓汉"
                )
                db.add(customer)
                db.flush()
                customer_id = customer.id
        
        # 璁＄畻鎬诲伐璐瑰拰鎬诲厠閲?
        # 鎬诲伐璐?= (鍏嬮噸 脳 鍏嬪伐璐? + (浠舵暟 脳 浠跺伐璐?
        def calc_item_total(item):
            gram_cost = item.labor_cost * item.weight
            piece_cost = (item.piece_count or 0) * (item.piece_labor_cost or 0)
            return gram_cost + piece_cost
        
        total_labor_cost = sum(calc_item_total(item) for item in order_data.items)
        total_weight = sum(item.weight for item in order_data.items)
        
        # 鐢熸垚閿€鍞崟鍙凤紙浣跨敤涓浗鏃堕棿锛?
        order_no = f"XS{china_now().strftime('%Y%m%d%H%M%S')}"
        
        # 鍒涘缓閿€鍞崟
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
            status="寰呯粨绠?
        )
        db.add(sales_order)
        db.flush()
        
        # 鍒涘缓閿€鍞槑缁?
        details = []
        for item in order_data.items:
            # 璁＄畻鍗曢」鎬诲伐璐癸細(鍏嬮噸 脳 鍏嬪伐璐? + (浠舵暟 脳 浠跺伐璐?
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
        
        # ==================== 瑙勫垯A: 鍒涘缓閿€鍞崟鏃剁珛鍗虫墸鍑忓簱瀛?====================
        # 鑾峰彇灞曞巺浣嶇疆锛堥攢鍞粠灞曞巺鍙戠敓锛?
        showroom_location = db.query(Location).filter(
            Location.location_type == "showroom",
            Location.is_active == 1
        ).first()
        
        for item in order_data.items:
            # 1. 鎵ｅ噺鎬诲簱瀛?(Inventory 琛?
            inventory = db.query(Inventory).filter(
                Inventory.product_name == item.product_name
            ).first()
            if inventory:
                inventory.total_weight = round(inventory.total_weight - item.weight, 3)
                logger.info(f"鎵ｅ噺鎬诲簱瀛? {item.product_name} - {item.weight}鍏? 鍓╀綑: {inventory.total_weight}鍏?)
            
            # 2. 鎵ｅ噺灞曞巺搴撳瓨 (LocationInventory 琛?
            if showroom_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == item.product_name,
                    LocationInventory.location_id == showroom_location.id
                ).first()
                if location_inv:
                    location_inv.weight -= item.weight
                    logger.info(f"鎵ｅ噺灞曞巺搴撳瓨: {item.product_name} - {item.weight}鍏? 鍓╀綑: {location_inv.weight}鍏?)
        # ==================== 搴撳瓨鎵ｅ噺瀹屾垚 ====================
        
        # 鏇存柊瀹㈡埛缁熻淇℃伅
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
        
        # 鏋勫缓鍝嶅簲
        order_response = SalesOrderResponse.model_validate(sales_order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "message": f"閿€鍞崟鍒涘缓鎴愬姛锛歿order_no}",
            "order": order_response.model_dump(mode='json')
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"鍒涘缓閿€鍞崟澶辫触: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"鍒涘缓閿€鍞崟澶辫触: {str(e)}"
        }


@router.get("/orders")
async def get_sales_orders(
    order_no: Optional[str] = Query(None, description="閿€鍞崟鍙凤紙妯＄硦鍖归厤锛?),
    customer_name: Optional[str] = None,
    salesperson: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500, description="杩斿洖鏁伴噺闄愬埗"),
    db: Session = Depends(get_db)
):
    """鑾峰彇閿€鍞崟鍒楄〃锛堝凡浼樺寲锛氭壒閲忔煡璇㈤伩鍏?N+1锛?""
    from collections import defaultdict
    
    try:
        query = db.query(SalesOrder)
        
        if order_no:
            query = query.filter(SalesOrder.order_no.contains(order_no))
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
        
        orders = query.order_by(desc(SalesOrder.order_date)).limit(limit).all()
        
        if not orders:
            return {"success": True, "orders": []}
        
        # ========== 鎵归噺鏌ヨ浼樺寲锛氶伩鍏?N+1 闂 ==========
        order_ids = [o.id for o in orders]
        
        # 鎵归噺鏌ヨ鎵€鏈夐攢鍞槑缁嗭紙1 娆℃煡璇級
        all_details = db.query(SalesDetail).filter(
            SalesDetail.order_id.in_(order_ids)
        ).all()
        
        # 鏋勫缓鏄犲皠瀛楀吀
        details_map = defaultdict(list)
        for d in all_details:
            details_map[d.order_id].append(d)
        
        # 鏋勫缓缁撴灉锛堜娇鐢ㄩ鍔犺浇鏁版嵁锛屾棤棰濆鏌ヨ锛?
        # 鐩存帴鏋勫缓瀛楀吀锛岄伩鍏?Pydantic model_validate 鐨勬€ц兘寮€閿€
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
        logger.error(f"鏌ヨ閿€鍞崟澶辫触: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"鏌ヨ閿€鍞崟澶辫触: {str(e)}"
        }


@router.get("/orders/{order_id}")
async def get_sales_order(order_id: int, db: Session = Depends(get_db)):
    """鑾峰彇閿€鍞崟璇︽儏"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        
        if not order:
            return {
                "success": False,
                "message": "閿€鍞崟涓嶅瓨鍦?
            }
        
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
        order_response = SalesOrderResponse.model_validate(order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "order": order_response.model_dump(mode='json')
        }
    except Exception as e:
        logger.error(f"鏌ヨ閿€鍞崟璇︽儏澶辫触: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"鏌ヨ閿€鍞崟璇︽儏澶辫触: {str(e)}"
        }


@router.options("/orders/{order_id}/download")
async def download_sales_order_options(order_id: int):
    """澶勭悊CORS棰勬璇锋眰"""
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
    """涓嬭浇鎴栨墦鍗伴攢鍞崟锛堟敮鎸丳DF鍜孒TML鏍煎紡锛?""
    try:
        logger.info(f"涓嬭浇閿€鍞崟璇锋眰: order_id={order_id}, format={format}")
        
        # 鏌ヨ閿€鍞崟
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="閿€鍞崟涓嶅瓨鍦?)
        
        # 鏌ヨ閿€鍞槑缁?
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order_id).all()
        if not details:
            raise HTTPException(status_code=404, detail="閿€鍞崟鏄庣粏涓嶅瓨鍦?)
        
        logger.info(f"鎵惧埌閿€鍞崟: order_no={order.order_no}, 鏄庣粏鏁?{len(details)}")
        
        # 鏃堕棿鏍煎紡鍖?
        from ..timezone_utils import to_china_time, format_china_time
        if order.order_date:
            china_time = to_china_time(order.order_date)
            order_date_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
        else:
            order_date_str = "鏈煡"
        
        if format == "pdf":
            try:
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                
                # 鑷畾涔夌焊寮犲昂瀵革細241mm 脳 140mm 妯悜锛堥拡寮忔墦鍗版満锛?
                PAGE_WIDTH = 241 * mm
                PAGE_HEIGHT = 140 * mm
                
                buffer = io.BytesIO()
                p = canvas.Canvas(buffer, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
                width, height = PAGE_WIDTH, PAGE_HEIGHT
                
                # 浣跨敤 CID 瀛椾綋
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    chinese_font = 'STSong-Light'
                except Exception as cid_error:
                    logger.warning(f"娉ㄥ唽CID瀛椾綋澶辫触: {cid_error}")
                    chinese_font = None
                
                # 椤佃竟璺?
                left_margin = 8 * mm
                right_margin = width - 8 * mm
                top_margin = height - 6 * mm
                
                # 鏍囬锛堝眳涓級
                if chinese_font:
                    p.setFont(chinese_font, 12)
                else:
                    p.setFont("Helvetica-Bold", 12)
                p.drawCentredString(width / 2, top_margin, "閿€鍞崟")
                
                # 鍩烘湰淇℃伅锛堢揣鍑戜袱鍒楀竷灞€锛?
                y = top_margin - 14
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica", 8)
                
                customer_name = (order.customer_name or '鏈煡')[:10]
                salesperson = (order.salesperson or '鏈煡')[:6]
                p.drawString(left_margin, y, f"鍗曞彿锛歿order.order_no}")
                p.drawString(width/2, y, f"鏃ユ湡锛歿order_date_str}")
                y -= 10
                p.drawString(left_margin, y, f"瀹㈡埛锛歿customer_name}  涓氬姟鍛橈細{salesperson}")
                p.drawString(width/2, y, f"鐘舵€侊細{order.status}")
                y -= 12
                
                # 鍒嗛殧绾?
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 鍟嗗搧鏄庣粏琛ㄥご
                col_x = [left_margin, 55*mm, 85*mm, 115*mm, 145*mm]
                if chinese_font:
                    p.setFont(chinese_font, 7)
                else:
                    p.setFont("Helvetica-Bold", 7)
                p.drawString(col_x[0], y, "鍟嗗搧鍚嶇О")
                p.drawString(col_x[1], y, "鍏嬮噸(g)")
                p.drawString(col_x[2], y, "宸ヨ垂/鍏?)
                p.drawString(col_x[3], y, "鎬诲伐璐?)
                y -= 8
                p.line(left_margin, y, right_margin, y)
                y -= 8
                
                # 鍟嗗搧鏄庣粏琛?
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
                
                # 姹囨€?
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica-Bold", 8)
                p.drawString(left_margin, y, f"鍚堣锛氭€诲厠閲?{order.total_weight:.2f}g  |  鎬诲伐璐?楼{order.total_labor_cost:.2f}")
                y -= 10
                
                # 澶囨敞
                if order.remark:
                    if chinese_font:
                        p.setFont(chinese_font, 7)
                    remark_text = order.remark[:30] if len(order.remark) > 30 else order.remark
                    p.drawString(left_margin, y, f"澶囨敞锛歿remark_text}")
                
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
                logger.error(f"鐢熸垚閿€鍞崟PDF澶辫触: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"鐢熸垚PDF澶辫触: {str(pdf_error)}")
        
        elif format == "html":
            # HTML 鎵撳嵃鏍煎紡
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>閿€鍞崟 - {order.order_no}</title>
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
            <h1>閿€鍞崟</h1>
            <div class="order-no">鍗曞彿锛歿order.order_no}</div>
        </div>
        <div class="info-grid">
            <div class="info-item">
                <label>閿€鍞棩鏈?/label>
                <span>{order_date_str}</span>
            </div>
            <div class="info-item">
                <label>瀹㈡埛鍚嶇О</label>
                <span>{order.customer_name or '鏈煡'}</span>
            </div>
            <div class="info-item">
                <label>涓氬姟鍛?/label>
                <span>{order.salesperson or '鏈煡'}</span>
            </div>
            <div class="info-item">
                <label>璁㈠崟鐘舵€?/label>
                <span>{order.status}</span>
            </div>
        </div>
        <table class="details-table">
            <thead>
                <tr>
                    <th>搴忓彿</th>
                    <th>鍟嗗搧鍚嶇О</th>
                    <th>鍏嬮噸(g)</th>
                    <th>宸ヨ垂(鍏?鍏?</th>
                    <th>鎬诲伐璐?鍏?</th>
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
                <span>鍟嗗搧鏁伴噺</span>
                <span>{len(details)} 浠?/span>
            </div>
            <div class="summary-row">
                <span>鎬诲厠閲?/span>
                <span>{order.total_weight:.2f} 鍏?/span>
            </div>
            <div class="summary-row total">
                <span>鎬诲伐璐?/span>
                <span>楼{order.total_labor_cost:.2f}</span>
            </div>
        </div>
        {f'<div class="remark"><strong>澶囨敞锛?/strong>{order.remark}</div>' if order.remark else ''}
        <button class="print-btn" onclick="window.print()">鎵撳嵃閿€鍞崟</button>
    </div>
</body>
</html>
"""
            return HTMLResponse(
                content=html_content,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
        else:
            raise HTTPException(status_code=400, detail="涓嶆敮鎸佺殑鏍煎紡锛岃浣跨敤 pdf 鎴?html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"鐢熸垚閿€鍞崟澶辫触: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"鐢熸垚閿€鍞崟澶辫触: {str(e)}")


@router.post("/orders/{order_id}/cancel")
async def cancel_sales_order(order_id: int, db: Session = Depends(get_db)):
    """鍙栨秷閿€鍞崟骞跺洖婊氬簱瀛橈紙浠呭緟缁撶畻鐘舵€佸彲鍙栨秷锛?""
    try:
        # 鏌ヨ閿€鍞崟
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        if not order:
            return {
                "success": False,
                "message": "閿€鍞崟涓嶅瓨鍦?
            }
        
        # 鍙湁寰呯粨绠楃姸鎬佹墠鑳藉彇娑?
        if order.status != "寰呯粨绠?:
            return {
                "success": False,
                "message": f"鍙湁寰呯粨绠楃姸鎬佺殑閿€鍞崟鍙互鍙栨秷锛屽綋鍓嶇姸鎬? {order.status}"
            }
        
        # 鏌ヨ閿€鍞槑缁?
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order_id).all()
        
        # ==================== 鍥炴粴搴撳瓨 ====================
        # 鑾峰彇灞曞巺浣嶇疆
        showroom_location = db.query(Location).filter(
            Location.location_type == "showroom",
            Location.is_active == 1
        ).first()
        
        for detail in details:
            # 1. 鍥炴粴鎬诲簱瀛?(Inventory 琛?
            inventory = db.query(Inventory).filter(
                Inventory.product_name == detail.product_name
            ).first()
            if inventory:
                inventory.total_weight = round(inventory.total_weight + detail.weight, 3)
                logger.info(f"鍥炴粴鎬诲簱瀛? {detail.product_name} + {detail.weight}鍏? 鍓╀綑: {inventory.total_weight}鍏?)
            
            # 2. 鍥炴粴灞曞巺搴撳瓨 (LocationInventory 琛?
            if showroom_location:
                location_inv = db.query(LocationInventory).filter(
                    LocationInventory.product_name == detail.product_name,
                    LocationInventory.location_id == showroom_location.id
                ).first()
                if location_inv:
                    location_inv.weight += detail.weight
                    logger.info(f"鍥炴粴灞曞巺搴撳瓨: {detail.product_name} + {detail.weight}鍏? 鍓╀綑: {location_inv.weight}鍏?)
        # ==================== 搴撳瓨鍥炴粴瀹屾垚 ====================
        
        # 鏇存柊閿€鍞崟鐘舵€佷负宸插彇娑?
        order.status = "宸插彇娑?
        
        # 鏇存柊瀹㈡埛缁熻淇℃伅锛堝洖婊氾級
        if order.customer_id:
            customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
            if customer:
                customer.total_purchase_amount -= order.total_labor_cost
                customer.total_purchase_count = max(0, customer.total_purchase_count - 1)
        
        db.commit()
        
        logger.info(f"閿€鍞崟宸插彇娑? {order.order_no}, 搴撳瓨宸插洖婊?)
        
        return {
            "success": True,
            "message": f"閿€鍞崟 {order.order_no} 宸插彇娑堬紝搴撳瓨宸插洖婊?
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"鍙栨秷閿€鍞崟澶辫触: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"鍙栨秷閿€鍞崟澶辫触: {str(e)}"
        }

