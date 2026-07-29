"""AI Mode API — toggle, auto-reply templates, process, company lifecycle."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from db.models import AppUser
from modules import ai_mode as ai_mode_module

router = APIRouter(prefix="/ai-mode", tags=["ai-mode"])


class AiModeSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    email_auto_reply_enabled: Optional[bool] = None
    whatsapp_auto_reply_enabled: Optional[bool] = None
    form_url: Optional[str] = None
    email_subject_template: Optional[str] = None
    email_body_template: Optional[str] = None
    whatsapp_body_template: Optional[str] = None
    query_keywords: Optional[list[str] | str] = None


class LifecycleUpdateRequest(BaseModel):
    stage: str
    notes: Optional[str] = None


class LifecycleEnsureRequest(BaseModel):
    buyer_id: int = Field(..., ge=1)


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    row = ai_mode_module.get_or_create_settings(db, user.id)
    return ai_mode_module.settings_to_dict(row)


@router.patch("/settings")
def patch_settings(
    payload: AiModeSettingsUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    return ai_mode_module.update_settings(
        db, user.id, payload.model_dump(exclude_unset=True)
    )


@router.post("/process-emails")
def process_emails(
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Manually scan mailbox and auto-reply to query emails (when AI Mode is on)."""
    return ai_mode_module.process_email_auto_replies_for_user(db, user)


@router.get("/auto-replies")
def list_auto_replies(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    return {"rows": ai_mode_module.list_auto_reply_log(db, user.id, limit=limit)}


@router.get("/lifecycle/stages")
def lifecycle_stages(
    _user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    return {"stages": ai_mode_module.LIFECYCLE_STAGES}


@router.get("/lifecycle")
def list_lifecycle(
    stage: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    result = ai_mode_module.list_lifecycle(
        db, stage=stage, search=search, limit=limit, offset=offset
    )
    result["pipeline"] = ai_mode_module.lifecycle_pipeline_counts(db)
    return result


@router.post("/lifecycle/ensure")
def ensure_lifecycle(
    payload: LifecycleEnsureRequest,
    db: Session = Depends(get_db),
    _user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    from db.models import Buyer

    buyer = db.get(Buyer, payload.buyer_id)
    if not buyer:
        raise HTTPException(404, "Buyer not found")
    row = ai_mode_module.ensure_lifecycle(db, payload.buyer_id)
    return ai_mode_module._lifecycle_to_dict(row, buyer)


@router.patch("/lifecycle/{buyer_id}")
def patch_lifecycle(
    buyer_id: int,
    payload: LifecycleUpdateRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return ai_mode_module.update_lifecycle(
            db,
            buyer_id,
            stage=payload.stage,
            notes=payload.notes,
            user_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
