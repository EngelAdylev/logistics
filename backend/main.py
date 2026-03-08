from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import models
import scheduler
from database import SessionLocal, engine, get_db
from config import get_settings
from auth import get_current_user, require_role, hash_password
from routers.auth_router import router as auth_router
from routers.table_settings_router import router as table_settings_router
from schemas import CreateUserRequest, TrackingWagonTableRowOut
from wagon_table_service import get_table_wagons

# Автоматическое создание таблиц
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Logistics Monitoring Service")

settings = get_settings()
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(table_settings_router)


@app.on_event("startup")
def startup_event():
    scheduler.start_scheduler()
    # Миграция для существующих БД
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            r = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'users' AND column_name = 'username'
            """))
            if r.fetchone():
                conn.execute(text("ALTER TABLE users RENAME COLUMN username TO login"))
                conn.commit()
            for col, sql in [
                ("is_active", "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true"),
                ("created_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()"),
                ("updated_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()"),
                ("token_version", "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0"),
                ("number_train", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS number_train TEXT"),
                ("train_index", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS train_index TEXT"),
                ("waybill_number", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS waybill_number TEXT"),
                ("type_railway_carriage", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS type_railway_carriage TEXT"),
                ("owners_administration", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS owners_administration TEXT"),
                ("remaining_mileage", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS remaining_mileage TEXT"),
                ("remaining_distance", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS remaining_distance TEXT"),
                ("destination_station_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS destination_station_code TEXT"),
                ("flight_start_station_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS flight_start_station_code TEXT"),
                ("container_number1", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number1 TEXT"),
                ("container_number2", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number2 TEXT"),
                ("container_number3", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number3 TEXT"),
                ("container_number4", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number4 TEXT"),
                ("container_number5", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number5 TEXT"),
                ("container_number6", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number6 TEXT"),
                ("container_number7", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number7 TEXT"),
                ("container_number8", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number8 TEXT"),
                ("container_number9", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number9 TEXT"),
                ("container_number10", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number10 TEXT"),
                ("container_number11", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number11 TEXT"),
                ("container_number12", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS container_number12 TEXT"),
            ]:
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception:
                    pass
    except Exception:
        pass
    # Создать админа если нет ни одного
    try:
        from auth import hash_password
        db = SessionLocal()
        try:
            admin = db.query(models.User).filter(models.User.role == "admin").first()
            if not admin:
                import os
                login = os.getenv("ADMIN_LOGIN", "admin")
                pwd = os.getenv("ADMIN_PASSWORD", "admin12345")
                u = models.User(login=login, password_hash=hash_password(pwd), role="admin", is_active=True)
                db.add(u)
                db.commit()
        finally:
            db.close()
    except Exception:
        pass


# --- ЭНДПОИНТЫ ДЛЯ ВАГОНОВ (требуют авторизации user/admin) ---


@app.get("/wagons/active", response_model=list[TrackingWagonTableRowOut])
def get_active_wagons(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return get_table_wagons(db, is_active=True)


@app.get("/wagons/archive", response_model=list[TrackingWagonTableRowOut])
def get_archive_wagons(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return get_table_wagons(db, is_active=False)


@app.get("/wagons/{tracking_id}/comments")
def get_comments(
    tracking_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wagon = db.query(models.TrackingWagon).filter(models.TrackingWagon.id == tracking_id).first()
    if not wagon:
        raise HTTPException(status_code=404, detail="Вагон не найден")
    return wagon.comments


from pydantic import BaseModel


class CommentCreate(BaseModel):
    text: str


@app.post("/wagons/{tracking_id}/comments")
def add_comment(
    tracking_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    new_comment = models.WagonComment(
        tracking_id=tracking_id,
        author_name=current_user.login,
        comment_text=body.text,
    )
    db.add(new_comment)
    db.commit()
    return {"status": "success"}


# --- ЭНДПОИНТЫ ДЛЯ АДМИНКИ (требуют роль admin) ---


@app.get("/users")
def get_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin")),
):
    return db.query(models.User).all()


@app.post("/users")
def create_user(
    data: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin")),
):
    exists = db.query(models.User).filter(models.User.login == data.login).first()
    if exists:
        raise HTTPException(status_code=400, detail={"error": "USER_EXISTS", "message": "Пользователь уже существует"})

    password_hash = hash_password(data.password)
    new_user = models.User(
        login=data.login,
        password_hash=password_hash,
        role=data.role,
    )
    db.add(new_user)
    db.commit()
    return {"status": "user created"}


# --- Ручное обновление данных (sync) и полная пересборка (rebuild) ---

import threading
import logging
from datetime import datetime, timezone

_sync_lock = threading.Lock()
_sync_in_progress = False
_logger = logging.getLogger(__name__)


@app.post("/wagons/sync")
def manual_sync(current_user: models.User = Depends(get_current_user)):
    """
    Ручное обновление данных из dislocation (та же логика, что у scheduler).
    Доступно любому авторизованному пользователю. Один запрос в момент времени.
    """
    global _sync_in_progress
    if not _sync_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail={"error": "SYNC_IN_PROGRESS", "message": "Обновление уже выполняется. Подождите."})
    try:
        _sync_in_progress = True
        _logger.info("manual_sync: started by user_id=%s login=%s", current_user.id, current_user.login)
        stats = scheduler.sync_dislocation_to_tracking()
        _logger.info("manual_sync: done by login=%s stats=%s", current_user.login, stats)
        return {
            "success": True,
            "message": "Данные обновлены",
            "created": stats.get("created", 0),
            "updated": stats.get("updated", 0),
            "archived": stats.get("archived", 0),
            "errors": stats.get("errors", 0),
            "last_events": stats.get("last_events", 0),
            "at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        _sync_in_progress = False
        _sync_lock.release()


@app.post("/admin/rebuild-tracking")
def admin_rebuild_tracking(current_user: models.User = Depends(require_role("admin"))):
    """
    Полная пересборка витрины по данным из dislocation. Не удаляет комментарии.
    Только для администратора. Использовать при смене логики архива или исправлении данных.
    """
    _logger.info("admin_rebuild_tracking: started by login=%s", current_user.login)
    result = scheduler.rebuild_tracking_from_dislocation_merge()
    _logger.info("admin_rebuild_tracking: done by login=%s result=%s", current_user.login, result)
    return result
