"""
操作审计服务 - 提供便捷的审计日志记录和查询功能
"""
import json
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_

from ..models.audit import AuditLog, BalanceChangeLog

# 中国时区
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间"""
    return datetime.now(CHINA_TZ)


class AuditService:
    """审计日志服务"""
    
    # 操作类型映射（用于展示）
    ACTION_LABELS = {
        'create': '创建',
        'update': '更新',
        'delete': '删除',
        'confirm': '确认',
        'cancel': '取消',
        'revert': '撤销',
        'balance_change': '余额变动',
        'deposit': '存料',
        'withdrawal': '提料',
        'settlement': '结算',
        'receipt': '收料',
        'payment': '付款',
        'transfer': '调拨'
    }
    
    # 实体类型映射
    ENTITY_LABELS = {
        'sales_order': '销售单',
        'settlement_order': '结算单',
        'inbound_order': '入库单',
        'return_order': '退货单',
        'customer': '客户',
        'supplier': '供应商',
        'inventory': '库存',
        'gold_deposit': '存料',
        'gold_withdrawal': '提料',
        'gold_receipt': '收料',
        'gold_payment': '付料',
        'finance_payment': '财务付款',
        'finance_receipt': '财务收款'
    }
    
    @classmethod
    def log_operation(
        cls,
        db: Session,
        action: str,
        entity_type: str,
        entity_id: Optional[int] = None,
        old_value: Optional[Dict] = None,
        new_value: Optional[Dict] = None,
        user_id: Optional[str] = None,
        user_role: Optional[str] = None,
        remark: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> AuditLog:
        """
        记录操作日志
        
        Args:
            db: 数据库会话
            action: 操作类型 (create/update/delete/confirm/cancel/revert等)
            entity_type: 实体类型 (sales_order/settlement_order/customer等)
            entity_id: 实体ID
            old_value: 变更前的值
            new_value: 变更后的值
            user_id: 用户ID
            user_role: 用户角色
            remark: 备注说明
            ip_address: IP地址
            
        Returns:
            创建的审计日志记录
        """
        log = AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            old_value=json.dumps(old_value, ensure_ascii=False, default=str) if old_value else None,
            new_value=json.dumps(new_value, ensure_ascii=False, default=str) if new_value else None,
            user_id=user_id,
            user_role=user_role,
            remark=remark,
            ip_address=ip_address,
            created_at=china_now()
        )
        db.add(log)
        db.flush()
        return log
    
    @classmethod
    def log_balance_change(
        cls,
        db: Session,
        account_type: str,
        account_id: int,
        account_name: str,
        change_type: str,
        change_amount: float,
        balance_before: float,
        balance_after: float,
        reference_type: Optional[str] = None,
        reference_id: Optional[int] = None,
        reference_no: Optional[str] = None,
        operator: Optional[str] = None,
        operator_role: Optional[str] = None,
        remark: Optional[str] = None
    ) -> BalanceChangeLog:
        """
        记录余额变动日志
        
        Args:
            account_type: 账户类型 (customer_gold/supplier_gold/cash)
            account_id: 账户ID
            account_name: 账户名称
            change_type: 变动类型
            change_amount: 变动金额
            balance_before: 变动前余额
            balance_after: 变动后余额
            reference_type: 关联单据类型
            reference_id: 关联单据ID
            reference_no: 关联单据号
            operator: 操作人
            operator_role: 操作人角色
            remark: 备注
            
        Returns:
            创建的余额变动日志
        """
        log = BalanceChangeLog(
            account_type=account_type,
            account_id=account_id,
            account_name=account_name,
            change_type=change_type,
            change_amount=str(change_amount),
            balance_before=str(balance_before),
            balance_after=str(balance_after),
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            operator=operator,
            operator_role=operator_role,
            remark=remark,
            created_at=china_now()
        )
        db.add(log)
        db.flush()
        return log
    
    @classmethod
    def get_operation_logs(
        cls,
        db: Session,
        entity_type: Optional[str] = None,
        entity_id: Optional[int] = None,
        action: Optional[str] = None,
        user_role: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 50
    ) -> List[Dict]:
        """
        查询操作日志
        """
        query = db.query(AuditLog)
        
        if entity_type:
            query = query.filter(AuditLog.entity_type == entity_type)
        if entity_id:
            query = query.filter(AuditLog.entity_id == entity_id)
        if action:
            query = query.filter(AuditLog.action == action)
        if user_role:
            query = query.filter(AuditLog.user_role == user_role)
        if start_date:
            query = query.filter(AuditLog.created_at >= start_date)
        if end_date:
            query = query.filter(AuditLog.created_at <= end_date)
        
        logs = query.order_by(desc(AuditLog.created_at)).limit(limit).all()
        
        return [
            {
                "id": log.id,
                "action": log.action,
                "action_label": cls.ACTION_LABELS.get(log.action, log.action),
                "entity_type": log.entity_type,
                "entity_label": cls.ENTITY_LABELS.get(log.entity_type, log.entity_type),
                "entity_id": log.entity_id,
                "old_value": json.loads(log.old_value) if log.old_value else None,
                "new_value": json.loads(log.new_value) if log.new_value else None,
                "user_id": log.user_id,
                "user_role": log.user_role,
                "remark": log.remark,
                "created_at": log.created_at.isoformat() if log.created_at else None
            }
            for log in logs
        ]
    
    @classmethod
    def get_balance_history(
        cls,
        db: Session,
        account_type: str,
        account_id: int,
        limit: int = 50
    ) -> List[Dict]:
        """
        查询账户余额变动历史
        """
        logs = db.query(BalanceChangeLog).filter(
            BalanceChangeLog.account_type == account_type,
            BalanceChangeLog.account_id == account_id
        ).order_by(desc(BalanceChangeLog.created_at)).limit(limit).all()
        
        return [
            {
                "id": log.id,
                "change_type": log.change_type,
                "change_amount": float(log.change_amount),
                "balance_before": float(log.balance_before),
                "balance_after": float(log.balance_after),
                "reference_type": log.reference_type,
                "reference_id": log.reference_id,
                "reference_no": log.reference_no,
                "operator": log.operator,
                "remark": log.remark,
                "created_at": log.created_at.isoformat() if log.created_at else None
            }
            for log in logs
        ]
    
    @classmethod
    def format_operation_result(
        cls,
        action: str,
        entity_type: str,
        entity_no: str,
        old_value: Optional[Dict] = None,
        new_value: Optional[Dict] = None,
        changes: Optional[List[Dict]] = None
    ) -> Dict:
        """
        格式化操作结果，用于AI回复展示
        
        Returns:
            格式化的操作结果字典，包含：
            - success: 是否成功
            - action_label: 操作类型中文名
            - entity_label: 实体类型中文名
            - entity_no: 单据号
            - changes: 变更列表（字段名、旧值、新值）
            - summary: 操作摘要
        """
        action_label = cls.ACTION_LABELS.get(action, action)
        entity_label = cls.ENTITY_LABELS.get(entity_type, entity_type)
        
        # 构建变更列表
        change_list = []
        if changes:
            change_list = changes
        elif old_value and new_value:
            for key in set(list(old_value.keys()) + list(new_value.keys())):
                old_v = old_value.get(key)
                new_v = new_value.get(key)
                if old_v != new_v:
                    change_list.append({
                        "field": key,
                        "old_value": old_v,
                        "new_value": new_v
                    })
        
        # 构建摘要
        summary = f"{action_label}{entity_label}：{entity_no}"
        
        return {
            "success": True,
            "action": action,
            "action_label": action_label,
            "entity_type": entity_type,
            "entity_label": entity_label,
            "entity_no": entity_no,
            "changes": change_list,
            "summary": summary,
            "timestamp": china_now().isoformat()
        }


# 高风险操作列表（需要二次确认）
HIGH_RISK_OPERATIONS = {
    # 删除操作
    ('delete', 'customer'): "删除客户将清除所有关联的销售记录",
    ('delete', 'supplier'): "删除供应商将清除所有关联的入库记录",
    ('delete', 'sales_order'): "删除销售单将影响库存和客户统计",
    ('delete', 'settlement_order'): "删除结算单将影响财务数据",
    
    # 批量操作
    ('batch_delete', '*'): "批量删除操作不可恢复",
    ('batch_update', '*'): "批量更新将影响多条记录",
    
    # 金额相关
    ('revert', 'settlement_order'): "撤销结算将回滚库存和财务数据",
    ('adjustment', 'balance'): "调整余额将直接影响账务数据",
    
    # 数据导入
    ('import', '*'): "批量导入将新增或覆盖数据"
}


def needs_confirmation(action: str, entity_type: str, amount: Optional[float] = None) -> Optional[str]:
    """
    检查操作是否需要二次确认
    
    Args:
        action: 操作类型
        entity_type: 实体类型
        amount: 涉及金额（可选）
        
    Returns:
        如果需要确认，返回确认提示信息；否则返回None
    """
    # 检查高风险操作
    key = (action, entity_type)
    if key in HIGH_RISK_OPERATIONS:
        return HIGH_RISK_OPERATIONS[key]
    
    # 检查通配符
    key_wildcard = (action, '*')
    if key_wildcard in HIGH_RISK_OPERATIONS:
        return HIGH_RISK_OPERATIONS[key_wildcard]
    
    # 检查大额操作
    if amount and amount >= 10000:
        return f"此操作涉及金额 ¥{amount:,.2f}，请确认"
    
    # 检查大克重操作
    if amount and amount >= 100 and entity_type in ['gold_deposit', 'gold_withdrawal', 'gold_receipt']:
        return f"此操作涉及 {amount:.2f} 克金料，请确认"
    
    return None


# 导出
__all__ = ['AuditService', 'needs_confirmation', 'HIGH_RISK_OPERATIONS']
