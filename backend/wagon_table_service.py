"""
Сервис подготовки данных таблицы вагонов.
Получает данные с number_train, train_index, last_comment_text без N+1.
Использует railway_station.esr_code для JOIN (код ЕСР станции).
"""
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import ProgrammingError
from typing import List, Tuple
from schemas import TrackingWagonTableRowOut

logger = logging.getLogger(__name__)


# Запрос с расширенными полями из dislocation
QUERY_FULL = text("""
    WITH LastEvents AS (
        SELECT
            d.railway_carriage_number,
            d.flight_start_date,
            d.number_train,
            d.train_index,
            rs.name as station_name,
            rs_dest.name as destination_station_name,
            rs_dep.name as departure_station_name,
            d.waybill_number,
            d.type_railway_carriage,
            d.owners_administration,
            d.remaining_mileage,
            d.remaining_distance,
            TRIM(BOTH ', ' FROM CONCAT_WS(', ',
                NULLIF(TRIM(COALESCE(d.container_number1,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number2,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number3,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number4,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number5,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number6,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number7,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number8,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number9,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number10,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number11,'')),''),
                NULLIF(TRIM(COALESCE(d.container_number12,'')),'')
            )) as container_numbers,
            ROW_NUMBER() OVER (
                PARTITION BY d.railway_carriage_number, d.flight_start_date::timestamptz
                ORDER BY d.date_time_of_operation::timestamptz DESC NULLS LAST
            ) as rn
        FROM dislocation d
        LEFT JOIN railway_station rs ON d.station_code_performing_operation::text = rs.esr_code
        LEFT JOIN railway_station rs_dest ON d.destination_station_code::text = rs_dest.esr_code
        LEFT JOIN railway_station rs_dep ON d.flight_start_station_code::text = rs_dep.esr_code
    ),
    LastComments AS (
        SELECT
            tracking_id,
            comment_text as last_comment_text,
            ROW_NUMBER() OVER (PARTITION BY tracking_id ORDER BY created_at DESC) as rn
        FROM wagon_comments
    )
    SELECT DISTINCT ON (tw.railway_carriage_number)
        tw.id,
        tw.railway_carriage_number,
        tw.flight_start_date,
        COALESCE(le.station_name, tw.current_station_name) as current_station_name,
        tw.current_operation_name,
        tw.last_operation_date,
        tw.is_active,
        le.number_train,
        le.train_index,
        lc.last_comment_text,
        le.remaining_distance,
        le.remaining_mileage,
        le.waybill_number,
        le.type_railway_carriage,
        le.owners_administration,
        le.container_numbers,
        le.destination_station_name,
        le.departure_station_name
    FROM tracking_wagons tw
    LEFT JOIN (
        SELECT railway_carriage_number, flight_start_date::timestamptz AS fs_ts,
            number_train, train_index, station_name,
            destination_station_name, departure_station_name, waybill_number, type_railway_carriage,
            owners_administration, remaining_mileage, remaining_distance, container_numbers
        FROM LastEvents WHERE rn = 1
    ) le ON tw.railway_carriage_number = le.railway_carriage_number
        AND tw.flight_start_date IS NOT DISTINCT FROM le.fs_ts
    LEFT JOIN (
        SELECT tracking_id, last_comment_text
        FROM LastComments WHERE rn = 1
    ) lc ON tw.id = lc.tracking_id
    WHERE tw.is_active = :is_active
    ORDER BY tw.railway_carriage_number, tw.last_operation_date DESC NULLS LAST
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
    SELECT DISTINCT ON (tw.railway_carriage_number)
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
    ORDER BY tw.railway_carriage_number, tw.last_operation_date DESC NULLS LAST
""")


def get_table_wagons(db: Session, is_active: bool) -> Tuple[List[TrackingWagonTableRowOut], str | None]:
    """
    Возвращает (список строк, error_message).
    error_message is None при успехе; при ошибке — текст для пользователя, исключение не глотается.
    """
    try:
        try:
            rows = db.execute(QUERY_FULL, {"is_active": is_active}).mappings().all()
        except ProgrammingError as e:
            db.rollback()
            logger.info("get_table_wagons: full query failed (%s), using fallback", str(e)[:150])
            rows = db.execute(QUERY_FALLBACK, {"is_active": is_active}).mappings().all()

        return (
            [
                TrackingWagonTableRowOut(
                    id=row["id"],
                    railway_carriage_number=row["railway_carriage_number"],
                    flight_start_date=row["flight_start_date"],
                    current_station_name=row["current_station_name"],
                    current_operation_name=row["current_operation_name"],
                    last_operation_date=row["last_operation_date"],
                    is_active=row["is_active"],
                    number_train=row.get("number_train"),
                    train_index=row.get("train_index"),
                    last_comment_text=row.get("last_comment_text"),
                    remaining_distance=row.get("remaining_distance"),
                    remaining_mileage=row.get("remaining_mileage"),
                    waybill_number=row.get("waybill_number"),
                    type_railway_carriage=row.get("type_railway_carriage"),
                    owners_administration=row.get("owners_administration"),
                    container_numbers=row.get("container_numbers"),
                    destination_station_name=row.get("destination_station_name"),
                    departure_station_name=row.get("departure_station_name"),
                )
                for row in rows
            ],
            None,
        )
    except Exception as e:
        logger.exception("get_table_wagons failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return ([], f"Ошибка загрузки таблицы: {e!s}")
