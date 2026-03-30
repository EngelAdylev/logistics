"""
Роутер для приёма данных дислокации из DATAREON.
POST /dislocation/webhook — принимает JSON-пакет, вставляет в таблицу dislocation.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dislocation", tags=["dislocation-webhook"])


@router.get("/webhook/health")
def dislocation_webhook_health():
    return {"status": "ok", "service": "dislocation-webhook", "endpoint": "/dislocation/webhook", "method": "POST"}


def _parse_dt(val) -> Optional[datetime]:
    if val is None:
        return None
    try:
        if isinstance(val, datetime):
            return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
        s = str(val).strip()
        if not s or s in ("null", "None", "0001-01-01T00:00:00"):
            return None
        # fromisoformat обрабатывает большинство ISO-форматов включая +03:00
        try:
            dt = datetime.fromisoformat(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            pass
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return None
    except Exception:
        return None


def _str(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


# JSON-ключ → (колонка в БД, тип: "str" | "dt" | "int")
# Все поля из пакета, маппятся 1:1 на колонки dislocation
FIELD_MAP = {
    # ── Основные (уже были в исходной модели) ──
    "railway_carriage_number":           ("railway_carriage_number", "str"),
    "flight_start_date":                 ("flight_start_date", "dt"),
    "operation_code_railway_carriage":   ("operation_code_railway_carriage", "str"),
    "station_code_performing_operation": ("station_code_performing_operation", "str"),
    "date_time_of_operation":            ("date_time_of_operation", "dt"),
    # ── Добавленные через миграции ──
    "number_train":                      ("number_train", "str"),
    "train_index":                       ("train_index", "str"),
    "waybill_number":                    ("waybill_number", "str"),
    "type_railway_carriage":             ("type_railway_carriage", "str"),
    "owners_administration":             ("owners_administration", "str"),
    "remaining_mileage":                 ("remaining_mileage", "str"),
    "remaining_distance":                ("remaining_distance", "str"),
    "destination_station_code":          ("destination_station_code", "str"),
    "flight_start_station_code":         ("flight_start_station_code", "str"),
    "number_railway_carriage_on_train":  ("number_railway_carriage_on_train", "str"),
    # ── Новые поля (добавляем миграцией) ──
    "country_start_flight":              ("country_start_flight", "str"),
    "flight_start_road":                 ("flight_start_road", "str"),
    "flight_end_date":                   ("flight_end_date", "dt"),
    "code":                              ("country_code", "str"),
    "destination_road_code":             ("destination_road_code", "str"),
    "shipper":                           ("shipper", "str"),
    "shipper_OKPO":                      ("shipper_okpo", "str"),
    "consignee":                         ("consignee", "str"),
    "consignee_OKPO":                    ("consignee_okpo", "str"),
    "gng_code":                          ("gng_code", "str"),
    "cargo_weight":                      ("cargo_weight", "str"),
    "mileage_loaded_condition":          ("mileage_loaded_condition", "str"),
    "empty_mileage":                     ("empty_mileage", "str"),
    "mileage_standard":                  ("mileage_standard", "str"),
    "mileage_indicator":                 ("mileage_indicator", "str"),
    "special_mark_1":                    ("special_mark_1", "str"),
    "special_mark_2":                    ("special_mark_2", "str"),
    "special_mark_3":                    ("special_mark_3", "str"),
    "senders_payers_code":               ("senders_payers_code", "str"),
    "code_unloaded_cargo":               ("code_unloaded_cargo", "str"),
    "operation_cost_code":               ("operation_cost_code", "str"),
    "park_number":                       ("park_number", "str"),
    "path_number":                       ("path_number", "str"),
    "number_of_seals":                   ("number_of_seals", "str"),
    "number_loaded_containers":          ("number_loaded_containers", "str"),
    "number_empty_containers":           ("number_empty_containers", "str"),
    "standard_delivery_time":            ("standard_delivery_time", "dt"),
    "distance_traveled":                 ("distance_traveled", "str"),
    "total_distance":                    ("total_distance", "str"),
    "last_operation_downtime_per_day":   ("last_operation_downtime_per_day", "str"),
    "idle_time_last_operation_hours":    ("idle_time_last_operation_hours", "str"),
    "idle_time_last_minute_operation":   ("idle_time_last_minute_operation", "str"),
    "date_time_departure_cargo_receiving_station": ("date_time_departure_cargo_receiving_station", "dt"),
    "date_time_arrival_destination_station":       ("date_time_arrival_destination_station", "dt"),
    "sending_number":                    ("sending_number", "str"),
    # ── Контейнеры 1-12 ──
    **{f"container_number{i}": (f"container_number{i}", "str") for i in range(1, 13)},
}


@router.post("/webhook")
@router.post("/webhook/")
async def dislocation_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Принимает JSON-пакет дислокации из DATAREON.
    Поддерживает одиночный объект и массив.
    Генерирует UUID (_id) и created_at автоматически.
    """
    try:
        body = await request.json()
    except Exception as e:
        logger.warning("dislocation_webhook: invalid JSON: %s", e)
        return {"status": "error", "message": "Invalid JSON"}

    records = body if isinstance(body, list) else [body]
    inserted = 0
    errors = 0

    for rec in records:
        try:
            columns = ["_id", "created_at"]
            values = {"_id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc)}

            for json_key, (col_name, col_type) in FIELD_MAP.items():
                raw_val = rec.get(json_key)
                if raw_val is None and json_key not in rec:
                    continue
                if col_type == "dt":
                    values[col_name] = _parse_dt(raw_val)
                else:
                    values[col_name] = _str(raw_val)
                columns.append(col_name)

            cols_sql = ", ".join(columns)
            vals_sql = ", ".join(f":{c}" for c in columns)
            db.execute(text(f"INSERT INTO dislocation ({cols_sql}) VALUES ({vals_sql})"), values)
            inserted += 1
        except Exception as e:
            logger.error("dislocation_webhook: insert error: %s | wagon=%s", e, rec.get("railway_carriage_number"))
            errors += 1

    db.commit()
    logger.info("dislocation_webhook: inserted=%d, errors=%d, total=%d", inserted, errors, len(records))
    return {"status": "ok", "inserted": inserted, "errors": errors, "total": len(records)}
