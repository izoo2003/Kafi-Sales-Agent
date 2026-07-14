"""Dashboard auth — password hashing, sessions, admin seed, user CRUD."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from db.models import AppUser, AppUserRole, AppUserSession

# Default admin (seeded once on startup). Change later via Users UI / env if needed.
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "1234"
DEFAULT_ADMIN_FULL_NAME = "Administrator"

SESSION_DAYS = 30
_PBKDF2_ITERATIONS = 120_000


def hash_password(password: str, *, salt: str | None = None) -> str:
    salt_hex = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_hex.encode("utf-8"),
        _PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt_hex}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, iterations_s, salt_hex, digest_hex = password_hash.split("$", 3)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    try:
        iterations = int(iterations_s)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_hex.encode("utf-8"),
        iterations,
    )
    return hmac.compare_digest(candidate.hex(), digest_hex)


def ensure_default_admin(db: Session) -> AppUser:
    """Create the default admin account if no admin exists yet."""
    admin = (
        db.query(AppUser)
        .filter(AppUser.role == AppUserRole.admin, AppUser.is_active.is_(True))
        .first()
    )
    if admin:
        return admin

    existing = db.query(AppUser).filter(AppUser.username == DEFAULT_ADMIN_USERNAME).first()
    if existing:
        existing.role = AppUserRole.admin
        existing.password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
        existing.is_active = True
        existing.full_name = existing.full_name or DEFAULT_ADMIN_FULL_NAME
        db.commit()
        db.refresh(existing)
        return existing

    admin = AppUser(
        username=DEFAULT_ADMIN_USERNAME,
        full_name=DEFAULT_ADMIN_FULL_NAME,
        role=AppUserRole.admin,
        password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def authenticate(db: Session, username: str, password: str) -> AppUser | None:
    user = (
        db.query(AppUser)
        .filter(AppUser.username == username.strip().lower())
        .first()
    )
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_session(db: Session, user: AppUser) -> AppUserSession:
    token = secrets.token_urlsafe(32)
    session = AppUserSession(
        user_id=user.id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def revoke_session(db: Session, token: str) -> None:
    db.query(AppUserSession).filter(AppUserSession.token == token).delete()
    db.commit()


def get_user_by_token(db: Session, token: str | None) -> AppUser | None:
    if not token:
        return None
    now = datetime.now(timezone.utc)
    row = (
        db.query(AppUserSession)
        .filter(AppUserSession.token == token, AppUserSession.expires_at > now)
        .first()
    )
    if not row:
        return None
    user = db.query(AppUser).filter(AppUser.id == row.user_id).first()
    if not user or not user.is_active:
        return None
    return user


def list_users(db: Session) -> list[AppUser]:
    return db.query(AppUser).order_by(AppUser.created_at.asc()).all()


def create_user(
    db: Session,
    *,
    username: str,
    full_name: str,
    password: str,
    role: AppUserRole = AppUserRole.user,
) -> AppUser:
    normalized = username.strip().lower()
    if not normalized:
        raise ValueError("Username is required")
    if not password or len(password) < 4:
        raise ValueError("Password must be at least 4 characters")
    if db.query(AppUser).filter(AppUser.username == normalized).first():
        raise ValueError("Username already exists")

    user = AppUser(
        username=normalized,
        full_name=full_name.strip() or normalized,
        role=role,
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_user_active(db: Session, user_id: int, is_active: bool) -> AppUser | None:
    user = db.query(AppUser).filter(AppUser.id == user_id).first()
    if not user:
        return None
    if user.role == AppUserRole.admin and not is_active:
        active_admins = (
            db.query(AppUser)
            .filter(AppUser.role == AppUserRole.admin, AppUser.is_active.is_(True))
            .count()
        )
        if active_admins <= 1:
            raise ValueError("Cannot deactivate the last admin")
    user.is_active = is_active
    if not is_active:
        db.query(AppUserSession).filter(AppUserSession.user_id == user.id).delete()
    db.commit()
    db.refresh(user)
    return user


def update_user(
    db: Session,
    user_id: int,
    *,
    username: str | None = None,
    full_name: str | None = None,
    password: str | None = None,
    is_active: bool | None = None,
) -> AppUser | None:
    user = db.query(AppUser).filter(AppUser.id == user_id).first()
    if not user:
        return None

    if username is not None:
        normalized = username.strip().lower()
        if not normalized:
            raise ValueError("Username is required")
        clash = (
            db.query(AppUser)
            .filter(AppUser.username == normalized, AppUser.id != user_id)
            .first()
        )
        if clash:
            raise ValueError("Username already exists")
        user.username = normalized

    if full_name is not None:
        cleaned = full_name.strip()
        if not cleaned:
            raise ValueError("Full name is required")
        user.full_name = cleaned

    if password is not None:
        if len(password) < 4:
            raise ValueError("Password must be at least 4 characters")
        user.password_hash = hash_password(password)
        db.query(AppUserSession).filter(AppUserSession.user_id == user.id).delete()

    if is_active is not None and is_active != user.is_active:
        if user.role == AppUserRole.admin and not is_active:
            active_admins = (
                db.query(AppUser)
                .filter(AppUser.role == AppUserRole.admin, AppUser.is_active.is_(True))
                .count()
            )
            if active_admins <= 1:
                raise ValueError("Cannot deactivate the last admin")
        user.is_active = is_active
        if not is_active:
            db.query(AppUserSession).filter(AppUserSession.user_id == user.id).delete()

    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user_id: int) -> None:
    user = db.query(AppUser).filter(AppUser.id == user_id).first()
    if not user:
        raise ValueError("User not found")
    if user.role == AppUserRole.admin:
        active_admins = (
            db.query(AppUser)
            .filter(AppUser.role == AppUserRole.admin, AppUser.is_active.is_(True))
            .count()
        )
        if active_admins <= 1:
            raise ValueError("Cannot delete the last admin")
    from modules.leads import clear_assignments_for_user

    clear_assignments_for_user(db, user_id)
    db.query(AppUserSession).filter(AppUserSession.user_id == user.id).delete()
    db.delete(user)
    db.commit()
