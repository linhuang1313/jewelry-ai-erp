"""
聊天历史路由模块
包含会话管理、历史记录、日志搜索等功能
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime
from time import time
import logging
import json
from typing import List, Optional

from ..database import get_db
from ..models import ChatLog, ChatSessionMeta
from .. import context_manager as ctx

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat-history"])

CHAT_SESSION_CACHE_TTL = 10
_CHAT_SESSION_CACHE: dict[str, dict] = {}


def _get_chat_session_cache_key(user_role: Optional[str], user_id: Optional[str], limit: int) -> str:
    return f"{user_role or ''}|{user_id or ''}|{limit}"


def _get_cached_chat_sessions(cache_key: str):
    cached = _CHAT_SESSION_CACHE.get(cache_key)
    if not cached:
        return None
    if time() - cached["timestamp"] > CHAT_SESSION_CACHE_TTL:
        return None
    return cached["data"]


def log_chat_message(
    db: Session,
    session_id: str,
    user_role: str,
    message_type: str,
    content: str,
    intent: str = None,
    entities: dict = None,
    response_time_ms: int = None,
    is_successful: bool = True,
    error_message: str = None,
    user_id: str = None
):
    """记录对话日志到数据库"""
    try:
        chat_log = ChatLog(
            session_id=session_id or f"session_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            user_id=user_id,
            user_role=user_role or "sales",
            message_type=message_type,
            content=content[:10000] if content else "",
            intent=intent,
            entities=json.dumps(entities, ensure_ascii=False) if entities else None,
            response_time_ms=response_time_ms,
            is_successful=1 if is_successful else 0,
            error_message=error_message
        )
        db.add(chat_log)
        db.commit()
        logger.info(f"[对话日志] 已记录: role={user_role}, type={message_type}, intent={intent}")
    except Exception as e:
        logger.error(f"[对话日志] 记录失败: {e}")
        db.rollback()


# ==================== 会话管理API ====================

@router.get("/api/chat-sessions")
async def get_chat_sessions(
    user_role: str = None,
    user_id: str = None,
    limit: int = 30,
    db: Session = Depends(get_db)
):
    """获取对话会话列表（按会话分组）"""
    try:
        cache_key = _get_chat_session_cache_key(user_role, user_id, limit)
        cached = _get_cached_chat_sessions(cache_key)
        if cached is not None:
            return cached

        subquery = db.query(
            ChatLog.session_id,
            func.min(ChatLog.created_at).label('start_time'),
            func.max(ChatLog.created_at).label('end_time'),
            func.count(ChatLog.id).label('message_count')
        ).group_by(ChatLog.session_id)
        
        if user_role:
            subquery = subquery.filter(ChatLog.user_role == user_role)
        
        if user_id:
            subquery = subquery.filter(ChatLog.user_id == user_id)
        
        subquery = subquery.order_by(desc(func.max(ChatLog.created_at))).limit(limit)
        sessions = subquery.all()
        session_ids = [s.session_id for s in sessions]
        if not session_ids:
            result = {"success": True, "sessions": [], "total": 0}
            _CHAT_SESSION_CACHE[cache_key] = {"timestamp": time(), "data": result}
            return result

        first_user_sub = db.query(
            ChatLog.session_id,
            func.min(ChatLog.created_at).label('first_time')
        ).filter(
            ChatLog.session_id.in_(session_ids),
            ChatLog.message_type == "user"
        )
        last_msg_sub = db.query(
            ChatLog.session_id,
            func.max(ChatLog.created_at).label('last_time')
        ).filter(
            ChatLog.session_id.in_(session_ids)
        )

        if user_role:
            first_user_sub = first_user_sub.filter(ChatLog.user_role == user_role)
            last_msg_sub = last_msg_sub.filter(ChatLog.user_role == user_role)
        if user_id:
            first_user_sub = first_user_sub.filter(ChatLog.user_id == user_id)
            last_msg_sub = last_msg_sub.filter(ChatLog.user_id == user_id)

        first_user_sub = first_user_sub.group_by(ChatLog.session_id).subquery()
        last_msg_sub = last_msg_sub.group_by(ChatLog.session_id).subquery()

        first_msgs = db.query(ChatLog).join(
            first_user_sub,
            (ChatLog.session_id == first_user_sub.c.session_id) &
            (ChatLog.created_at == first_user_sub.c.first_time)
        ).all()
        last_msgs = db.query(ChatLog).join(
            last_msg_sub,
            (ChatLog.session_id == last_msg_sub.c.session_id) &
            (ChatLog.created_at == last_msg_sub.c.last_time)
        ).all()

        first_msg_map = {msg.session_id: msg for msg in first_msgs}
        last_msg_map = {msg.session_id: msg for msg in last_msgs}
        session_meta_map = {
            meta.session_id: meta
            for meta in db.query(ChatSessionMeta).filter(
                ChatSessionMeta.session_id.in_(session_ids)
            ).all()
        }
        
        result = []
        for session in sessions:
            first_msg = first_msg_map.get(session.session_id)
            last_msg = last_msg_map.get(session.session_id)
            
            summary = ""
            if first_msg and first_msg.content:
                summary = first_msg.content[:60] + "..." if len(first_msg.content) > 60 else first_msg.content
            
            session_meta = session_meta_map.get(session.session_id)
            custom_name = session_meta.custom_name if session_meta else None
            is_pinned = session_meta.is_pinned if session_meta else 0
            
            result.append({
                "session_id": session.session_id,
                "start_time": session.start_time.isoformat() if session.start_time else None,
                "end_time": session.end_time.isoformat() if session.end_time else None,
                "message_count": session.message_count,
                "summary": summary,
                "custom_name": custom_name,
                "is_pinned": is_pinned,
                "last_intent": last_msg.intent if last_msg else None,
                "user_role": last_msg.user_role if last_msg else None
            })
        
        result.sort(key=lambda x: (-x.get('is_pinned', 0), x.get('start_time', '') or ''), reverse=False)
        result.sort(key=lambda x: -x.get('is_pinned', 0))
        
        response = {"success": True, "sessions": result, "total": len(result)}
        _CHAT_SESSION_CACHE[cache_key] = {"timestamp": time(), "data": response}
        return response
    except Exception as e:
        logger.error(f"获取会话列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "sessions": []}


@router.put("/api/chat-sessions/{session_id}/rename")
async def rename_chat_session(
    session_id: str,
    name: str = Query(..., description="新的会话名称"),
    db: Session = Depends(get_db)
):
    """重命名对话会话"""
    try:
        session_meta = db.query(ChatSessionMeta).filter(
            ChatSessionMeta.session_id == session_id
        ).first()
        
        if session_meta:
            session_meta.custom_name = name.strip() if name.strip() else None
        else:
            session_meta = ChatSessionMeta(
                session_id=session_id,
                custom_name=name.strip() if name.strip() else None
            )
            db.add(session_meta)
        
        db.commit()
        
        return {
            "success": True,
            "message": "会话重命名成功",
            "session_id": session_id,
            "custom_name": session_meta.custom_name
        }
    except Exception as e:
        db.rollback()
        logger.error(f"重命名会话失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.put("/api/chat-sessions/{session_id}/pin")
async def toggle_pin_chat_session(
    session_id: str,
    pinned: bool = Query(..., description="是否置顶"),
    db: Session = Depends(get_db)
):
    """置顶/取消置顶对话会话"""
    try:
        session_meta = db.query(ChatSessionMeta).filter(
            ChatSessionMeta.session_id == session_id
        ).first()
        
        if session_meta:
            session_meta.is_pinned = 1 if pinned else 0
        else:
            session_meta = ChatSessionMeta(
                session_id=session_id,
                is_pinned=1 if pinned else 0
            )
            db.add(session_meta)
        
        db.commit()
        
        return {
            "success": True,
            "message": "置顶已" + ("设置" if pinned else "取消"),
            "session_id": session_id,
            "is_pinned": session_meta.is_pinned
        }
    except Exception as e:
        db.rollback()
        logger.error(f"置顶会话失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.delete("/api/chat-sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    db: Session = Depends(get_db)
):
    """删除对话会话"""
    try:
        deleted_logs = db.query(ChatLog).filter(
            ChatLog.session_id == session_id
        ).delete()
        
        db.query(ChatSessionMeta).filter(
            ChatSessionMeta.session_id == session_id
        ).delete()
        
        db.commit()
        
        return {
            "success": True,
            "message": f"会话已删除，共删除 {deleted_logs} 条消息",
            "session_id": session_id
        }
    except Exception as e:
        db.rollback()
        logger.error(f"删除会话失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# ==================== 历史记录API ====================

@router.get("/api/chat-history/{session_id}")
async def get_chat_history(
    session_id: str,
    db: Session = Depends(get_db)
):
    """获取指定会话的完整对话历史"""
    try:
        logs = db.query(ChatLog).filter(
            ChatLog.session_id == session_id
        ).order_by(ChatLog.created_at).all()
        
        if not logs:
            return {"success": False, "message": "未找到该会话", "messages": []}
        
        messages = []
        for log in logs:
            messages.append({
                "id": log.id,
                "message_type": log.message_type,
                "content": log.content,
                "intent": log.intent,
                "user_role": log.user_role,
                "is_successful": log.is_successful,
                "response_time_ms": log.response_time_ms,
                "created_at": log.created_at.isoformat() if log.created_at else None
            })
        
        return {
            "success": True,
            "session_id": session_id,
            "messages": messages,
            "total": len(messages)
        }
    except Exception as e:
        logger.error(f"获取对话历史失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "messages": []}


# ==================== 日志API ====================

@router.post("/api/chat-logs/message")
async def save_chat_message(
    session_id: str,
    message_type: str,
    content: str,
    user_role: str = 'sales',
    user_id: str = None,
    intent: str = None,
    db: Session = Depends(get_db)
):
    """保存单条聊天消息到历史记录"""
    try:
        log_chat_message(
            db=db,
            session_id=session_id,
            user_role=user_role,
            message_type=message_type,
            content=content[:10000] if content else "",
            intent=intent,
            response_time_ms=None,
            is_successful=True,
            user_id=user_id
        )
        return {"success": True, "message": "消息保存成功"}
    except Exception as e:
        logger.error(f"保存消息失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/api/chat-logs/search")
async def search_chat_logs(
    keyword: str = None,
    user_role: str = None,
    intent: str = None,
    start_date: str = None,
    end_date: str = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """搜索聊天记录"""
    try:
        query = db.query(ChatLog).order_by(desc(ChatLog.created_at))
        
        if keyword:
            query = query.filter(ChatLog.content.contains(keyword))
        if user_role:
            query = query.filter(ChatLog.user_role == user_role)
        if intent:
            query = query.filter(ChatLog.intent == intent)
        if start_date:
            query = query.filter(func.date(ChatLog.created_at) >= start_date)
        if end_date:
            query = query.filter(func.date(ChatLog.created_at) <= end_date)
        
        total = query.count()
        logs = query.offset(offset).limit(limit).all()
        
        return {
            "success": True,
            "total": total,
            "logs": [
                {
                    "id": log.id,
                    "session_id": log.session_id,
                    "user_role": log.user_role,
                    "message_type": log.message_type,
                    "content": log.content[:200] + "..." if log.content and len(log.content) > 200 else log.content,
                    "intent": log.intent,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                    "is_successful": log.is_successful
                }
                for log in logs
            ]
        }
    except Exception as e:
        logger.error(f"搜索聊天记录失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "logs": [], "total": 0}


# ==================== 上下文工程API ====================

@router.get("/api/context/{session_id}")
async def get_session_context(session_id: str):
    """获取会话上下文"""
    try:
        context = ctx.load_session_context(session_id)
        summary = ctx.generate_context_summary(session_id)
        return {
            "success": True,
            "context": context,
            "summary": summary
        }
    except Exception as e:
        logger.error(f"获取上下文失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/api/context/{session_id}/goal")
async def set_session_goal(session_id: str, goal: str, phases: List[str] = None):
    """设置会话目标和阶段"""
    try:
        context = ctx.update_session_goal(session_id, goal, phases)
        return {
            "success": True,
            "message": f"目标已设置: {goal}",
            "context": context
        }
    except Exception as e:
        logger.error(f"设置目标失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/api/context/{session_id}/note")
async def add_session_note(session_id: str, note: str, category: str = "general"):
    """添加会话笔记"""
    try:
        context = ctx.add_note(session_id, note, category)
        return {
            "success": True,
            "message": "笔记已添加",
            "notes_count": len(context.get("notes", []))
        }
    except Exception as e:
        logger.error(f"添加笔记失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.delete("/api/context/{session_id}")
async def clear_session_context(session_id: str):
    """清除会话上下文"""
    try:
        ctx.clear_session(session_id)
        return {"success": True, "message": f"会话 {session_id} 的上下文已清除"}
    except Exception as e:
        logger.error(f"清除上下文失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/api/context/list/all")
async def list_all_contexts():
    """列出所有会话上下文"""
    try:
        sessions = ctx.list_sessions()
        contexts = []
        for sid in sessions:
            c = ctx.load_session_context(sid)
            contexts.append({
                "session_id": sid,
                "goal": c.get("goal"),
                "last_updated": c.get("last_updated"),
                "actions_count": len(c.get("completed_actions", [])),
                "errors_count": len(c.get("errors", []))
            })
        return {
            "success": True,
            "sessions": contexts,
            "total": len(contexts)
        }
    except Exception as e:
        logger.error(f"列出上下文失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/api/knowledge-base")
async def get_knowledge_base():
    """获取业务知识库内容"""
    try:
        knowledge = ctx.load_knowledge_base()
        return {
            "success": True,
            "content": knowledge,
            "length": len(knowledge)
        }
    except Exception as e:
        logger.error(f"获取知识库失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}
