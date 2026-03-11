from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text
from database import SessionLocal
from models import TrackingWagon
import logging

logger = logging.getLogger(__name__)


def _normalize_dt(v):
    """Приводит дату к timestamp для сравнения (dislocation — varchar, tracking — timestamptz)."""
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        return v.timestamp()
    s = str(v).strip()
    if not s:
        return None
    if s.endswith("+03") and not s.endswith("+03:"):
        s = s[:-3] + "+03:00"
    elif s.endswith("-03") and not s.endswith("-03:"):
        s = s[:-3] + "-03:00"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def _parse_flight_start_date(v):
    """Парсит flight_start_date из dislocation (varchar) в datetime для поиска в tracking_wagons."""
    if v is None:
        return None
    if hasattr(v, "year"):
        return v
    s = str(v).strip()
    if not s:
        return None
    # Нормализуем +03 -> +03:00 для fromisoformat
    if s.endswith("+03") and not s.endswith("+03:"):
        s = s[:-3] + "+03:00"
    elif s.endswith("-03") and not s.endswith("-03:"):
        s = s[:-3] + "-03:00"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _fetch_qualifying_rows(db):
    """
    Возвращает строки dislocation, подходящие для слежения:
    (станция отправления=648400 ИЛИ станция назначения=648400) И remaining_distance > 0.
    При 0 результатах — fallback: только remaining_distance > 0.
    Base CTE не зависит от railway_station/operation_code: при отсутствии или ошибке
    этих таблиц используется dislocation-only CTE (st_name/op_name = NULL).
    """
    # Minimal CTE — только dislocation, без JOIN на railway_station/operation_code.
    # Используется при ошибке или отсутствии справочников.
    base_cte_minimal = """
        WITH LastEvents AS (
            SELECT d.railway_carriage_number, d.flight_start_date, d.date_time_of_operation,
                   d.operation_code_railway_carriage, d.flight_start_station_code,
                   d.destination_station_code, d.remaining_distance,
                   NULL::text as st_name, NULL::text as op_name,
                   ROW_NUMBER() OVER (PARTITION BY d.railway_carriage_number, d.flight_start_date
                       ORDER BY d.date_time_of_operation DESC NULLS LAST) as rn
            FROM dislocation d
        )
    """
    base_cte_full = """
        WITH LastEvents AS (
            SELECT d.railway_carriage_number, d.flight_start_date, d.date_time_of_operation,
                   d.operation_code_railway_carriage, d.flight_start_station_code,
                   d.destination_station_code, d.remaining_distance,
                   rs.name as st_name, oc.name as op_name,
                   ROW_NUMBER() OVER (PARTITION BY d.railway_carriage_number, d.flight_start_date
                       ORDER BY d.date_time_of_operation DESC NULLS LAST) as rn
            FROM dislocation d
            LEFT JOIN railway_station rs ON d.station_code_performing_operation::text = rs.esr_code
            LEFT JOIN operation_code oc ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
        )
    """

    def _run_queries(base_cte):
        query_strict = text(base_cte + """
            SELECT * FROM LastEvents
            WHERE rn = 1
              AND (
                TRIM(COALESCE(flight_start_station_code::text, '')) = '648400'
                OR TRIM(COALESCE(destination_station_code::text, '')) = '648400'
                OR TRIM(COALESCE(flight_start_station_code::text, '')) LIKE '%648400'
                OR TRIM(COALESCE(destination_station_code::text, '')) LIKE '%648400'
              )
              AND COALESCE(CAST(NULLIF(TRIM(COALESCE(remaining_distance::text, '')), '') AS NUMERIC), 0) > 0
        """)
        results = []
        try:
            results = db.execute(query_strict).mappings().all()
        except Exception as e:
            logger.warning("qualifying query (strict) failed: %s", e)
        if not results:
            try:
                query_fallback = text(base_cte + """
                    SELECT * FROM LastEvents
                    WHERE rn = 1
                      AND COALESCE(CAST(NULLIF(TRIM(COALESCE(remaining_distance::text, '')), '') AS NUMERIC), 0) > 0
                """)
                results = db.execute(query_fallback).mappings().all()
                if results:
                    logger.info("qualifying rows: strict=0, using fallback (remaining_distance > 0), got %s rows", len(results))
            except Exception as e:
                logger.warning("qualifying query (remaining_distance fallback) failed: %s", e)
                results = []
        if not results:
            try:
                query_all = text(base_cte + """
                    SELECT * FROM LastEvents WHERE rn = 1
                """)
                results = db.execute(query_all).mappings().all()
                if results:
                    logger.info("qualifying rows: both filters=0, using fallback (all rows), got %s rows", len(results))
            except Exception as e:
                logger.warning("qualifying query (all rows fallback) failed: %s", e)
                results = []
        return results

    # Сначала пробуем полный CTE с JOIN; при ошибке — минимальный (без railway_station/operation_code)
    results = _run_queries(base_cte_full)
    if not results:
        try:
            # Проверяем, не была ли причина в самом CTE (отсутствуют railway_station/operation_code)
            db.execute(text(base_cte_full + " SELECT 1 FROM LastEvents WHERE rn = 1 LIMIT 1")).fetchall()
        except Exception as e:
            logger.info("base CTE with railway_station/operation_code failed, using dislocation-only: %s", e)
            results = _run_queries(base_cte_minimal)
    return results


