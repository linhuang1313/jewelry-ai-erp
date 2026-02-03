"""
单据查询中心 API 路由
统一查询各类单据，根据角色权限返回可访问的单据
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import logging

from ..database import get_db
from ..middleware.permissions import has_permission
from ..models import (
    InboundOrder, InboundDetail, SalesOrder, SettlementOrder,
    ReturnOrder, LoanOrder, Supplier
)
from ..models.finance import AccountPayable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["单据查询中心"])


# 单据类型配置
DOCUMENT_TYPES = {
    'inbound': {
        'name': '入库单',
        'model': InboundOrder,
        'order_no_field': 'order_no',
        'date_field': 'create_time',
        'permission': 'can_inbound',
        'roles': ['product', 'finance', 'manager']
    },
    'purchase': {
        'name': '采购单',
        'model': AccountPayable,
        'order_no_field': 'payable_no',
        'date_field': 'create_time',
        'permission': 'can_view_purchase_orders',
        'roles': ['product', 'finance', 'manager'],
        'filter': lambda q: q.filter(AccountPayable.payable_no.like('CG%'), ~AccountPayable.payable_no.like('CGTH%'))
    },
    'purchase_return': {
        'name': '采购退货单',
        'model': AccountPayable,
        'order_no_field': 'payable_no',
        'date_field': 'create_time',
        'permission': 'can_view_purchase_returns',
        'roles': ['product', 'finance', 'manager'],
        'filter': lambda q: q.filter(AccountPayable.payable_no.like('CGTH%'))
    },
    'sales': {
        'name': '销售单',
        'model': SalesOrder,
        'order_no_field': 'order_no',
        'date_field': 'order_date',
        'permission': 'can_create_sales',
        'roles': ['counter', 'settlement', 'finance', 'manager']
    },
    'settlement': {
        'name': '结算单',
        'model': SettlementOrder,
        'order_no_field': 'settlement_no',
        'date_field': 'created_at',
        'permission': 'can_create_settlement',
        'roles': ['settlement', 'finance', 'manager']
    },
    'return': {
        'name': '退货单',
        'model': ReturnOrder,
        'order_no_field': 'return_no',
        'date_field': 'created_at',
        'permission': 'can_return_to_warehouse',
        'roles': ['counter', 'settlement', 'product', 'finance', 'manager']
    },
    'loan': {
        'name': '暂借单',
        'model': LoanOrder,
        'order_no_field': 'loan_no',
        'date_field': 'created_at',
        'permission': 'can_manage_loan',
        'roles': ['counter', 'settlement', 'finance', 'manager']
    }
}


@router.get("/types")
async def get_document_types(
    user_role: str = Query(..., description="用户角色"),
):
    """获取当前角色可查询的单据类型列表"""
    available_types = []
    
    for doc_type, config in DOCUMENT_TYPES.items():
        # 检查角色是否有权限查看此类型单据
        if user_role in config['roles'] or user_role == 'manager':
            available_types.append({
                'type': doc_type,
                'name': config['name']
            })
    
    return {
        "success": True,
        "document_types": available_types
    }


@router.get("/search")
async def search_documents(
    doc_type: str = Query(..., description="单据类型：inbound/purchase/purchase_return/sales/settlement/return/loan"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    keyword: Optional[str] = Query(None, description="单号/关键词搜索"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    user_role: str = Query(..., description="用户角色"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """统一单据查询接口"""
    try:
        # 验证单据类型
        if doc_type not in DOCUMENT_TYPES:
            return {"success": False, "message": f"不支持的单据类型: {doc_type}"}
        
        config = DOCUMENT_TYPES[doc_type]
        
        # 检查权限
        if user_role not in config['roles'] and user_role != 'manager':
            return {"success": False, "message": f"您没有查看{config['name']}的权限"}
        
        # 构建查询
        model = config['model']
        query = db.query(model)
        
        # 应用类型特定过滤器
        if 'filter' in config:
            query = config['filter'](query)
        
        # 日期筛选
        date_field = getattr(model, config['date_field'])
        if start_date:
            try:
                start_dt = datetime.strptime(start_date, '%Y-%m-%d')
                query = query.filter(date_field >= start_dt)
            except ValueError:
                pass
        
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, '%Y-%m-%d')
                end_dt = end_dt.replace(hour=23, minute=59, second=59)
                query = query.filter(date_field <= end_dt)
            except ValueError:
                pass
        
        # 单号搜索
        if keyword:
            order_no_field = getattr(model, config['order_no_field'])
            query = query.filter(order_no_field.ilike(f'%{keyword}%'))
        
        # 供应商筛选（仅适用于有供应商关联的单据）
        if supplier_id:
            if hasattr(model, 'supplier_id'):
                query = query.filter(model.supplier_id == supplier_id)
        
        # 获取总数
        total = query.count()
        
        # 排序和分页
        query = query.order_by(date_field.desc())
        documents = query.offset(skip).limit(limit).all()
        
        # 构建返回数据
        results = []
        for doc in documents:
            item = {
                'id': doc.id,
                'order_no': getattr(doc, config['order_no_field']),
                'doc_type': doc_type,
                'doc_type_name': config['name'],
            }
            
            # 获取日期
            date_value = getattr(doc, config['date_field'])
            if date_value:
                item['date'] = date_value.strftime('%Y-%m-%d %H:%M:%S') if isinstance(date_value, datetime) else str(date_value)
            else:
                item['date'] = None
            
            # 根据不同单据类型添加额外字段
            if doc_type == 'inbound':
                item['operator'] = doc.operator
                item['status'] = doc.status
            elif doc_type in ['purchase', 'purchase_return']:
                item['total_amount'] = doc.total_amount
                item['unpaid_amount'] = doc.unpaid_amount
                item['status'] = doc.status
                if doc.supplier_id:
                    supplier = db.query(Supplier).filter(Supplier.id == doc.supplier_id).first()
                    item['supplier_name'] = supplier.name if supplier else None
            elif doc_type == 'sales':
                item['customer_name'] = doc.customer_name
                item['total_weight'] = doc.total_weight
                item['status'] = doc.status
            elif doc_type == 'settlement':
                item['payment_method'] = doc.payment_method
                item['total_amount'] = doc.total_amount
                item['status'] = doc.status
            elif doc_type == 'return':
                item['return_type'] = doc.return_type
                item['total_weight'] = doc.total_weight
                item['status'] = doc.status
            elif doc_type == 'loan':
                item['customer_name'] = doc.customer_name
                item['product_name'] = doc.product_name
                item['weight'] = doc.weight
                item['status'] = doc.status
            
            results.append(item)
        
        return {
            "success": True,
            "total": total,
            "skip": skip,
            "limit": limit,
            "documents": results
        }
        
    except Exception as e:
        logger.error(f"查询单据失败: {e}", exc_info=True)
        return {"success": False, "message": f"查询失败: {str(e)}"}


@router.get("/download-url")
async def get_document_download_url(
    doc_type: str = Query(..., description="单据类型"),
    doc_id: int = Query(..., description="单据ID"),
    format: str = Query("pdf", description="格式：pdf/html"),
    sub_type: Optional[str] = Query(None, description="子类型（如入库单的purchase/退货单的stock_out等）"),
):
    """获取单据下载URL"""
    # 根据单据类型构建下载URL
    url_mapping = {
        'inbound': f"/api/inbound/{doc_id}/download?format={format}&doc_type={sub_type or 'inbound'}",
        'purchase': f"/api/inbound/{doc_id}/download?format={format}&doc_type=purchase",
        'purchase_return': f"/api/returns/{doc_id}/download?format={format}&doc_type=purchase_return",
        'sales': f"/api/sales/{doc_id}/download?format={format}",
        'settlement': f"/api/settlement/{doc_id}/download?format={format}",
        'return': f"/api/returns/{doc_id}/download?format={format}&doc_type={sub_type or 'return'}",
        'loan': f"/api/loan/orders/{doc_id}/download?format={format}",
    }
    
    if doc_type not in url_mapping:
        return {"success": False, "message": f"不支持的单据类型: {doc_type}"}
    
    return {
        "success": True,
        "download_url": url_mapping[doc_type]
    }
