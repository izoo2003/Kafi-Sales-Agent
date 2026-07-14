"""Auth API — login, logout, current user, admin user management."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.deps import get_bearer_token, get_current_user, get_db, require_admin
from db.models import AppUser, AppUserRole
from modules import auth as auth_module

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=4, max_length=128)


class UserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=100)
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    password: str | None = Field(default=None, min_length=4, max_length=128)
    is_active: bool | None = None


class UserRead(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    token: str
    user: UserRead


def _to_user_read(user: AppUser) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role.value if isinstance(user.role, AppUserRole) else str(user.role),
        is_active=user.is_active,
    )


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> Any:
    user = auth_module.authenticate(db, body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    session = auth_module.create_session(db, user)
    return LoginResponse(token=session.token, user=_to_user_read(user))


@router.post("/logout", status_code=204)
def logout(
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
    token: str | None = Depends(get_bearer_token),
) -> None:
    del user
    if token:
        auth_module.revoke_session(db, token)


@router.get("/me", response_model=UserRead)
def me(user: AppUser = Depends(get_current_user)) -> Any:
    return _to_user_read(user)


@router.get("/users", response_model=list[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> Any:
    return [_to_user_read(u) for u in auth_module.list_users(db)]


@router.get("/assignees", response_model=list[UserRead])
def list_assignees(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> Any:
    """Active sales users that can be assigned leads."""
    users = auth_module.list_users(db)
    return [
        _to_user_read(u)
        for u in users
        if u.is_active
        and (
            (u.role.value if isinstance(u.role, AppUserRole) else str(u.role))
            == AppUserRole.user.value
        )
    ]


@router.post("/users", response_model=UserRead, status_code=201)
def create_user(
    body: UserCreateRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> Any:
    try:
        user = auth_module.create_user(
            db,
            username=body.username,
            full_name=body.full_name,
            password=body.password,
            role=AppUserRole.user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_user_read(user)


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    body: UserUpdateRequest,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
) -> Any:
    if admin.id == user_id and body.is_active is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    try:
        user = auth_module.update_user(
            db,
            user_id,
            username=body.username,
            full_name=body.full_name,
            password=body.password,
            is_active=body.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _to_user_read(user)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
) -> None:
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    try:
        auth_module.delete_user(db, user_id)
    except ValueError as exc:
        detail = str(exc)
        status = 404 if detail == "User not found" else 400
        raise HTTPException(status_code=status, detail=detail) from exc
