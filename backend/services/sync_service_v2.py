"""
Сервис синхронизации иерархической модели v2.

Логика по ТЗ:
  1. Получаем qualifying пары (wagon_number, flight_start_date) из dislocation
  2. Создаём/находим записи в wagons + wagon_trips
  3. Batch UPDATE: dislocation.flight_id = wagon_trips.id
  4. Batch UPDATE денормализованных полей wagon_trips из dislocation
  5. Присваиваем flight_number, обновляем is_active

Ключ рейса: (вагон, дата, станция отправления) — день/месяц/год в МСК + flight_start_station_code.
Различаем рейсы одного дня: приезд и отъезд с другой станции = другой рейс.
"""
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Wagon, WagonTrip
from scheduler import _fetch_qualifying_rows, _parse_flight_start_date

logger = logging.getLogger(__name__)

def _business_date(dt: datetime) -> date:
    """Дата в МСК (UTC+3) для группировки: один рейс = один вагон на один календарный день."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt.astimezone(timezone.utc) + timedelta(hours=3)).date()


def _canonical_flight_start_date(raw) -> datetime | None:
    """
    Приводит дату начала рейса к каноническому виду: UTC, точность до секунды.
    Устраняет дубли из-за формата/timezone/микросекунд.
    """
    dt = _parse_flight_start_date(raw)
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.replace(microsecond=0)


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


def _norm_station(v) -> str:
    """Нормализация кода станции для ключа (trim, пустая строка для NULL)."""
    if v is None:
        return ""
    return str(v).strip()


def _upsert_trip(
    db: Session,
    wagon: Wagon,
    flight_dt_canonical: datetime,
    business_d: date,
    departure_station: str,
    raw_fsd=None,
) -> tuple[WagonTrip, bool]:
    """
    Создаёт или находит рейс по (wagon_id, бизнес-дата, станция отправления).
    Ключ: один рейс на вагон на один календарный день (МСК) с одной станцией отправления.
    """
    bus_date_str = business_d.isoformat()
    dep = _norm_station(departure_station)
    existing = db.execute(
        text("""
            SELECT id, flight_start_date FROM wagon_trips wt
            WHERE wagon_id = :wid
              AND ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date = :bd
              AND TRIM(COALESCE(wt.departure_station_code, '')) = :dep
            ORDER BY flight_start_date ASC
            LIMIT 1
        """),
        {"wid": wagon.id, "bd": business_d, "dep": dep},
    ).mappings().first()
    if existing:
        trip = db.query(WagonTrip).filter(WagonTrip.id == existing["id"]).first()
        logger.debug(
            "sync_new_model: trip reused wagon_id=%s business_date=%s",
            wagon.id, bus_date_str,
        )
        return trip, False

    trip = WagonTrip(
        wagon_id=wagon.id,
        flight_start_date=flight_dt_canonical,
        flight_number=_next_flight_number(db),
        departure_station_code=dep if dep else None,
    )
    db.add(trip)
    db.flush()
    logger.info(
        "sync_new_model: trip created wagon_id=%s business_date=%s dep_station=%s",
        wagon.id, bus_date_str, dep or "(empty)",
    )
    return trip, True


def _fetch_qualifying_pairs(db: Session) -> list[tuple[str, datetime, date, str, object]]:
    """
    Уникальные пары (wagon_number, canonical_fsd, business_date, departure_station, raw_fsd).
    Группировка по (вагон, бизнес-дата, станция отправления).
    Для группы берём min(canonical) как flight_start_date.
    """
    qualifying_rows = _fetch_qualifying_rows(db)
    by_key: dict[tuple[str, date, str], tuple[datetime, object]] = {}
    for row in qualifying_rows:
        wn = row.get("railway_carriage_number")
        raw_fsd = row.get("flight_start_date")
        dep_st = _norm_station(row.get("flight_start_station_code"))
        canonical = _canonical_flight_start_date(raw_fsd)
        if wn and canonical:
            bus_d = _business_date(canonical)
            key = (wn, bus_d, dep_st)
            if key not in by_key or canonical < by_key[key][0]:
                by_key[key] = (canonical, raw_fsd)
    return [(wn, canonical, bus_d, dep_st, raw_fsd) for (wn, bus_d, dep_st), (canonical, raw_fsd) in by_key.items()]


# ---------------------------------------------------------------------------
# Основная синхронизация
# ---------------------------------------------------------------------------

def sync_new_model(db: Session, *, force_rebind: bool = False) -> dict:
    """
    Полная синхронизация иерархической модели.

    Вызывается из POST /v2/sync (admin) и инкрементально из scheduler.
    Идемпотентна: безопасно запускать повторно.

    force_rebind: при True сбрасывает flight_id у всех dislocation, затем выполняет перепривязку
    (ТЗ №2: режим контролируемой перепривязки для исправления накопленных ошибок).
    """
    stats = {
        "wagons_created": 0,
        "wagons_updated": 0,
        "trips_created": 0,
        "trips_updated": 0,
        "operations_inserted": 0,
        "trips_merged": 0,
        "errors": 0,
    }

    try:
        # Диагностика: проверяем тип колонки dislocation.flight_start_date
        try:
            col_type = db.execute(text("""
                SELECT data_type FROM information_schema.columns
                WHERE table_name = 'dislocation' AND column_name = 'flight_start_date'
            """)).scalar()
            logger.info("sync_new_model: dislocation.flight_start_date type=%s", col_type)
        except Exception as diag_e:
            logger.warning("sync_new_model: could not check column type: %s", diag_e)

        # Опционально: сброс привязок для контролируемой перепривязки (ТЗ №2)
        if force_rebind:
            cleared = db.execute(text("UPDATE dislocation SET flight_id = NULL")).rowcount
            logger.info("sync_new_model: force_rebind=True, cleared flight_id for %d rows", cleared)

        # Шаг 1. Получаем qualifying пары
        qualifying_pairs = _fetch_qualifying_pairs(db)
        if not qualifying_pairs:
            logger.info("sync_new_model: no qualifying pairs, nothing to sync")
            stats["status"] = "success"
            return stats

        logger.info("sync_new_model: %d qualifying pairs", len(qualifying_pairs))

        # Шаг 2. Создаём/находим wagons + trips (ключ = вагон + бизнес-дата + станция отправления)
        wagon_cache: dict[str, Wagon] = {}
        for wagon_number, flight_dt_canonical, business_d, dep_station, raw_fsd in qualifying_pairs:
            try:
                if wagon_number not in wagon_cache:
                    wagon, created = _upsert_wagon(db, wagon_number)
                    wagon_cache[wagon_number] = wagon
                    if created:
                        stats["wagons_created"] += 1
                    else:
                        stats["wagons_updated"] += 1

                wagon = wagon_cache[wagon_number]
                _, trip_created = _upsert_trip(
                    db, wagon, flight_dt_canonical, business_d, dep_station, raw_fsd=raw_fsd
                )
                if trip_created:
                    stats["trips_created"] += 1
                else:
                    stats["trips_updated"] += 1

            except Exception as e:
                stats["errors"] += 1
                logger.warning("sync_new_model: upsert error wagon=%s fsd=%s: %s", wagon_number, flight_dt_canonical, e)

        db.flush()

        # Шаг 3. Batch UPDATE: привязка dislocation.flight_id по (вагон, бизнес-дата, станция отправления)
        link_result = db.execute(text("""
            WITH trip_by_key AS (
                SELECT wt.id, w.railway_carriage_number,
                    ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date AS bus_date,
                    TRIM(COALESCE(wt.departure_station_code, '')) AS dep_station,
                    ROW_NUMBER() OVER (
                        PARTITION BY w.railway_carriage_number,
                            ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date,
                            TRIM(COALESCE(wt.departure_station_code, ''))
                        ORDER BY wt.flight_start_date ASC
                    ) AS rn
                FROM wagon_trips wt
                JOIN wagons w ON wt.wagon_id = w.id
            ),
            primary_trip AS (
                SELECT id, railway_carriage_number, bus_date, dep_station
                FROM trip_by_key WHERE rn = 1
            )
            UPDATE dislocation d
            SET flight_id = pt.id
            FROM primary_trip pt
            WHERE d.railway_carriage_number = pt.railway_carriage_number
              AND ((d.flight_start_date::timestamptz AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date = pt.bus_date
              AND TRIM(COALESCE(d.flight_start_station_code::text, '')) = pt.dep_station
              AND d.flight_id IS NULL
        """))
        stats["operations_inserted"] = link_result.rowcount
        logger.info("sync_new_model: linked %d dislocation rows", link_result.rowcount)

        # Шаг 3b. Merge дублей: один рейс на (вагон, дата, станция отправления)
        merge_result = db.execute(text("""
            WITH duplicates AS (
                SELECT wt.id, wt.wagon_id,
                    ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date AS bus_date,
                    TRIM(COALESCE(wt.departure_station_code, '')) AS dep_station,
                    ROW_NUMBER() OVER (
                        PARTITION BY wt.wagon_id,
                            ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date,
                            TRIM(COALESCE(wt.departure_station_code, ''))
                        ORDER BY wt.flight_start_date ASC, wt.id ASC
                    ) AS rn
                FROM wagon_trips wt
            ),
            to_remove AS (
                SELECT d.id, d.wagon_id, d.bus_date, d.dep_station
                FROM duplicates d WHERE d.rn > 1
            ),
            primary_per_group AS (
                SELECT id AS keep_id, wagon_id, bus_date, dep_station FROM duplicates WHERE rn = 1
            )
            UPDATE trip_comments tc
            SET trip_id = p.keep_id
            FROM to_remove tr
            JOIN primary_per_group p
                ON p.wagon_id = tr.wagon_id AND p.bus_date = tr.bus_date AND p.dep_station = tr.dep_station
            WHERE tc.trip_id = tr.id
        """))
        comments_migrated = merge_result.rowcount
        db.execute(text("""
            WITH duplicates AS (
                SELECT wt.id, wt.wagon_id,
                    ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date AS bus_date,
                    TRIM(COALESCE(wt.departure_station_code, '')) AS dep_station,
                    ROW_NUMBER() OVER (
                        PARTITION BY wt.wagon_id,
                            ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date,
                            TRIM(COALESCE(wt.departure_station_code, ''))
                        ORDER BY wt.flight_start_date ASC, wt.id ASC
                    ) AS rn
                FROM wagon_trips wt
            ),
            to_remove AS (SELECT id, wagon_id, bus_date, dep_station FROM duplicates WHERE rn > 1),
            primary_per_group AS (
                SELECT id AS keep_id, wagon_id, bus_date, dep_station FROM duplicates WHERE rn = 1
            )
            UPDATE comment_history ch
            SET entity_id = p.keep_id
            FROM to_remove tr
            JOIN primary_per_group p
                ON p.wagon_id = tr.wagon_id AND p.bus_date = tr.bus_date AND p.dep_station = tr.dep_station
            WHERE ch.entity_type = 'trip' AND ch.entity_id = tr.id
        """))
        merge_delete = db.execute(text("""
            WITH duplicates AS (
                SELECT wt.id,
                    ROW_NUMBER() OVER (
                        PARTITION BY wt.wagon_id,
                            ((wt.flight_start_date AT TIME ZONE 'UTC') + INTERVAL '3 hours')::date,
                            TRIM(COALESCE(wt.departure_station_code, ''))
                        ORDER BY wt.flight_start_date ASC, wt.id ASC
                    ) AS rn
                FROM wagon_trips wt
            )
            DELETE FROM wagon_trips WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
        """))
        merged_count = merge_delete.rowcount
        if merged_count > 0:
            logger.info(
                "sync_new_model: merged %d duplicate trips (comments_migrated=%d)",
                merged_count, comments_migrated,
            )
        stats["trips_merged"] = merged_count

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
              AND wt.departure_station_name IS NULL
        """))

        # Шаг 5. Batch UPDATE: денормализованные поля последней операции + is_active
        # date_time_of_operation в dislocation — character varying, нужен явный каст
        db.execute(text("""
            UPDATE wagon_trips wt
            SET
                last_operation_date   = last_op.dto::timestamptz,
                last_operation_code   = last_op.op_code,
                last_operation_name   = last_op.op_name,
                last_station_name     = last_op.stn_name,
                destination_station_code = last_op.dst_code,
                destination_station_name = last_op.dst_name,
                number_train          = last_op.number_train,
                train_index           = last_op.train_index,
                number_railway_carriage_on_train = last_op.number_railway_carriage_on_train,
                is_active             = NOT (
                    last_op.op_code = '96'
                    OR (last_op.rem <= 0 AND last_op.op_code IN ('20', '43', '85'))
                ),
                updated_at            = now()
            FROM (
                SELECT DISTINCT ON (d.flight_id)
                    d.flight_id,
                    d.date_time_of_operation           AS dto,
                    d.operation_code_railway_carriage  AS op_code,
                    d.destination_station_code         AS dst_code,
                    COALESCE(CAST(NULLIF(TRIM(COALESCE(d.remaining_distance::text,'')), '') AS NUMERIC), 1) AS rem,
                    d.number_train,
                    d.train_index,
                    d.number_railway_carriage_on_train,
                    oc.name                            AS op_name,
                    rs_op.name                         AS stn_name,
                    rs_dst.name                        AS dst_name
                FROM dislocation d
                LEFT JOIN operation_code oc
                    ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
                LEFT JOIN railway_station rs_op
                    ON d.station_code_performing_operation = rs_op.esr_code
                LEFT JOIN railway_station rs_dst
                    ON d.destination_station_code = rs_dst.esr_code
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

        # Шаг 8. Нормализация активности: у каждого вагона не более одного активного рейса (ТЗ №1)
        import time as _time
        _t0 = _time.perf_counter()
        norm_result = db.execute(text("""
            WITH active_trips AS (
                SELECT id, wagon_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY wagon_id
                        ORDER BY
                            last_operation_date DESC NULLS LAST,
                            flight_start_date DESC NULLS LAST,
                            id DESC
                    ) AS rn
                FROM wagon_trips
                WHERE is_active = true
            ),
            to_deactivate AS (
                SELECT id FROM active_trips WHERE rn > 1
            )
            UPDATE wagon_trips wt
            SET is_active = false, updated_at = now()
            FROM to_deactivate td
            WHERE wt.id = td.id
        """))
        deactivated_count = norm_result.rowcount
        _t1 = _time.perf_counter()
        if deactivated_count > 0:
            logger.info(
                "sync_new_model: normalization trips_deactivated=%d (was >1 active per wagon), duration_ms=%.0f",
                deactivated_count, (_t1 - _t0) * 1000,
            )
        stats["trips_normalized_deactivated"] = deactivated_count

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
            "operations_inserted": 0, "trips_merged": 0, "errors": 1, "status": "failure",
        }


def sync_new_model_incremental(db: Session) -> dict:
    """
    Инкрементальная синхронизация для scheduler (каждые 10 минут).

    Логика та же что у sync_new_model — батчевый UPDATE обрабатывает только
    строки dislocation где flight_id IS NULL, поэтому повторный запуск безопасен.
    """
    return sync_new_model(db)
