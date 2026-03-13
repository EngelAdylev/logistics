from datetime import datetime, timedelta, timezone
import re
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text
from database import SessionLocal
from models import TrackingWagon
import logging

logger = logging.getLogger(__name__)


def _fix_dt_str(s: str) -> str:
    """Приводит строку datetime к виду, понятному fromisoformat.
    Обрабатывает форматы: '2026-03-03 17:11:00.000 +0300', '2026-02-26 16:42:00+03', и ISO 8601.
    """
    s = s.strip().replace("Z", "+00:00")
    # Убираем пробел перед знаком timezone: "17:11:00.000 +0300" → "17:11:00.000+0300"
    s = re.sub(r"\s+([+-]\d)", r"\1", s)
    # +HHMM → +HH:MM (4 цифры без двоеточия)
    s = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", s)
    # +HH → +HH:00 (только 2 цифры)
    s = re.sub(r"([+-])(\d{2})$", r"\1\2:00", s)
    return s


def _normalize_dt(v):
    """Приводит дату к timestamp (float) для сравнения."""
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        return v.timestamp()
    s = str(v).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(_fix_dt_str(s)).timestamp()
    except (ValueError, TypeError):
        return None


def _parse_flight_start_date(v):
    """Парсит datetime-строку из dislocation (varchar) в объект datetime."""
    if v is None:
        return None
    if hasattr(v, "year"):
        return v
    s = str(v).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(_fix_dt_str(s))
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

        # Строим to_archive_keys ДО sync loop через ::timestamptz нормализацию в SQL.
        # Берём ПОСЛЕДНЮЮ операцию per (wagon, normalized_trip_UTC). Если remaining=0 — в архив.
        arch_epoch_rows = db.execute(text("""
            WITH nt AS (
                SELECT railway_carriage_number,
                       flight_start_date::timestamptz AS fs_ts,
                       COALESCE(CAST(NULLIF(TRIM(COALESCE(remaining_distance::text,'')),''
                       ) AS NUMERIC), 0) AS rem,
                       ROW_NUMBER() OVER (
                           PARTITION BY railway_carriage_number, flight_start_date::timestamptz
                           ORDER BY date_time_of_operation::timestamptz DESC NULLS LAST
                       ) AS rn
                FROM dislocation
            )
            SELECT railway_carriage_number, EXTRACT(EPOCH FROM fs_ts) AS fs_epoch
            FROM nt WHERE rn = 1 AND rem <= 0
        """)).mappings().all()
        to_archive_keys = {(str(r["railway_carriage_number"]), float(r["fs_epoch"])) for r in arch_epoch_rows if r["fs_epoch"] is not None}

        # qualifying_keys для авто-архива (чтобы не архивировать вагоны которые ещё едут)
        qualifying_keys = set()
        for row in results:
            ts = _normalize_dt(row.get("flight_start_date"))
            if ts is not None:
                qualifying_keys.add((str(row["railway_carriage_number"]), ts))

        # Sync loop: обновляем данные из qualifying_rows, ставим is_active=True.
        # Пропускаем вагоны в to_archive_keys — они уже прибыли (remaining=0 по свежей операции).
        for row in results:
            try:
                flight_dt = _parse_flight_start_date(row.get("flight_start_date"))
                if flight_dt is None:
                    stats["errors"] += 1
                    continue
                fs_ts = _normalize_dt(row.get("flight_start_date"))
                if (str(row["railway_carriage_number"]), fs_ts) in to_archive_keys:
                    continue  # рейс закрыт (remaining=0), не активируем
                track_entry = db.query(TrackingWagon).filter(
                    TrackingWagon.railway_carriage_number == row["railway_carriage_number"],
                    TrackingWagon.flight_start_date == flight_dt,
                ).first()
                row_dt_raw = row.get("date_time_of_operation")
                row_dt = _parse_flight_start_date(row_dt_raw)
                row_ts = _normalize_dt(row_dt_raw)
                entry_ts = _normalize_dt(track_entry.last_operation_date if track_entry else None)
                if not track_entry:
                    db.add(TrackingWagon(
                        railway_carriage_number=row["railway_carriage_number"],
                        flight_start_date=flight_dt,
                        current_station_name=row.get("st_name"),
                        current_operation_name=row.get("op_name"),
                        last_operation_date=row_dt,
                        is_active=True,
                    ))
                    stats["created"] += 1
                elif entry_ts is None or (row_ts is not None and row_ts > entry_ts):
                    track_entry.current_station_name = row.get("st_name")
                    track_entry.current_operation_name = row.get("op_name")
                    track_entry.last_operation_date = row_dt
                    track_entry.is_active = True
                    stats["updated"] += 1
                else:
                    track_entry.is_active = True
            except Exception as e:
                stats["errors"] += 1
                logger.warning(
                    "sync_dislocation_to_tracking: row error wagon=%s flight_start=%s: %s",
                    row.get("railway_carriage_number"), row.get("flight_start_date"), e,
                )

        db.flush()

        # Условие 1: remaining_distance = 0 → архив (SQL, нормализует все varchar-форматы через ::timestamptz)
        archived_rem = db.execute(text("""
            UPDATE tracking_wagons tw
            SET is_active = false
            WHERE tw.is_active = true
              AND EXISTS (
                  SELECT 1 FROM (
                      SELECT railway_carriage_number,
                             flight_start_date::timestamptz AS fs_ts,
                             COALESCE(CAST(NULLIF(TRIM(COALESCE(remaining_distance::text,'')),''
                             ) AS NUMERIC), 0) AS rem,
                             ROW_NUMBER() OVER (
                                 PARTITION BY railway_carriage_number, flight_start_date::timestamptz
                                 ORDER BY date_time_of_operation::timestamptz DESC NULLS LAST
                             ) AS rn
                      FROM dislocation
                  ) le
                  WHERE le.rn = 1
                    AND le.rem <= 0
                    AND le.railway_carriage_number = tw.railway_carriage_number
                    AND le.fs_ts = tw.flight_start_date
              )
        """)).rowcount
        stats["archived"] += archived_rem

        # Восстанавливаем ошибочно заархивированные: remaining>0 И нет записи с remaining=0 для того же рейса
        restored = db.execute(text("""
            UPDATE tracking_wagons tw
            SET is_active = true
            WHERE tw.is_active = false
              AND EXISTS (
                  SELECT 1 FROM (
                      SELECT railway_carriage_number,
                             flight_start_date::timestamptz AS fs_ts,
                             COALESCE(CAST(NULLIF(TRIM(COALESCE(remaining_distance::text,'')),''
                             ) AS NUMERIC), 0) AS rem,
                             ROW_NUMBER() OVER (
                                 PARTITION BY railway_carriage_number, flight_start_date::timestamptz
                                 ORDER BY date_time_of_operation::timestamptz DESC NULLS LAST
                             ) AS rn
                      FROM dislocation
                  ) le
                  WHERE le.rn = 1
                    AND le.rem > 0
                    AND le.railway_carriage_number = tw.railway_carriage_number
                    AND le.fs_ts = tw.flight_start_date
              )
              AND NOT EXISTS (
                  SELECT 1 FROM (
                      SELECT railway_carriage_number,
                             flight_start_date::timestamptz AS fs_ts,
                             COALESCE(CAST(NULLIF(TRIM(COALESCE(remaining_distance::text,'')),''
                             ) AS NUMERIC), 0) AS rem,
                             ROW_NUMBER() OVER (
                                 PARTITION BY railway_carriage_number, flight_start_date::timestamptz
                                 ORDER BY date_time_of_operation::timestamptz DESC NULLS LAST
                             ) AS rn
                      FROM dislocation
                  ) le2
                  WHERE le2.rn = 1
                    AND le2.rem <= 0
                    AND le2.railway_carriage_number = tw.railway_carriage_number
                    AND le2.fs_ts = tw.flight_start_date
              )
        """)).rowcount
        if restored:
            logger.info("sync_dislocation_to_tracking: restored=%s (wrongly archived, still in transit)", restored)

        # Условие 2: > 20 дней без операций → архив.
        # Исключаем вагоны которые сейчас есть в qualifying_rows (ещё в пути по дислокации).
        cutoff_ts = (datetime.now(timezone.utc) - timedelta(days=20)).timestamp()
        auto_archived = 0
        for tw in db.query(TrackingWagon).filter(TrackingWagon.is_active == True).all():
            key = (str(tw.railway_carriage_number), _normalize_dt(tw.flight_start_date))
            if key in qualifying_keys:
                continue  # вагон в дислокации, не трогаем
            op_ts = _normalize_dt(tw.last_operation_date)
            if op_ts is not None and op_ts < cutoff_ts:
                tw.is_active = False
                auto_archived += 1
        if auto_archived:
            stats["archived"] += auto_archived
            logger.info("sync_dislocation_to_tracking: auto_archived_by_age=%s (no ops > 20 days)", auto_archived)

        fail_safe = qualifying_rows == 0 and active_before > 0
        if fail_safe:
            logger.warning("sync fail-safe: qualifying_rows=0 but active_before=%s", active_before)

        logger.info(
            "sync_dislocation: qualifying_rows=%s active_before=%s archived_rem=%s restored=%s auto_archived=%s errors=%s",
            qualifying_rows, active_before, archived_rem, restored, auto_archived, stats["errors"],
        )

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
                row_dt = _parse_flight_start_date(row.get("date_time_of_operation"))
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