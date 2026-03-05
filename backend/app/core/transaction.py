"""
事务管理器 - 提供数据库事务的统一管理和审计日志记录

主要功能：
1. 事务作用域管理 - 确保多表操作的原子性
2. 审计日志记录 - 记录敏感操作的变更历史
3. 操作回滚支持 - 支持错误时的自动回滚
"""

from contextlib import contextmanager
from functools import wraps
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, Dict, Any, Callable
import logging
import json


from ..timezone_utils import china_now

logger = logging.getLogger(__name__)


class TransactionError(Exception):
    """事务错误"""
    def __init__(self, message: str, operation: str = None, details: dict = None):
        self.message = message
        self.operation = operation
        self.details = details or {}
        super().__init__(self.message)


@contextmanager
def transaction_scope(db: Session, operation_name: str = "unknown"):
    """
    事务作用域上下文管理器
    
    使用方式：
    ```python
    with transaction_scope(db, "确认结算单") as tx:
        # 多表操作...
        tx.add_log("更新结算单状态", {"old": "pending", "new": "confirmed"})
    # 自动提交或回滚
    ```
    
    Args:
        db: 数据库会话
        operation_name: 操作名称（用于日志记录）
        
    Yields:
        TransactionContext: 事务上下文对象
    """
    tx = TransactionContext(db, operation_name)
    try:
        yield tx
        db.commit()
        tx.on_success()
    except Exception as e:
        db.rollback()
        tx.on_error(e)
        logger.error(f"[事务回滚] 操作: {operation_name}, 错误: {e}", exc_info=True)
        raise TransactionError(
            message=f"操作失败: {operation_name}",
            operation=operation_name,
            details={"error": str(e), "logs": tx.logs}
        )


class TransactionContext:
    """事务上下文对象"""
    
    def __init__(self, db: Session, operation_name: str):
        self.db = db
        self.operation_name = operation_name
        self.start_time = china_now()
        self.logs = []
        self._rollback_handlers = []
    
    def add_log(self, action: str, details: dict = None):
        """添加操作日志"""
        self.logs.append({
            "action": action,
            "details": details or {},
            "timestamp": china_now().isoformat()
        })
    
    def register_rollback(self, handler: Callable):
        """注册回滚处理器（用于外部资源回滚）"""
        self._rollback_handlers.append(handler)
    
    def on_success(self):
        """事务成功回调"""
        duration = (china_now() - self.start_time).total_seconds()
        logger.info(f"[事务成功] 操作: {self.operation_name}, 耗时: {duration:.2f}s, 步骤数: {len(self.logs)}")
    
    def on_error(self, error: Exception):
        """事务失败回调"""
        # 执行注册的回滚处理器
        for handler in self._rollback_handlers:
            try:
                handler()
            except Exception as e:
                logger.error(f"[回滚处理器失败] {e}")


def transactional(operation_name: str = None):
    """
    事务装饰器 - 自动管理函数级别的事务
    
    使用方式：
    ```python
    @transactional("确认结算单")
    async def confirm_settlement(db: Session, settlement_id: int, ...):
        # 业务逻辑...
    ```
    
    Args:
        operation_name: 操作名称
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 从参数中获取 db session
            db = kwargs.get('db') or (args[0] if args else None)
            if not isinstance(db, Session):
                # 尝试从第二个参数获取
                db = kwargs.get('db') or (args[1] if len(args) > 1 else None)
            
            if not db:
                raise ValueError("无法获取数据库会话")
            
            op_name = operation_name or func.__name__
            
            try:
                result = await func(*args, **kwargs)
                db.commit()
                logger.info(f"[事务成功] {op_name}")
                return result
            except Exception as e:
                db.rollback()
                logger.error(f"[事务回滚] {op_name}: {str(e)}")
                raise
        
        return wrapper
    return decorator


# ==================== 审计日志服务 ====================

class AuditLogService:
    """审计日志服务"""
    
    @staticmethod
    def log_operation(
        db: Session,
        user_id: Optional[str],
        user_role: str,
        action: str,
        entity_type: str,
        entity_id: int,
        old_value: dict = None,
        new_value: dict = None,
        ip_address: str = None,
        remark: str = None
    ):
        """
        记录审计日志
        
        Args:
            db: 数据库会话
            user_id: 用户ID
            user_role: 用户角色
            action: 操作类型 (create, update, delete, confirm, cancel, revert)
            entity_type: 实体类型 (settlement, gold_receipt, customer_deposit, etc.)
            entity_id: 实体ID
            old_value: 变更前的值
            new_value: 变更后的值
            ip_address: IP地址
            remark: 备注
        """
        from ..models.audit import AuditLog
        
        try:
            audit_log = AuditLog(
                user_id=user_id,
                user_role=user_role,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                old_value=json.dumps(old_value, ensure_ascii=False, default=str) if old_value else None,
                new_value=json.dumps(new_value, ensure_ascii=False, default=str) if new_value else None,
                ip_address=ip_address,
                remark=remark,
                created_at=china_now()
            )
            db.add(audit_log)
            # 注意：不在这里commit，由外层事务统一管理
        except Exception as e:
            logger.error(f"[审计日志] 记录失败: {e}")
    
    @staticmethod
    def log_settlement_confirm(
        db: Session,
        user_role: str,
        settlement_id: int,
        settlement_no: str,
        customer_name: str,
        total_amount: float,
        gold_weight: float = None,
        confirmed_by: str = None
    ):
        """记录结算确认审计日志"""
        AuditLogService.log_operation(
            db=db,
            user_id=confirmed_by,
            user_role=user_role,
            action="confirm",
            entity_type="settlement",
            entity_id=settlement_id,
            new_value={
                "settlement_no": settlement_no,
                "customer_name": customer_name,
                "total_amount": total_amount,
                "gold_weight": gold_weight,
                "confirmed_by": confirmed_by,
                "confirmed_at": china_now().isoformat()
            },
            remark=f"确认结算单 {settlement_no}"
        )
    
    @staticmethod
    def log_gold_balance_change(
        db: Session,
        user_role: str,
        customer_id: int,
        customer_name: str,
        change_type: str,
        amount: float,
        balance_before: float,
        balance_after: float,
        reference_no: str = None,
        operator: str = None
    ):
        """记录金料余额变动审计日志"""
        AuditLogService.log_operation(
            db=db,
            user_id=operator,
            user_role=user_role,
            action="balance_change",
            entity_type="customer_gold_deposit",
            entity_id=customer_id,
            old_value={"balance": balance_before},
            new_value={
                "balance": balance_after,
                "change_type": change_type,
                "amount": amount,
                "reference_no": reference_no
            },
            remark=f"客户 {customer_name} 金料余额变动: {balance_before} -> {balance_after}"
        )


# 导出
__all__ = [
    'transaction_scope',
    'transactional',
    'TransactionContext',
    'TransactionError',
    'AuditLogService'
]
