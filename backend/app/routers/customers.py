"""
客户管理路由
"""
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from ..timezone_utils import china_now
from typing import Optional, List, Dict, Any
import logging
import io
import csv
import time

from ..database import get_db
from ..utils.response import (
    success_response, error_response, paginated_response,
    not_found_response, conflict_response, server_error_response, ErrorCode
)
from ..models import (
    Customer, SalesOrder, SalesDetail, ReturnOrder,
    AccountReceivable, CustomerTransaction, CustomerGoldDeposit,
    CustomerGoldDepositTransaction, SettlementOrder
)
from ..models.finance import PaymentRecord, GoldReceipt
from ..schemas import CustomerCreate, CustomerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/customers", tags=["客户管理"])


@router.post("")
async def create_customer(
    customer_data: CustomerCreate,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """创建客户"""
    # 权限检查 - 需要 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限（创建/编辑/删除）")
    
    try:
        # 检查客户是否已存在
        existing = db.query(Customer).filter(
            Customer.name == customer_data.name,
            Customer.status == "active"
        ).first()
        
        if existing:
            return conflict_response(
                message=f"客户 {customer_data.name} 已存在",
            )
        
        # 生成客户编号
        customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
        
        customer = Customer(
            customer_no=customer_no,
            **customer_data.model_dump()
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        
        return success_response(
            data={"customer": CustomerResponse.model_validate(customer).model_dump(mode='json')},
            message=f"客户创建成功：{customer.name}",
            code=ErrorCode.CREATED
        )
    except Exception as e:
        db.rollback()
        logger.error(f"创建客户失败: {e}", exc_info=True)
        return server_error_response(message=f"创建客户失败: {str(e)}")


@router.get("")
async def get_customers(
    name: Optional[str] = None,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户列表"""
    # 权限检查 - 需要 can_view_customers 或 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_view_customers') and not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看客户】的权限")
    
    try:
        query = db.query(Customer).filter(Customer.status == "active")
        
        if name:
            query = query.filter(Customer.name.contains(name))
        
        customers = query.order_by(desc(Customer.create_time)).all()
        
        return success_response(
            data={"customers": [CustomerResponse.model_validate(c).model_dump(mode='json') for c in customers]},
            message="查询成功"
        )
    except Exception as e:
        logger.error(f"查询客户失败: {e}", exc_info=True)
        return server_error_response(message=f"查询客户失败: {str(e)}")


@router.get("/suggest-salesperson")
async def suggest_salesperson(customer_name: str, db: Session = Depends(get_db)):
    """根据客户名智能推荐业务员（基于历史销售记录）"""
    try:
        if not customer_name or not customer_name.strip():
            return success_response(
                data={"salesperson": None, "hint": "请输入客户名", "is_new_customer": None}
            )
        
        customer_name = customer_name.strip()
        
        # 查找该客户最近一次的销售单
        latest_order = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer_name,
            SalesOrder.status != "已取消"
        ).order_by(SalesOrder.create_time.desc()).first()
        
        if latest_order and latest_order.salesperson:
            last_date = latest_order.create_time.strftime('%Y-%m-%d') if latest_order.create_time else "未知"
            return success_response(
                data={
                    "salesperson": latest_order.salesperson,
                    "hint": f"已自动匹配业务员（上次服务：{last_date}）",
                    "is_new_customer": False
                }
            )
        
        # 如果没有历史记录，返回空
        return success_response(
            data={
                "salesperson": None,
                "hint": "新客户，请手动输入业务员",
                "is_new_customer": True
            }
        )
    
    except Exception as e:
        logger.error(f"查询业务员推荐失败: {e}", exc_info=True)
        return server_error_response(message=f"查询业务员推荐失败: {str(e)}")


# ============= 客户欠款查询 API =============
# 注意：此路由必须在 /{customer_id} 之前定义，否则会被错误匹配

@router.get("/debt-summary")
async def get_customer_debt_summary(
    search: Optional[str] = Query(None, description="搜索客户名称"),
    sort_by: str = Query("total_debt", description="排序字段: cash_debt/gold_debt/total_debt/name"),
    sort_order: str = Query("desc", description="排序方向: asc/desc"),
    hide_zero: bool = Query(True, description="隐藏无欠款客户"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户欠款汇总列表
    
    返回所有客户的现金欠款和金料欠款情况，支持搜索和排序。
    业务员和结算专员都可以查询所有客户。
    """
    from ..middleware.permissions import has_permission
    # 业务员和结算专员都可以查询
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_query_customer_sales') or
        has_permission(user_role, 'can_create_settlement')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足：您没有查看客户欠款的权限")
    
    try:
        # 查询所有活跃客户
        query = db.query(Customer).filter(Customer.status == "active")
        
        if search:
            query = query.filter(Customer.name.contains(search))
        
        customers = query.all()
        customer_ids = [c.id for c in customers]
        customer_names = [c.name for c in customers]
        
        # ========== 批量查询优化：4次查询代替 N*4 次查询 ==========
        
        # 1. 批量查询现金欠款（按 customer_id 聚合）
        cash_debt_map = {}
        if customer_ids:
            cash_results = db.query(
                AccountReceivable.customer_id,
                func.sum(AccountReceivable.unpaid_amount).label('total_debt')
            ).filter(
                AccountReceivable.customer_id.in_(customer_ids),
                AccountReceivable.status.in_(["unpaid", "overdue"])
            ).group_by(AccountReceivable.customer_id).all()
            
            for row in cash_results:
                cash_debt_map[row.customer_id] = float(row.total_debt or 0)
        
        # 2. 批量查询金料账户净值（使用历史交易计算，优化为批量查询）
        net_gold_map = {}
        settlement_gold_map = {}  # 结算欠料
        receipts_gold_map = {}    # 来料
        
        if customer_ids:
            try:
                # 批量查询结算欠料（一次查询所有客户）
                # 注意：需要在 Python 中过滤 payment_method，因为需要区分 physical_gold 和 mixed
                settlements = db.query(
                    SalesOrder.customer_id,
                    SettlementOrder.payment_method,
                    SettlementOrder.physical_gold_weight,
                    SettlementOrder.gold_payment_weight
                ).join(SettlementOrder, SettlementOrder.sales_order_id == SalesOrder.id).filter(
                    SalesOrder.customer_id.in_(customer_ids),
                    SettlementOrder.status.in_(['confirmed', 'printed'])
                ).all()
                
                for row in settlements:
                    cid = row.customer_id
                    if cid not in settlement_gold_map:
                        settlement_gold_map[cid] = 0.0
                    if row.payment_method == 'physical_gold':
                        settlement_gold_map[cid] += row.physical_gold_weight or 0
                    elif row.payment_method == 'mixed':
                        settlement_gold_map[cid] += row.gold_payment_weight or 0
                
                # 批量查询来料（一次查询所有客户）
                receipts = db.query(
                    GoldReceipt.customer_id,
                    func.sum(GoldReceipt.gold_weight).label('total_weight')
                ).filter(
                    GoldReceipt.customer_id.in_(customer_ids),
                    GoldReceipt.status == 'received'
                ).group_by(GoldReceipt.customer_id).all()
                
                for row in receipts:
                    receipts_gold_map[row.customer_id] = float(row.total_weight or 0)
                
                # 计算每个客户的净金料
                for cid in customer_ids:
                    settlement = settlement_gold_map.get(cid, 0.0)
                    receipt = receipts_gold_map.get(cid, 0.0)
                    net_gold_map[cid] = receipt - settlement
            except Exception as e:
                logger.warning(f"批量查询金料账户时出错: {e}")
        
        # 4. 批量查询最后交易时间（按客户名称）
        last_tx_map = {}
        if customer_names:
            # 使用子查询获取每个客户名称的最后交易时间
            last_orders = db.query(
                SalesOrder.customer_name,
                func.max(SalesOrder.create_time).label('last_time')
            ).filter(
                SalesOrder.customer_name.in_(customer_names)
            ).group_by(SalesOrder.customer_name).all()
            
            for row in last_orders:
                if row.last_time:
                    last_tx_map[row.customer_name] = row.last_time.strftime("%Y-%m-%d")
        
        # 5. 批量查询每个客户最常用的业务员
        salesperson_map = {}
        if customer_names:
            # 查询每个客户最常用的业务员（按销售次数统计）
            salesperson_results = db.query(
                SalesOrder.customer_name,
                SalesOrder.salesperson,
                func.count(SalesOrder.id).label('order_count')
            ).filter(
                SalesOrder.customer_name.in_(customer_names),
                SalesOrder.status != "已取消",
                SalesOrder.salesperson.isnot(None)
            ).group_by(
                SalesOrder.customer_name,
                SalesOrder.salesperson
            ).order_by(
                SalesOrder.customer_name,
                desc('order_count')
            ).all()
            
            # 为每个客户选择订单数最多的业务员
            for row in salesperson_results:
                if row.customer_name not in salesperson_map:
                    salesperson_map[row.customer_name] = row.salesperson
        
        # ========== 构建欠款数据 ==========
        # 单一账户模式：net_gold 直接从 current_balance 获取
        # 正数 = 客人有存料
        # 负数 = 客人欠料
        debt_list = []
        total_cash_debt = 0.0
        total_net_gold = 0.0
        
        for customer in customers:
            cash_debt = cash_debt_map.get(customer.id, 0.0)
            net_gold = net_gold_map.get(customer.id, 0.0)  # 直接获取净金料值
            last_transaction_date = last_tx_map.get(customer.name)
            
            # 单一账户模式：net_gold 就是最终值
            # 正数 = 存料，负数 = 欠料
            gold_balance = -net_gold  # 保持兼容：正数=欠料
            
            # 如果隐藏无欠款客户（现金欠款为0且金料净额为0）
            if hide_zero and cash_debt <= 0 and abs(gold_balance) < 0.001:
                continue
            
            debt_list.append({
                "customer_id": customer.id,
                "customer_no": customer.customer_no,
                "customer_name": customer.name,
                "phone": customer.phone,
                "salesperson": salesperson_map.get(customer.name, ""),  # 业务员
                "cash_debt": round(cash_debt, 2),
                "net_gold": round(net_gold, 3),  # 单一账户净值（正=存料，负=欠料）
                "gold_balance": round(gold_balance, 3),  # 兼容字段（正=欠料）
                # 保留原字段用于兼容
                "gold_debt": round(max(0, -net_gold), 3),  # 欠料（负值的绝对值）
                "gold_deposit": round(max(0, net_gold), 3),  # 存料（正值部分）
                "total_debt": round(cash_debt, 2),
                "last_transaction_date": last_transaction_date
            })
            
            total_cash_debt += cash_debt
            total_net_gold += net_gold
        
        # 排序
        reverse = sort_order == "desc"
        if sort_by == "cash_debt":
            debt_list.sort(key=lambda x: x["cash_debt"], reverse=reverse)
        elif sort_by == "gold_debt" or sort_by == "gold_balance":
            debt_list.sort(key=lambda x: x["gold_balance"], reverse=reverse)
        elif sort_by == "name":
            debt_list.sort(key=lambda x: x["customer_name"], reverse=reverse)
        else:  # total_debt
            debt_list.sort(key=lambda x: (x["cash_debt"], x["gold_balance"]), reverse=reverse)
        
        # 分页
        total = len(debt_list)
        debt_list = debt_list[skip:skip + limit]
        
        return success_response(
            data={
                "items": debt_list,
                "total": total,
                "summary": {
                    "total_cash_debt": round(total_cash_debt, 2),
                    "total_net_gold": round(total_net_gold, 3),
                    "total_gold_balance": round(-total_net_gold, 3),
                    "customer_count": total
                }
            },
            message="查询成功"
        )
        
    except Exception as e:
        logger.error(f"查询客户欠款汇总失败: {e}", exc_info=True)
        return server_error_response(message=f"查询失败: {str(e)}")


@router.get("/chat-debt-query")
async def chat_debt_query(
    customer_name: str = Query(..., description="客户名称（支持模糊匹配）"),
    query_type: str = Query(default="all", description="查询类型：all/cash_debt/gold_debt/gold_deposit"),
    date_start: Optional[str] = Query(default=None, description="开始日期 YYYY-MM-DD"),
    date_end: Optional[str] = Query(default=None, description="结束日期 YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    聊天查询客户账务（供AI聊天使用）
    返回客户的欠款、欠料、存料等财务信息
    """
    try:
        # 1. 优先精确匹配客户名
        customer = db.query(Customer).filter(
            Customer.name == customer_name,
            Customer.status == "active"
        ).first()
        
        if not customer:
            # 2. 精确匹配失败，尝试模糊匹配（优先匹配最短名称，避免错误匹配）
            candidates = db.query(Customer).filter(
                Customer.name.contains(customer_name),
                Customer.status == "active"
            ).all()
            if candidates:
                # 优先选择名称长度最接近搜索词的客户
                customer = min(candidates, key=lambda c: abs(len(c.name) - len(customer_name)))
        
        if not customer:
            return not_found_response(message=f"未找到客户：{customer_name}")
        
        customer_id = customer.id
        
        # 2. 解析日期范围
        start_date = None
        end_date = None
        if date_start:
            try:
                start_date = datetime.strptime(date_start, "%Y-%m-%d")
            except:
                pass
        if date_end:
            try:
                end_date = datetime.strptime(date_end, "%Y-%m-%d")
                # 设置为当天结束时间
                end_date = end_date.replace(hour=23, minute=59, second=59)
            except:
                pass
        
        result = {
            "success": True,
            "customer": {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "customer_no": customer.customer_no
            },
            "query_period": {
                "start": date_start,
                "end": date_end
            }
        }
        
        # 3. 查询现金欠款（使用历史交易汇总方式，与财务对账单一致）
        # Bug #30 fix: 始终查询 cash_debt，确保 AI 能看到完整账务数据
        logger.info(f"[诊断-chat_debt_query] query_type = '{query_type}'")
        # 不再根据 query_type 过滤，始终查询现金账户
        if True:  # 原条件: query_type in ["all", "cash_debt"]
            cash_debt = 0.0
            cash_transactions = []
            try:
                # 计算结算金额（cash_price + mixed的现金部分 + labor_amount）
                total_settlement_cash = 0.0
                settlements_query = db.query(SettlementOrder).join(SalesOrder).filter(
                    SalesOrder.customer_id == customer_id,
                    SettlementOrder.status.in_(['confirmed', 'printed'])
                )
                
                if start_date:
                    settlements_query = settlements_query.filter(
                        SettlementOrder.created_at >= start_date
                    )
                if end_date:
                    settlements_query = settlements_query.filter(
                        SettlementOrder.created_at <= end_date
                    )
                
                settlements = settlements_query.all()
                for s in settlements:
                    if s.payment_method == 'cash_price':
                        total_settlement_cash += s.total_amount or 0
                    elif s.payment_method == 'mixed':
                        # 混合支付：只计算现金部分（cash_payment_weight * gold_price）
                        if s.cash_payment_weight and s.gold_price:
                            total_settlement_cash += s.cash_payment_weight * s.gold_price
                        total_settlement_cash += s.labor_amount or 0  # 工费总是现金
                
                # 查询收款记录
                payments_query = db.query(PaymentRecord).filter(
                    PaymentRecord.customer_id == customer_id
                )
                
                if start_date:
                    payments_query = payments_query.filter(
                        PaymentRecord.payment_date >= start_date.date()
                    )
                if end_date:
                    payments_query = payments_query.filter(
                        PaymentRecord.payment_date <= end_date.date()
                    )
                
                total_payments = db.query(func.coalesce(func.sum(PaymentRecord.amount), 0)).filter(
                    PaymentRecord.customer_id == customer_id
                )
                if start_date:
                    total_payments = total_payments.filter(PaymentRecord.payment_date >= start_date.date())
                if end_date:
                    total_payments = total_payments.filter(PaymentRecord.payment_date <= end_date.date())
                
                total_payments = total_payments.scalar() or 0
                
                # 净欠款 = 结算现金 - 收款（正数=欠款，负数=预收款）
                cash_debt = float(total_settlement_cash) - float(total_payments)
                
                # 获取交易明细用于展示
                payments = payments_query.order_by(desc(PaymentRecord.create_time)).limit(20).all()
                for p in payments:
                    payment_method_label = {
                        'bank_transfer': '银行转账',
                        'cash': '现金',
                        'wechat': '微信',
                        'alipay': '支付宝',
                        'card': '刷卡'
                    }.get(p.payment_method, p.payment_method)
                    
                    cash_transactions.append({
                        "id": p.id,
                        "type": "payment",
                        "description": f"{payment_method_label} 收款",
                        "amount": p.amount,
                        "payment_date": p.payment_date.isoformat() if p.payment_date else None,
                        "created_at": p.create_time.isoformat() if p.create_time else None
                    })
                
                # 添加结算单明细
                for s in settlements[:20]:
                    cash_transactions.append({
                        "id": s.id,
                        "type": "settlement",
                        "description": f"销售结算（结算单号: {s.settlement_no}）",
                        "amount": s.total_amount if s.payment_method == 'cash_price' else (s.cash_payment_weight * s.gold_price if s.payment_method == 'mixed' and s.cash_payment_weight and s.gold_price else 0) + (s.labor_amount or 0),
                        "created_at": s.created_at.isoformat() if s.created_at else None
                    })
                
            except Exception as e:
                logger.warning(f"查询现金欠款出错: {e}", exc_info=True)
            
            result["cash_debt"] = cash_debt
            result["cash_transactions"] = cash_transactions
        
        # 4. 查询金料账户（使用历史交易汇总方式，与财务对账单一致）
        # Bug #30 fix: 始终查询 net_gold，确保 AI 能看到完整账务数据
        if True:  # 原条件: query_type in ["all", "gold_debt", "gold_deposit"]
            net_gold = 0.0  # 净金料值（正数=欠料，负数=存料）
            gold_transactions = []
            deposit_transactions = []
            
            try:
                # 计算结算金料（physical_gold + mixed的金料部分）
                total_settlement_gold = 0.0
                settlements_query = db.query(SettlementOrder).join(SalesOrder).filter(
                    SalesOrder.customer_id == customer_id,
                    SettlementOrder.status.in_(['confirmed', 'printed'])
                )
                
                if start_date:
                    settlements_query = settlements_query.filter(
                        SettlementOrder.created_at >= start_date
                    )
                if end_date:
                    settlements_query = settlements_query.filter(
                        SettlementOrder.created_at <= end_date
                    )
                
                settlements = settlements_query.all()
                for s in settlements:
                    if s.payment_method == 'physical_gold':
                        total_settlement_gold += s.physical_gold_weight or 0
                    elif s.payment_method == 'mixed':
                        total_settlement_gold += s.gold_payment_weight or 0
                
                # 查询来料记录
                receipts_query = db.query(GoldReceipt).filter(
                    GoldReceipt.customer_id == customer_id,
                    GoldReceipt.status == 'received'
                )
                
                if start_date:
                    receipts_query = receipts_query.filter(
                        GoldReceipt.created_at >= start_date
                    )
                if end_date:
                    receipts_query = receipts_query.filter(
                        GoldReceipt.created_at <= end_date
                    )
                
                total_receipts_gold = db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
                    GoldReceipt.customer_id == customer_id,
                    GoldReceipt.status == 'received'
                )
                if start_date:
                    total_receipts_gold = total_receipts_gold.filter(GoldReceipt.created_at >= start_date)
                if end_date:
                    total_receipts_gold = total_receipts_gold.filter(GoldReceipt.created_at <= end_date)
                
                total_receipts_gold = total_receipts_gold.scalar() or 0
                
                # 净金料 = 结算欠料 - 来料（正数=欠料，负数=存料）
                net_gold = float(total_settlement_gold) - float(total_receipts_gold)
                
                # 获取结算单明细用于展示
                for s in settlements[:20]:
                    gold_amount = 0.0
                    if s.payment_method == 'physical_gold':
                        gold_amount = s.physical_gold_weight or 0
                    elif s.payment_method == 'mixed':
                        gold_amount = s.gold_payment_weight or 0
                    
                    if gold_amount > 0:
                        gold_transactions.append({
                            "id": s.id,
                            "type": "settlement",
                            "type_label": "销售结算",
                            "gold_weight": gold_amount,
                            "order_no": s.settlement_no,
                            "created_at": s.created_at.isoformat() if s.created_at else None,
                            "remark": s.remark or ""
                        })
                
                # 获取来料记录明细用于展示
                receipts = receipts_query.order_by(desc(GoldReceipt.created_at)).limit(20).all()
                for r in receipts:
                    deposit_transactions.append({
                        "id": r.id,
                        "type": "receipt",
                        "type_label": "客户来料",
                        "amount": r.gold_weight,
                        "gold_weight": r.gold_weight,
                        "order_no": r.receipt_no,
                        "gold_fineness": r.gold_fineness,
                        "created_at": r.created_at.isoformat() if r.created_at else None,
                        "remark": r.remark or ""
                    })
                    
            except Exception as e:
                logger.warning(f"查询金料账户出错: {e}")
            
            # 单一账户模式：从 net_gold 计算兼容字段
            # 语义：net_gold = 结算欠料 - 来料（正数=欠料，负数=存料）
            result["net_gold"] = net_gold  # 净金料值（核心字段）
            result["gold_debt"] = max(0, net_gold)  # 欠料（正数部分）
            result["gold_deposit"] = max(0, -net_gold)  # 存料（负数的绝对值）
            result["gold_transactions"] = gold_transactions
            result["deposit_transactions"] = deposit_transactions
        
        # 6. 查询客户销售历史表现（新增）
        try:
            # === 第一部分：查询指定时间段的销售（今日/本周/本月等）===
            period_sales_query = db.query(SalesOrder).filter(
                SalesOrder.customer_name == customer.name,
                SalesOrder.status != "已取消"
            )
            
            if start_date:
                period_sales_query = period_sales_query.filter(SalesOrder.order_date >= start_date)
            if end_date:
                period_sales_query = period_sales_query.filter(SalesOrder.order_date <= end_date)
            
            period_orders = period_sales_query.all()
            
            # 统计指定时间段的销售
            period_sales_weight = 0.0
            period_labor_cost = 0.0
            period_order_count = len(period_orders)
            
            for order in period_orders:
                details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
                for detail in details:
                    period_sales_weight += detail.weight or 0
                    period_labor_cost += detail.total_labor_cost or 0
            
            # === 第二部分：查询历史总览（不受日期限制）===
            all_sales_query = db.query(SalesOrder).filter(
                SalesOrder.customer_name == customer.name,
                SalesOrder.status != "已取消"
            )
            all_orders = all_sales_query.all()
            
            # 统计历史总销售克重和工费
            total_sales_weight = 0.0
            total_labor_cost = 0.0
            total_order_count = len(all_orders)
            
            # 品类统计（基于全部历史记录）
            category_stats = {}
            
            for order in all_orders:
                details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
                for detail in details:
                    weight = detail.weight or 0
                    labor = detail.total_labor_cost or 0
                    total_sales_weight += weight
                    total_labor_cost += labor
                    
                    # 按品类统计
                    product_name = detail.product_name or "其他"
                    if product_name not in category_stats:
                        category_stats[product_name] = {"weight": 0, "labor": 0, "count": 0}
                    category_stats[product_name]["weight"] += weight
                    category_stats[product_name]["labor"] += labor
                    category_stats[product_name]["count"] += 1
            
            # 将品类统计转为列表并按销售克重排序
            category_breakdown = [
                {"name": name, "weight": stats["weight"], "labor": stats["labor"], "count": stats["count"]}
                for name, stats in category_stats.items()
            ]
            category_breakdown.sort(key=lambda x: x["weight"], reverse=True)
            
            # 计算客户排名（按总购买金额）
            all_customers = db.query(Customer).filter(Customer.status == "active").order_by(
                desc(Customer.total_purchase_amount)
            ).all()
            customer_rank = 1
            for idx, c in enumerate(all_customers, 1):
                if c.id == customer.id:
                    customer_rank = idx
                    break
            total_customer_count = len(all_customers)
            
            result["sales_history"] = {
                # 指定时间段销售（今日/本周/本月等）
                "period_sales_weight": period_sales_weight,
                "period_labor_cost": period_labor_cost,
                "period_order_count": period_order_count,
                # 历史总览（全部记录）
                "total_sales_weight": total_sales_weight,
                "total_labor_cost": total_labor_cost,
                "order_count": total_order_count,
                "category_breakdown": category_breakdown[:5],  # 只返回前5个品类
                "customer_rank": customer_rank,
                "total_customer_count": total_customer_count,
                "last_purchase_time": str(customer.last_purchase_time) if customer.last_purchase_time else None
            }
        except Exception as e:
            logger.warning(f"查询客户销售历史出错: {e}")
            result["sales_history"] = None
        
        # 将result转换为统一响应格式
        return success_response(data=result)
        
    except Exception as e:
        logger.error(f"聊天查询客户账务失败: {e}", exc_info=True)
        return server_error_response(message=f"查询失败: {str(e)}")


@router.get("/{customer_id}")
async def get_customer(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户详情"""
    # 权限检查 - 需要 can_view_customers 或 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_view_customers') and not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看客户】的权限")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        
        if not customer:
            return not_found_response(message="客户不存在")
        
        return success_response(
            data={"customer": CustomerResponse.model_validate(customer).model_dump(mode='json')}
        )
    except Exception as e:
        logger.error(f"查询客户详情失败: {e}", exc_info=True)
        return server_error_response(message=f"查询客户详情失败: {str(e)}")


@router.put("/{customer_id}")
async def update_customer(
    customer_id: int,
    data: CustomerCreate,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """更新客户信息"""
    # 权限检查 - 需要 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限（创建/编辑/删除）")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return not_found_response(message="客户不存在")
        
        # 更新字段
        if data.name:
            customer.name = data.name
        if data.phone is not None:
            customer.phone = data.phone
        if data.wechat is not None:
            customer.wechat = data.wechat
        if data.address is not None:
            customer.address = data.address
        if data.remark is not None:
            customer.remark = data.remark
        
        db.commit()
        db.refresh(customer)
        
        return success_response(
            data={"customer": CustomerResponse.model_validate(customer).model_dump(mode='json')},
            message=f"客户【{customer.name}】信息已更新"
        )
    except Exception as e:
        db.rollback()
        logger.error(f"更新客户失败: {e}", exc_info=True)
        return server_error_response(message=str(e))


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """删除客户（软删除）"""
    # 权限检查 - 只有管理层可以删除
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_delete'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【删除数据】的权限")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return not_found_response(message="客户不存在")
        
        customer.status = "inactive"
        db.commit()
        
        return success_response(message=f"客户【{customer.name}】已删除")
    except Exception as e:
        db.rollback()
        logger.error(f"删除客户失败: {e}", exc_info=True)
        return server_error_response(message=str(e))


@router.get("/{customer_id}/detail")
async def get_customer_detail(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户详情（销售记录、退货记录、欠款/存料余额、往来账目）
    业务员角色可以查看客户的完整往来信息
    """
    # 权限检查 - 需要查看客户或查询客户销售权限
    from ..middleware.permissions import has_permission
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_manage_customers') or
        has_permission(user_role, 'can_query_customer_sales')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足：您没有查看客户详情的权限")
    
    try:
        # 获取客户基本信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return not_found_response(message="客户不存在")
        
        # 获取销售记录
        sales_orders = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.status != "已取消"
        ).order_by(desc(SalesOrder.create_time)).limit(50).all()
        
        sales_list = []
        for order in sales_orders:
            # 获取销售单明细
            details = db.query(SalesDetail).filter(
                SalesDetail.order_id == order.id
            ).all()
            
            for detail in details:
                sales_list.append({
                    "id": detail.id,
                    "order_no": order.order_no,
                    "product_name": detail.product_name,
                    "weight": detail.weight,
                    "labor_cost": detail.labor_cost,
                    "total_amount": detail.total_labor_cost,  # 使用 total_labor_cost 字段
                    "status": order.status,
                    "created_at": order.create_time.isoformat() if order.create_time else None
                })
        
        # 获取退货记录（客户相关的退货，通常是从展厅退回的）
        # 注意：这里假设有客户相关的退货逻辑，如果没有则返回空列表
        returns_list = []
        try:
            # 查询与客户关联的销售单的退货
            for order in sales_orders:
                related_returns = db.query(ReturnOrder).filter(
                    ReturnOrder.remark.contains(order.order_no) if hasattr(ReturnOrder, 'remark') else False
                ).all()
                for ret in related_returns:
                    returns_list.append({
                        "id": ret.id,
                        "return_no": ret.return_no,
                        "product_name": ret.product_name,
                        "return_weight": ret.return_weight,
                        "return_reason": ret.return_reason or "未知",
                        "status": ret.status,
                        "created_at": ret.created_at.isoformat() if ret.created_at else None
                    })
        except Exception as e:
            logger.warning(f"查询客户退货记录时出错: {e}")
            returns_list = []
        
        # 获取欠款/存料余额
        # 现金欠款 - 从应收账款表获取
        cash_debt = 0.0
        try:
            latest_receivable = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id
            ).order_by(desc(AccountReceivable.credit_start_date)).first()
            if latest_receivable:
                cash_debt = latest_receivable.closing_balance or 0.0
        except Exception as e:
            logger.warning(f"查询现金欠款时出错: {e}")
        
        # 金料账户（使用历史交易计算，与快捷提料一致）
        gold_deposit = 0.0
        gold_debt = 0.0
        net_gold = 0.0
        try:
            # 1. 结算欠料（结料支付 + 混合支付的金料部分）
            total_settlement_gold = 0.0
            settlements = db.query(SettlementOrder).join(SalesOrder).filter(
                SalesOrder.customer_id == customer_id,
                SettlementOrder.status.in_(['confirmed', 'printed'])
            ).all()
            for s in settlements:
                if s.payment_method == 'physical_gold':
                    total_settlement_gold += s.physical_gold_weight or 0
                elif s.payment_method == 'mixed':
                    total_settlement_gold += s.gold_payment_weight or 0
            
            # 2. 来料（GoldReceipt）
            total_receipts_gold = db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
                GoldReceipt.customer_id == customer_id,
                GoldReceipt.status == 'received'
            ).scalar() or 0
            
            # 调试日志：打印收料记录数量
            receipt_count = db.query(GoldReceipt).filter(
                GoldReceipt.customer_id == customer_id,
                GoldReceipt.status == 'received'
            ).count()
            logger.info(f"[客户详情] customer_id={customer_id}, 收料记录数={receipt_count}, 来料总计={total_receipts_gold}, 结算用料={total_settlement_gold}")
            
            # 3. 净金料 = 来料 - 结算欠料（正数=存料，负数=欠料）
            net_gold = float(total_receipts_gold) - total_settlement_gold
            
            # 从净值计算兼容字段
            gold_deposit = max(0, net_gold)  # 正值 = 存料
            gold_debt = max(0, -net_gold)    # 负值的绝对值 = 欠料
            
            logger.info(f"[客户详情] net_gold={net_gold}, gold_deposit={gold_deposit}, gold_debt={gold_debt}")
        except Exception as e:
            logger.warning(f"查询金料账户时出错: {e}")
        
        balance = {
            "cash_debt": cash_debt,
            "gold_debt": gold_debt,
            "gold_deposit": gold_deposit,
            "net_gold": net_gold  # 净金料值（核心字段）
        }
        
        # 获取往来账目
        transactions_list = []
        
        # 销售交易
        for order in sales_orders[:20]:  # 限制数量
            transactions_list.append({
                "id": order.id,
                "type": "sale",
                "description": f"销售：{order.order_no}",
                "amount": order.total_labor_cost,
                "gold_weight": None,
                "created_at": order.create_time.isoformat() if order.create_time else None
            })
        
        # 金料收料记录（从GoldReceipt表获取，这是核心数据源）
        try:
            gold_receipts = db.query(GoldReceipt).filter(
                GoldReceipt.customer_id == customer_id,
                GoldReceipt.status == 'received'
            ).order_by(desc(GoldReceipt.received_at)).limit(20).all()
            
            for receipt in gold_receipts:
                transactions_list.append({
                    "id": receipt.id,
                    "type": "gold_receipt",
                    "description": f"客户来料：{receipt.receipt_no}",
                    "amount": None,
                    "gold_weight": receipt.gold_weight,
                    "created_at": (receipt.received_at or receipt.created_at).isoformat() if (receipt.received_at or receipt.created_at) else None
                })
        except Exception as e:
            logger.warning(f"查询收料记录时出错: {e}")
        
        # 金料提料记录（从CustomerWithdrawal表获取）
        try:
            from ..models.finance import CustomerWithdrawal
            withdrawals = db.query(CustomerWithdrawal).filter(
                CustomerWithdrawal.customer_id == customer_id,
                CustomerWithdrawal.status == 'completed'
            ).order_by(desc(CustomerWithdrawal.completed_at)).limit(20).all()
            
            for withdrawal in withdrawals:
                transactions_list.append({
                    "id": withdrawal.id,
                    "type": "gold_withdrawal",
                    "description": f"客户提料：{withdrawal.withdrawal_no}",
                    "amount": None,
                    "gold_weight": -withdrawal.gold_weight,  # 提料为负数
                    "created_at": (withdrawal.completed_at or withdrawal.created_at).isoformat() if (withdrawal.completed_at or withdrawal.created_at) else None
                })
        except Exception as e:
            logger.warning(f"查询提料记录时出错: {e}")
        
        # 按时间排序
        transactions_list.sort(key=lambda x: x["created_at"] or "", reverse=True)
        
        return success_response(
            data={
                "customer": CustomerResponse.model_validate(customer).model_dump(mode='json'),
                "sales": sales_list,
                "returns": returns_list,
                "balance": balance,
                "transactions": transactions_list[:30]
            }
        )
    except Exception as e:
        logger.error(f"查询客户详情失败: {e}", exc_info=True)
        return server_error_response(message=f"查询客户详情失败: {str(e)}")


@router.post("/batch-import")
async def batch_import_customers(
    file: UploadFile = File(...),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    批量导入客户（支持2000+条数据）
    支持格式：
    1. Excel (.xlsx, .xls) - 第一列必须是姓名，其他列可选（电话、微信、地址、类型、备注）
    2. CSV (.csv) - 第一列必须是姓名，其他列可选
    3. 纯文本 (.txt) - 每行一个姓名
    """
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限")
    
    results = {
        "success": True,
        "total": 0,
        "created": 0,
        "skipped": 0,
        "errors": [],
        "details": []
    }
    
    try:
        # 读取文件内容
        content = await file.read()
        file_extension = file.filename.split('.')[-1].lower() if '.' in file.filename else ''
        
        customers_data = []
        
        if file_extension in ['xlsx', 'xls']:
            # Excel 文件处理
            try:
                from openpyxl import load_workbook
                wb = load_workbook(io.BytesIO(content), read_only=True)
                ws = wb.active
                
                # 跳过表头（第一行）
                for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                    if row and row[0]:
                        name = str(row[0]).strip()
                        if name:
                            customers_data.append({
                                "name": name,
                                "phone": str(row[1]).strip() if len(row) > 1 and row[1] else None,
                                "wechat": str(row[2]).strip() if len(row) > 2 and row[2] else None,
                                "address": str(row[3]).strip() if len(row) > 3 and row[3] else None,
                                "customer_type": str(row[4]).strip() if len(row) > 4 and row[4] else "个人",
                                "remark": str(row[5]).strip() if len(row) > 5 and row[5] else None,
                            })
                wb.close()
            except Exception as e:
                error_msg = str(e).lower()
                # 检测是否是 .xls 格式导致的错误
                if "zip file" in error_msg or "not a zip file" in error_msg or file_extension == 'xls':
                    return error_response(
                        message="不支持旧版 Excel (.xls) 格式，请将文件另存为 .xlsx 格式或转换为 CSV 格式后重试"
                    )
                else:
                    return error_response(
                        message=f"Excel 文件解析失败: {str(e)[:200]}\n\n提示：请确保文件格式正确，或尝试转换为 CSV 格式上传"
                    )
        
        elif file_extension == 'csv':
            # CSV 文件处理
            try:
                content_str = content.decode('utf-8-sig')  # 处理 BOM
            except:
                try:
                    content_str = content.decode('gbk')  # 尝试 GBK 编码
                except:
                    content_str = content.decode('utf-8', errors='ignore')
            
            csv_reader = csv.reader(io.StringIO(content_str))
            
            # 跳过表头
            next(csv_reader, None)
            
            for row in csv_reader:
                if row and row[0]:
                    name = str(row[0]).strip()
                    if name:
                        customers_data.append({
                            "name": name,
                            "phone": row[1].strip() if len(row) > 1 and row[1] else None,
                            "wechat": row[2].strip() if len(row) > 2 and row[2] else None,
                            "address": row[3].strip() if len(row) > 3 and row[3] else None,
                            "customer_type": row[4].strip() if len(row) > 4 and row[4] else "个人",
                            "remark": row[5].strip() if len(row) > 5 and row[5] else None,
                        })
        
        elif file_extension == 'txt':
            # 纯文本文件（每行一个姓名）
            try:
                content_str = content.decode('utf-8')
            except:
                try:
                    content_str = content.decode('gbk')
                except:
                    content_str = content.decode('utf-8', errors='ignore')
            
            for line in content_str.split('\n'):
                name = line.strip()
                if name:
                    customers_data.append({
                        "name": name,
                        "phone": None,
                        "wechat": None,
                        "address": None,
                        "customer_type": "个人",
                        "remark": None,
                    })
        else:
            return error_response(
                message=f"不支持的文件格式：{file_extension}。支持格式：.xlsx, .xls, .csv, .txt"
            )
        
        results["total"] = len(customers_data)
        
        if results["total"] == 0:
            return error_response(message="文件中没有找到有效的客户数据")
        
        # 批量创建客户（性能优化：批量提交）
        start_time = time.time()
        batch_size = 100  # 每100条提交一次
        
        # 先批量查询已存在的客户（避免重复查询）
        existing_names = set()
        existing_customers = db.query(Customer.name).filter(
            Customer.status == "active"
        ).all()
        existing_names = {c[0] for c in existing_customers}
        
        for idx, customer_data in enumerate(customers_data, 1):
            try:
                # 检查是否已存在
                if customer_data["name"] in existing_names:
                    results["skipped"] += 1
                    if idx <= 10:  # 只记录前10个跳过的详情
                        results["details"].append({
                            "row": idx,
                            "name": customer_data["name"],
                            "status": "skipped",
                            "message": "客户已存在"
                        })
                    continue
                
                # 生成客户编号（使用时间戳+序号，确保唯一）
                timestamp = china_now().strftime('%Y%m%d%H%M%S')
                customer_no = f"KH{timestamp}{idx:06d}"
                
                # 创建客户对象
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_data["name"],
                    phone=customer_data.get("phone"),
                    wechat=customer_data.get("wechat"),
                    address=customer_data.get("address"),
                    customer_type=customer_data.get("customer_type", "个人"),
                    remark=customer_data.get("remark"),
                    status="active"
                )
                db.add(customer)
                existing_names.add(customer_data["name"])  # 添加到已存在集合
                results["created"] += 1
                
                # 每 batch_size 条提交一次（提高性能）
                if idx % batch_size == 0:
                    db.commit()
                    logger.info(f"已导入 {idx}/{results['total']} 条客户数据")
                
                # 只记录前10个成功的详情
                if results["created"] <= 10:
                    results["details"].append({
                        "row": idx,
                        "name": customer_data["name"],
                        "status": "created",
                        "customer_no": customer_no
                    })
                    
            except Exception as e:
                results["errors"].append({
                    "row": idx,
                    "name": customer_data.get("name", "未知"),
                    "error": str(e)[:100]  # 限制错误信息长度
                })
                logger.error(f"导入第 {idx} 行失败: {e}")
                # 如果错误太多，停止导入
                if len(results["errors"]) > 100:
                    db.rollback()
                    return error_response(
                        message=f"导入过程中错误过多（超过100个），已停止导入。已成功导入 {results['created']} 条",
                        data=results
                    )
        
        # 最终提交
        db.commit()
        
        elapsed_time = time.time() - start_time
        message = f"导入完成！成功创建 {results['created']} 个客户，跳过 {results['skipped']} 个已存在客户"
        if results["errors"]:
            message += f"，失败 {len(results['errors'])} 个"
        message += f"。耗时 {elapsed_time:.2f} 秒"
        results["elapsed_time"] = elapsed_time
        
        return success_response(data=results, message=message)
        
    except Exception as e:
        db.rollback()
        logger.error(f"批量导入客户失败: {e}", exc_info=True)
        return server_error_response(message=f"批量导入失败: {str(e)}")


@router.get("/{customer_id}/debt-history")
async def get_customer_debt_history(
    customer_id: int,
    limit: int = Query(50, ge=1, le=200),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户欠款交易历史
    
    返回该客户的所有交易记录，包括销售、结算、收款、金料收付等。
    """
    from ..middleware.permissions import has_permission
    from ..models import SettlementOrder, PaymentRecord
    
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_query_customer_sales') or
        has_permission(user_role, 'can_create_settlement')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足")
    
    try:
        # 获取客户信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return not_found_response(message="客户不存在")
        
        transactions = []
        
        # 1. 销售记录
        sales_orders = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.status != "已取消"
        ).order_by(desc(SalesOrder.create_time)).limit(limit).all()
        
        for order in sales_orders:
            transactions.append({
                "id": f"sale_{order.id}",
                "type": "sale",
                "type_label": "销售",
                "order_no": order.order_no,
                "description": f"销售单 {order.order_no}",
                "cash_amount": order.total_labor_cost or 0,
                "gold_amount": order.total_weight or 0,
                "status": order.status,
                "created_at": order.create_time.isoformat() if order.create_time else None,
                "operator": order.salesperson
            })
        
        # 2. 结算记录
        try:
            for order in sales_orders:
                settlements = db.query(SettlementOrder).filter(
                    SettlementOrder.sales_order_id == order.id
                ).all()
                for s in settlements:
                    payment_method_label = {
                        "cash_price": "结价",
                        "physical_gold": "结料",
                        "mixed": "混合支付"
                    }.get(s.payment_method, s.payment_method)
                    
                    transactions.append({
                        "id": f"settlement_{s.id}",
                        "type": "settlement",
                        "type_label": "结算",
                        "order_no": s.settlement_no,
                        "description": f"结算单 {s.settlement_no}（{payment_method_label}）",
                        "cash_amount": s.total_amount or 0,
                        "gold_amount": s.physical_gold_weight or 0,
                        "status": s.status,
                        "created_at": s.created_at.isoformat() if s.created_at else None,
                        "operator": s.created_by
                    })
        except Exception as e:
            logger.warning(f"查询结算记录出错: {e}")
        
        # 3. 收款记录
        try:
            payments = db.query(PaymentRecord).filter(
                PaymentRecord.customer_id == customer_id
            ).order_by(desc(PaymentRecord.create_time)).limit(limit).all()
            
            for p in payments:
                transactions.append({
                    "id": f"payment_{p.id}",
                    "type": "payment",
                    "type_label": "收款",
                    "order_no": f"PY{p.id:06d}",
                    "description": f"收款 ¥{p.amount:.2f}",
                    "cash_amount": -(p.amount or 0),  # 负数表示减少欠款
                    "gold_amount": 0,
                    "status": "completed",
                    "created_at": p.create_time.isoformat() if p.create_time else None,
                    "operator": p.operator
                })
        except Exception as e:
            logger.warning(f"查询收款记录出错: {e}")
        
        # 4. 金料存取记录
        try:
            gold_txs = db.query(CustomerGoldDepositTransaction).filter(
                CustomerGoldDepositTransaction.customer_id == customer_id
            ).order_by(desc(CustomerGoldDepositTransaction.created_at)).limit(limit).all()
            
            for tx in gold_txs:
                tx_type_label = {
                    "deposit": "存料",
                    "use": "用料",
                    "refund": "退料"
                }.get(tx.transaction_type, tx.transaction_type)
                
                amount = tx.amount or 0
                if tx.transaction_type == "use":
                    amount = -amount  # 用料为负数
                
                transactions.append({
                    "id": f"gold_deposit_{tx.id}",
                    "type": "gold_deposit",
                    "type_label": tx_type_label,
                    "order_no": f"GD{tx.id:06d}",
                    "description": tx.remark or f"金料{tx_type_label} {abs(tx.amount):.2f}克",
                    "cash_amount": 0,
                    "gold_amount": amount,
                    "status": tx.status,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                    "operator": tx.created_by
                })
        except Exception as e:
            logger.warning(f"查询金料交易记录出错: {e}")
        
        # 5. 客户往来账记录
        try:
            customer_txs = db.query(CustomerTransaction).filter(
                CustomerTransaction.customer_id == customer_id,
                CustomerTransaction.status == "active"
            ).order_by(desc(CustomerTransaction.created_at)).limit(limit).all()
            
            for tx in customer_txs:
                tx_type_label = {
                    "sales": "销售",
                    "settlement": "结算",
                    "gold_receipt": "收料",
                    "payment": "付款"
                }.get(tx.transaction_type, tx.transaction_type)
                
                transactions.append({
                    "id": f"tx_{tx.id}",
                    "type": "transaction",
                    "type_label": tx_type_label,
                    "order_no": f"TX{tx.id:06d}",
                    "description": tx.remark or f"往来账：{tx_type_label}",
                    "cash_amount": tx.amount or 0,
                    "gold_amount": tx.gold_weight or 0,
                    "gold_debt_before": tx.gold_due_before or 0,
                    "gold_debt_after": tx.gold_due_after or 0,
                    "status": tx.status,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                    "operator": None
                })
        except Exception as e:
            logger.warning(f"查询往来账记录出错: {e}")
        
        # 按时间排序（去重）
        seen_ids = set()
        unique_transactions = []
        for tx in transactions:
            if tx["id"] not in seen_ids:
                seen_ids.add(tx["id"])
                unique_transactions.append(tx)
        
        unique_transactions.sort(key=lambda x: x["created_at"] or "", reverse=True)
        
        # 获取当前欠款余额
        current_balance = {
            "cash_debt": 0.0,
            "gold_debt": 0.0,
            "gold_deposit": 0.0
        }
        
        try:
            receivables = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id,
                AccountReceivable.status.in_(["unpaid", "overdue"])
            ).all()
            current_balance["cash_debt"] = sum(r.unpaid_amount or 0 for r in receivables)
        except:
            pass
        
        # 计算净金料（与快捷提料一致，使用历史交易计算）
        try:
            # 1. 结算欠料（结料支付 + 混合支付的金料部分）
            total_settlement_gold = 0.0
            settlements = db.query(SettlementOrder).join(SalesOrder).filter(
                SalesOrder.customer_id == customer_id,
                SettlementOrder.status.in_(['confirmed', 'printed'])
            ).all()
            for s in settlements:
                if s.payment_method == 'physical_gold':
                    total_settlement_gold += s.physical_gold_weight or 0
                elif s.payment_method == 'mixed':
                    total_settlement_gold += s.gold_payment_weight or 0
            
            # 2. 来料（GoldReceipt）
            total_receipts_gold = db.query(func.coalesce(func.sum(GoldReceipt.gold_weight), 0)).filter(
                GoldReceipt.customer_id == customer_id,
                GoldReceipt.status == 'received'
            ).scalar() or 0
            
            # 3. 净金料 = 来料 - 结算欠料（正数=存料，负数=欠料）
            net_gold = float(total_receipts_gold) - total_settlement_gold
            
            current_balance["net_gold"] = net_gold  # 净金料值（正=存料，负=欠料）
            current_balance["gold_debt"] = max(0, -net_gold)  # 兼容字段：欠料
            current_balance["gold_deposit"] = max(0, net_gold)  # 兼容字段：存料
        except Exception as e:
            logger.warning(f"计算客户金料余额失败: {e}")
            current_balance["net_gold"] = 0
            current_balance["gold_debt"] = 0
            current_balance["gold_deposit"] = 0
        
        return success_response(
            data={
                "customer": {
                    "id": customer.id,
                    "name": customer.name,
                    "phone": customer.phone,
                    "customer_no": customer.customer_no
                },
                "current_balance": current_balance,
                "transactions": unique_transactions[:limit]
            }
        )
        
    except Exception as e:
        logger.error(f"查询客户欠款历史失败: {e}", exc_info=True)
        return server_error_response(message=f"查询失败: {str(e)}")


# ============= 客户往来账明细表 API =============

@router.get("/{customer_id}/transactions-detail")
async def get_customer_transactions_detail(
    customer_id: int,
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    user_role: str = Query(default="settlement", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户往来账明细表
    
    合并显示：销售结算、客户来料、客户来款
    按发生日期排序
    """
    from ..middleware.permissions import has_permission
    from ..models import SettlementOrder
    from ..models.finance import GoldReceipt, PaymentRecord, AccountReceivable
    
    # 权限检查
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_create_settlement') or
        user_role == 'manager'
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足")
    
    try:
        # 验证客户存在
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="客户不存在")
        
        # 解析日期范围
        date_start = None
        date_end = None
        if start_date:
            try:
                date_start = datetime.strptime(start_date, "%Y-%m-%d")
            except:
                pass
        if end_date:
            try:
                date_end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            except:
                pass
        
        transactions = []
        
        # ========== 1. 销售结算记录 ==========
        settlement_query = db.query(SettlementOrder).join(SalesOrder).filter(
            SalesOrder.customer_id == customer_id,
            SettlementOrder.status.in_(['confirmed', 'printed'])
        )
        if date_start:
            settlement_query = settlement_query.filter(SettlementOrder.create_time >= date_start)
        if date_end:
            settlement_query = settlement_query.filter(SettlementOrder.create_time <= date_end)
        
        settlements = settlement_query.all()
        
        for s in settlements:
            # 足金：结料时的应付金料重量
            gold_amount = 0.0
            if s.payment_method == 'physical_gold':
                gold_amount = s.physical_gold_weight or 0.0
            
            # 欠款金额：结价时的应收金额
            cash_amount = 0.0
            if s.payment_method == 'cash_price':
                cash_amount = s.total_amount or 0.0
            elif s.payment_method == 'mixed':
                cash_amount = s.cash_payment_weight or 0.0  # 混合支付的现金部分
            
            transactions.append({
                "id": f"settlement_{s.id}",
                "date": s.create_time.strftime("%Y-%m-%d") if s.create_time else None,
                "datetime": s.create_time.isoformat() if s.create_time else None,
                "type": "销售结算",
                "order_no": s.settlement_no,
                "gold_amount": round(gold_amount, 3),  # 正数=客户欠料
                "cash_amount": round(cash_amount, 2),  # 正数=客户欠款
                "remark": s.remark or ""
            })
        
        # ========== 2. 客户来料记录 ==========
        receipt_query = db.query(GoldReceipt).filter(
            GoldReceipt.customer_id == customer_id,
            GoldReceipt.status == 'received'
        )
        if date_start:
            receipt_query = receipt_query.filter(GoldReceipt.created_at >= date_start)
        if date_end:
            receipt_query = receipt_query.filter(GoldReceipt.created_at <= date_end)
        
        receipts = receipt_query.all()
        
        for r in receipts:
            transactions.append({
                "id": f"receipt_{r.id}",
                "date": r.received_at.strftime("%Y-%m-%d") if r.received_at else (r.created_at.strftime("%Y-%m-%d") if r.created_at else None),
                "datetime": r.received_at.isoformat() if r.received_at else (r.created_at.isoformat() if r.created_at else None),
                "type": "客户来料",
                "order_no": r.receipt_no,
                "gold_amount": round(-(r.gold_weight or 0), 3),  # 负数=客户给料
                "cash_amount": 0.0,
                "remark": f"{r.gold_fineness or ''} {r.remark or ''}".strip()
            })
        
        # ========== 3. 客户来款记录 ==========
        payment_query = db.query(PaymentRecord).filter(
            PaymentRecord.customer_id == customer_id
        )
        if date_start:
            payment_query = payment_query.filter(PaymentRecord.payment_date >= date_start.date())
        if date_end:
            payment_query = payment_query.filter(PaymentRecord.payment_date <= date_end.date())
        
        payments = payment_query.all()
        
        for p in payments:
            payment_method_label = {
                'bank_transfer': '银行转账',
                'cash': '现金',
                'wechat': '微信',
                'alipay': '支付宝',
                'card': '刷卡'
            }.get(p.payment_method, p.payment_method)
            
            transactions.append({
                "id": f"payment_{p.id}",
                "date": p.payment_date.strftime("%Y-%m-%d") if p.payment_date else None,
                "datetime": p.create_time.isoformat() if p.create_time else None,
                "type": "客户来款",
                "order_no": p.payment_no or f"SK{p.id}",
                "gold_amount": 0.0,
                "cash_amount": round(-(p.amount or 0), 2),  # 负数=客户付款
                "remark": f"{payment_method_label} {p.remark or ''}".strip()
            })
        
        # ========== 按日期排序 ==========
        transactions.sort(key=lambda x: x.get("datetime") or "0000-00-00")
        
        # ========== 计算合计 ==========
        total_gold = sum(t["gold_amount"] for t in transactions)
        total_cash = sum(t["cash_amount"] for t in transactions)
        
        # 添加序号
        for i, t in enumerate(transactions, 1):
            t["seq"] = i
        
        return {
            "success": True,
            "customer": {
                "id": customer.id,
                "name": customer.name,
                "customer_no": customer.customer_no
            },
            "date_range": {
                "start": start_date,
                "end": end_date
            },
            "transactions": transactions,
            "summary": {
                "total_gold": round(total_gold, 3),  # 正数=客户欠料，负数=客户存料
                "total_cash": round(total_cash, 2),  # 正数=客户欠款，负数=预收款
                "count": len(transactions)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取客户往来账明细失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取往来账明细失败: {str(e)}")


# ========== 金料账户诊断和修复 API ==========

@router.get("/{customer_id}/gold-account-diagnosis")
async def diagnose_gold_account(
    customer_id: int,
    db: Session = Depends(get_db)
):
    """
    诊断客户金料账户，计算正确的净值
    
    通过汇总所有金料交易记录，计算应该的净值：
    - 收料/存料 = 增加（正）
    - 结算欠料/提料 = 减少（负）
    """
    try:
        # 查找客户
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail=f"客户ID {customer_id} 不存在")
        
        # 当前账户余额
        deposit = db.query(CustomerGoldDeposit).filter(
            CustomerGoldDeposit.customer_id == customer_id
        ).first()
        current_balance = deposit.current_balance if deposit else 0.0
        
        # 汇总所有金料交易
        # 1. 从 CustomerGoldDepositTransaction 获取存料记录
        deposit_txs = db.query(CustomerGoldDepositTransaction).filter(
            CustomerGoldDepositTransaction.customer_id == customer_id,
            CustomerGoldDepositTransaction.status == "active"
        ).all()
        
        total_deposited = 0.0  # 总存入
        total_used = 0.0  # 总使用
        deposit_details = []
        
        for tx in deposit_txs:
            if tx.transaction_type == "deposit":
                total_deposited += tx.amount or 0
            elif tx.transaction_type == "use":
                total_used += tx.amount or 0
            
            deposit_details.append({
                "id": tx.id,
                "type": tx.transaction_type,
                "amount": tx.amount,
                "balance_after": tx.balance_after,
                "remark": tx.remark,
                "created_at": tx.created_at.isoformat() if tx.created_at else None
            })
        
        # 2. 从 CustomerTransaction 获取金料欠款记录
        gold_txs = db.query(CustomerTransaction).filter(
            CustomerTransaction.customer_id == customer_id,
            CustomerTransaction.status == "active"
        ).order_by(CustomerTransaction.created_at).all()
        
        latest_gold_due = 0.0
        gold_tx_details = []
        
        for tx in gold_txs:
            latest_gold_due = tx.gold_due_after or 0
            gold_tx_details.append({
                "id": tx.id,
                "type": tx.transaction_type,
                "gold_weight": tx.gold_weight,
                "gold_due_before": tx.gold_due_before,
                "gold_due_after": tx.gold_due_after,
                "remark": tx.remark,
                "created_at": tx.created_at.isoformat() if tx.created_at else None
            })
        
        # 计算正确的净值
        # 方法1：根据交易记录计算
        calculated_from_deposits = total_deposited - total_used
        
        # 方法2：根据最后一条存料交易的 balance_after
        last_deposit_balance = deposit_txs[-1].balance_after if deposit_txs else 0.0
        
        # 推荐的正确净值：使用最后一条存料交易的 balance_after
        # 如果没有存料交易，则使用 -latest_gold_due（欠料转为负值）
        if deposit_txs:
            recommended_balance = last_deposit_balance
        else:
            recommended_balance = -latest_gold_due  # 欠料转为负值
        
        return {
            "success": True,
            "customer": {
                "id": customer.id,
                "name": customer.name
            },
            "current_balance": current_balance,
            "diagnosis": {
                "total_deposited": total_deposited,
                "total_used": total_used,
                "calculated_net": calculated_from_deposits,
                "latest_gold_due": latest_gold_due,
                "last_deposit_balance": last_deposit_balance
            },
            "recommended_balance": recommended_balance,
            "status": "存料" if recommended_balance > 0 else ("欠料" if recommended_balance < 0 else "清账"),
            "deposit_transactions": deposit_details[-10:],  # 最近10条
            "gold_transactions": gold_tx_details[-10:]  # 最近10条
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"诊断客户金料账户失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"诊断失败: {str(e)}")


@router.post("/{customer_id}/fix-gold-account")
async def fix_customer_gold_account(
    customer_id: int,
    correct_balance: float = Query(..., description="正确的净金料值（正=存料，负=欠料）"),
    db: Session = Depends(get_db)
):
    """
    手动修复客户金料账户余额
    
    参数:
    - customer_id: 客户ID
    - correct_balance: 正确的净金料值（正数=存料，负数=欠料，0=清账）
    
    此API用于一次性修复数据，不会自动执行。
    """
    try:
        # 查找客户
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail=f"客户ID {customer_id} 不存在")
        
        # 查找或创建金料账户记录
        deposit = db.query(CustomerGoldDeposit).filter(
            CustomerGoldDeposit.customer_id == customer_id
        ).first()
        
        old_balance = 0.0
        if deposit:
            old_balance = deposit.current_balance or 0.0
            deposit.current_balance = correct_balance
        else:
            # 创建新记录
            deposit = CustomerGoldDeposit(
                customer_id=customer_id,
                customer_name=customer.name,
                current_balance=correct_balance,
                total_deposited=max(0, correct_balance),
                total_used=max(0, -correct_balance)
            )
            db.add(deposit)
        
        db.commit()
        
        logger.info(f"[金料账户修复] 客户 {customer.name}(ID:{customer_id}): {old_balance:.2f}克 -> {correct_balance:.2f}克")
        
        return {
            "success": True,
            "message": f"客户 {customer.name} 的金料账户已修复",
            "customer_id": customer_id,
            "customer_name": customer.name,
            "old_balance": old_balance,
            "new_balance": correct_balance,
            "status": "存料" if correct_balance > 0 else ("欠料" if correct_balance < 0 else "清账")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"修复客户金料账户失败: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"修复失败: {str(e)}")
