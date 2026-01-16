"""
退货管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from typing import Optional, List
import json
import logging

from ..database import get_db
from ..timezone_utils import china_now, to_china_time
from ..models import ReturnOrder, Location, Supplier, InboundOrder, LocationInventory
from ..schemas import (
    ReturnOrderCreate, 
    ReturnOrderApprove, 
    ReturnOrderReject,
    ReturnOrderComplete,
    ReturnOrderResponse
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/returns", tags=["退货管理"])

# 退货原因选项
RETURN_REASONS = ["质量问题", "款式不符", "数量差异", "工艺瑕疵", "其他"]


def build_return_response(return_order: ReturnOrder, db: Session) -> dict:
    """构建退货单响应对象"""
    # 获取关联信息
    from_location_name = None
    supplier_name = None
    inbound_order_no = None
    
    if return_order.from_location_id:
        location = db.query(Location).filter(Location.id == return_order.from_location_id).first()
        if location:
            from_location_name = location.name
    
    if return_order.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
        if supplier:
            supplier_name = supplier.name
    
    if return_order.inbound_order_id:
        inbound = db.query(InboundOrder).filter(InboundOrder.id == return_order.inbound_order_id).first()
        if inbound:
            inbound_order_no = inbound.order_no
    
    # 转换时间为中国时区（数据库存储的是 UTC 时间，需要加 8 小时）
    def format_time_china(dt):
        if dt is None:
            return None
        # 数据库存储的是 UTC 时间（无时区），需要加 8 小时转换为中国时间
        from datetime import timedelta
        china_dt = dt + timedelta(hours=8)
        return china_dt.isoformat()
    
    return {
        "id": return_order.id,
        "return_no": return_order.return_no,
        "return_type": return_order.return_type,
        "product_name": return_order.product_name,
        "return_weight": return_order.return_weight,
        "from_location_id": return_order.from_location_id,
        "from_location_name": from_location_name,
        "supplier_id": return_order.supplier_id,
        "supplier_name": supplier_name,
        "inbound_order_id": return_order.inbound_order_id,
        "inbound_order_no": inbound_order_no,
        "return_reason": return_order.return_reason,
        "reason_detail": return_order.reason_detail,
        "status": return_order.status,
        "created_by": return_order.created_by,
        "created_at": format_time_china(return_order.created_at),
        "approved_by": return_order.approved_by,
        "approved_at": format_time_china(return_order.approved_at),
        "reject_reason": return_order.reject_reason,
        "completed_by": return_order.completed_by,
        "completed_at": format_time_china(return_order.completed_at),
        "images": return_order.images,
        "remark": return_order.remark
    }


@router.get("/reasons")
async def get_return_reasons():
    """获取退货原因列表"""
    return {
        "success": True,
        "reasons": RETURN_REASONS
    }


@router.get("")
async def get_return_orders(
    return_type: Optional[str] = Query(None, description="退货类型: to_supplier/to_warehouse"),
    status: Optional[str] = Query(None, description="状态: pending/approved/completed/rejected"),
    keyword: Optional[str] = Query(None, description="搜索关键词（商品名称）"),
    start_date: Optional[str] = Query(None, description="开始日期"),
    end_date: Optional[str] = Query(None, description="结束日期"),
    db: Session = Depends(get_db)
):
    """获取退货单列表"""
    try:
        query = db.query(ReturnOrder)
        
        if return_type:
            query = query.filter(ReturnOrder.return_type == return_type)
        if status:
            query = query.filter(ReturnOrder.status == status)
        if keyword:
            query = query.filter(ReturnOrder.product_name.contains(keyword))
        if start_date:
            query = query.filter(ReturnOrder.created_at >= start_date)
        if end_date:
            query = query.filter(ReturnOrder.created_at <= end_date + " 23:59:59")
        
        returns = query.order_by(desc(ReturnOrder.created_at)).all()
        
        return {
            "success": True,
            "returns": [build_return_response(r, db) for r in returns],
            "total": len(returns)
        }
    except Exception as e:
        logger.error(f"获取退货单列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "returns": []}


@router.post("")
async def create_return_order(
    data: ReturnOrderCreate,
    created_by: str = Query("系统管理员", description="创建人"),
    user_role: str = Query("manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """创建退货单"""
    # 权限检查
    from ..middleware.permissions import has_permission
    if data.return_type == "to_supplier" and not has_permission(user_role, 'can_return_to_supplier'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【退货给供应商】的权限")
    if data.return_type == "to_warehouse" and not has_permission(user_role, 'can_return_to_warehouse'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【退货给商品部】的权限")
    
    try:
        # 验证退货类型
        if data.return_type not in ["to_supplier", "to_warehouse"]:
            return {"success": False, "message": "无效的退货类型，应为 to_supplier 或 to_warehouse"}
        
        # 验证退货原因
        if data.return_reason not in RETURN_REASONS:
            return {"success": False, "message": f"无效的退货原因，可选值: {', '.join(RETURN_REASONS)}"}
        
        # 退给供应商时验证供应商
        if data.return_type == "to_supplier":
            if not data.supplier_id:
                return {"success": False, "message": "退给供应商时必须选择供应商"}
            supplier = db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
            if not supplier:
                return {"success": False, "message": "供应商不存在"}
        
        # 验证发起位置
        if data.from_location_id:
            location = db.query(Location).filter(Location.id == data.from_location_id).first()
            if not location:
                return {"success": False, "message": "发起位置不存在"}
            
            # 检查库存是否充足
            inventory = db.query(LocationInventory).filter(
                LocationInventory.location_id == data.from_location_id,
                LocationInventory.product_name == data.product_name
            ).first()
            
            if not inventory or inventory.weight < data.return_weight:
                available = inventory.weight if inventory else 0
                return {
                    "success": False, 
                    "message": f"库存不足：{location.name} 的 {data.product_name} 仅有 {available}g，无法退货 {data.return_weight}g"
                }
        
        # 生成退货单号
        now = china_now()
        count = db.query(ReturnOrder).filter(
            ReturnOrder.return_no.like(f"TH{now.strftime('%Y%m%d')}%")
        ).count()
        return_no = f"TH{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 处理图片
        images_json = json.dumps(data.images) if data.images else None
        
        # 创建退货单 - 直接完成，无需审批
        return_order = ReturnOrder(
            return_no=return_no,
            return_type=data.return_type,
            product_name=data.product_name,
            return_weight=data.return_weight,
            from_location_id=data.from_location_id,
            supplier_id=data.supplier_id,
            inbound_order_id=data.inbound_order_id,
            return_reason=data.return_reason,
            reason_detail=data.reason_detail,
            status="completed",  # 直接完成
            created_by=created_by,
            completed_by=created_by,  # 创建人即完成人
            completed_at=now,  # 立即完成
            images=images_json,
            remark=data.remark
        )
        
        db.add(return_order)
        
        # 直接扣减库存
        if data.from_location_id:
            inventory.weight -= data.return_weight
            logger.info(f"扣减库存: {data.product_name} 在位置 {location.name} 扣减 {data.return_weight}g，剩余 {inventory.weight}g")
        
        # 如果是退给供应商，更新供应商统计
        if data.return_type == "to_supplier" and data.supplier_id:
            supplier.total_supply_weight -= data.return_weight
            if supplier.total_supply_count > 0:
                supplier.total_supply_count -= 1
            logger.info(f"更新供应商统计: {supplier.name} 供货重量减少 {data.return_weight}g")
        
        db.commit()
        db.refresh(return_order)
        
        logger.info(f"退货单创建并完成: {return_no}, 类型: {data.return_type}, 商品: {data.product_name}, 克重: {data.return_weight}g, 库存已扣减")
        
        return {
            "success": True,
            "message": f"退货单 {return_no} 创建成功，库存已扣减 {data.return_weight}g",
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"创建退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": f"创建退货单失败: {str(e)}"}


@router.get("/{return_id}")
async def get_return_order(
    return_id: int,
    db: Session = Depends(get_db)
):
    """获取退货单详情"""
    try:
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "message": "退货单不存在"}
        
        return {
            "success": True,
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"获取退货单详情失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/{return_id}/approve")
async def approve_return_order(
    return_id: int,
    data: ReturnOrderApprove,
    db: Session = Depends(get_db)
):
    """审批通过退货单"""
    try:
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "message": "退货单不存在"}
        
        if return_order.status != "pending":
            return {"success": False, "message": f"退货单状态为 {return_order.status}，无法审批"}
        
        # 更新状态
        return_order.status = "approved"
        return_order.approved_by = data.approved_by
        return_order.approved_at = china_now()
        
        db.commit()
        db.refresh(return_order)
        
        logger.info(f"审批通过退货单: {return_order.return_no}, 审批人: {data.approved_by}")
        
        return {
            "success": True,
            "message": f"退货单 {return_order.return_no} 已审批通过",
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"审批退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": str(e)}


@router.post("/{return_id}/reject")
async def reject_return_order(
    return_id: int,
    data: ReturnOrderReject,
    db: Session = Depends(get_db)
):
    """驳回退货单"""
    try:
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "message": "退货单不存在"}
        
        if return_order.status != "pending":
            return {"success": False, "message": f"退货单状态为 {return_order.status}，无法驳回"}
        
        # 更新状态
        return_order.status = "rejected"
        return_order.approved_by = data.rejected_by
        return_order.approved_at = china_now()
        return_order.reject_reason = data.reject_reason
        
        db.commit()
        db.refresh(return_order)
        
        logger.info(f"驳回退货单: {return_order.return_no}, 驳回人: {data.rejected_by}, 原因: {data.reject_reason}")
        
        return {
            "success": True,
            "message": f"退货单 {return_order.return_no} 已驳回",
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"驳回退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": str(e)}


@router.post("/{return_id}/complete")
async def complete_return_order(
    return_id: int,
    data: ReturnOrderComplete,
    db: Session = Depends(get_db)
):
    """完成退货（扣减库存）"""
    try:
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            return {"success": False, "message": "退货单不存在"}
        
        if return_order.status != "approved":
            return {"success": False, "message": f"退货单状态为 {return_order.status}，必须先审批通过才能完成"}
        
        # 扣减库存
        if return_order.from_location_id:
            inventory = db.query(LocationInventory).filter(
                LocationInventory.location_id == return_order.from_location_id,
                LocationInventory.product_name == return_order.product_name
            ).first()
            
            if inventory:
                if inventory.weight < return_order.return_weight:
                    return {
                        "success": False, 
                        "message": f"库存不足，当前库存 {inventory.weight}g，退货需要 {return_order.return_weight}g"
                    }
                inventory.weight -= return_order.return_weight
                logger.info(f"扣减库存: {return_order.product_name} 在位置 {return_order.from_location_id} 扣减 {return_order.return_weight}g")
        
        # 如果是退给供应商，更新供应商统计
        if return_order.return_type == "to_supplier" and return_order.supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
            if supplier:
                # 减少供应商的供货统计（可选：也可以增加退货统计字段）
                supplier.total_supply_weight -= return_order.return_weight
                supplier.total_supply_count -= 1  # 可选
                logger.info(f"更新供应商统计: {supplier.name} 供货重量减少 {return_order.return_weight}g")
        
        # 更新退货单状态
        return_order.status = "completed"
        return_order.completed_by = data.completed_by
        return_order.completed_at = china_now()
        
        db.commit()
        db.refresh(return_order)
        
        logger.info(f"完成退货单: {return_order.return_no}, 完成人: {data.completed_by}")
        
        return {
            "success": True,
            "message": f"退货单 {return_order.return_no} 已完成，库存已扣减 {return_order.return_weight}g",
            "return_order": build_return_response(return_order, db)
        }
    except Exception as e:
        logger.error(f"完成退货单失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": str(e)}


@router.get("/stats/summary")
async def get_return_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取退货统计"""
    try:
        query = db.query(ReturnOrder)
        
        if start_date:
            query = query.filter(ReturnOrder.created_at >= start_date)
        if end_date:
            query = query.filter(ReturnOrder.created_at <= end_date + " 23:59:59")
        
        returns = query.all()
        
        # 统计
        total_count = len(returns)
        pending_count = len([r for r in returns if r.status == "pending"])
        approved_count = len([r for r in returns if r.status == "approved"])
        completed_count = len([r for r in returns if r.status == "completed"])
        rejected_count = len([r for r in returns if r.status == "rejected"])
        
        to_supplier_count = len([r for r in returns if r.return_type == "to_supplier"])
        to_warehouse_count = len([r for r in returns if r.return_type == "to_warehouse"])
        
        total_weight = sum(r.return_weight for r in returns if r.status == "completed")
        
        # 按原因统计
        reason_stats = {}
        for r in returns:
            if r.return_reason not in reason_stats:
                reason_stats[r.return_reason] = {"count": 0, "weight": 0}
            reason_stats[r.return_reason]["count"] += 1
            if r.status == "completed":
                reason_stats[r.return_reason]["weight"] += r.return_weight
        
        return {
            "success": True,
            "stats": {
                "total_count": total_count,
                "pending_count": pending_count,
                "approved_count": approved_count,
                "completed_count": completed_count,
                "rejected_count": rejected_count,
                "to_supplier_count": to_supplier_count,
                "to_warehouse_count": to_warehouse_count,
                "total_completed_weight": total_weight,
                "reason_stats": reason_stats
            }
        }
    except Exception as e:
        logger.error(f"获取退货统计失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.options("/{return_id}/download")
async def download_return_order_options(return_id: int):
    """处理CORS预检请求"""
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/{return_id}/download")
async def download_return_order(
    return_id: int,
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印退货单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载退货单请求: return_id={return_id}, format={format}")
        
        # 查询退货单
        return_order = db.query(ReturnOrder).filter(ReturnOrder.id == return_id).first()
        if not return_order:
            raise HTTPException(status_code=404, detail="退货单不存在")
        
        # 获取关联信息
        from_location_name = None
        supplier_name = None
        inbound_order_no = None
        
        if return_order.from_location_id:
            location = db.query(Location).filter(Location.id == return_order.from_location_id).first()
            if location:
                from_location_name = location.name
        
        if return_order.supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == return_order.supplier_id).first()
            if supplier:
                supplier_name = supplier.name
        
        if return_order.inbound_order_id:
            inbound = db.query(InboundOrder).filter(InboundOrder.id == return_order.inbound_order_id).first()
            if inbound:
                inbound_order_no = inbound.order_no
        
        if format == "pdf":
            try:
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                import io
                from ..timezone_utils import to_china_time, format_china_time
                
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
                p.drawCentredString(width / 2, top_margin, "退货单")
                
                # 退货类型
                return_type_str = "退给供应商" if return_order.return_type == "to_supplier" else "退给商品部"
                status_map = {
                    "pending": "待审批",
                    "approved": "已批准",
                    "completed": "已完成",
                    "rejected": "已驳回"
                }
                status_str = status_map.get(return_order.status, return_order.status)
                
                # 创建时间
                if return_order.created_at:
                    china_time = to_china_time(return_order.created_at)
                    create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M')
                else:
                    create_time_str = "未知"
                
                # 基本信息（紧凑两列布局）
                y = top_margin - 14
                if chinese_font:
                    p.setFont(chinese_font, 8)
                else:
                    p.setFont("Helvetica", 8)
                
                p.drawString(left_margin, y, f"单号：{return_order.return_no}")
                p.drawString(width/2, y, f"时间：{create_time_str}")
                y -= 10
                p.drawString(left_margin, y, f"类型：{return_type_str}  状态：{status_str}")
                if return_order.created_by:
                    p.drawString(width/2, y, f"创建人：{return_order.created_by}")
                y -= 12
                
                # 分隔线
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 商品信息
                product_name = return_order.product_name[:15] if len(return_order.product_name) > 15 else return_order.product_name
                if chinese_font:
                    p.setFont(chinese_font, 8)
                p.drawString(left_margin, y, f"商品：{product_name}")
                p.setFont("Helvetica", 8)
                p.drawString(width/2, y, f"克重：{return_order.return_weight:.2f}g")
                y -= 10
                
                # 供应商/位置信息
                if return_order.return_type == "to_supplier" and supplier_name:
                    supplier_short = supplier_name[:10] if len(supplier_name) > 10 else supplier_name
                    if chinese_font:
                        p.setFont(chinese_font, 8)
                    p.drawString(left_margin, y, f"供应商：{supplier_short}")
                if from_location_name:
                    p.drawString(width/2, y, f"发起位置：{from_location_name}")
                y -= 10
                
                # 退货原因
                reason_short = return_order.return_reason[:20] if len(return_order.return_reason) > 20 else return_order.return_reason
                if chinese_font:
                    p.setFont(chinese_font, 8)
                p.drawString(left_margin, y, f"原因：{reason_short}")
                y -= 12
                
                # 分隔线
                p.line(left_margin, y, right_margin, y)
                y -= 10
                
                # 审批信息
                if return_order.approved_by:
                    if chinese_font:
                        p.setFont(chinese_font, 8)
                    p.drawString(left_margin, y, f"审批人：{return_order.approved_by}")
                    if return_order.approved_at:
                        approved_time = to_china_time(return_order.approved_at)
                        approved_time_str = format_china_time(approved_time, '%Y-%m-%d %H:%M')
                        p.drawString(width/2, y, f"审批时间：{approved_time_str}")
                    y -= 10
                
                # 备注
                if return_order.remark:
                    remark_short = return_order.remark[:30] if len(return_order.remark) > 30 else return_order.remark
                    if chinese_font:
                        p.setFont(chinese_font, 7)
                    p.drawString(left_margin, y, f"备注：{remark_short}")
                
                p.save()
                buffer.seek(0)
                
                from fastapi.responses import Response
                filename = f"return_order_{return_order.return_no}.pdf"
                return Response(
                    content=buffer.getvalue(),
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{filename}"',
                        "Access-Control-Allow-Origin": "*",
                    }
                )
            except Exception as pdf_error:
                logger.error(f"生成PDF失败: {pdf_error}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"生成PDF失败: {str(pdf_error)}")
        
        elif format == "html":
            # 生成HTML（用于打印）
            from fastapi.responses import HTMLResponse
            from ..timezone_utils import to_china_time, format_china_time
            
            return_type_str = "退给供应商" if return_order.return_type == "to_supplier" else "退给商品部"
            status_map = {
                "pending": "待审批",
                "approved": "已批准",
                "completed": "已完成",
                "rejected": "已驳回"
            }
            status_str = status_map.get(return_order.status, return_order.status)
            
            create_time_str = "未知"
            if return_order.created_at:
                china_time = to_china_time(return_order.created_at)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            
            approved_time_str = ""
            if return_order.approved_at:
                approved_time = to_china_time(return_order.approved_at)
                approved_time_str = format_china_time(approved_time, '%Y-%m-%d %H:%M:%S')
            
            html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>退货单 - {return_order.return_no}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: 'Microsoft YaHei', 'SimHei', Arial, sans-serif;
            padding: 40px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        .header {{
            text-align: center;
            border-bottom: 3px solid #ef4444;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }}
        .header h1 {{
            font-size: 32px;
            color: #ef4444;
            margin-bottom: 10px;
        }}
        .info-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }}
        .info-item {{
            padding: 15px;
            background: #f9fafb;
            border-radius: 8px;
        }}
        .info-label {{
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 5px;
        }}
        .info-value {{
            font-size: 16px;
            font-weight: 600;
            color: #111827;
        }}
        .full-width {{
            grid-column: 1 / -1;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 12px;
        }}
        @media print {{
            body {{
                background: white;
                padding: 0;
            }}
            .container {{
                box-shadow: none;
                padding: 20px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>退货单</h1>
        </div>
        
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">退货单号</div>
                <div class="info-value">{return_order.return_no}</div>
            </div>
            <div class="info-item">
                <div class="info-label">退货类型</div>
                <div class="info-value">{return_type_str}</div>
            </div>
            <div class="info-item">
                <div class="info-label">商品名称</div>
                <div class="info-value">{return_order.product_name}</div>
            </div>
            <div class="info-item">
                <div class="info-label">退货克重</div>
                <div class="info-value">{return_order.return_weight:.2f} 克</div>
            </div>
            {f'<div class="info-item"><div class="info-label">供应商</div><div class="info-value">{supplier_name or "-"}</div></div>' if return_order.return_type == "to_supplier" else ''}
            {f'<div class="info-item"><div class="info-label">发起位置</div><div class="info-value">{from_location_name or "-"}</div></div>' if from_location_name else ''}
            <div class="info-item">
                <div class="info-label">退货原因</div>
                <div class="info-value">{return_order.return_reason}</div>
            </div>
            <div class="info-item">
                <div class="info-label">状态</div>
                <div class="info-value">{status_str}</div>
            </div>
            {f'<div class="info-item full-width"><div class="info-label">详细说明</div><div class="info-value">{return_order.reason_detail or "-"}</div></div>' if return_order.reason_detail else ''}
            <div class="info-item">
                <div class="info-label">创建时间</div>
                <div class="info-value">{create_time_str}</div>
            </div>
            {f'<div class="info-item"><div class="info-label">创建人</div><div class="info-value">{return_order.created_by or "-"}</div></div>' if return_order.created_by else ''}
            {f'<div class="info-item"><div class="info-label">审批人</div><div class="info-value">{return_order.approved_by or "-"}</div></div>' if return_order.approved_by else ''}
            {f'<div class="info-item"><div class="info-label">审批时间</div><div class="info-value">{approved_time_str}</div></div>' if approved_time_str else ''}
            {f'<div class="info-item full-width"><div class="info-label">备注</div><div class="info-value">{return_order.remark or "-"}</div></div>' if return_order.remark else ''}
        </div>
        
        <div class="footer">
            <p>打印时间：{format_china_time(to_china_time(datetime.now()), '%Y-%m-%d %H:%M:%S')}</p>
        </div>
    </div>
</body>
</html>
"""
            
            return HTMLResponse(
                content=html_content,
                headers={
                    "Access-Control-Allow-Origin": "*",
                }
            )
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式，请使用 pdf 或 html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成退货单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成退货单失败: {str(e)}")

