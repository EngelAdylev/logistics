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
from routers.hierarchy_router import router as hierarchy_router
from routers.etran_router import router as etran_router
from routers.dislocation_webhook_router import router as dislocation_webhook_router
from schemas import CreateUserRequest, TrackingWagonTableRowOut
from wagon_table_service import get_table_wagons

# Автоматическое создание таблиц
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Logistics Monitoring Service", redirect_slashes=True)

settings = get_settings()
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers.trains_router import router as trains_router

app.include_router(auth_router)
app.include_router(table_settings_router)
app.include_router(hierarchy_router)
app.include_router(trains_router)
app.include_router(etran_router)
app.include_router(dislocation_webhook_router)


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
                ("number_railway_carriage_on_train_col", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS number_railway_carriage_on_train TEXT"),
                # Новые поля дислокации (из пакета DATAREON)
                ("disl_country_start_flight", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS country_start_flight TEXT"),
                ("disl_flight_start_road", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS flight_start_road TEXT"),
                ("disl_flight_end_date", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS flight_end_date TIMESTAMPTZ"),
                ("disl_country_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS country_code TEXT"),
                ("disl_destination_road_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS destination_road_code TEXT"),
                ("disl_shipper", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS shipper TEXT"),
                ("disl_shipper_okpo", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS shipper_okpo TEXT"),
                ("disl_consignee", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS consignee TEXT"),
                ("disl_consignee_okpo", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS consignee_okpo TEXT"),
                ("disl_gng_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS gng_code TEXT"),
                ("disl_cargo_weight", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS cargo_weight TEXT"),
                ("disl_mileage_loaded_condition", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS mileage_loaded_condition TEXT"),
                ("disl_empty_mileage", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS empty_mileage TEXT"),
                ("disl_mileage_standard", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS mileage_standard TEXT"),
                ("disl_mileage_indicator", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS mileage_indicator TEXT"),
                ("disl_special_mark_1", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS special_mark_1 TEXT"),
                ("disl_special_mark_2", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS special_mark_2 TEXT"),
                ("disl_special_mark_3", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS special_mark_3 TEXT"),
                ("disl_senders_payers_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS senders_payers_code TEXT"),
                ("disl_code_unloaded_cargo", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS code_unloaded_cargo TEXT"),
                ("disl_operation_cost_code", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS operation_cost_code TEXT"),
                ("disl_park_number", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS park_number TEXT"),
                ("disl_path_number", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS path_number TEXT"),
                ("disl_number_of_seals", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS number_of_seals TEXT"),
                ("disl_number_loaded_containers", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS number_loaded_containers TEXT"),
                ("disl_number_empty_containers", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS number_empty_containers TEXT"),
                ("disl_standard_delivery_time", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS standard_delivery_time TIMESTAMPTZ"),
                ("disl_distance_traveled", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS distance_traveled TEXT"),
                ("disl_total_distance", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS total_distance TEXT"),
                ("disl_last_op_downtime_day", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS last_operation_downtime_per_day TEXT"),
                ("disl_idle_hours", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS idle_time_last_operation_hours TEXT"),
                ("disl_idle_minutes", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS idle_time_last_minute_operation TEXT"),
                ("disl_dt_departure_cargo", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS date_time_departure_cargo_receiving_station TIMESTAMPTZ"),
                ("disl_dt_arrival_dest", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS date_time_arrival_destination_station TIMESTAMPTZ"),
                ("disl_sending_number", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS sending_number TEXT"),
                ("disl_created_at", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ"),
                # Иерархическая модель v2 — прямая ссылка на рейс
                ("flight_id_col", "ALTER TABLE dislocation ADD COLUMN IF NOT EXISTS flight_id UUID"),
                ("flight_id_idx", "CREATE INDEX IF NOT EXISTS idx_dislocation_flight_id ON dislocation(flight_id, date_time_of_operation DESC)"),
                # Мастер-данные вагона
                ("wagons_owner", "ALTER TABLE wagons ADD COLUMN IF NOT EXISTS owner TEXT"),
                ("wagons_type", "ALTER TABLE wagons ADD COLUMN IF NOT EXISTS type TEXT"),
                ("wagons_last_repair_date", "ALTER TABLE wagons ADD COLUMN IF NOT EXISTS last_repair_date TIMESTAMPTZ"),
                ("wagons_next_repair_date", "ALTER TABLE wagons ADD COLUMN IF NOT EXISTS next_repair_date TIMESTAMPTZ"),
                # Порядковый номер рейса
                ("wagon_trips_flight_number", "ALTER TABLE wagon_trips ADD COLUMN IF NOT EXISTS flight_number INTEGER"),
                ("tracking_wagons_dep_station", "ALTER TABLE tracking_wagons ADD COLUMN IF NOT EXISTS departure_station_code TEXT"),
                ("wagon_trips_carriage_on_train", "ALTER TABLE wagon_trips ADD COLUMN IF NOT EXISTS number_railway_carriage_on_train TEXT"),
                ("wagon_trips_waybill_number", "ALTER TABLE wagon_trips ADD COLUMN IF NOT EXISTS waybill_number TEXT"),
                ("wagon_trips_remaining_distance", "ALTER TABLE wagon_trips ADD COLUMN IF NOT EXISTS remaining_distance TEXT"),
                # ЭТРАН таблицы
                ("etran_waybills_table", """
                    CREATE TABLE IF NOT EXISTS etran_waybills (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        waybill_number TEXT NOT NULL,
                        source_message_id TEXT,
                        waybill_identifier TEXT,
                        status TEXT NOT NULL,
                        status_updated_at TIMESTAMPTZ,
                        departure_station_code TEXT,
                        departure_station_name TEXT,
                        destination_station_code TEXT,
                        destination_station_name TEXT,
                        shipper_name TEXT,
                        consignee_name TEXT,
                        consignee_address TEXT,
                        payer TEXT,
                        payer_code TEXT,
                        waybill_created_at TIMESTAMPTZ,
                        accepted_at TIMESTAMPTZ,
                        departure_at TIMESTAMPTZ,
                        delivery_deadline TIMESTAMPTZ,
                        waybill_type TEXT,
                        shipment_type TEXT,
                        shipment_speed TEXT,
                        form_type TEXT,
                        raw_data JSONB,
                        is_relevant BOOLEAN DEFAULT true,
                        created_at TIMESTAMPTZ DEFAULT now(),
                        updated_at TIMESTAMPTZ DEFAULT now()
                    )
                """),
                ("etran_waybills_idx", "CREATE INDEX IF NOT EXISTS idx_etran_wb_number ON etran_waybills(waybill_number)"),
                ("etran_waybills_message_id", "ALTER TABLE etran_waybills ADD COLUMN IF NOT EXISTS source_message_id TEXT"),
                ("etran_waybills_message_idx", "CREATE INDEX IF NOT EXISTS idx_etran_wb_message_id ON etran_waybills(source_message_id)"),
                ("etran_waybills_drop_old_uc", "ALTER TABLE etran_waybills DROP CONSTRAINT IF EXISTS etran_waybills_waybill_number_key"),
                ("etran_waybills_drop_old_uc2", "ALTER TABLE etran_waybills DROP CONSTRAINT IF EXISTS _etran_waybill_message_uc"),
                ("etran_waybills_new_uc", "ALTER TABLE etran_waybills ADD CONSTRAINT _etran_waybill_message_uc UNIQUE (waybill_number, source_message_id)"),
                ("etran_waybill_wagons_table", """
                    CREATE TABLE IF NOT EXISTS etran_waybill_wagons (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        waybill_id UUID NOT NULL REFERENCES etran_waybills(id) ON DELETE CASCADE,
                        railway_carriage_number TEXT NOT NULL,
                        lifting_capacity TEXT,
                        axles_count INTEGER,
                        ownership TEXT,
                        weight_net TEXT,
                        container_number TEXT,
                        container_length TEXT,
                        container_owner TEXT,
                        cargo_name TEXT,
                        cargo_weight TEXT,
                        wagon_id UUID REFERENCES wagons(id),
                        created_at TIMESTAMPTZ DEFAULT now(),
                        UNIQUE(waybill_id, railway_carriage_number, container_number)
                    )
                """),
                ("etran_waybill_wagons_idx", "CREATE INDEX IF NOT EXISTS idx_etran_wbw_waybill ON etran_waybill_wagons(waybill_id)"),
                ("etran_wbw_drop_legacy_uc", "ALTER TABLE etran_waybill_wagons DROP CONSTRAINT IF EXISTS etran_waybill_wagons_waybill_id_railway_carriage_number_key"),
                ("etran_wbw_drop_old_uc", "ALTER TABLE etran_waybill_wagons DROP CONSTRAINT IF EXISTS _etran_wb_wagon_uc"),
                ("etran_wbw_new_uc", "ALTER TABLE etran_waybill_wagons ADD CONSTRAINT _etran_wb_wagon_uc UNIQUE (waybill_id, railway_carriage_number, container_number)"),
                ("etran_wbw_zpu_number", "ALTER TABLE etran_waybill_wagons ADD COLUMN IF NOT EXISTS zpu_number TEXT"),
                ("etran_incoming_log_table", """
                    CREATE TABLE IF NOT EXISTS etran_incoming_log (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        message_id TEXT,
                        waybill_number TEXT,
                        status_received TEXT,
                        action_taken TEXT,
                        details TEXT,
                        received_at TIMESTAMPTZ DEFAULT now(),
                        raw_payload JSONB
                    )
                """),
                # Новые поля ЭТРАН v2
                ("etran_wb_departure_country", "ALTER TABLE etran_waybills ADD COLUMN IF NOT EXISTS departure_country TEXT"),
                ("etran_wb_destination_country", "ALTER TABLE etran_waybills ADD COLUMN IF NOT EXISTS destination_country TEXT"),
                ("etran_wb_responsible_person", "ALTER TABLE etran_waybills ADD COLUMN IF NOT EXISTS responsible_person TEXT"),
                ("etran_wbw_zpu_type", "ALTER TABLE etran_waybill_wagons ADD COLUMN IF NOT EXISTS zpu_type TEXT"),
                ("etran_wbw_renter", "ALTER TABLE etran_waybill_wagons ADD COLUMN IF NOT EXISTS renter TEXT"),
                ("etran_wbw_wagon_model", "ALTER TABLE etran_waybill_wagons ADD COLUMN IF NOT EXISTS wagon_model TEXT"),
                ("etran_wbw_next_repair_date", "ALTER TABLE etran_waybill_wagons ADD COLUMN IF NOT EXISTS next_repair_date TEXT"),
                ("trip_waybills_table", """
                    CREATE TABLE IF NOT EXISTS trip_waybills (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        wagon_trip_id UUID NOT NULL REFERENCES wagon_trips(id) ON DELETE CASCADE,
                        waybill_id UUID NOT NULL REFERENCES etran_waybills(id) ON DELETE CASCADE,
                        created_at TIMESTAMPTZ DEFAULT now(),
                        UNIQUE(wagon_trip_id, waybill_id)
                    )
                """),
                ("trip_waybills_trip_idx", "CREATE INDEX IF NOT EXISTS idx_trip_waybills_trip ON trip_waybills(wagon_trip_id)"),
                ("trip_waybills_waybill_idx", "CREATE INDEX IF NOT EXISTS idx_trip_waybills_waybill ON trip_waybills(waybill_id)"),
                # Поезда
                ("railway_routes", """
                    CREATE TABLE IF NOT EXISTS railway_routes (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        train_number TEXT NOT NULL UNIQUE,
                        train_index TEXT,
                        snapshot_data JSONB,
                        status TEXT DEFAULT 'open',
                        created_at TIMESTAMPTZ DEFAULT now(),
                        updated_at TIMESTAMPTZ DEFAULT now()
                    )
                """),
                ("receiving_orders", """
                    CREATE TABLE IF NOT EXISTS receiving_orders (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        route_id UUID NOT NULL REFERENCES railway_routes(id) ON DELETE CASCADE,
                        client_name TEXT,
                        contract_number TEXT,
                        status TEXT DEFAULT 'new',
                        comment TEXT,
                        created_by TEXT,
                        created_at TIMESTAMPTZ DEFAULT now(),
                        updated_at TIMESTAMPTZ DEFAULT now()
                    )
                """),
                ("receiving_orders_route_idx", "CREATE INDEX IF NOT EXISTS idx_receiving_orders_route ON receiving_orders(route_id)"),
                # Удалить устаревший waybill_id если остался от старой схемы
                ("drop_receiving_orders_waybill_id",
                 "ALTER TABLE receiving_orders DROP COLUMN IF EXISTS waybill_id"),
                ("receiving_order_items", """
                    CREATE TABLE IF NOT EXISTS receiving_order_items (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        order_id UUID NOT NULL REFERENCES receiving_orders(id) ON DELETE CASCADE,
                        route_id UUID NOT NULL REFERENCES railway_routes(id) ON DELETE CASCADE,
                        waybill_id UUID REFERENCES etran_waybills(id) ON DELETE SET NULL,
                        wagon_number TEXT NOT NULL,
                        CONSTRAINT _order_item_route_wagon_uc UNIQUE (route_id, wagon_number)
                    )
                """),
                ("receiving_order_items_order_idx", "CREATE INDEX IF NOT EXISTS idx_order_items_order ON receiving_order_items(order_id)"),
                ("receiving_order_items_route_idx", "CREATE INDEX IF NOT EXISTS idx_order_items_route ON receiving_order_items(route_id)"),
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


@app.get("/wagons/summary")
def get_wagons_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    active = db.query(models.TrackingWagon).filter(models.TrackingWagon.is_active == True).count()
    archived = db.query(models.TrackingWagon).filter(models.TrackingWagon.is_active == False).count()
    return {"active": active, "archived": archived}


@app.get("/wagons/active", response_model=list[TrackingWagonTableRowOut])
def get_active_wagons(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows, err = get_table_wagons(db, is_active=True)
    if err:
        raise HTTPException(status_code=500, detail={"error": "TABLE_LOAD_ERROR", "message": err})
    return rows


@app.get("/wagons/archive", response_model=list[TrackingWagonTableRowOut])
def get_archive_wagons(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows, err = get_table_wagons(db, is_active=False)
    if err:
        raise HTTPException(status_code=500, detail={"error": "TABLE_LOAD_ERROR", "message": err})
    return rows


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
        sync_status = stats.get("status", "failure")
        return {
            "success": sync_status == "success",
            "sync_status": sync_status,
            "message": "Данные обновлены" if sync_status == "success" else (
                "Синхронизация завершена с ошибками" if sync_status == "partial_failure" else "Синхронизация завершилась с ошибкой"
            ),
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


@app.get("/admin/diagnostic")
def admin_diagnostic(
    current_user: models.User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Диагностика: количество строк, примеры данных, результат qualifying-запроса."""
    from sqlalchemy import text
    info = {}
    try:
        info["dislocation_count"] = db.execute(text("SELECT COUNT(*) FROM dislocation")).scalar()
        info["tracking_active"] = db.execute(text("SELECT COUNT(*) FROM tracking_wagons WHERE is_active = true")).scalar()
        info["tracking_archived"] = db.execute(text("SELECT COUNT(*) FROM tracking_wagons WHERE is_active = false")).scalar()
        rows = scheduler._fetch_qualifying_rows(db)
        info["qualifying_rows"] = len(rows)
        if rows:
            r = rows[0]
            info["sample"] = {
                "railway_carriage_number": r.get("railway_carriage_number"),
                "flight_start_date": str(r.get("flight_start_date")),
                "flight_start_station_code": r.get("flight_start_station_code"),
                "destination_station_code": r.get("destination_station_code"),
                "remaining_distance": r.get("remaining_distance"),
                "operation_code": r.get("operation_code_railway_carriage"),
            }
        else:
            try:
                sample = db.execute(text("SELECT railway_carriage_number, flight_start_date, flight_start_station_code, destination_station_code, remaining_distance FROM dislocation LIMIT 1")).mappings().first()
                info["dislocation_sample"] = dict(sample) if sample else None
            except Exception as e:
                info["dislocation_sample_error"] = str(e)
    except Exception as e:
        info["error"] = str(e)
    return info


@app.get("/admin/diagnostic/wagon/{wagon_number}")
def admin_diagnostic_wagon(
    wagon_number: str,
    current_user: models.User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """
    Диагностика привязки рейсов для конкретного вагона.
    Показывает: значения flight_start_date в dislocation vs wagon_trips.
    Помогает выявить причины дробления одного рейса на несколько.
    """
    from sqlalchemy import text
    wagon_number = wagon_number.strip()
    info = {"wagon_number": wagon_number}
    try:
        # dislocation: уникальные flight_start_date (сырые) по вагону
        d_rows = db.execute(text("""
            SELECT DISTINCT flight_start_date, flight_id, COUNT(*) as cnt
            FROM dislocation
            WHERE railway_carriage_number = :wn
            GROUP BY flight_start_date, flight_id
            ORDER BY flight_start_date
        """), {"wn": wagon_number}).mappings().all()
        info["dislocation_flight_dates"] = [
            {
                "flight_start_date_raw": str(r["flight_start_date"]) if r["flight_start_date"] else None,
                "flight_id": str(r["flight_id"]) if r["flight_id"] else None,
                "rows_count": r["cnt"],
            }
            for r in d_rows
        ]
        # wagon_trips для этого вагона
        wagon = db.query(models.Wagon).filter(
            models.Wagon.railway_carriage_number == wagon_number,
        ).first()
        if wagon:
            trips = db.execute(text("""
                SELECT id, flight_start_date, flight_number, is_active,
                       last_operation_date, departure_station_code
                FROM wagon_trips
                WHERE wagon_id = :wid
                ORDER BY flight_start_date
            """), {"wid": wagon.id}).mappings().all()
            info["wagon_id"] = str(wagon.id)
            info["wagon_trips"] = [
                {
                    "id": str(r["id"]),
                    "flight_start_date": str(r["flight_start_date"]) if r["flight_start_date"] else None,
                    "flight_number": r["flight_number"],
                    "is_active": r["is_active"],
                    "last_operation_date": str(r["last_operation_date"]) if r["last_operation_date"] else None,
                }
                for r in trips
            ]
            # Сколько dislocation-строк без flight_id (не привязаны)
            unlinked = db.execute(text("""
                SELECT COUNT(*) FROM dislocation
                WHERE railway_carriage_number = :wn AND flight_id IS NULL
            """), {"wn": wagon_number}).scalar() or 0
            info["dislocation_unlinked_count"] = unlinked
        else:
            info["wagon"] = None
            info["note"] = "Wagon not found in wagons table"
    except Exception as e:
        info["error"] = str(e)
    return info


@app.post("/admin/clear-data")
def admin_clear_data(
    current_user: models.User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """
    Очистка всех бизнес-данных системы. Пользователи, сессии и справочники не затрагиваются.
    После очистки можно загружать новые данные с нуля.
    """
    from sqlalchemy import text
    _logger.info("admin_clear_data: started by login=%s", current_user.login)
    try:
        tables_to_clear = [
            "etran_incoming_log",
            "etran_waybill_wagons",
            "etran_waybills",
            "dislocation",
            "tracking_wagons",   # CASCADE -> wagon_comments
            "wagons",            # CASCADE -> wagon_trips, wagon_entity_comments, wagon_trip_operations, trip_comments
            "comment_history",
        ]
        counts = {}
        for t in tables_to_clear:
            try:
                r = db.execute(text(f"SELECT COUNT(*) FROM {t}"))
                counts[t] = r.scalar() or 0
                db.execute(text(f"TRUNCATE TABLE {t} CASCADE"))
            except Exception as e:
                if "does not exist" in str(e).lower():
                    counts[t] = 0
                else:
                    raise
        db.commit()
        _logger.info("admin_clear_data: done by login=%s cleared=%s", current_user.login, counts)
        return {
            "status": "success",
            "message": "Данные очищены. Система готова к загрузке новых данных.",
            "cleared": counts,
        }
    except Exception as e:
        _logger.exception("admin_clear_data failed: %s", e)
        db.rollback()
        raise HTTPException(status_code=500, detail={"error": "CLEAR_FAILED", "message": str(e)})


@app.post("/admin/rebuild-tracking")
def admin_rebuild_tracking(current_user: models.User = Depends(require_role("admin"))):
    """
    Полная пересборка витрины по данным из dislocation. Не удаляет комментарии.
    Только для администратора. Использовать при смене логики архива или исправлении данных.
    """
    _logger.info("admin_rebuild_tracking: started by login=%s", current_user.login)
    try:
        result = scheduler.rebuild_tracking_from_dislocation_merge()
        _logger.info("admin_rebuild_tracking: done by login=%s result=%s", current_user.login, result)
        return result
    except Exception as e:
        _logger.exception("admin_rebuild_tracking failed: %s", e)
        raise HTTPException(status_code=500, detail={"error": "REBUILD_FAILED", "message": str(e)})
