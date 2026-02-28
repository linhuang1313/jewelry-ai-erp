"""
Core 模块 - 核心功能组件

包含：
- transaction: 事务管理器
"""

from .transaction import (
    transaction_scope,
    transactional,
    TransactionContext,
    TransactionError,
    AuditLogService
)

__all__ = [
    'transaction_scope',
    'transactional',
    'TransactionContext',
    'TransactionError',
    'AuditLogService'
]
