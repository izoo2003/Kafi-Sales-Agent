"""Shared API dependencies."""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from db.models import AppUser, AppUserRole
from db.session import get_db
from modules import auth as auth_module

__all__ = [
    "get_db",
    "get_session_token",
    "get_bearer_token",
    "get_current_user",
    "require_admin",
]


def get_session_token(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str | None:
    """Session token from Bearer header or httpOnly cookie."""
    return auth_module.extract_session_token(
        authorization=authorization,
        cookies=request.cookies,
    )


# Back-compat alias used by older route signatures.
def get_bearer_token(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str | None:
    return get_session_token(request, authorization)


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_session_token),
) -> AppUser:
    # Middleware may already have validated the session — reuse that user id
    # so polling endpoints don't re-query app_user_sessions every time.
    user_id = getattr(request.state, "user_id", None)
    if user_id is not None:
        user = db.get(AppUser, int(user_id))
        if user and user.is_active:
            return user

    user = auth_module.get_user_by_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_admin(user: AppUser = Depends(get_current_user)) -> AppUser:
    role = user.role.value if isinstance(user.role, AppUserRole) else str(user.role)
    if role != AppUserRole.admin.value:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
