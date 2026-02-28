"""
跨角色协同任务卡片模型
ActionCard: 任务卡片（收款确认、结算审批等跨角色协同场景）
Notification: 闭环通知（卡片完成后推送给创建者）
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.sql import func
from ..database import Base


class ActionCard(Base):
    """跨角色协同任务卡片"""
    __tablename__ = "action_cards"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(String(50), unique=True, index=True, nullable=False)
    creator_id = Column(String(50), nullable=False)
    creator_role = Column(String(20), nullable=False, index=True)
    target_roles = Column(JSON, nullable=False)
    card_type = Column(String(50), nullable=False, index=True)
    payload = Column(JSON, nullable=False)
    status = Column(String(20), default="pending", index=True)
    actions_taken = Column(JSON, default=list)
    business_result = Column(JSON, nullable=True)
    session_id = Column(String(100), nullable=True, index=True)
    create_time = Column(DateTime(timezone=True), server_default=func.now())
    update_time = Column(DateTime(timezone=True), onupdate=func.now())
    expire_time = Column(DateTime(timezone=True), nullable=True)


class Notification(Base):
    """闭环通知"""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    target_role = Column(String(20), nullable=False, index=True)
    target_user = Column(String(50), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    card_id = Column(String(50), nullable=True, index=True)
    notification_type = Column(String(50), nullable=False, index=True)
    is_read = Column(Boolean, default=False, index=True)
    create_time = Column(DateTime(timezone=True), server_default=func.now())
