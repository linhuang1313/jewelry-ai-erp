"""
金料对账路由 - 提供金料账户对账和一致性检查的API

主要功能：
1. 单客户对账 - 检查单个客户的金料账户余额
2. 批量对账 - 检查所有客户/供应商账户
3. 自动修复 - 发现差异时自动修正
4. 对账单生成 - 生成期间对账单
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date, datetime
from typing import Optional
import logging

from ..database import get_db
from ..services.gold_service import GoldAccountService
from ..middleware.permissions import has_permission
from ..utils.response import success_response, error_response
from ..dependencies.auth import get_current_role, require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gold-reconciliation", tags=["金料对账"])


# ==================== 客户金料账户对账 ====================

@router.get("/customer/{customer_id}")
async def reconcile_customer_account(
    customer_id: int,
    auto_fix: bool = Query(default=False, description="是否自动修复差异"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    对账单个客户的金料账户
    
    检查客户的 current_balance 是否与历史交易记录一致
    
    - customer_id: 客户ID
    - auto_fix: 是否自动修复差异（仅管理员可用）
    
    返回：
    - recorded_balance: 记录的余额
    - calculated_balance: 从交易记录计算的余额
    - difference: 差异
    - is_consistent: 是否一致
    - details: 计算明细
    """
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足：您没有查看金料记录的权限")
    
    # 自动修复需要管理员权限
    if auto_fix and user_role not in ['manager', 'material']:
        raise HTTPException(status_code=403, detail="自动修复需要管理员或料部权限")
    
    try:
        result = await GoldAccountService.reconcile_customer_balance(
            db, customer_id, auto_fix
        )
        
        if "error" in result:
            return error_response(message=result["error"])
        
        return success_response(data=result)
    except Exception as e:
        logger.error(f"[对账] 客户 {customer_id} 对账失败: {e}")
        raise HTTPException(status_code=500, detail=f"对账失败: {str(e)}")


@router.get("/customers/batch")
async def batch_reconcile_customers(
    auto_fix: bool = Query(default=False, description="是否自动修复差异"),
    only_inconsistent: bool = Query(default=False, description="是否只返回不一致的记录"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    批量对账所有客户金料账户
    
    检查所有有金料往来的客户账户一致性
    
    - auto_fix: 是否自动修复差异（仅管理员可用）
    - only_inconsistent: 是否只返回不一致的记录
    
    返回：
    - total_checked: 检查总数
    - consistent_count: 一致数量
    - inconsistent_count: 不一致数量
    - fixed_count: 已修复数量
    - results: 详细结果列表
    """
    # 权限检查：仅管理员和料部可进行批量对账
    if user_role not in ['manager', 'material']:
        raise HTTPException(status_code=403, detail="批量对账需要管理员或料部权限")
    
    # 自动修复需要管理员权限
    if auto_fix and user_role != 'manager':
        raise HTTPException(status_code=403, detail="自动修复需要管理员权限")
    
    try:
        result = await GoldAccountService.batch_reconcile_customers(
            db, auto_fix, only_inconsistent
        )
        
        return success_response(
            data=result,
            message=f"已检查 {result['total_checked']} 个账户，"
                    f"{result['inconsistent_count']} 个不一致"
                    + (f"，已修复 {result['fixed_count']} 个" if auto_fix else "")
        )
    except Exception as e:
        logger.error(f"[批量对账] 失败: {e}")
        raise HTTPException(status_code=500, detail=f"批量对账失败: {str(e)}")


# ==================== 供应商金料账户对账 ====================

@router.get("/supplier/{supplier_id}")
async def reconcile_supplier_account(
    supplier_id: int,
    auto_fix: bool = Query(default=False, description="是否自动修复差异"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    对账单个供应商的金料账户
    
    检查供应商的 current_balance 是否与历史交易记录一致
    """
    # 权限检查
    if not has_permission(user_role, 'can_view_supplier_gold_account'):
        raise HTTPException(status_code=403, detail="权限不足：您没有查看供应商金料账户的权限")
    
    if auto_fix and user_role not in ['manager', 'material']:
        raise HTTPException(status_code=403, detail="自动修复需要管理员或料部权限")
    
    try:
        result = await GoldAccountService.reconcile_supplier_balance(
            db, supplier_id, auto_fix
        )
        
        if "error" in result:
            return error_response(message=result["error"])
        
        return success_response(data=result)
    except Exception as e:
        logger.error(f"[对账] 供应商 {supplier_id} 对账失败: {e}")
        raise HTTPException(status_code=500, detail=f"对账失败: {str(e)}")


# ==================== 对账单生成 ====================

@router.get("/customer/{customer_id}/statement")
async def get_customer_statement(
    customer_id: int,
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    生成客户金料对账单
    
    获取指定期间内客户的金料交易明细和余额变动
    
    - customer_id: 客户ID
    - start_date: 开始日期
    - end_date: 结束日期
    
    返回：
    - opening_balance: 期初余额
    - transactions: 期间交易明细
    - closing_balance: 期末余额
    - summary: 汇总信息
    """
    # 权限检查
    if not has_permission(user_role, 'can_view_gold_material'):
        raise HTTPException(status_code=403, detail="权限不足")
    
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式错误，请使用 YYYY-MM-DD 格式")
    
    if start > end:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")
    
    try:
        result = await GoldAccountService.generate_customer_statement(
            db, customer_id, start, end
        )
        
        if "error" in result:
            return error_response(message=result["error"])
        
        return success_response(data=result)
    except Exception as e:
        logger.error(f"[对账单] 生成失败: {e}")
        raise HTTPException(status_code=500, detail=f"生成对账单失败: {str(e)}")


# ==================== 健康检查 ====================

@router.get("/health")
async def reconciliation_health_check(
    user_role: str = Query(default="sales", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    金料账户健康检查
    
    快速检查是否存在账户不一致的情况
    仅返回统计信息，不返回详细数据
    """
    if user_role not in ['manager', 'material']:
        raise HTTPException(status_code=403, detail="需要管理员或料部权限")
    
    try:
        result = await GoldAccountService.batch_reconcile_customers(
            db, auto_fix=False, only_inconsistent=True
        )
        
        health_status = "healthy" if result["inconsistent_count"] == 0 else "warning"
        
        return success_response(
            data={
                "status": health_status,
                "total_accounts": result["total_checked"],
                "consistent_accounts": result["consistent_count"],
                "inconsistent_accounts": result["inconsistent_count"],
                "message": "所有账户余额一致" if health_status == "healthy" 
                          else f"发现 {result['inconsistent_count']} 个账户余额不一致，建议进行对账修复"
            }
        )
    except Exception as e:
        logger.error(f"[健康检查] 失败: {e}")
        return success_response(
            data={
                "status": "error",
                "message": f"检查失败: {str(e)}"
            }
        )
