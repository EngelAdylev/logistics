from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text
from database import SessionLocal
from models import TrackingWagon
import logging

logger = logging.getLogger(__name__)


def sync_dislocation_to_tracking():
    """Обычная синхронизация: подтягивает последние события из dislocation в tracking_wagons. Не удаляет данные."""
    stats = {"last_events": 0, "created": 0, "updated": 0, "archived": 0, "errors": 0}
    db = SessionLocal()
    try:
        query = text("""
            WITH LastEvents AS (
                SELECT d.railway_carriage_number, d.flight_start_date, d.date_time_of_operation,
                       d.operation_code_railway_carriage, rs.name as st_name, oc.name as op_name,
                       ROW_NUMBER() OVER (PARTITION BY d.railway_carriage_number, d.flight_start_date
                           ORDER BY d.date_time_of_operation DESC NULLS LAST) as rn
                FROM dislocation d
                LEFT JOIN railway_station rs ON d.station_code_performing_operation = rs.code
                LEFT JOIN operation_code oc ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
            )
            SELECT * FROM LastEvents WHERE rn = 1
        """)
        results = db.execute(query).mappings().all()
        stats["last_events"] = len(results)

        for row in results:
            try:
                is_unloaded = row.get("operation_code_railway_carriage") == "20"
                track_entry = db.query(TrackingWagon).filter(
                    TrackingWagon.railway_carriage_number == row["railway_carriage_number"],
                    TrackingWagon.flight_start_date == row["flight_start_date"],
                ).first()
                row_dt = row.get("date_time_of_operation")

                if not track_entry:
                    db.add(TrackingWagon(
                        railway_carriage_number=row["railway_carriage_number"],
                        flight_start_date=row["flight_start_date"],
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
            except Exception:
                stats["errors"] += 1
                logger.exception("sync_dislocation_to_tracking: row error")
        db.commit()
        logger.info("sync_dislocation_to_tracking: done created=%s updated=%s archived=%s errors=%s", stats["created"], stats["updated"], stats["archived"], stats["errors"])
    except Exception:
        logger.exception("sync_dislocation_to_tracking: failed")
        stats["errors"] += 1
    finally:
        db.close()
    return stats


def rebuild_tracking_from_dislocation_merge():
    """Полная пересборка витрины без удаления комментариев. Только для админа при смене логики/ремонте данных."""
    result = {"created": 0, "updated": 0, "active": 0, "archived": 0, "last_events": 0}
    db = SessionLocal()
    try:
        query = text("""
            WITH LastEvents AS (
                SELECT d.railway_carriage_number, d.flight_start_date, d.date_time_of_operation,
                       d.operation_code_railway_carriage, rs.name as st_name, oc.name as op_name,
                       ROW_NUMBER() OVER (PARTITION BY d.railway_carriage_number, d.flight_start_date
                           ORDER BY d.date_time_of_operation DESC NULLS LAST) as rn
                FROM dislocation d
                LEFT JOIN railway_station rs ON d.station_code_performing_operation = rs.code
                LEFT JOIN operation_code oc ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
            )
            SELECT * FROM LastEvents WHERE rn = 1
        """)
        results = db.execute(query).mappings().all()
        created, updated = 0, 0
        for row in results:
            try:
                is_unloaded = row.get("operation_code_railway_carriage") == "20"
                row_dt = row.get("date_time_of_operation")
                track_entry = db.query(TrackingWagon).filter(
                    TrackingWagon.railway_carriage_number == row["railway_carriage_number"],
                    TrackingWagon.flight_start_date == row["flight_start_date"],
                ).first()
                if not track_entry:
                    db.add(TrackingWagon(
                        railway_carriage_number=row["railway_carriage_number"],
                        flight_start_date=row["flight_start_date"],
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
            except Exception:
                logger.exception("rebuild_tracking_from_dislocation_merge: row error")
        db.commit()
        active = db.query(TrackingWagon).filter(TrackingWagon.is_active == True).count()
        archived = db.query(TrackingWagon).filter(TrackingWagon.is_active == False).count()
        result = {"created": created, "updated": updated, "active": active, "archived": archived, "last_events": len(results)}
    finally:
        db.close()
    return result

def start_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(sync_dislocation_to_tracking, 'interval', minutes=10)
    scheduler.start()