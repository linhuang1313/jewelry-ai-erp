"""
金料采购管理路由 - 从供应商采购金料的全流程（收料→结价→付款）
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, desc
from typing import Optional
from datetime import datetime
import logging

from ..database import get_db
from ..timezone_utils import china_now
from ..models import GoldPurchaseOrder, GoldPurchasePayment, Supplier
from ..schemas import (
    GoldPurchaseOrderCreate,
    GoldPurchaseOrderPrice,
    GoldPurchasePaymentCreate,
    GoldPurchaseOrderResponse,
    GoldPurchasePaymentResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gold-purchase", tags=["金料采购"])


def _generate_order_no(db: Session) -> str:
    now = china_now()
    prefix = f"CG{now.strftime('%y%m%d')}"
    last = db.query(GoldPurchaseOrder).filter(
        GoldPurchaseOrder.order_no.like(f"{prefix}%")
    ).order_by(desc(GoldPurchaseOrder.order_no)).first()
    if last:
        seq = int(last.order_no[-3:]) + 1
    else:
        seq = 1
    return f"{prefix}{seq:03d}"


def _generate_payment_no(db: Session) -> str:
    now = china_now()
    prefix = f"FK{now.strftime('%y%m%d')}"
    last = db.query(GoldPurchasePayment).filter(
        GoldPurchasePayment.payment_no.like(f"{prefix}%")
    ).order_by(desc(GoldPurchasePayment.payment_no)).first()
    if last:
        seq = int(last.payment_no[-3:]) + 1
    else:
        seq = 1
    return f"{prefix}{seq:03d}"


def _to_response(order: GoldPurchaseOrder) -> dict:
    total_amount = float(order.total_amount) if order.total_amount else None
    paid_amount = float(order.paid_amount or 0)
    return {
        "id": order.id,
        "order_no": order.order_no,
        "supplier_id": order.supplier_id,
        "supplier_name": order.supplier_name,
        "gold_weight": float(order.gold_weight),
        "gold_fineness": order.gold_fineness or "足金999",
        "conversion_rate": float(order.conversion_rate or 1),
        "settled_weight": float(order.settled_weight) if order.settled_weight else None,
        "gold_price": float(order.gold_price) if order.gold_price else None,
        "total_amount": total_amount,
        "paid_amount": paid_amount,
        "unpaid_amount": round(total_amount - paid_amount, 2) if total_amount else None,
        "status": order.status,
        "receive_date": order.receive_date,
        "price_date": order.price_date,
        "created_by": order.created_by,
        "priced_by": order.priced_by,
        "create_time": order.create_time,
        "update_time": order.update_time,
        "remark": order.remark,
        "payments": [
            {
                "id": p.id,
                "purchase_order_id": p.purchase_order_id,
                "payment_no": p.payment_no,
                "payment_amount": float(p.payment_amount),
                "payment_method": p.payment_method,
                "payment_date": p.payment_date,
                "created_by": p.created_by,
                "create_time": p.create_time,
                "remark": p.remark,
            }
            for p in (order.payments or [])
        ],
    }


# ============= 采购单 CRUD =============

@router.post("/orders")
async def create_purchase_order(
    data: GoldPurchaseOrderCreate,
    created_by: str = Query(default="料部", description="创建人"),
    db: Session = Depends(get_db),
):
    """创建金料采购单（收料）"""
    supplier = db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")

    if data.gold_weight <= 0:
        raise HTTPException(status_code=400, detail="金重必须大于0")

    settled_weight = round(data.gold_weight * data.conversion_rate, 4)

    order = GoldPurchaseOrder(
        order_no=_generate_order_no(db),
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        gold_weight=data.gold_weight,
        gold_fineness=data.gold_fineness,
        conversion_rate=data.conversion_rate,
        settled_weight=settled_weight,
        status="pending",
        receive_date=data.receive_date or china_now(),
        created_by=created_by,
        remark=data.remark,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    logger.info(f"创建金料采购单: {order.order_no}, 供应商={supplier.name}, 金重={data.gold_weight}g")
    return {"success": True, "data": _to_response(order)}


@router.get("/orders")
async def list_purchase_orders(
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """查询金料采购单列表"""
    query = db.query(GoldPurchaseOrder).options(
        joinedload(GoldPurchaseOrder.payments)
    )

    if status:
        query = query.filter(GoldPurchaseOrder.status == status)
    if supplier_id:
        query = query.filter(GoldPurchaseOrder.supplier_id == supplier_id)
    if start_date:
        query = query.filter(GoldPurchaseOrder.receive_date >= start_date)
    if end_date:
        query = query.filter(GoldPurchaseOrder.receive_date <= end_date + " 23:59:59")

    total = query.count()
    orders = query.order_by(desc(GoldPurchaseOrder.create_time)).offset(offset).limit(limit).all()

    # unique 去重（joinedload 可能导致重复）
    seen = set()
    unique_orders = []
    for o in orders:
        if o.id not in seen:
            seen.add(o.id)
            unique_orders.append(o)

    return {
        "success": True,
        "data": [_to_response(o) for o in unique_orders],
        "total": total,
        "summary": {
            "total_weight": float(sum(float(o.gold_weight or 0) for o in unique_orders)),
            "total_amount": float(sum(float(o.total_amount or 0) for o in unique_orders)),
            "total_paid": float(sum(float(o.paid_amount or 0) for o in unique_orders)),
            "total_unpaid": float(sum(
                (float(o.total_amount or 0) - float(o.paid_amount or 0))
                for o in unique_orders if o.total_amount
            )),
            "pending_count": len([o for o in unique_orders if o.status == "pending"]),
            "priced_count": len([o for o in unique_orders if o.status == "priced"]),
            "partial_paid_count": len([o for o in unique_orders if o.status == "partial_paid"]),
            "paid_count": len([o for o in unique_orders if o.status == "paid"]),
        },
    }


@router.get("/orders/{order_id}")
async def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    """获取单个采购单详情"""
    order = db.query(GoldPurchaseOrder).options(
        joinedload(GoldPurchaseOrder.payments)
    ).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    return {"success": True, "data": _to_response(order)}


@router.put("/orders/{order_id}")
async def update_purchase_order(
    order_id: int,
    data: GoldPurchaseOrderCreate,
    db: Session = Depends(get_db),
):
    """修改采购单（仅待结价状态可修改）"""
    order = db.query(GoldPurchaseOrder).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="只有待结价的采购单可以修改")

    supplier = db.query(Supplier).filter(Supplier.id == data.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")

    order.supplier_id = supplier.id
    order.supplier_name = supplier.name
    order.gold_weight = data.gold_weight
    order.gold_fineness = data.gold_fineness
    order.conversion_rate = data.conversion_rate
    order.settled_weight = round(data.gold_weight * data.conversion_rate, 4)
    order.receive_date = data.receive_date or order.receive_date
    order.remark = data.remark
    db.commit()
    db.refresh(order)

    return {"success": True, "data": _to_response(order)}


@router.delete("/orders/{order_id}")
async def delete_purchase_order(order_id: int, db: Session = Depends(get_db)):
    """删除采购单（仅待结价状态可删除）"""
    order = db.query(GoldPurchaseOrder).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="只有待结价的采购单可以删除")

    db.delete(order)
    db.commit()
    return {"success": True, "message": f"已删除采购单 {order.order_no}"}


# ============= 结价 =============

@router.post("/orders/{order_id}/price")
async def price_purchase_order(
    order_id: int,
    data: GoldPurchaseOrderPrice,
    priced_by: str = Query(default="料部", description="结价人"),
    db: Session = Depends(get_db),
):
    """金料采购单结价（填入金价，自动计算金额）"""
    order = db.query(GoldPurchaseOrder).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="只有待结价的采购单可以结价")
    if data.gold_price <= 0:
        raise HTTPException(status_code=400, detail="金价必须大于0")

    settled_weight = float(order.settled_weight or order.gold_weight)
    total_amount = round(settled_weight * data.gold_price, 2)

    order.gold_price = data.gold_price
    order.total_amount = total_amount
    order.status = "priced"
    order.price_date = china_now()
    order.priced_by = priced_by
    db.commit()
    db.refresh(order)

    logger.info(f"金料采购单结价: {order.order_no}, 金价={data.gold_price}, 金额={total_amount}")
    return {"success": True, "data": _to_response(order)}


@router.post("/orders/{order_id}/unprice")
async def unprice_purchase_order(order_id: int, db: Session = Depends(get_db)):
    """撤销结价（仅待付款且未付款可撤销）"""
    order = db.query(GoldPurchaseOrder).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status != "priced":
        raise HTTPException(status_code=400, detail="只有待付款状态可以撤销结价")
    if float(order.paid_amount or 0) > 0:
        raise HTTPException(status_code=400, detail="已有付款记录，无法撤销结价")

    order.gold_price = None
    order.total_amount = None
    order.status = "pending"
    order.price_date = None
    order.priced_by = None
    db.commit()
    db.refresh(order)

    return {"success": True, "data": _to_response(order)}


# ============= 付款 =============

@router.post("/orders/{order_id}/pay")
async def pay_purchase_order(
    order_id: int,
    data: GoldPurchasePaymentCreate,
    created_by: str = Query(default="财务", description="付款人"),
    db: Session = Depends(get_db),
):
    """金料采购单付款"""
    order = db.query(GoldPurchaseOrder).options(
        joinedload(GoldPurchaseOrder.payments)
    ).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status not in ("priced", "partial_paid"):
        raise HTTPException(status_code=400, detail="只有已结价或部分付款的采购单可以付款")
    if data.payment_amount <= 0:
        raise HTTPException(status_code=400, detail="付款金额必须大于0")

    total_amount = float(order.total_amount or 0)
    paid_so_far = float(order.paid_amount or 0)
    remaining = round(total_amount - paid_so_far, 2)

    if data.payment_amount > remaining + 0.01:
        raise HTTPException(status_code=400, detail=f"付款金额({data.payment_amount})超过剩余欠款({remaining})")

    payment = GoldPurchasePayment(
        purchase_order_id=order.id,
        payment_no=_generate_payment_no(db),
        payment_amount=data.payment_amount,
        payment_method=data.payment_method,
        payment_date=data.payment_date or china_now(),
        created_by=created_by,
        remark=data.remark,
    )
    db.add(payment)

    new_paid = round(paid_so_far + data.payment_amount, 2)
    order.paid_amount = new_paid

    if new_paid >= total_amount - 0.01:
        order.status = "paid"
    else:
        order.status = "partial_paid"

    db.commit()
    db.refresh(order)

    logger.info(f"金料采购单付款: {order.order_no}, 付款={data.payment_amount}, 累计={new_paid}/{total_amount}")
    return {"success": True, "data": _to_response(order)}


# ============= 取消 =============

@router.post("/orders/{order_id}/cancel")
async def cancel_purchase_order(order_id: int, db: Session = Depends(get_db)):
    """取消采购单"""
    order = db.query(GoldPurchaseOrder).filter(GoldPurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status == "paid":
        raise HTTPException(status_code=400, detail="已结清的采购单无法取消")
    if float(order.paid_amount or 0) > 0:
        raise HTTPException(status_code=400, detail="已有付款记录，无法取消")

    order.status = "cancelled"
    db.commit()
    return {"success": True, "message": f"已取消采购单 {order.order_no}"}


# ============= 汇总统计 =============

@router.get("/summary")
async def get_purchase_summary(
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """获取金料采购汇总（按供应商分组）"""
    query = db.query(
        GoldPurchaseOrder.supplier_id,
        GoldPurchaseOrder.supplier_name,
        func.sum(GoldPurchaseOrder.gold_weight).label("total_weight"),
        func.sum(GoldPurchaseOrder.total_amount).label("total_amount"),
        func.sum(GoldPurchaseOrder.paid_amount).label("total_paid"),
        func.count(GoldPurchaseOrder.id).label("order_count"),
    ).filter(
        GoldPurchaseOrder.status != "cancelled"
    )

    if supplier_id:
        query = query.filter(GoldPurchaseOrder.supplier_id == supplier_id)

    rows = query.group_by(
        GoldPurchaseOrder.supplier_id,
        GoldPurchaseOrder.supplier_name,
    ).all()

    suppliers = []
    total_weight = 0
    total_amount = 0
    total_paid = 0
    for row in rows:
        w = float(row.total_weight or 0)
        a = float(row.total_amount or 0)
        p = float(row.total_paid or 0)
        suppliers.append({
            "supplier_id": row.supplier_id,
            "supplier_name": row.supplier_name,
            "total_weight": round(w, 3),
            "total_amount": round(a, 2),
            "total_paid": round(p, 2),
            "total_unpaid": round(a - p, 2),
            "order_count": row.order_count,
        })
        total_weight += w
        total_amount += a
        total_paid += p

    suppliers.sort(key=lambda x: x["total_unpaid"], reverse=True)

    return {
        "success": True,
        "summary": {
            "total_weight": round(total_weight, 3),
            "total_amount": round(total_amount, 2),
            "total_paid": round(total_paid, 2),
            "total_unpaid": round(total_amount - total_paid, 2),
            "supplier_count": len(suppliers),
        },
        "suppliers": suppliers,
    }
