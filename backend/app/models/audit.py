"""
审计日志模型 - 记录敏感操作的变更历史

记录的操作类型：
- create: 创建
- update: 更新
- delete: 删除
- confirm: 确认
- cancel: 取消
- revert: 撤销
- balance_change: 余额变动
"""

from sqlalchemy import Column, Integer, String, DateTime, Text, Index
from sqlalchemy.sql import func
from ..database import Base


class AuditLog(Base):
    """审计日志表 - 记录所有敏感操作"""
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 操作人信息
    user_id = Column(String(100), nullable=True, index=True)  # 用户ID
    user_role = Column(String(20), nullable=True, index=True)  # 用户角色
    
    # 操作信息
    action = Column(String(50), nullable=False, index=True)  # 操作类型
    entity_type = Column(String(50), nullable=False, index=True)  # 实体类型
    entity_id = Column(Integer, nullable=True, index=True)  # 实体ID
    
    # 变更内容
    old_value = Column(Text, nullable=True)  # 变更前的值（JSON格式）
    new_value = Column(Text, nullable=True)  # 变更后的值（JSON格式）
    
    # 其他信息
    ip_address = Column(String(50), nullable=True)  # IP地址
    remark = Column(Text, nullable=True)  # 备注
    
    # 时间戳
    created_at = Column(DateTime, server_default=func.now(), index=True)
    
    # 复合索引
    __table_args__ = (
        Index('idx_audit_entity', 'entity_type', 'entity_id'),
        Index('idx_audit_user_action', 'user_id', 'action'),
        Index('idx_audit_date_action', 'created_at', 'action'),
    )


class BalanceChangeLog(Base):
    """余额变动日志表 - 专门记录金料/现金余额的变动"""
    __tablename__ = "balance_change_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 账户信息
    account_type = Column(String(20), nullable=False, index=True)  # customer_gold, supplier_gold, cash
    account_id = Column(Integer, nullable=False, index=True)  # 客户ID或供应商ID
    account_name = Column(String(100), nullable=True)  # 账户名称
    
    # 变动信息
    change_type = Column(String(30), nullable=False, index=True)  # settlement, receipt, payment, withdrawal, transfer, adjustment
    change_amount = Column(String(20), nullable=False)  # 变动金额（正/负）
    balance_before = Column(String(20), nullable=False)  # 变动前余额
    balance_after = Column(String(20), nullable=False)  # 变动后余额
    
    # 关联单据
    reference_type = Column(String(30), nullable=True)  # settlement, gold_receipt, withdrawal, transfer
    reference_id = Column(Integer, nullable=True)  # 关联单据ID
    reference_no = Column(String(50), nullable=True)  # 关联单据号
    
    # 操作人信息
    operator = Column(String(50), nullable=True)  # 操作人
    operator_role = Column(String(20), nullable=True)  # 操作人角色
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 时间戳
    created_at = Column(DateTime, server_default=func.now(), index=True)
    
    # 复合索引
    __table_args__ = (
        Index('idx_balance_account', 'account_type', 'account_id'),
        Index('idx_balance_reference', 'reference_type', 'reference_id'),
    )


# 导出
__all__ = ['AuditLog', 'BalanceChangeLog']
