"""
跨角色协同任务卡片 API
"""
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import get_current_role, require_permission
from ..models.action_card import ActionCard, Notification
from ..schemas.action_card import (
    ActionCardExecute,
    ActionCardResponse,
    NotificationResponse,
)
from ..services.card_executor import on_card_completed

logger = logging.getLogger(__name__)

router = APIRouter(tags=["action-cards"])

CHINA_TZ = timezone(timedelta(hours=8))


def china_now() -> datetime:
    return datetime.now(CHINA_TZ)


def _generate_card_id(db: Session, max_retries: int = 3) -> str:
    """生成卡片编号 AC + 日期 + 3位序号"""
    now = china_now()
    full_prefix = f"AC{now.strftime('%Y%m%d')}"

    for attempt in range(max_retries):
        latest_row = (
            db.query(ActionCard.card_id)
            .filter(ActionCard.card_id.like(f"{full_prefix}%"))
            .order_by(ActionCard.card_id.desc())
            .limit(1)
            .with_for_update()
            .scalar()
        )

        if latest_row and latest_row.startswith(full_prefix):
            try:
                seq = int(latest_row[len(full_prefix):]) + 1
            except (ValueError, TypeError):
                seq = 1
        else:
            seq = 1

        card_id = f"{full_prefix}{seq:03d}"

        existing = db.query(ActionCard).filter(ActionCard.card_id == card_id).first()
        if existing is None:
            return card_id

        logger.warning(
            "Card ID collision: %s (attempt %d/%d)",
            card_id, attempt + 1, max_retries,
        )

    fallback_ts = now.strftime("%H%M%S")
    return f"{full_prefix}{fallback_ts}"


# ============= 静态路由必须在动态路由之前 =============