def sync_dislocation_to_tracking():
    """Обычная синхронизация: подтягивает последние события из dislocation в tracking_wagons. Не удаляет данные."""
    stats = {"last_events": 0, "created": 0, "updated": 0, "archived": 0, "errors": 0}
    db = SessionLocal()
    try:
        results = _fetch_qualifying_rows(db)
        qualifying_rows = len(results)
        stats["last_events"] = qualifying_rows

        active_before = db.query(TrackingWagon).filter(TrackingWagon.is_active == True).count()
        qualifying_keys = set()
        for row in results:
            ts = _normalize_dt(row.get("flight_start_date"))
            if ts is not None:
                qualifying_keys.add((str(row["railway_carriage_number"]), ts))

        for row in results:
            try:
                flight_dt = _parse_flight_start_date(row.get("flight_start_date"))
                if flight_dt is None:
                    stats["errors"] += 1
                    continue
                is_unloaded = row.get("operation_code_railway_carriage") == "20"
                track_entry = db.query(TrackingWagon).filter(
                    TrackingWagon.railway_carriage_number == row["railway_carriage_number"],
                    TrackingWagon.flight_start_date == flight_dt,
                ).first()
                row_dt = row.get("date_time_of_operation")

                if not track_entry:
                    db.add(TrackingWagon(
                        railway_carriage_number=row["railway_carriage_number"],
                        flight_start_date=flight_dt,
                        current_station_name=row.get("st_name"),
                        current_operation_name=row.get("op_name"),
                        last_operation_date=row_dt,
                        is_active=not is_unloaded,
                    ))
                    stats["created"] += 1
                    if is_unloaded:
                        stats["archived"] += 1
                elif track_entry.last_operation_date is None or (row_dt and row_dt > track_entry.last_operation_date):
                    track_entry.current_station_name = row.get("st_name")
                    track_entry.current_operation_name = row.get("op_name")
                    track_entry.last_operation_date = row_dt
                    track_entry.is_active = not is_unloaded
                    stats["updated"] += 1
                    if is_unloaded:
                        stats["archived"] += 1
                else:
                    track_entry.is_active = not is_unloaded
            except Exception as e:
                stats["errors"] += 1
                logger.warning(
                    "sync_dislocation_to_tracking: row error wagon=%s flight_start=%s: %s",
                    row.get("railway_carriage_number"),
                    row.get("flight_start_date"),
                    e,
                    exc_info=False,
                )
        archived_out = 0
        active_list = db.query(TrackingWagon).filter(TrackingWagon.is_active == True).all()
        archived_keys_examples = []

        fail_safe = False
        if qualifying_rows == 0 and active_before > 0:
            fail_safe = True
            logger.warning("sync fail-safe: qualifying_rows=0 but active_before=%s, skipping archive", active_before)
        elif not qualifying_keys and active_before > 0:
            fail_safe = True
            logger.warning("sync fail-safe: qualifying_keys empty but active_before=%s, skipping archive", active_before)
        elif qualifying_rows > 0 and stats["errors"] >= qualifying_rows:
            fail_safe = True
            logger.warning("sync fail-safe: mass errors (%s/%s), skipping archive", stats["errors"], qualifying_rows)

        if not fail_safe and qualifying_keys:
            for tw in active_list:
                key = (str(tw.railway_carriage_number), _normalize_dt(tw.flight_start_date))
                if key is not None and key[1] is not None and key not in qualifying_keys:
                    tw.is_active = False
                    archived_out += 1
                    if len(archived_keys_examples) < 10:
                        archived_keys_examples.append(key)
        stats["archived"] += archived_out

        qualifying_examples = list(qualifying_keys)[:10]
        logger.info(
            "sync_dislocation: qualifying_rows=%s active_before=%s qualifying_keys=%s archived_out=%s errors=%s fail_safe=%s",
            qualifying_rows, active_before, len(qualifying_keys), archived_out, stats["errors"], fail_safe,
        )
        logger.info("sync_dislocation: qualifying_keys_sample=%s", qualifying_examples)
        logger.info("sync_dislocation: archived_keys_sample=%s", archived_keys_examples)

        db.commit()
        last_events = stats["last_events"]
        errs = stats["errors"]
        if errs == 0:
            stats["status"] = "success"
        elif last_events and errs < last_events:
            stats["status"] = "partial_failure"
        else:
            stats["status"] = "failure"
        logger.info("sync_dislocation: done created=%s updated=%s archived=%s errors=%s status=%s", stats["created"], stats["updated"], stats["archived"], stats["errors"], stats["status"])
    except Exception:
        logger.exception("sync_dislocation_to_tracking: failed")
        stats["errors"] += 1
        stats["status"] = "failure"
    finally:
        db.close()
    if "status" not in stats:
        stats["status"] = "failure"
    return stats


