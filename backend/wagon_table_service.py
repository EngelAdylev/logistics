"""
Сервис подготовки данных таблицы вагонов.
Получает данные с number_train, train_index, last_comment_text без N+1.
"""
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import ProgrammingError
from typing import List
from schemas import TrackingWagonTableRowOut

logger = logging.getLogger(__name__)

# Запрос с number_train, train_index, current_station_name из railway_station (сравнение по первым 5 цифрам)
QUERY_FULL = text("""
    WITH LastEvents AS (
        SELECT
            d.railway_carriage_number,
            d.flight_start_date,
            d.number_train,
            d.train_index,
            rs.name as station_name,
            ROW_NUMBER() OVER (
                PARTITION BY d.railway_carriage_number, d.flight_start_date
                ORDER BY d.date_time_of_operation DESC NULLS LAST
            ) as rn
        FROM dislocation d
        LEFT JOIN railway_station rs ON d.station_code_performing_operation::text = rs.esr_code
    ),
    LastComments AS (
        SELECT
            tracking_id,
            comment_text as last_comment_text,
            ROW_NUMBER() OVER (PARTITION BY tracking_id ORDER BY created_at DESC) as rn
        FROM wagon_comments
    )
    SELECT
        tw.id,
        tw.railway_carriage_number,
        tw.flight_start_date,
        COALESCE(le.station_name, tw.current_station_name) as current_station_name,
        tw.current_operation_name,
        tw.last_operation_date,
        tw.is_active,
        le.number_train,
        le.train_index,
        lc.last_comment_text
    FROM tracking_wagons tw
    LEFT JOIN (
        SELECT railway_carriage_number, flight_start_date, number_train, train_index, station_name
        FROM LastEvents WHERE rn = 1
    ) le ON tw.railway_carriage_number = le.railway_carriage_number
        AND tw.flight_start_date IS NOT DISTINCT FROM le.flight_start_date::timestamptz
    LEFT JOIN (
        SELECT tracking_id, last_comment_text
        FROM LastComments WHERE rn = 1
    ) lc ON tw.id = lc.tracking_id
    WHERE tw.is_active = :is_active
    ORDER BY tw.railway_carriage_number, tw.flight_start_date
""")

# Запрос без number_train, train_index (fallback, когда колонок нет в dislocation)
QUERY_FALLBACK = text("""
    WITH LastComments AS (
        SELECT
            tracking_id,
            comment_text as last_comment_text,
            ROW_NUMBER() OVER (PARTITION BY tracking_id ORDER BY created_at DESC) as rn
        FROM wagon_comments
    )
    SELECT
        tw.id,
        tw.railway_carriage_number,
        tw.flight_start_date,
        tw.current_station_name,
        tw.current_operation_name,
        tw.last_operation_date,
        tw.is_active,
        NULL::text as number_train,
        NULL::text as train_index,
        lc.last_comment_text
    FROM tracking_wagons tw
    LEFT JOIN (
        SELECT tracking_id, last_comment_text
        FROM LastComments WHERE rn = 1
    ) lc ON tw.id = lc.tracking_id
    WHERE tw.is_active = :is_active
    ORDER BY tw.railway_carriage_number, tw.flight_start_date
""")


def get_table_wagons(db: Session, is_active: bool) -> List[TrackingWagonTableRowOut]:
    """
    Возвращает строки таблицы вагонов с number_train, train_index, last_comment_text.
    Один запрос, без N+1. Использует fallback, если в dislocation нет number_train/train_index.
    """
    try:
        rows = db.execute(QUERY_FULL, {"is_active": is_active}).mappings().all()
    except ProgrammingError as e:
        db.rollback()
        if "number_train" in str(e) or "train_index" in str(e) or "column" in str(e).lower():
            logger.info("dislocation lacks number_train/train_index, using fallback query")
            rows = db.execute(QUERY_FALLBACK, {"is_active": is_active}).mappings().all()
        else:
            raise

    return [
        TrackingWagonTableRowOut(
            id=row["id"],
            railway_carriage_number=row["railway_carriage_number"],
            flight_start_date=row["flight_start_date"],
            current_station_name=row["current_station_name"],
            current_operation_name=row["current_operation_name"],
            last_operation_date=row["last_operation_date"],
            is_active=row["is_active"],
            number_train=row["number_train"],
            train_index=row["train_index"],
            last_comment_text=row["last_comment_text"],
        )
        for row in rows
    ]
