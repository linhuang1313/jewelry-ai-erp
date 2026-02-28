"""
操作审计日志API路由
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional

from ..database import get_db
from ..services.audit_service import AuditService, needs_confirmation
from ..utils.response import success_response, error_response
from ..middleware.permissions import has_permission
from ..dependencies.auth import get_current_role, require_permission

router = APIRouter(prefix="/api/audit", tags=["操作审计"])


@router.get("/logs")
async def get_audit_logs(
    entity_type: Optional[str] = Query(None, description="实体类型"),
    entity_id: Optional[int] = Query(None, description="实体ID"),
    action: Optional[str] = Query(None, description="操作类型"),
    user_role: str = Query(default="sales", description="用户角色"),
    days: int = Query(default=7, ge=1, le=90, description="查询天数"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    db: Session = Depends(get_db)
):
    """
    查询操作审计日志
    
    支持按实体类型、实体ID、操作类型筛选
    """
    # 权限检查 - 只有管理员可以查看审计日志
    if not has_permission(user_role, 'can_view_analytics'):
        raise HTTPException(status_code=403, detail="权限不足：您没有查看审计日志的权限")
    
    try:
        start_date = datetime.now() - timedelta(days=days)
        
        logs = AuditService.get_operation_logs(
            db=db,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            user_role=None,  # 查询所有角色的操作
            start_date=start_date,
            limit=limit
        )
        
        return success_response(
            data={
                "logs": logs,
                "total": len(logs),
                "query_days": days
            }
        )
    except Exception as e:
        return error_response(message=f"查询审计日志失败: {str(e)}")


@router.get("/balance-history/{account_type}/{account_id}")
async def get_balance_history(
    account_type: str,
    account_id: int,
    user_role: str = Query(default="sales", description="用户角色"),
    limit: int = Query(default=50, ge=1, le=200, description="返回数量"),
    db: Session = Depends(get_db)
):
    """
    查询账户余额变动历史
    
    Args:
        account_type: 账户类型 (customer_gold/supplier_gold/cash)
        account_id: 账户ID（客户ID或供应商ID）
    """
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material') and not has_permission(user_role, 'can_view_customers'):
        raise HTTPException(status_code=403, detail="权限不足")
    
    try:
        history = AuditService.get_balance_history(
            db=db,
            account_type=account_type,
            account_id=account_id,
            limit=limit
        )
        
        return success_response(
            data={
                "history": history,
                "total": len(history),
                "account_type": account_type,
                "account_id": account_id
            }
        )
    except Exception as e:
        return error_response(message=f"查询余额历史失败: {str(e)}")


@router.post("/check-confirmation")
async def check_operation_confirmation(
    action: str = Query(..., description="操作类型"),
    entity_type: str = Query(..., description="实体类型"),
    amount: Optional[float] = Query(None, description="涉及金额/克重"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    检查操作是否需要二次确认
    
    返回：
    - needs_confirmation: 是否需要确认
    - confirmation_message: 确认提示信息
    """
    try:
        confirmation_msg = needs_confirmation(action, entity_type, amount)
        
        return success_response(
            data={
                "needs_confirmation": confirmation_msg is not None,
                "confirmation_message": confirmation_msg,
                "action": action,
                "entity_type": entity_type,
                "amount": amount
            }
        )
    except Exception as e:
        return error_response(message=f"检查失败: {str(e)}")


@router.get("/recent-operations")
async def get_recent_operations(
    user_role: str = Query(default="sales", description="用户角色"),
    limit: int = Query(default=20, ge=1, le=100, description="返回数量"),
    db: Session = Depends(get_db)
):
    """
    获取最近的操作记录（用于操作面板展示）
    """
    try:
        # 获取最近的操作日志
        logs = AuditService.get_operation_logs(
            db=db,
            user_role=user_role if user_role != 'manager' else None,
            limit=limit
        )
        
        # 格式化为简洁的展示格式
        operations = []
        for log in logs:
            operations.append({
                "id": log["id"],
                "summary": f"{log['action_label']}{log['entity_label']}",
                "entity_no": log.get("new_value", {}).get("order_no") or log.get("new_value", {}).get("id") or log["entity_id"],
                "user_role": log["user_role"],
                "time": log["created_at"],
                "has_changes": bool(log.get("old_value") or log.get("new_value"))
            })
        
        return success_response(
            data={
                "operations": operations,
                "total": len(operations)
            }
        )
    except Exception as e:
        return error_response(message=f"获取最近操作失败: {str(e)}")
