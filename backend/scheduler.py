from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text
from database import SessionLocal
from models import TrackingWagon
import logging

def sync_dislocation_to_tracking():
    db = SessionLocal()
    try:
        # Получаем последнее событие по каждому вагону
        query = text("""
            WITH LastEvents AS (
                SELECT d.railway_carriage_number, d.flight_start_date, d.date_time_of_operation,
                       d.operation_code_railway_carriage, rs.name as st_name, oc.name as op_name,
                       ROW_NUMBER() OVER (PARTITION BY d.railway_carriage_number ORDER BY d.date_time_of_operation DESC) as rn
                FROM dislocation d
                LEFT JOIN railway_station rs ON d.station_code_performing_operation = rs.code
                LEFT JOIN operation_code oc ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
            )
            SELECT * FROM LastEvents WHERE rn = 1
        """)
        results = db.execute(query).mappings().all()
        
        for row in results:
            is_unloaded = (row['operation_code_railway_carriage'] == '20') # Операция выгрузки
            
            track_entry = db.query(TrackingWagon).filter(
                TrackingWagon.railway_carriage_number == row['railway_carriage_number'],
                TrackingWagon.flight_start_date == row['flight_start_date']
            ).first()

            if not track_entry and not is_unloaded:
                db.add(TrackingWagon(
                    railway_carriage_number=row['railway_carriage_number'],
                    flight_start_date=row['flight_start_date'],
                    current_station_name=row['st_name'],
                    current_operation_name=row['op_name'],
                    last_operation_date=row['date_time_of_operation']
                ))
            elif track_entry and row['date_time_of_operation'] > track_entry.last_operation_date:
                track_entry.current_station_name = row['st_name']
                track_entry.current_operation_name = row['op_name']
                track_entry.last_operation_date = row['date_time_of_operation']
                if is_unloaded: track_entry.is_active = False
        db.commit()
    finally:
        db.close()

def start_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(sync_dislocation_to_tracking, 'interval', minutes=10)
    scheduler.start()