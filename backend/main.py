import logging
from uuid import UUID

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload

import models
import scheduler
from database import SessionLocal, engine, get_db
from config import get_settings
from auth import get_current_user, require_role, hash_password
from routers.auth_router import router as auth_router
from schemas import CreateUserRequest, UserOut, CommentCreateRequest, CommentOut

logger = logging.getLogger(__name__)

# Таблицы создаются через Alembic (alembic upgrade head). Для совместимости без миграций:
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


@app.on_event("startup")
def startup_event():
    # Проверка соединения с БД и наличие таблиц (критично)
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("startup: database connection OK")
    except Exception as e:
        logger.exception("startup: database connection failed")
        raise

    # Опциональная миграция для обратной совместимости (некритично; основная схема — через Alembic)
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
                logger.info("startup: migrated users.username -> login")
            for col, sql in [
                ("is_active", "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true"),
                ("created_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()"),
                ("updated_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()"),
                ("token_version", "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0"),
            ]:
                try:
                    conn.execute(text(sql))
                    conn.commit()
                    logger.info("startup: ensured column %s on users", col)
                except Exception as e:
                    logger.warning("startup: column %s on users: %s", col, e)
            try:
                conn.execute(text("ALTER TABLE wagon_comments ALTER COLUMN created_at SET DEFAULT now()"))
                conn.commit()
            except Exception as e:
                logger.warning("startup: wagon_comments.created_at default: %s", e)
    except Exception as e:
        logger.warning("startup: optional schema compatibility: %s", e)

    # Создать дефолтного admin при отсутствии (некритично)
    try:
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
                logger.info("startup: created default admin user %s", login)
            else:
                logger.info("startup: admin user already exists")
        finally:
            db.close()
    except Exception as e:
        logger.warning("startup: create default admin failed: %s", e)

    # Scheduler не запускается в web-процессе — работает отдельным сервисом (см. run_scheduler.py)
    logger.info("startup: application ready")


# --- ЭНДПОИНТЫ ДЛЯ ВАГОНОВ (требуют авторизации user/admin) ---


@app.get("/wagons/active")
def get_active_wagons(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.TrackingWagon)
        .filter(models.TrackingWagon.is_active == True)
        .order_by(models.TrackingWagon.last_operation_date.desc().nullslast())
        .all()
    )


@app.get("/wagons/archive")
def get_archive_wagons(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.TrackingWagon)
        .filter(models.TrackingWagon.is_active == False)
        .order_by(models.TrackingWagon.last_operation_date.desc().nullslast())
        .all()
    )


@app.get("/wagons/{tracking_id}/comments", response_model=list[CommentOut])
def get_comments(
    tracking_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wagon = db.query(models.TrackingWagon).filter(models.TrackingWagon.id == tracking_id).first()
    if not wagon:
        raise HTTPException(status_code=404, detail="Вагон не найден")
    rows = (
        db.query(models.WagonComment)
        .options(joinedload(models.WagonComment.author))
        .filter(models.WagonComment.tracking_id == wagon.id)
        .order_by(models.WagonComment.created_at.asc())
        .all()
    )
    return [
        CommentOut(
            id=c.id,
            comment_text=c.comment_text,
            created_at=c.created_at,
            author_id=c.author_id,
            author_login=c.author.login if c.author else c.author_name,
        )
        for c in rows
    ]


@app.post("/wagons/{tracking_id}/comments", response_model=CommentOut)
def add_comment(
    tracking_id: UUID,
    body: CommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    wagon = db.query(models.TrackingWagon).filter(models.TrackingWagon.id == tracking_id).first()
    if not wagon:
        raise HTTPException(status_code=404, detail="Вагон не найден")
    new_comment = models.WagonComment(
        tracking_id=tracking_id,
        author_id=current_user.id,
        author_name=current_user.login,
        comment_text=body.text.strip(),
    )
    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)
    return CommentOut(
        id=new_comment.id,
        comment_text=new_comment.comment_text,
        created_at=new_comment.created_at,
        author_id=new_comment.author_id,
        author_login=current_user.login,
    )


# --- ЭНДПОИНТЫ ДЛЯ АДМИНКИ (требуют роль admin) ---


@app.get("/users", response_model=list[UserOut])
def get_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin")),
):
    users = db.query(models.User).all()
    return [UserOut(id=u.id, login=u.login, role=u.role, is_active=u.is_active, created_at=u.created_at) for u in users]


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


@app.post("/admin/rebuild-tracking")
def admin_rebuild_tracking(
    current_user: models.User = Depends(require_role("admin")),
):
    return scheduler.rebuild_tracking_from_dislocation_merge()
