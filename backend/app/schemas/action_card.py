"""
ActionCard Pydantic Schema
"""
from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List, Dict, Any


class ActionCardCreate(BaseModel):
    """创建卡片（内部使用，由 chat_handlers 调用）"""
    card_type: str
    target_roles: List[str]
    payload: Dict[str, Any]


class ActionCardExecute(BaseModel):
    """执行卡片动作"""
    action: str  # confirm / reject
    comment: Optional[str] = None


class ActionCardResponse(BaseModel):
    """卡片响应"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: str
    creator_id: str
    creator_role: str
    target_roles: List[str]
    card_type: str
    payload: Dict[str, Any]
    status: str
    actions_taken: Optional[List[Dict[str, Any]]] = []
    business_result: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = None
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None


class NotificationResponse(BaseModel):
    """通知响应"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_role: str
    target_user: Optional[str] = None
    title: str
    body: Optional[str] = None
    card_id: Optional[str] = None
    notification_type: str
    is_read: bool
    create_time: Optional[datetime] = None
