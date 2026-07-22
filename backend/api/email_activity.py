from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    EmailActivityCatalogItem,
    EmailActivityInsights,
    EmailActivityListResponse,
    EmailActivityMarkReadRequest,
)
from modules import email_activity

router = APIRouter(prefix="/email-activity", tags=["email-activity"])


@router.get("", response_model=EmailActivityListResponse)
def list_email_activity(
    page: int = 1,
    page_size: int = 30,
    unread_only: bool = False,
    db: Session = Depends(get_db),
):
    rows, total, unread = email_activity.list_events(
        db,
        page=page,
        page_size=page_size,
        unread_only=unread_only,
    )
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    total_pages = max(1, (total + page_size - 1) // page_size)
    return EmailActivityListResponse(
        total=total,
        unread_count=unread,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        rows=[email_activity.event_to_dict(row) for row in rows],
    )


@router.get("/insights", response_model=EmailActivityInsights)
def email_activity_insights(days: int | None = 30, db: Session = Depends(get_db)):
    """Aggregate send / open / bulk vs individual stats for the Insights panel."""
    period = None if days is not None and int(days) <= 0 else (days if days is not None else 30)
    if period is not None:
        period = max(1, min(int(period), 3650))
    return email_activity.insights_stats(db, days=period)


@router.get("/catalog", response_model=list[EmailActivityCatalogItem])
def list_email_activity_catalog():
    return email_activity.catalog_list()


@router.get("/unread-count")
def email_activity_unread_count(db: Session = Depends(get_db)):
    _, _, unread = email_activity.list_events(db, page=1, page_size=1)
    return {"unread_count": unread}


@router.post("/mark-read")
def mark_email_activity_read(
    payload: EmailActivityMarkReadRequest,
    db: Session = Depends(get_db),
):
    if not payload.mark_all and not payload.event_ids:
        raise HTTPException(400, "Provide event_ids or set mark_all=true")
    updated = email_activity.mark_read(
        db,
        payload.event_ids,
        mark_all=payload.mark_all,
    )
    return {"updated": updated}
