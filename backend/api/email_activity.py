from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import (
    EmailActivityCatalogItem,
    EmailActivityInsights,
    EmailActivityListResponse,
    EmailActivityMarkReadRequest,
)
from db.models import AppUser, AppUserRole
from modules import email_activity

router = APIRouter(prefix="/email-activity", tags=["email-activity"])


def _is_admin(user: AppUser) -> bool:
    role = user.role.value if isinstance(user.role, AppUserRole) else str(user.role)
    return role == AppUserRole.admin.value


@router.get("", response_model=EmailActivityListResponse)
def list_email_activity(
    page: int = 1,
    page_size: int = email_activity.DEFAULT_PAGE_SIZE,
    unread_only: bool = False,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    is_admin = _is_admin(user)
    rows, total, unread = email_activity.list_events(
        db,
        page=page,
        page_size=page_size,
        unread_only=unread_only,
        user_id=user.id,
        is_admin=is_admin,
    )
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    actors = email_activity.actors_for_events(db, rows)
    return EmailActivityListResponse(
        total=total,
        unread_count=unread,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        rows=[
            email_activity.event_to_dict(row, actor=actors.get(row.user_id) if row.user_id else None)
            for row in rows
        ],
    )


@router.get("/insights", response_model=EmailActivityInsights)
def email_activity_insights(
    days: int | None = 30,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    """Aggregate send / open / bulk vs individual stats for the Insights panel."""
    period = None if days is not None and int(days) <= 0 else (days if days is not None else 30)
    if period is not None:
        period = max(1, min(int(period), 3650))
    return email_activity.insights_stats(
        db,
        days=period,
        user_id=user.id,
        is_admin=_is_admin(user),
    )


@router.get("/catalog", response_model=list[EmailActivityCatalogItem])
def list_email_activity_catalog(_: AppUser = Depends(get_current_user)):
    return email_activity.catalog_list()


@router.get("/unread-count")
def email_activity_unread_count(
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    _, _, unread = email_activity.list_events(
        db,
        page=1,
        page_size=1,
        user_id=user.id,
        is_admin=_is_admin(user),
    )
    return {"unread_count": unread}


@router.post("/mark-read")
def mark_email_activity_read(
    payload: EmailActivityMarkReadRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    if not payload.mark_all and not payload.event_ids:
        raise HTTPException(400, "Provide event_ids or set mark_all=true")
    updated = email_activity.mark_read(
        db,
        payload.event_ids,
        mark_all=payload.mark_all,
        user_id=user.id,
        is_admin=_is_admin(user),
    )
    return {"updated": updated}
