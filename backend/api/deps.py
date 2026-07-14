"""Shared API dependencies."""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from db.models import AppUser, AppUserRole
from db.session import get_db
from modules import auth as auth_module

__all__ = [
    "get_db",
    "get_bearer_token",
    "get_current_user",
    "require_admin",
]


def get_bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def get_current_user(
    db: Session = Depends(get_db),
    token: str | None = Depends(get_bearer_token),
) -> AppUser:
    user = auth_module.get_user_by_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_admin(user: AppUser = Depends(get_current_user)) -> AppUser:
    role = user.role.value if isinstance(user.role, AppUserRole) else str(user.role)
    if role != AppUserRole.admin.value:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
