"""Handoff to the Vercel mailer app (SMTP off Railway Hobby)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from config import settings
from db.models import AppUser
from modules import buyers as buyers_module
from modules.mailbox_accounts import resolve_user_mailbox

router = APIRouter(prefix="/mailer", tags=["mailer"])


class MailerHandoffRequest(BaseModel):
    buyer_ids: list[int] = Field(default_factory=list, max_length=500)


class MailerHandoffResponse(BaseModel):
    url: str
    token: str
    expires_in_seconds: int
    recipient_count: int
    skipped_no_email: int


@router.post("/handoff", response_model=MailerHandoffResponse)
def create_mailer_handoff(
    payload: MailerHandoffRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    secret = (settings.mailer_handoff_secret or "").strip()
    public_url = (settings.mailer_public_url or "").strip().rstrip("/")
    if not secret or not public_url:
        raise HTTPException(
            status_code=503,
            detail=(
                "Vercel mailer is not configured. Set MAILER_HANDOFF_SECRET and "
                "MAILER_PUBLIC_URL on Railway, and VITE_BULK_MAILER_URL on the frontend."
            ),
        )

    account = resolve_user_mailbox(user)
    if not account:
        raise HTTPException(
            status_code=400,
            detail="Your company mailbox is not configured. Ask an admin (Users page).",
        )

    buyer_ids = list(dict.fromkeys(payload.buyer_ids))
    if not buyer_ids:
        raise HTTPException(status_code=400, detail="Select at least one lead")

    leads: list[dict[str, Any]] = []
    skipped = 0
    for buyer_id in buyer_ids:
        buyer = buyers_module.get_buyer(db, buyer_id)
        if not buyer:
            skipped += 1
            continue
        contact = buyers_module.primary_contact_with_email(db, buyer_id)
        if not contact or not (contact.email or "").strip():
            skipped += 1
            continue
        leads.append(
            {
                "buyer_id": buyer_id,
                "company_name": buyer.company_name,
                "contact_name": contact.full_name,
                "contact_email": contact.email.strip(),
            }
        )

    if not leads:
        raise HTTPException(
            status_code=400,
            detail="None of the selected leads have a contact email",
        )

    expires_in = 20 * 60
    now = datetime.now(timezone.utc)
    token_payload = {
        "user_id": user.id,
        "username": user.username,
        "mailbox_email": account.email,
        "display_name": account.display_name,
        "buyer_ids": [row["buyer_id"] for row in leads],
        "leads": leads,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(token_payload, secret, algorithm="HS256")
    if isinstance(token, bytes):
        token = token.decode("ascii")

    return MailerHandoffResponse(
        url=f"{public_url}/?token={token}",
        token=token,
        expires_in_seconds=expires_in,
        recipient_count=len(leads),
        skipped_no_email=skipped,
    )
