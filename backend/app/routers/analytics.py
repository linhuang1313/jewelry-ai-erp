"""
数据分析路由模块
包含销售分析、库存分析、财务分析、预警中心的所有API
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, case, distinct, and_, or_
from datetime import datetime, timedelta
from typing import Optional, List
import logging

from ..database import get_db
from ..models import (
    SalesOrder, SalesDetail, SettlementOrder,
    Inventory, LocationInventory, Location,
    InboundOrder, InboundDetail,
    Customer, Supplier, Salesperson,
    LoanOrder, LoanDetail
)
from ..models.finance import GoldReceipt
from ..timezone_utils import china_now, to_china_time

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ============= 仪表盘汇总 API =============

@router.get("/dashboard/summary")
async def get_dashboard_summary(
    db: Session = Depends(get_db)
):
    """获取仪表盘汇总数据（今日/本月关键指标）"""
    try:
        now = china_now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_month_start = (month_start - timedelta(days=1)).replace(day=1)
        yesterday_start = today_start - timedelta(days=1)
        
        # 今日销售额
        today_sales = db.query(
            func.sum(SettlementOrder.total_amount).label("amount"),
            func.sum(SettlementOrder.total_weight).label("weight"),
            func.count(SettlementOrder.id).label("count")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= today_start
        ).first()
        
        # 昨日销售额（对比）
        yesterday_sales = db.query(
            func.sum(SettlementOrder.total_amount).label("amount")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= yesterday_start,
            SettlementOrder.created_at < today_start
        ).first()
        
        # 本月销售额
        month_sales = db.query(
            func.sum(SettlementOrder.total_amount).label("amount"),
            func.sum(SettlementOrder.total_weight).label("weight"),
            func.count(SettlementOrder.id).label("count")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= month_start
        ).first()
        
        # 上月销售额（对比）
        last_month_sales = db.query(
            func.sum(SettlementOrder.total_amount).label("amount")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= last_month_start,
            SettlementOrder.created_at < month_start
        ).first()
        
        # 今日/本月订单数
        today_amount = float(today_sales.amount or 0)
        yesterday_amount = float(yesterday_sales.amount or 0)
        month_amount = float(month_sales.amount or 0)
        last_month_amount = float(last_month_sales.amount or 0)
        
        # 计算同比
        today_change = ((today_amount - yesterday_amount) / yesterday_amount * 100) if yesterday_amount > 0 else 0
        month_change = ((month_amount - last_month_amount) / last_month_amount * 100) if last_month_amount > 0 else 0
        
        # 本月新客户数
        new_customers = db.query(func.count(distinct(SalesOrder.customer_name))).filter(
            SalesOrder.create_time >= month_start,
            ~SalesOrder.customer_name.in_(
                db.query(distinct(SalesOrder.customer_name)).filter(
                    SalesOrder.create_time < month_start
                )
            )
        ).scalar() or 0
        
        # 库存总值（简化计算）
        total_inventory = db.query(func.sum(Inventory.total_weight)).scalar() or 0
        
        # 待处理事项
        pending_settlements = db.query(func.count(SettlementOrder.id)).filter(
            SettlementOrder.status == "pending"
        ).scalar() or 0
        
        # ============= 管理层专用指标 =============
        
        # 今日工费金额
        today_labor = db.query(
            func.sum(SettlementOrder.labor_amount)
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= today_start
        ).scalar() or 0
        
        # 今日收到客人金料克重（已确认的收料单，排除期初）
        today_gold_received = db.query(
            func.sum(GoldReceipt.gold_weight)
        ).filter(
            GoldReceipt.status == "received",
            GoldReceipt.is_initial_balance == False,
            GoldReceipt.received_at.isnot(None),
            GoldReceipt.received_at >= today_start
        ).scalar() or 0
        
        # 今日结价平均金价
        today_avg_gold_price = db.query(
            func.avg(SettlementOrder.gold_price)
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.payment_method.in_(["cash_price", "mixed"]),
            SettlementOrder.created_at >= today_start,
            SettlementOrder.gold_price.isnot(None)
        ).scalar() or 0
        
        # 今日结价克重
        today_cash_price_weight = db.query(
            func.sum(case(
                (SettlementOrder.payment_method == "cash_price", SettlementOrder.total_weight),
                (SettlementOrder.payment_method == "mixed", SettlementOrder.cash_payment_weight),
                else_=0
            ))
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.payment_method.in_(["cash_price", "mixed"]),
            SettlementOrder.created_at >= today_start
        ).scalar() or 0
        
        # 暂借克重：未归还的暂借单总克重（明细级精确计算）
        outstanding_loan_weight = db.query(
            func.sum(LoanDetail.weight)
        ).filter(
            LoanDetail.status == "borrowed",
            LoanDetail.loan_id.in_(
                db.query(LoanOrder.id).filter(
                    LoanOrder.status.in_(["borrowed", "partial_returned"])
                )
            )
        ).scalar() or 0
        
        return {
            "success": True,
            "data": {
                "today": {
                    "sales_amount": today_amount,
                    "sales_weight": float(today_sales.weight or 0),
                    "order_count": int(today_sales.count or 0),
                    "change_percent": round(today_change, 1),
                    "labor_amount": float(today_labor),
                    "gold_received_weight": float(today_gold_received),
                    "avg_gold_price": round(float(today_avg_gold_price), 2),
                    "cash_price_weight": float(today_cash_price_weight)
                },
                "month": {
                    "sales_amount": month_amount,
                    "sales_weight": float(month_sales.weight or 0),
                    "order_count": int(month_sales.count or 0),
                    "change_percent": round(month_change, 1)
                },
                "inventory": {
                    "total_weight": float(total_inventory)
                },
                "loan": {
                    "outstanding_weight": float(outstanding_loan_weight)
                },
                "new_customers": new_customers,
                "pending": {
                    "settlements": pending_settlements
                },
                "updated_at": now.isoformat()
            }
        }
    except Exception as e:
        logger.error(f"获取仪表盘汇总失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# ============= 销售分析 API =============

@router.get("/sales/trends")
async def get_sales_trends(
    period: str = Query("day", description="时间粒度: day/week/month"),
    days: int = Query(30, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取销售趋势数据"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 查询已结算的销售单
        query = db.query(
            func.date(SettlementOrder.created_at).label("date"),
            func.sum(SettlementOrder.total_amount).label("total_amount"),
            func.sum(SettlementOrder.total_weight).label("total_weight"),
            func.sum(SettlementOrder.labor_amount).label("labor_amount"),
            func.count(SettlementOrder.id).label("order_count")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= start_date
        ).group_by(func.date(SettlementOrder.created_at)).order_by(func.date(SettlementOrder.created_at))
        
        results = query.all()
        
        # 按期间聚合
        trends = []
        if period == "day":
            for r in results:
                trends.append({
                    "date": str(r.date),
                    "total_amount": float(r.total_amount or 0),
                    "total_weight": float(r.total_weight or 0),
                    "labor_amount": float(r.labor_amount or 0),
                    "order_count": int(r.order_count or 0)
                })
        elif period == "week":
            # 按周聚合
            weekly_data = {}
            for r in results:
                week_start = r.date - timedelta(days=r.date.weekday())
                week_key = str(week_start)
                if week_key not in weekly_data:
                    weekly_data[week_key] = {
                        "date": week_key,
                        "total_amount": 0,
                        "total_weight": 0,
                        "labor_amount": 0,
                        "order_count": 0
                    }
                weekly_data[week_key]["total_amount"] += float(r.total_amount or 0)
                weekly_data[week_key]["total_weight"] += float(r.total_weight or 0)
                weekly_data[week_key]["labor_amount"] += float(r.labor_amount or 0)
                weekly_data[week_key]["order_count"] += int(r.order_count or 0)
            trends = list(weekly_data.values())
        elif period == "month":
            # 按月聚合
            monthly_data = {}
            for r in results:
                month_key = r.date.strftime("%Y-%m")
                if month_key not in monthly_data:
                    monthly_data[month_key] = {
                        "date": month_key,
                        "total_amount": 0,
                        "total_weight": 0,
                        "labor_amount": 0,
                        "order_count": 0
                    }
                monthly_data[month_key]["total_amount"] += float(r.total_amount or 0)
                monthly_data[month_key]["total_weight"] += float(r.total_weight or 0)
                monthly_data[month_key]["labor_amount"] += float(r.labor_amount or 0)
                monthly_data[month_key]["order_count"] += int(r.order_count or 0)
            trends = list(monthly_data.values())
        
        # 计算汇总
        summary = {
            "total_amount": sum(t["total_amount"] for t in trends),
            "total_weight": sum(t["total_weight"] for t in trends),
            "total_orders": sum(t["order_count"] for t in trends),
            "avg_order_amount": 0
        }
        if summary["total_orders"] > 0:
            summary["avg_order_amount"] = summary["total_amount"] / summary["total_orders"]
        
        return {
            "success": True,
            "data": {
                "trends": trends,
                "summary": summary,
                "period": period,
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取销售趋势失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/sales/top-products")
async def get_top_products(
    limit: int = Query(10, description="返回数量"),
    sort_by: str = Query("amount", description="排序方式: amount/weight/count"),
    days: int = Query(30, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取热销商品排行"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 查询已结算的销售明细
        query = db.query(
            SalesDetail.product_name,
            func.sum(SalesDetail.weight).label("total_weight"),
            func.sum(SalesDetail.total_labor_cost).label("total_labor_cost"),
            func.count(SalesDetail.id).label("sale_count")
        ).join(
            SalesOrder, SalesDetail.order_id == SalesOrder.id
        ).filter(
            SalesOrder.status == "已结算",
            SalesOrder.create_time >= start_date
        ).group_by(SalesDetail.product_name)
        
        # 排序
        if sort_by == "weight":
            query = query.order_by(func.sum(SalesDetail.weight).desc())
        elif sort_by == "count":
            query = query.order_by(func.count(SalesDetail.id).desc())
        else:  # amount
            query = query.order_by(func.sum(SalesDetail.total_labor_cost).desc())
        
        results = query.limit(limit).all()
        
        products = []
        for idx, r in enumerate(results, 1):
            products.append({
                "rank": idx,
                "product_name": r.product_name,
                "total_weight": float(r.total_weight or 0),
                "total_amount": float(r.total_labor_cost or 0),
                "sale_count": int(r.sale_count or 0)
            })
        
        return {
            "success": True,
            "data": {
                "products": products,
                "sort_by": sort_by,
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取热销商品失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/sales/salesperson-performance")
async def get_salesperson_performance(
    days: int = Query(30, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取业务员业绩分析"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 查询业务员业绩
        query = db.query(
            SalesOrder.salesperson,
            func.sum(SalesOrder.total_labor_cost).label("total_amount"),
            func.sum(SalesOrder.total_weight).label("total_weight"),
            func.count(SalesOrder.id).label("order_count"),
            func.count(distinct(SalesOrder.customer_name)).label("customer_count")
        ).filter(
            SalesOrder.status == "已结算",
            SalesOrder.create_time >= start_date
        ).group_by(SalesOrder.salesperson).order_by(
            func.sum(SalesOrder.total_labor_cost).desc()
        )
        
        results = query.all()
        
        salespersons = []
        for idx, r in enumerate(results, 1):
            avg_order = float(r.total_amount or 0) / int(r.order_count) if r.order_count and int(r.order_count) > 0 else 0
            salespersons.append({
                "rank": idx,
                "salesperson": r.salesperson,
                "total_amount": float(r.total_amount or 0),
                "total_weight": float(r.total_weight or 0),
                "order_count": int(r.order_count or 0),
                "customer_count": int(r.customer_count or 0),
                "avg_order_amount": avg_order
            })
        
        return {
            "success": True,
            "data": {
                "salespersons": salespersons,
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取业务员业绩失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/sales/customer-analysis")
async def get_customer_analysis(
    limit: int = Query(20, description="返回数量"),
    days: int = Query(90, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取客户分析数据"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 查询客户购买统计
        query = db.query(
            SalesOrder.customer_name,
            func.sum(SalesOrder.total_labor_cost).label("total_amount"),
            func.sum(SalesOrder.total_weight).label("total_weight"),
            func.count(SalesOrder.id).label("purchase_count"),
            func.min(SalesOrder.create_time).label("first_purchase"),
            func.max(SalesOrder.create_time).label("last_purchase")
        ).filter(
            SalesOrder.status == "已结算",
            SalesOrder.create_time >= start_date
        ).group_by(SalesOrder.customer_name).order_by(
            func.sum(SalesOrder.total_labor_cost).desc()
        ).limit(limit)
        
        results = query.all()
        
        # 计算复购率
        total_customers = db.query(func.count(distinct(SalesOrder.customer_name))).filter(
            SalesOrder.status == "已结算",
            SalesOrder.create_time >= start_date
        ).scalar() or 0
        
        repeat_customers = db.query(func.count(distinct(SalesOrder.customer_name))).filter(
            SalesOrder.status == "已结算",
            SalesOrder.create_time >= start_date
        ).group_by(SalesOrder.customer_name).having(func.count(SalesOrder.id) > 1).count()
        
        repeat_rate = (repeat_customers / total_customers * 100) if total_customers > 0 else 0
        
        customers = []
        for r in results:
            avg_amount = float(r.total_amount or 0) / int(r.purchase_count) if r.purchase_count and int(r.purchase_count) > 0 else 0
            customers.append({
                "customer_name": r.customer_name,
                "total_amount": float(r.total_amount or 0),
                "total_weight": float(r.total_weight or 0),
                "purchase_count": int(r.purchase_count or 0),
                "avg_order_amount": avg_amount,
                "first_purchase": r.first_purchase.isoformat() if r.first_purchase else None,
                "last_purchase": r.last_purchase.isoformat() if r.last_purchase else None
            })
        
        return {
            "success": True,
            "data": {
                "customers": customers,
                "summary": {
                    "total_customers": total_customers,
                    "repeat_customers": repeat_customers,
                    "repeat_rate": round(repeat_rate, 2)
                },
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取客户分析失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# ============= 库存分析 API =============

@router.get("/inventory/value")
async def get_inventory_value(
    db: Session = Depends(get_db)
):
    """获取库存价值统计"""
    try:
        # 按商品统计库存价值（使用最新工费计算）
        product_values = []
        inventories = db.query(Inventory).filter(Inventory.total_weight > 0).all()
        
        for inv in inventories:
            # 获取最新工费
            latest_detail = db.query(InboundDetail).filter(
                InboundDetail.product_name == inv.product_name
            ).order_by(InboundDetail.id.desc()).first()
            
            labor_cost = latest_detail.labor_cost if latest_detail else 0
            value = inv.total_weight * labor_cost
            
            product_values.append({
                "product_name": inv.product_name,
                "weight": float(inv.total_weight),
                "labor_cost": float(labor_cost),
                "value": float(value)
            })
        
        # 按位置统计
        location_values = []
        locations = db.query(Location).filter(Location.is_active == 1).all()
        
        for loc in locations:
            loc_inv = db.query(
                func.sum(LocationInventory.weight).label("total_weight")
            ).filter(
                LocationInventory.location_id == loc.id,
                LocationInventory.weight > 0
            ).first()
            
            total_weight = float(loc_inv.total_weight or 0) if loc_inv else 0
            
            # 计算该位置库存价值
            loc_details = db.query(LocationInventory).filter(
                LocationInventory.location_id == loc.id,
                LocationInventory.weight > 0
            ).all()
            
            total_value = 0
            for ld in loc_details:
                latest = db.query(InboundDetail).filter(
                    InboundDetail.product_name == ld.product_name
                ).order_by(InboundDetail.id.desc()).first()
                if latest:
                    total_value += ld.weight * latest.labor_cost
            
            location_values.append({
                "location_id": loc.id,
                "location_name": loc.name,
                "location_type": loc.location_type,
                "total_weight": total_weight,
                "total_value": float(total_value)
            })
        
        # 汇总
        total_weight = sum(p["weight"] for p in product_values)
        total_value = sum(p["value"] for p in product_values)
        
        return {
            "success": True,
            "data": {
                "by_product": sorted(product_values, key=lambda x: x["value"], reverse=True)[:20],
                "by_location": location_values,
                "summary": {
                    "total_weight": total_weight,
                    "total_value": total_value,
                    "product_count": len(product_values)
                }
            }
        }
    except Exception as e:
        logger.error(f"获取库存价值失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/inventory/turnover")
async def get_inventory_turnover(
    days: int = Query(30, description="计算周期天数"),
    db: Session = Depends(get_db)
):
    """获取库存周转率分析"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 获取期间销售数据
        sales_data = db.query(
            SalesDetail.product_name,
            func.sum(SalesDetail.weight).label("sold_weight")
        ).join(
            SalesOrder, SalesDetail.order_id == SalesOrder.id
        ).filter(
            SalesOrder.status == "已结算",
            SalesOrder.create_time >= start_date
        ).group_by(SalesDetail.product_name).all()
        
        sales_map = {s.product_name: float(s.sold_weight or 0) for s in sales_data}
        
        # 计算每个商品的周转率
        turnover_list = []
        inventories = db.query(Inventory).all()
        
        for inv in inventories:
            sold = sales_map.get(inv.product_name, 0)
            current_stock = float(inv.total_weight or 0)
            avg_stock = current_stock + sold / 2  # 简化计算
            
            if avg_stock > 0:
                turnover_rate = sold / avg_stock
            else:
                turnover_rate = 0
            
            # 计算周转天数
            turnover_days = days / turnover_rate if turnover_rate > 0 else 999
            
            turnover_list.append({
                "product_name": inv.product_name,
                "current_stock": current_stock,
                "sold_weight": sold,
                "turnover_rate": round(turnover_rate, 2),
                "turnover_days": round(turnover_days, 1),
                "status": "fast" if turnover_days < 15 else ("normal" if turnover_days < 60 else "slow")
            })
        
        # 排序
        turnover_list.sort(key=lambda x: x["turnover_rate"], reverse=True)
        
        # 统计
        fast_count = len([t for t in turnover_list if t["status"] == "fast"])
        normal_count = len([t for t in turnover_list if t["status"] == "normal"])
        slow_count = len([t for t in turnover_list if t["status"] == "slow"])
        
        return {
            "success": True,
            "data": {
                "products": turnover_list,
                "summary": {
                    "fast_count": fast_count,
                    "normal_count": normal_count,
                    "slow_count": slow_count,
                    "avg_turnover_rate": sum(t["turnover_rate"] for t in turnover_list) / len(turnover_list) if turnover_list else 0
                },
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取库存周转率失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/inventory/slow-moving")
async def get_slow_moving_products(
    threshold_days: int = Query(30, description="滞销天数阈值"),
    db: Session = Depends(get_db)
):
    """获取滞销商品列表"""
    try:
        now = china_now()
        threshold_date = now - timedelta(days=threshold_days)
        
        # 获取所有有库存的商品
        inventories = db.query(Inventory).filter(Inventory.total_weight > 0).all()
        
        slow_moving = []
        for inv in inventories:
            # 查询最后销售时间
            last_sale = db.query(func.max(SalesOrder.create_time)).join(
                SalesDetail, SalesDetail.order_id == SalesOrder.id
            ).filter(
                SalesDetail.product_name == inv.product_name,
                SalesOrder.status == "已结算"
            ).scalar()
            
            # 查询最后入库时间
            last_inbound = db.query(func.max(InboundOrder.create_time)).join(
                InboundDetail, InboundDetail.order_id == InboundOrder.id
            ).filter(
                InboundDetail.product_name == inv.product_name
            ).scalar()
            
            # 计算滞销天数
            if last_sale:
                days_since_sale = (now - last_sale).days if hasattr(last_sale, 'days') else (now.replace(tzinfo=None) - last_sale).days
            else:
                # 如果从未销售过，从入库时间算起
                if last_inbound:
                    days_since_sale = (now.replace(tzinfo=None) - last_inbound).days if last_inbound.tzinfo is None else (now - last_inbound).days
                else:
                    days_since_sale = 999
            
            if days_since_sale >= threshold_days:
                slow_moving.append({
                    "product_name": inv.product_name,
                    "current_stock": float(inv.total_weight),
                    "days_since_sale": days_since_sale,
                    "last_sale_date": last_sale.isoformat() if last_sale else None,
                    "last_inbound_date": last_inbound.isoformat() if last_inbound else None,
                    "alert_level": "high" if days_since_sale > 90 else ("medium" if days_since_sale > 60 else "low")
                })
        
        # 按天数排序
        slow_moving.sort(key=lambda x: x["days_since_sale"], reverse=True)
        
        return {
            "success": True,
            "data": {
                "products": slow_moving,
                "summary": {
                    "total_count": len(slow_moving),
                    "high_alert": len([p for p in slow_moving if p["alert_level"] == "high"]),
                    "medium_alert": len([p for p in slow_moving if p["alert_level"] == "medium"]),
                    "low_alert": len([p for p in slow_moving if p["alert_level"] == "low"])
                },
                "threshold_days": threshold_days
            }
        }
    except Exception as e:
        logger.error(f"获取滞销商品失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/inventory/distribution")
async def get_inventory_distribution(
    db: Session = Depends(get_db)
):
    """获取库存结构分布"""
    try:
        # 按位置统计
        location_dist = []
        locations = db.query(Location).filter(Location.is_active == 1).all()
        
        for loc in locations:
            loc_inv = db.query(
                func.sum(LocationInventory.weight).label("total_weight"),
                func.count(LocationInventory.id).label("product_count")
            ).filter(
                LocationInventory.location_id == loc.id,
                LocationInventory.weight > 0
            ).first()
            
            location_dist.append({
                "location_id": loc.id,
                "location_name": loc.name,
                "location_type": loc.location_type,
                "total_weight": float(loc_inv.total_weight or 0) if loc_inv else 0,
                "product_count": int(loc_inv.product_count or 0) if loc_inv else 0
            })
        
        # 按商品类别统计（简单实现：按商品名称前缀）
        category_dist = {}
        inventories = db.query(Inventory).filter(Inventory.total_weight > 0).all()
        
        for inv in inventories:
            # 简单分类：取商品名称的前两个字作为类别
            category = inv.product_name[:2] if len(inv.product_name) >= 2 else inv.product_name
            if category not in category_dist:
                category_dist[category] = {"weight": 0, "count": 0}
            category_dist[category]["weight"] += float(inv.total_weight)
            category_dist[category]["count"] += 1
        
        categories = [
            {"category": k, "weight": v["weight"], "count": v["count"]}
            for k, v in category_dist.items()
        ]
        categories.sort(key=lambda x: x["weight"], reverse=True)
        
        # 汇总
        total_weight = sum(l["total_weight"] for l in location_dist)
        
        return {
            "success": True,
            "data": {
                "by_location": location_dist,
                "by_category": categories[:10],  # Top 10类别
                "summary": {
                    "total_weight": total_weight,
                    "location_count": len(location_dist),
                    "category_count": len(categories)
                }
            }
        }
    except Exception as e:
        logger.error(f"获取库存分布失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# ============= 财务分析 API =============

@router.get("/finance/profit")
async def get_profit_analysis(
    days: int = Query(30, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取利润分析"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 按日期计算收入（结算单总额）
        revenue_data = db.query(
            func.date(SettlementOrder.created_at).label("date"),
            func.sum(SettlementOrder.total_amount).label("revenue"),
            func.sum(SettlementOrder.labor_amount).label("labor_revenue")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= start_date
        ).group_by(func.date(SettlementOrder.created_at)).all()
        
        # 按日期计算成本（入库单工费）
        cost_data = db.query(
            func.date(InboundOrder.create_time).label("date"),
            func.sum(InboundDetail.total_cost).label("cost")
        ).join(
            InboundDetail, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundOrder.create_time >= start_date
        ).group_by(func.date(InboundOrder.create_time)).all()
        
        revenue_map = {str(r.date): {"revenue": float(r.revenue or 0), "labor": float(r.labor_revenue or 0)} for r in revenue_data}
        cost_map = {str(c.date): float(c.cost or 0) for c in cost_data}
        
        # 合并数据
        all_dates = sorted(set(list(revenue_map.keys()) + list(cost_map.keys())))
        
        profit_trends = []
        for date in all_dates:
            revenue = revenue_map.get(date, {"revenue": 0, "labor": 0})
            cost = cost_map.get(date, 0)
            profit = revenue["revenue"] - cost
            
            profit_trends.append({
                "date": date,
                "revenue": revenue["revenue"],
                "labor_revenue": revenue["labor"],
                "cost": cost,
                "profit": profit,
                "profit_margin": round(profit / revenue["revenue"] * 100, 2) if revenue["revenue"] > 0 else 0
            })
        
        # 汇总
        total_revenue = sum(p["revenue"] for p in profit_trends)
        total_cost = sum(p["cost"] for p in profit_trends)
        total_profit = total_revenue - total_cost
        
        return {
            "success": True,
            "data": {
                "trends": profit_trends,
                "summary": {
                    "total_revenue": total_revenue,
                    "total_cost": total_cost,
                    "total_profit": total_profit,
                    "profit_margin": round(total_profit / total_revenue * 100, 2) if total_revenue > 0 else 0
                },
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取利润分析失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/finance/cost-structure")
async def get_cost_structure(
    days: int = Query(30, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取成本结构分析"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 入库工费成本
        labor_cost = db.query(
            func.sum(InboundDetail.total_cost).label("total")
        ).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundOrder.create_time >= start_date
        ).scalar() or 0
        
        # 结算单中的原料成本（结价支付时）
        material_cost = db.query(
            func.sum(SettlementOrder.material_amount).label("total")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= start_date,
            SettlementOrder.payment_method == "cash_price"
        ).scalar() or 0
        
        # 按供应商统计入库成本
        supplier_costs = db.query(
            InboundDetail.supplier,
            func.sum(InboundDetail.total_cost).label("cost"),
            func.sum(InboundDetail.weight).label("weight")
        ).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundOrder.create_time >= start_date,
            InboundDetail.supplier.isnot(None)
        ).group_by(InboundDetail.supplier).order_by(
            func.sum(InboundDetail.total_cost).desc()
        ).limit(10).all()
        
        return {
            "success": True,
            "data": {
                "structure": {
                    "labor_cost": float(labor_cost),
                    "material_cost": float(material_cost),
                    "total_cost": float(labor_cost) + float(material_cost)
                },
                "by_supplier": [
                    {
                        "supplier": s.supplier or "未知供应商",
                        "cost": float(s.cost or 0),
                        "weight": float(s.weight or 0)
                    }
                    for s in supplier_costs
                ],
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取成本结构失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/finance/cashflow")
async def get_cashflow(
    days: int = Query(30, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取现金流分析"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 收入：已确认的结算单（现金支付）
        income_data = db.query(
            func.date(SettlementOrder.created_at).label("date"),
            func.sum(SettlementOrder.total_amount).label("amount")
        ).filter(
            SettlementOrder.status.in_(["confirmed", "printed"]),
            SettlementOrder.created_at >= start_date,
            SettlementOrder.payment_method == "cash_price"
        ).group_by(func.date(SettlementOrder.created_at)).all()
        
        # 支出：入库成本（简化为工费成本）
        expense_data = db.query(
            func.date(InboundOrder.create_time).label("date"),
            func.sum(InboundDetail.total_cost).label("amount")
        ).join(
            InboundDetail, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundOrder.create_time >= start_date
        ).group_by(func.date(InboundOrder.create_time)).all()
        
        income_map = {str(i.date): float(i.amount or 0) for i in income_data}
        expense_map = {str(e.date): float(e.amount or 0) for e in expense_data}
        
        # 合并
        all_dates = sorted(set(list(income_map.keys()) + list(expense_map.keys())))
        
        cashflow = []
        running_balance = 0
        for date in all_dates:
            income = income_map.get(date, 0)
            expense = expense_map.get(date, 0)
            net = income - expense
            running_balance += net
            
            cashflow.append({
                "date": date,
                "income": income,
                "expense": expense,
                "net": net,
                "balance": running_balance
            })
        
        # 汇总
        total_income = sum(c["income"] for c in cashflow)
        total_expense = sum(c["expense"] for c in cashflow)
        
        return {
            "success": True,
            "data": {
                "flows": cashflow,
                "summary": {
                    "total_income": total_income,
                    "total_expense": total_expense,
                    "net_cashflow": total_income - total_expense
                },
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取现金流失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/finance/supplier-cost")
async def get_supplier_cost_analysis(
    days: int = Query(90, description="查询天数"),
    db: Session = Depends(get_db)
):
    """获取供应商成本分析"""
    try:
        end_date = china_now()
        start_date = end_date - timedelta(days=days)
        
        # 查询各供应商的入库统计
        supplier_stats = db.query(
            InboundDetail.supplier,
            func.sum(InboundDetail.total_cost).label("total_cost"),
            func.sum(InboundDetail.weight).label("total_weight"),
            func.count(InboundDetail.id).label("inbound_count"),
            func.avg(InboundDetail.labor_cost).label("avg_labor_cost")
        ).join(
            InboundOrder, InboundDetail.order_id == InboundOrder.id
        ).filter(
            InboundOrder.create_time >= start_date,
            InboundDetail.supplier.isnot(None)
        ).group_by(InboundDetail.supplier).order_by(
            func.sum(InboundDetail.total_cost).desc()
        ).all()
        
        suppliers = []
        for s in supplier_stats:
            unit_cost = float(s.total_cost or 0) / float(s.total_weight) if s.total_weight and float(s.total_weight) > 0 else 0
            suppliers.append({
                "supplier": s.supplier,
                "total_cost": float(s.total_cost or 0),
                "total_weight": float(s.total_weight or 0),
                "inbound_count": int(s.inbound_count or 0),
                "avg_labor_cost": round(float(s.avg_labor_cost or 0), 2),
                "unit_cost": round(unit_cost, 2)
            })
        
        return {
            "success": True,
            "data": {
                "suppliers": suppliers,
                "summary": {
                    "supplier_count": len(suppliers),
                    "total_cost": sum(s["total_cost"] for s in suppliers),
                    "total_weight": sum(s["total_weight"] for s in suppliers)
                },
                "days": days
            }
        }
    except Exception as e:
        logger.error(f"获取供应商成本分析失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# ============= 预警中心 API =============

@router.get("/alerts/list")
async def get_alert_list(
    alert_type: Optional[str] = Query(None, description="预警类型: low_stock/slow_moving/abnormal"),
    db: Session = Depends(get_db)
):
    """获取预警列表"""
    try:
        alerts = []
        now = china_now()
        
        # 1. 低库存预警
        if not alert_type or alert_type == "low_stock":
            # 获取预警设置
            from ..models import InventoryAlertSetting
            
            inventories = db.query(Inventory).filter(Inventory.total_weight > 0).all()
            
            for inv in inventories:
                # 查询该商品的预警设置
                setting = db.query(InventoryAlertSetting).filter(
                    InventoryAlertSetting.product_name == inv.product_name,
                    InventoryAlertSetting.is_enabled == 1
                ).first()
                
                min_weight = setting.min_weight if setting else 50.0  # 默认50克
                
                if inv.total_weight < min_weight:
                    alerts.append({
                        "type": "low_stock",
                        "level": "high" if inv.total_weight < min_weight * 0.5 else "medium",
                        "product_name": inv.product_name,
                        "current_value": float(inv.total_weight),
                        "threshold": min_weight,
                        "message": f"库存不足：当前{inv.total_weight:.2f}克，低于阈值{min_weight}克",
                        "created_at": now.isoformat()
                    })
        
        # 2. 滞销预警
        if not alert_type or alert_type == "slow_moving":
            from ..models import InventoryAlertSetting
            
            inventories = db.query(Inventory).filter(Inventory.total_weight > 0).all()
            
            for inv in inventories:
                setting = db.query(InventoryAlertSetting).filter(
                    InventoryAlertSetting.product_name == inv.product_name,
                    InventoryAlertSetting.is_enabled == 1
                ).first()
                
                slow_days = setting.slow_days if setting else 30  # 默认30天
                threshold_date = now - timedelta(days=slow_days)
                
                # 查询最后销售时间
                last_sale = db.query(func.max(SalesOrder.create_time)).join(
                    SalesDetail, SalesDetail.order_id == SalesOrder.id
                ).filter(
                    SalesDetail.product_name == inv.product_name,
                    SalesOrder.status == "已结算"
                ).scalar()
                
                if not last_sale or last_sale < threshold_date.replace(tzinfo=None):
                    days_since = (now.replace(tzinfo=None) - last_sale).days if last_sale else 999
                    alerts.append({
                        "type": "slow_moving",
                        "level": "high" if days_since > 90 else ("medium" if days_since > 60 else "low"),
                        "product_name": inv.product_name,
                        "current_value": days_since,
                        "threshold": slow_days,
                        "message": f"滞销预警：{days_since}天未销售，超过阈值{slow_days}天",
                        "created_at": now.isoformat()
                    })
        
        # 3. 异常预警（负库存）
        if not alert_type or alert_type == "abnormal":
            negative_inv = db.query(Inventory).filter(Inventory.total_weight < 0).all()
            for inv in negative_inv:
                alerts.append({
                    "type": "abnormal",
                    "level": "high",
                    "product_name": inv.product_name,
                    "current_value": float(inv.total_weight),
                    "threshold": 0,
                    "message": f"异常：库存为负数 ({inv.total_weight:.2f}克)",
                    "created_at": now.isoformat()
                })
        
        # 按级别排序
        level_order = {"high": 0, "medium": 1, "low": 2}
        alerts.sort(key=lambda x: level_order.get(x["level"], 3))
        
        # 统计
        summary = {
            "total": len(alerts),
            "high": len([a for a in alerts if a["level"] == "high"]),
            "medium": len([a for a in alerts if a["level"] == "medium"]),
            "low": len([a for a in alerts if a["level"] == "low"]),
            "by_type": {
                "low_stock": len([a for a in alerts if a["type"] == "low_stock"]),
                "slow_moving": len([a for a in alerts if a["type"] == "slow_moving"]),
                "abnormal": len([a for a in alerts if a["type"] == "abnormal"])
            }
        }
        
        return {
            "success": True,
            "data": {
                "alerts": alerts,
                "summary": summary
            }
        }
    except Exception as e:
        logger.error(f"获取预警列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/alerts/settings")
async def get_alert_settings(
    db: Session = Depends(get_db)
):
    """获取预警设置"""
    try:
        from ..models import InventoryAlertSetting
        
        settings = db.query(InventoryAlertSetting).all()
        
        # 获取所有库存商品
        inventories = db.query(Inventory.product_name).all()
        product_names = [i.product_name for i in inventories]
        
        # 合并设置
        setting_map = {s.product_name: s for s in settings}
        
        result = []
        for name in product_names:
            s = setting_map.get(name)
            result.append({
                "product_name": name,
                "min_weight": s.min_weight if s else 50.0,
                "slow_days": s.slow_days if s else 30,
                "is_enabled": bool(s.is_enabled) if s else True
            })
        
        return {
            "success": True,
            "data": {
                "settings": result,
                "defaults": {
                    "min_weight": 50.0,
                    "slow_days": 30
                }
            }
        }
    except Exception as e:
        logger.error(f"获取预警设置失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/alerts/settings")
async def update_alert_settings(
    settings: List[dict],
    db: Session = Depends(get_db)
):
    """更新预警设置"""
    try:
        from ..models import InventoryAlertSetting
        
        for item in settings:
            product_name = item.get("product_name")
            if not product_name:
                continue
            
            existing = db.query(InventoryAlertSetting).filter(
                InventoryAlertSetting.product_name == product_name
            ).first()
            
            if existing:
                existing.min_weight = item.get("min_weight", 50.0)
                existing.slow_days = item.get("slow_days", 30)
                existing.is_enabled = 1 if item.get("is_enabled", True) else 0
            else:
                new_setting = InventoryAlertSetting(
                    product_name=product_name,
                    min_weight=item.get("min_weight", 50.0),
                    slow_days=item.get("slow_days", 30),
                    is_enabled=1 if item.get("is_enabled", True) else 0
                )
                db.add(new_setting)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"已更新{len(settings)}条预警设置"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新预警设置失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


