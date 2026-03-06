from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text
from database import SessionLocal
from models import TrackingWagon, WagonComment
import logging

logger = logging.getLogger(__name__)


def is_archive_operation(operation_code: str | None) -> bool:
    # Вынесено в отдельную функцию, чтобы потом расширять правила
    return operation_code == "20"


def _fetch_last_events(db):
    query = text(
        """
        WITH LastEvents AS (
            SELECT
                d.railway_carriage_number,
                d.flight_start_date,
                d.date_time_of_operation,
                d.operation_code_railway_carriage,
                rs.name as st_name,
                oc.name as op_name,
                ROW_NUMBER() OVER (
                    PARTITION BY d.railway_carriage_number, d.flight_start_date
                    ORDER BY d.date_time_of_operation DESC NULLS LAST, d._id DESC
                ) as rn
            FROM dislocation d
            LEFT JOIN railway_station rs ON d.station_code_performing_operation = rs.code
            LEFT JOIN operation_code oc ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
        )
        SELECT * FROM LastEvents WHERE rn = 1
        """
    )
    return db.execute(query).mappings().all()


def sync_dislocation_to_tracking():
    stats = {
        "last_events": 0,
        "created": 0,
        "updated": 0,
        "archived": 0,
        "errors": 0,
    }

    db = SessionLocal()
    try:
        logger.info("sync_dislocation_to_tracking: started")
        results = _fetch_last_events(db)
        stats["last_events"] = len(results)
        logger.info("sync_dislocation_to_tracking: last_events=%s", stats["last_events"])

        for row in results:
            try:
                op_code = row.get("operation_code_railway_carriage")
                archived = is_archive_operation(op_code)
                should_be_active = not archived

                track_entry = (
                    db.query(TrackingWagon)
                    .filter(
                        TrackingWagon.railway_carriage_number == row["railway_carriage_number"],
                        TrackingWagon.flight_start_date == row["flight_start_date"],
                    )
                    .first()
                )

                row_dt = row.get("date_time_of_operation")

                if not track_entry:
                    db.add(
                        TrackingWagon(
                            railway_carriage_number=row["railway_carriage_number"],
                            flight_start_date=row["flight_start_date"],
                            current_station_name=row.get("st_name"),
                            current_operation_name=row.get("op_name"),
                            last_operation_date=row_dt,
                            is_active=should_be_active,
                        )
                    )
                    stats["created"] += 1
                    if archived:
                        stats["archived"] += 1
                    continue

                # Обновляем только если событие свежее (или если last_operation_date ещё пустой).
                # is_active пересчитываем строго от последнего события.
                if track_entry.last_operation_date is None or (row_dt and row_dt > track_entry.last_operation_date):
                    track_entry.current_station_name = row.get("st_name")
                    track_entry.current_operation_name = row.get("op_name")
                    track_entry.last_operation_date = row_dt
                    track_entry.is_active = should_be_active
                    stats["updated"] += 1
                    if archived:
                        stats["archived"] += 1
                else:
                    # Даже если дата не новее, на всякий случай поддерживаем идемпотентность статуса
                    track_entry.is_active = should_be_active
            except Exception:
                stats["errors"] += 1
                logger.exception("sync_dislocation_to_tracking: row processing error")

        db.commit()
        logger.info(
            "sync_dislocation_to_tracking: done created=%s updated=%s archived=%s errors=%s",
            stats["created"],
            stats["updated"],
            stats["archived"],
            stats["errors"],
        )
        return stats
    finally:
        db.close()


def rebuild_tracking_from_dislocation():
    db = SessionLocal()
    try:
        logger.info("rebuild_tracking_from_dislocation: started")
        # Служебная пересборка: чистим витрину. Комментарии привязаны FK к tracking_wagons,
        # поэтому удаляем их первыми, чтобы не упасть на constraint.
        deleted_comments = db.query(WagonComment).delete()
        deleted = db.query(TrackingWagon).delete()
        db.commit()
        logger.info(
            "rebuild_tracking_from_dislocation: cleared deleted_tracking=%s deleted_comments=%s",
            deleted,
            deleted_comments,
        )
    finally:
        db.close()

    stats = sync_dislocation_to_tracking()
    active = 0
    archived = 0
    db = SessionLocal()
    try:
        active = db.query(TrackingWagon).filter(TrackingWagon.is_active == True).count()
        archived = db.query(TrackingWagon).filter(TrackingWagon.is_active == False).count()
    finally:
        db.close()

    return {
        "deleted": deleted,
        "deleted_comments": deleted_comments,
        "created": stats.get("created", 0),
        "updated": stats.get("updated", 0),
        "active": active,
        "archived": archived,
        "errors": stats.get("errors", 0),
        "last_events": stats.get("last_events", 0),
    }

def start_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(sync_dislocation_to_tracking, 'interval', minutes=10)
    scheduler.start()