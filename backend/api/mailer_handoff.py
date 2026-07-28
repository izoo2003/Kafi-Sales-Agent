"""Handoff + session exchange for the Vercel mailer app (SMTP off Railway Hobby)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.auth import UserRead, _to_user_read
from api.deps import get_current_user, get_db, get_session_token
from config import settings
from db.models import AppUser
from modules import auth as auth_module
from modules import buyers as buyers_module
from modules.mailbox_accounts import resolve_user_mailbox

router = APIRouter(prefix="/mailer", tags=["mailer"])


def _require_mailer_config() -> tuple[str, str]:
    secret = (settings.mailer_handoff_secret or "").strip()
    public_url = (settings.mailer_public_url or "").strip().rstrip("/")
    if not secret or not public_url:
        raise HTTPException(
            status_code=503,
            detail=(
                "Vercel mailer is not configured. Set MAILER_HANDOFF_SECRET and "
                "MAILER_PUBLIC_URL on Railway."
            ),
        )
    return secret, public_url


class MailerHandoffRequest(BaseModel):
    buyer_ids: list[int] = Field(default_factory=list, max_length=500)


class MailerHandoffResponse(BaseModel):
    url: str
    token: str
    expires_in_seconds: int
    recipient_count: int
    skipped_no_email: int


class MailerSessionResponse(BaseModel):
    url: str
    code: str
    expires_in_seconds: int


class MailerSessionRedeemRequest(BaseModel):
    code: str = Field(min_length=10)


class MailerHandoffLoginRequest(BaseModel):
    token: str = Field(min_length=10)


class MailerAuthResponse(BaseModel):
    token: str
    user: UserRead


@router.post("/session", response_model=MailerSessionResponse)
def create_mailer_session(
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
    existing_token: str | None = Depends(get_session_token),
):
    """One-time code so Sales Agent can open the mailer already logged in."""
    secret, public_url = _require_mailer_config()
    session_token = existing_token
    if not session_token or not auth_module.get_user_by_token(db, session_token):
        session_token = auth_module.create_session(db, user).token

    expires_in = 90
    now = datetime.now(timezone.utc)
    code = jwt.encode(
        {
            "typ": "mailer_session",
            "session_token": session_token,
            "user_id": user.id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
        },
        secret,
        algorithm="HS256",
    )
    if isinstance(code, bytes):
        code = code.decode("ascii")

    return MailerSessionResponse(
        url=f"{public_url}/auth/callback?code={code}",
        code=code,
        expires_in_seconds=expires_in,
    )


@router.post("/session/redeem", response_model=MailerAuthResponse)
def redeem_mailer_session(
    payload: MailerSessionRedeemRequest,
    db: Session = Depends(get_db),
):
    secret, _ = _require_mailer_config()
    try:
        data = jwt.decode(payload.code, secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired mailer code") from exc

    if data.get("typ") != "mailer_session":
        raise HTTPException(status_code=401, detail="Invalid mailer code type")

    session_token = str(data.get("session_token") or "")
    user = auth_module.get_user_by_token(db, session_token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired — log in again")

    return MailerAuthResponse(token=session_token, user=_to_user_read(user))


@router.post("/handoff-login", response_model=MailerAuthResponse)
def login_from_bulk_handoff(
    payload: MailerHandoffLoginRequest,
    db: Session = Depends(get_db),
):
    """Exchange a bulk-send handoff JWT for a normal API session (mailer inbox access)."""
    secret, _ = _require_mailer_config()
    try:
        data = jwt.decode(payload.token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired handoff token") from exc

    user_id = data.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Handoff missing user")
    user = db.query(AppUser).filter(AppUser.id == int(user_id), AppUser.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    session = auth_module.create_session(db, user)
    return MailerAuthResponse(token=session.token, user=_to_user_read(user))


@router.post("/handoff", response_model=MailerHandoffResponse)
def create_mailer_handoff(
    payload: MailerHandoffRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    secret, public_url = _require_mailer_config()

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
        url=f"{public_url}/bulk?token={token}",
        token=token,
        expires_in_seconds=expires_in,
        recipient_count=len(leads),
        skipped_no_email=skipped,
    )
