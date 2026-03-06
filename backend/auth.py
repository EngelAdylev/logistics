import re
import hashlib
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyCookie
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
import models

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)
cookie_security = APIKeyCookie(name="refresh_token", auto_error=False)

# Rate limit: in-memory (для production лучше Redis)
_login_attempts: dict[str, list[float]] = {}


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Пароль не менее 8 символов")
    if not re.search(r"[a-zA-Z]", password):
        raise HTTPException(status_code=400, detail="Пароль должен содержать букву")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Пароль должен содержать цифру")
    if password != password.strip():
        raise HTTPException(status_code=400, detail="Пароль не должен содержать пробелы по краям")


def hash_password(password: str) -> str:
    _validate_password(password)
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user: models.User) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "login": user.login,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(seconds=settings.ACCESS_TTL_SECONDS),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGO)


def create_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _check_rate_limit(key: str) -> None:
    settings = get_settings()
    if not settings.RATE_LIMIT_ENABLED:
        return
    now = datetime.now(timezone.utc).timestamp()
    window = settings.RATE_LIMIT_WINDOW_SECONDS
    attempts = _login_attempts.get(key, [])
    attempts = [t for t in attempts if now - t < window]
    if len(attempts) >= settings.RATE_LIMIT_ATTEMPTS:
        logger.warning("Rate limit exceeded for %s", key[:20] + "...")
        raise HTTPException(
            status_code=429,
            detail={"error": "TOO_MANY_ATTEMPTS", "message": "Слишком много попыток. Попробуйте позже."},
        )
    attempts.append(now)
    _login_attempts[key] = attempts


def get_current_user(
    cred: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    if not cred:
        raise HTTPException(
            status_code=401,
            detail={"error": "UNAUTHORIZED", "message": "Требуется авторизация"},
        )
    token = cred.credentials
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGO])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN", "message": "Неверный токен"})
    except JWTError:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN", "message": "Неверный или истёкший токен"})

    user = db.query(models.User).filter(models.User.id == UUID(user_id)).first()
    if not user:
        raise HTTPException(status_code=401, detail={"error": "USER_NOT_FOUND", "message": "Пользователь не найден"})
    if not user.is_active:
        raise HTTPException(status_code=403, detail={"error": "USER_INACTIVE", "message": "Пользователь деактивирован"})
    return user


def require_role(role: str):
    def _require(current_user: models.User = Depends(get_current_user)) -> models.User:
        if current_user.role != role:
            logger.info("Access denied for user %s to %s", current_user.login, role)
            raise HTTPException(
                status_code=403,
                detail={"error": "FORBIDDEN", "message": "Недостаточно прав"},
            )
        return current_user

    return _require