def rebuild_tracking_from_dislocation_merge():
    """Полная пересборка витрины без удаления комментариев. Только для админа при смене логики/ремонте данных."""
    result = {"created": 0, "updated": 0, "active": 0, "archived": 0, "last_events": 0}
    db = SessionLocal()
    try:
        results = _fetch_qualifying_rows(db)
        qualifying_keys = set()
        for row in results:
            ts = _normalize_dt(row.get("flight_start_date"))
            if ts is not None:
                qualifying_keys.add((str(row["railway_carriage_number"]), ts))
        created, updated = 0, 0
        for row in results:
            try:
                flight_dt = _parse_flight_start_date(row.get("flight_start_date"))
                if flight_dt is None:
                    continue
                is_unloaded = row.get("operation_code_railway_carriage") == "20"
                row_dt = row.get("date_time_of_operation")
                track_entry = db.query(TrackingWagon).filter(
                    TrackingWagon.railway_carriage_number == row["railway_carriage_number"],
                    TrackingWagon.flight_start_date == flight_dt,
                ).first()
                if not track_entry:
                    db.add(TrackingWagon(
                        railway_carriage_number=row["railway_carriage_number"],
                        flight_start_date=flight_dt,
                        current_station_name=row.get("st_name"),
                        current_operation_name=row.get("op_name"),
                        last_operation_date=row_dt,
                        is_active=not is_unloaded,
                    ))
                    created += 1
                else:
                    track_entry.current_station_name = row.get("st_name")
                    track_entry.current_operation_name = row.get("op_name")
                    track_entry.last_operation_date = row_dt
                    track_entry.is_active = not is_unloaded
                    updated += 1
            except Exception as e:
                logger.warning(
                    "rebuild_tracking_from_dislocation_merge: row error wagon=%s flight_start=%s: %s",
                    row.get("railway_carriage_number"),
                    row.get("flight_start_date"),
                    e,
                    exc_info=False,
                )
        if qualifying_keys:
            for tw in db.query(TrackingWagon).filter(TrackingWagon.is_active == True).all():
                key = (str(tw.railway_carriage_number), _normalize_dt(tw.flight_start_date))
                if key[1] is not None and key not in qualifying_keys:
                    tw.is_active = False
        db.commit()
        active = db.query(TrackingWagon).filter(TrackingWagon.is_active == True).count()
        archived = db.query(TrackingWagon).filter(TrackingWagon.is_active == False).count()
        result = {"created": created, "updated": updated, "active": active, "archived": archived, "last_events": len(results)}
    finally:
        db.close()
    return result

def sync_all():
    """Запускает синхронизацию старой (tracking_wagons) и новой (wagons/trips/operations) моделей."""
    sync_dislocation_to_tracking()
    try:
        from database import SessionLocal as _SessionLocal
        from services.sync_service_v2 import sync_new_model_incremental
        _db = _SessionLocal()
        try:
            stats = sync_new_model_incremental(_db)
            logger.info("sync_new_model_incremental: %s", stats)
        finally:
            _db.close()
    except Exception as e:
        logger.warning("sync_new_model_incremental failed (non-critical): %s", e)


def start_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(sync_all, 'interval', minutes=10)
    scheduler.start()