@router.get("/api/action-cards/pending")
async def get_pending_cards(
    role: str = Depends(get_current_role),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """获取当前角色的待办卡片"""
    query = db.query(ActionCard).filter(ActionCard.status == "pending")
    # JSON 字段包含当前角色
    all_pending = query.order_by(ActionCard.create_time.desc()).all()
    # 过滤 target_roles 包含当前角色的卡片
    filtered = [c for c in all_pending if role in (c.target_roles or [])]
    # 排除当前角色已操作的卡片
    result = []
    for c in filtered:
        already_acted = any(a.get("role") == role for a in (c.actions_taken or []))
        if not already_acted:
            result.append(c)

    total = len(result)
    start = (page - 1) * page_size
    page_items = result[start : start + page_size]

    return {
        "success": True,
        "items": [ActionCardResponse.model_validate(c).model_dump() for c in page_items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/api/action-cards/history")
async def get_card_history(
    role: str = Depends(get_current_role),
    status: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """获取历史卡片（分页）"""
    query = db.query(ActionCard)
    if status:
        query = query.filter(ActionCard.status == status)
    query = query.order_by(ActionCard.create_time.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "success": True,
        "items": [ActionCardResponse.model_validate(c).model_dump() for c in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/api/action-cards/{card_id}")
async def get_action_card(
    card_id: str,
    db: Session = Depends(get_db),
):
    """获取单个卡片详情"""
    card = db.query(ActionCard).filter(ActionCard.card_id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    return {
        "success": True,
        "data": ActionCardResponse.model_validate(card).model_dump(),
    }


@router.post("/api/action-cards/{card_id}/execute")
async def execute_action_card(
    card_id: str,
    body: ActionCardExecute,
    role: str = Depends(get_current_role),
    db: Session = Depends(get_db),
):
    """执行卡片动作（确认/拒绝），后端强制校验角色"""
    try:
        card = (
            db.query(ActionCard)
            .filter(ActionCard.card_id == card_id)
            .with_for_update()
            .first()
        )
        if not card:
            raise HTTPException(status_code=404, detail="卡片不存在")
        if card.status != "pending":
            raise HTTPException(status_code=400, detail=f"卡片状态为 {card.status}，无法操作")

        if role not in (card.target_roles or []):
            raise HTTPException(status_code=403, detail="你不在此卡片的目标角色中")

        if any(a.get("role") == role for a in (card.actions_taken or [])):
            raise HTTPException(status_code=400, detail="你已经操作过此卡片")

        actions = list(card.actions_taken or [])
        actions.append({
            "role": role,
            "action": body.action,
            "time": china_now().isoformat(),
            "comment": body.comment,
        })
        card.actions_taken = actions

        if body.action == "reject":
            card.status = "rejected"
            # 拒绝通知
            notification = Notification(
                target_role=card.creator_role,
                target_user=card.creator_id,
                title=f"卡片 {card.card_id} 已被 {role} 拒绝",
                body=body.comment or "",
                card_id=card.card_id,
                notification_type="card_rejected",
            )
            db.add(notification)
            db.commit()
            return {
                "success": True,
                "status": "rejected",
                "message": f"卡片已被拒绝（{role}）",
                "card": ActionCardResponse.model_validate(card).model_dump(),
            }

        # 检查是否所有目标角色都已确认
        confirmed_roles = {a["role"] for a in actions if a.get("action") == "confirm"}
        all_confirmed = set(card.target_roles or []).issubset(confirmed_roles)

        if all_confirmed:
            result = await on_card_completed(card, db)

            if not result.get("success", False):
                db.rollback()
                logger.warning(f"card {card_id} 平账失败，事务已回滚: {result.get('summary')}")
                return {
                    "success": False,
                    "status": "pending",
                    "message": result.get("summary", "平账执行失败，卡片保持待确认状态"),
                    "business_result": result,
                }

            card.status = "completed"
            safe_result = {k: v for k, v in result.items() if k != "db"}
            card.business_result = safe_result
            db.commit()
            return {
                "success": True,
                "status": "completed",
                "message": result.get("summary", "卡片已完成"),
                "business_result": safe_result,
                "card": ActionCardResponse.model_validate(card).model_dump(),
            }
        else:
            remaining = set(card.target_roles or []) - confirmed_roles
            db.commit()
            return {
                "success": True,
                "status": "pending",
                "message": f"已确认，等待 {', '.join(remaining)} 确认",
                "confirmed": list(confirmed_roles),
                "remaining": list(remaining),
                "card": ActionCardResponse.model_validate(card).model_dump(),
            }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"execute_action_card error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")


# ============= 通知 API =============

@router.get("/api/notifications/unread")
async def get_unread_notifications(
    role: str = Depends(get_current_role),
    db: Session = Depends(get_db),
):
    """获取当前角色的未读通知"""
    items = (
        db.query(Notification)
        .filter(
            Notification.target_role == role,
            Notification.is_read == False,
        )
        .order_by(Notification.create_time.desc())
        .limit(50)
        .all()
    )
    return {
        "success": True,
        "items": [NotificationResponse.model_validate(n).model_dump() for n in items],
        "total": len(items),
    }


@router.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
):
    """标记通知为已读"""
    n = db.query(Notification).filter(Notification.id == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="通知不存在")
    n.is_read = True
    db.commit()
    return {"success": True, "message": "已标记为已读"}


@router.post("/api/notifications/read-all")
async def mark_all_notifications_read(
    role: str = Depends(get_current_role),
    db: Session = Depends(get_db),
):
    """标记当前角色所有通知为已读"""
    db.query(Notification).filter(
        Notification.target_role == role,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"success": True, "message": "全部已读"}


# ============= 内部辅助：创建卡片（供 chat_handlers 调用） =============

def create_action_card(
    db: Session,
    card_type: str,
    creator_id: str,
    creator_role: str,
    target_roles: list,
    payload: dict,
    session_id: str = None,
) -> ActionCard:
    """创建 ActionCard 记录并返回（不 commit，由调用方统一提交）"""
    card = ActionCard(
        card_id=_generate_card_id(db),
        creator_id=creator_id,
        creator_role=creator_role,
        target_roles=target_roles,
        card_type=card_type,
        payload=payload,
        status="pending",
        actions_taken=[],
        session_id=session_id,
    )
    db.add(card)
    db.flush()
    return card
