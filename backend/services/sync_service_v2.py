"""
Сервис синхронизации иерархической модели v2.

Логика по ТЗ:
  1. Получаем qualifying пары (wagon_number, flight_start_date) из dislocation
  2. Создаём/находим записи в wagons + wagon_trips
  3. Batch UPDATE: dislocation.flight_id = wagon_trips.id  (для строк где flight_id IS NULL)
  4. Batch UPDATE денормализованных полей wagon_trips из dislocation
  5. Присваиваем flight_number (порядковый номер рейса у вагона)
  6. Обновляем is_active для trips и wagons

Данные хранятся в dislocation — дублирование в wagon_trip_operations больше не используется.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Wagon, WagonTrip
from scheduler import _fetch_qualifying_rows, _parse_flight_start_date

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _upsert_wagon(db: Session, wagon_number: str) -> tuple[Wagon, bool]:
    wagon = db.query(Wagon).filter(Wagon.railway_carriage_number == wagon_number).first()
    if wagon:
        return wagon, False
    wagon = Wagon(railway_carriage_number=wagon_number)
    db.add(wagon)
    db.flush()
    return wagon, True


def _next_flight_number(db: Session) -> int:
    """Возвращает следующий глобально уникальный номер рейса (MAX + 1 по всей таблице)."""
    max_fn = db.execute(
        text("SELECT COALESCE(MAX(flight_number), 0) FROM wagon_trips")
    ).scalar()
    return (max_fn or 0) + 1


def _upsert_trip(db: Session, wagon: Wagon, flight_dt: datetime) -> tuple[WagonTrip, bool]:
    trip = db.query(WagonTrip).filter(
        WagonTrip.wagon_id == wagon.id,
        WagonTrip.flight_start_date == flight_dt,
    ).first()
    if trip:
        return trip, False
    # Новый рейс получает глобально уникальный номер
    trip = WagonTrip(
        wagon_id=wagon.id,
        flight_start_date=flight_dt,
        flight_number=_next_flight_number(db),
    )
    db.add(trip)
    db.flush()
    return trip, True


def _fetch_qualifying_pairs(db: Session) -> list[tuple[str, datetime]]:
    """Возвращает уникальные (wagon_number, flight_start_date) из qualifying-строк."""
    qualifying_rows = _fetch_qualifying_rows(db)
    seen: set[tuple] = set()
    pairs: list[tuple[str, datetime]] = []
    for row in qualifying_rows:
        wn = row.get("railway_carriage_number")
        fsd = _parse_flight_start_date(row.get("flight_start_date"))
        if wn and fsd:
            key = (wn, fsd)
            if key not in seen:
                seen.add(key)
                pairs.append(key)
    return pairs


# ---------------------------------------------------------------------------
# Основная синхронизация
# ---------------------------------------------------------------------------

def sync_new_model(db: Session) -> dict:
    """
    Полная синхронизация иерархической модели.

    Вызывается из POST /v2/sync (admin) и инкрементально из scheduler.
    Идемпотентна: безопасно запускать повторно.
    """
    stats = {
        "wagons_created": 0,
        "wagons_updated": 0,
        "trips_created": 0,
        "trips_updated": 0,
        "operations_inserted": 0,  # количество строк dislocation, которым проставлен flight_id
        "errors": 0,
    }

    try:
        # Шаг 1. Получаем qualifying пары
        qualifying_pairs = _fetch_qualifying_pairs(db)
        if not qualifying_pairs:
            logger.info("sync_new_model: no qualifying pairs, nothing to sync")
            stats["status"] = "success"
            return stats

        logger.info("sync_new_model: %d qualifying pairs", len(qualifying_pairs))

        # Шаг 2. Создаём/находим wagons + trips для каждой пары
        wagon_cache: dict[str, Wagon] = {}
        for wagon_number, flight_dt in qualifying_pairs:
            try:
                if wagon_number not in wagon_cache:
                    wagon, created = _upsert_wagon(db, wagon_number)
                    wagon_cache[wagon_number] = wagon
                    if created:
                        stats["wagons_created"] += 1
                    else:
                        stats["wagons_updated"] += 1

                wagon = wagon_cache[wagon_number]
                _, trip_created = _upsert_trip(db, wagon, flight_dt)
                if trip_created:
                    stats["trips_created"] += 1
                else:
                    stats["trips_updated"] += 1

            except Exception as e:
                stats["errors"] += 1
                logger.warning("sync_new_model: upsert error wagon=%s fsd=%s: %s", wagon_number, flight_dt, e)

        db.flush()

        # Шаг 3. Batch UPDATE: проставляем dislocation.flight_id для всех необработанных строк
        # Это ключевой шаг по ТЗ — вместо копирования данных в отдельную таблицу
        link_result = db.execute(text("""
            UPDATE dislocation d
            SET flight_id = wt.id
            FROM wagon_trips wt
            JOIN wagons w ON wt.wagon_id = w.id
            WHERE d.railway_carriage_number = w.railway_carriage_number
              AND d.flight_start_date IS NOT DISTINCT FROM wt.flight_start_date
              AND d.flight_id IS NULL
        """))
        stats["operations_inserted"] = link_result.rowcount
        logger.info("sync_new_model: linked %d dislocation rows", link_result.rowcount)

        # Шаг 4. Batch UPDATE: обновляем станцию отправления для новых рейсов (где NULL)
        db.execute(text("""
            UPDATE wagon_trips wt
            SET
                departure_station_code = first_op.fsc,
                departure_station_name = rs_dep.name
            FROM (
                SELECT DISTINCT ON (d.flight_id)
                    d.flight_id,
                    d.flight_start_station_code AS fsc
                FROM dislocation d
                WHERE d.flight_id IS NOT NULL
                ORDER BY d.flight_id, d.date_time_of_operation ASC
            ) first_op
            LEFT JOIN railway_station rs_dep
                ON first_op.fsc::text = rs_dep.esr_code
            WHERE wt.id = first_op.flight_id
              AND wt.departure_station_code IS NULL
        """))

        # Шаг 5. Batch UPDATE: денормализованные поля последней операции + is_active
        db.execute(text("""
            UPDATE wagon_trips wt
            SET
                last_operation_date   = last_op.date_time_of_operation,
                last_operation_code   = last_op.op_code,
                last_operation_name   = last_op.op_name,
                last_station_name     = last_op.stn_name,
                destination_station_code = last_op.dst_code,
                destination_station_name = last_op.dst_name,
                number_train          = last_op.number_train,
                train_index           = last_op.train_index,
                is_active             = (last_op.op_code IS DISTINCT FROM '20'),
                updated_at            = now()
            FROM (
                SELECT DISTINCT ON (d.flight_id)
                    d.flight_id,
                    d.date_time_of_operation,
                    d.operation_code_railway_carriage   AS op_code,
                    d.destination_station_code          AS dst_code,
                    d.number_train,
                    d.train_index,
                    oc.name                             AS op_name,
                    rs_op.name                          AS stn_name,
                    rs_dst.name                         AS dst_name
                FROM dislocation d
                LEFT JOIN operation_code oc
                    ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
                LEFT JOIN railway_station rs_op
                    ON d.station_code_performing_operation::text = rs_op.esr_code
                LEFT JOIN railway_station rs_dst
                    ON d.destination_station_code::text = rs_dst.esr_code
                WHERE d.flight_id IS NOT NULL
                ORDER BY d.flight_id, d.date_time_of_operation DESC
            ) last_op
            WHERE wt.id = last_op.flight_id
        """))

        # Шаг 6. Присваиваем flight_number тем рейсам, у которых его ещё нет.
        # Номера глобально уникальны по всей таблице wagon_trips (как номер документа в 1С):
        # каждый новый рейс любого вагона получает следующий номер, нет повторений.
        # Для миграции существующих данных: нумеруем по created_at, начиная после текущего MAX.
        db.execute(text("""
            UPDATE wagon_trips wt
            SET flight_number = sub.base + sub.rn
            FROM (
                SELECT
                    id,
                    COALESCE(
                        (SELECT MAX(flight_number) FROM wagon_trips WHERE flight_number IS NOT NULL),
                        0
                    ) AS base,
                    ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST) AS rn
                FROM wagon_trips
                WHERE flight_number IS NULL
            ) sub
            WHERE wt.id = sub.id
        """))

        # Шаг 7. Обновляем Wagon.is_active
        db.execute(text("""
            UPDATE wagons w
            SET
                is_active  = EXISTS (
                    SELECT 1 FROM wagon_trips wt
                    WHERE wt.wagon_id = w.id AND wt.is_active = true
                ),
                updated_at = now()
        """))

        db.commit()
        stats["status"] = "success" if stats["errors"] == 0 else "partial_failure"
        logger.info("sync_new_model: done stats=%s", stats)
        return stats

    except Exception as e:
        logger.exception("sync_new_model failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return {
            "wagons_created": 0, "wagons_updated": 0,
            "trips_created": 0, "trips_updated": 0,
            "operations_inserted": 0, "errors": 1, "status": "failure",
        }


def sync_new_model_incremental(db: Session) -> dict:
    """
    Инкрементальная синхронизация для scheduler (каждые 10 минут).

    Логика та же что у sync_new_model — батчевый UPDATE обрабатывает только
    строки dislocation где flight_id IS NULL, поэтому повторный запуск безопасен.
    """
    return sync_new_model(db)
