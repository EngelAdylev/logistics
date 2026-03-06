import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from auth import (
    get_current_user,
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    _check_rate_limit,
)
import models
from schemas import LoginRequest, LoginResponse, RefreshResponse, UserResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/auth",
        max_age=settings.REFRESH_TTL_SECONDS,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key="refresh_token", path="/auth")


@router.post("/login", response_model=LoginResponse)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _check_rate_limit(f"login:{data.login}")
    _check_rate_limit(f"ip:{request.client.host if request.client else 'unknown'}")

    user = db.query(models.User).filter(models.User.login == data.login).first()
    if not user or not verify_password(data.password, user.password_hash):
        logger.warning("Failed login for login=%s", data.login)
        raise HTTPException(
            status_code=401,
            detail={"error": "INVALID_CREDENTIALS", "message": "Неверный логин или пароль"},
        )
    if not user.is_active:
        logger.warning("Login attempt for inactive user=%s", user.login)
        raise HTTPException(
            status_code=403,
            detail={"error": "USER_INACTIVE", "message": "Пользователь деактивирован"},
        )

    settings = get_settings()
    access = create_access_token(user)
    refresh = create_refresh_token()
    refresh_hash = hash_refresh_token(refresh)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.REFRESH_TTL_SECONDS)

    session = models.UserSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        user_agent=request.headers.get("user-agent", "")[:500],
        ip=request.client.host if request.client else None,
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()

    _set_refresh_cookie(response, refresh)
    logger.info("User %s logged in", user.login)
    return LoginResponse(
        access_token=access,
        token_type="bearer",
        expires_in=settings.ACCESS_TTL_SECONDS,
        user=UserResponse(id=user.id, login=user.login, role=user.role),
    )


@router.post("/refresh", response_model=RefreshResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"error": "INVALID_REFRESH", "message": "Refresh токен отсутствует"},
        )

    refresh_hash = hash_refresh_token(token)
    session = (
        db.query(models.UserSession)
        .filter(
            models.UserSession.refresh_token_hash == refresh_hash,
            models.UserSession.revoked_at.is_(None),
            models.UserSession.expires_at > datetime.now(timezone.utc),
        )
        .first()
    )
    if not session:
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=401,
            detail={"error": "INVALID_REFRESH", "message": "Refresh токен недействителен или истёк"},
        )

    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user or not user.is_active:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=403,
            detail={"error": "SESSION_REVOKED", "message": "Сессия отозвана"},
        )

    access = create_access_token(user)
    logger.info("Token refreshed for user %s", user.login)
    return RefreshResponse(
        access_token=access,
        token_type="bearer",
        expires_in=get_settings().ACCESS_TTL_SECONDS,
    )


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    token = request.cookies.get("refresh_token")
    if token:
        refresh_hash = hash_refresh_token(token)
        session = db.query(models.UserSession).filter(
            models.UserSession.refresh_token_hash == refresh_hash
        ).first()
        if session:
            session.revoked_at = datetime.now(timezone.utc)
            db.commit()
            logger.info("Session revoked for user_id=%s", session.user_id)
    _clear_refresh_cookie(response)


@router.get("/me", response_model=UserResponse)
def me(current_user: models.User = Depends(get_current_user)):
    return UserResponse(id=current_user.id, login=current_user.login, role=current_user.role)
