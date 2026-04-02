"""
Роутер «Поезда» — только для поставки (destination_station_code = 648400).

Эндпоинты:
  GET  /v2/trains                    — список активных поездов
  GET  /v2/routes/{route_id}         — маршрут + состав + заявки
  POST /v2/routes/{route_id}/orders  — создать заявку
  PATCH /v2/orders/{order_id}        — обновить заявку
  DELETE /v2/orders/{order_id}       — удалить заявку
  GET  /v2/routes/{route_id}/export  — JSON для 1С
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db
import models
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v2", tags=["trains"])

DELIVERY_STATION = "648400"


# ─── Pydantic schemas ──────────────────────────────────────────────────────────

class OrderCreate(BaseModel):
    waybill_id: UUID
    client_name: Optional[str] = None
    contract_number: Optional[str] = None
    status: Optional[str] = "new"
    comment: Optional[str] = None


class OrderUpdate(BaseModel):
    client_name: Optional[str] = None
    contract_number: Optional[str] = None
    status: Optional[str] = None
    comment: Optional[str] = None


def _order_out(o: models.ReceivingOrder) -> dict:
    return {
        "id": str(o.id),
        "route_id": str(o.route_id),
        "waybill_id": str(o.waybill_id) if o.waybill_id else None,
        "waybill_number": o.waybill.waybill_number if o.waybill else None,
        "client_name": o.client_name or "",
        "contract_number": o.contract_number or "",
        "status": o.status or "new",
        "comment": o.comment or "",
        "created_by": o.created_by or "",
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
    }


# ─── POST /v2/routes/snapshot-debug ──────────────────────────────────────────

@router.post("/routes/snapshot-debug")
def snapshot_debug(
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """
    Диагностика: показывает какие поезда готовы к созданию болванки
    и пытается их создать. Возвращает подробный результат/ошибку.
    """
    import traceback
    try:
        rows = db.execute(text("""
            SELECT
                wt.number_train,
                wt.train_index,
                MIN(
                    CASE WHEN wt.remaining_distance ~ '^[0-9]+$'
                    THEN wt.remaining_distance::int ELSE NULL END
                ) AS min_km,
                json_agg(json_build_object(
                    'trip_id',            wt.id::text,
                    'wagon_number',       w.railway_carriage_number,
                    'waybill_id',         tw.waybill_id::text,
                    'waybill_number',     ew.waybill_number,
                    'consignee_name',     ew.consignee_name,
                    'shipper_name',       ew.shipper_name,
                    'cargo_name',         eww.cargo_name,
                    'remaining_distance', wt.remaining_distance,
                    'last_station_name',  wt.last_station_name,
                    'last_operation_name', wt.last_operation_name
                ) ORDER BY w.railway_carriage_number) AS snapshot
            FROM wagon_trips wt
            JOIN wagons w ON w.id = wt.wagon_id
            LEFT JOIN trip_waybills tw ON tw.wagon_trip_id = wt.id
            LEFT JOIN etran_waybills ew ON ew.id = tw.waybill_id
            LEFT JOIN etran_waybill_wagons eww
                   ON eww.waybill_id = ew.id
                  AND eww.railway_carriage_number = w.railway_carriage_number
            WHERE wt.is_active = true
              AND wt.number_train IS NOT NULL
              AND TRIM(COALESCE(wt.destination_station_code, '')) = :dst
            GROUP BY wt.number_train, wt.train_index
            HAVING MIN(
                CASE WHEN wt.remaining_distance ~ '^[0-9]+$'
                THEN wt.remaining_distance::int ELSE NULL END
            ) <= 150
        """), {"dst": DELIVERY_STATION}).mappings().all()

        candidates = [{"train_number": r["number_train"], "min_km": r["min_km"]} for r in rows]
        created = []
        skipped = []

        for row in rows:
            existing = db.query(models.RailwayRoute).filter_by(
                train_number=row["number_train"]
            ).first()
            if existing:
                skipped.append(row["number_train"])
            else:
                route = models.RailwayRoute(
                    train_number=row["number_train"],
                    train_index=row["train_index"],
                    snapshot_data=row["snapshot"],
                    status="open",
                )
                db.add(route)
                created.append(row["number_train"])

        if created:
            db.commit()

        return {
            "candidates": candidates,
            "created": created,
            "skipped": skipped,
            "error": None,
        }
    except Exception as e:
        db.rollback()
        return {
            "candidates": [],
            "created": [],
            "skipped": [],
            "error": traceback.format_exc(),
        }


# ─── GET /v2/trains ────────────────────────────────────────────────────────────

@router.get("/trains")
def list_trains(
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """
    Список активных поездов, везущих груз в 648400 (поставка).
    Данные считаются на лету по wagon_trips.
    Добавляет route_id если для поезда уже создана болванка.
    """
    rows = db.execute(text("""
        SELECT
            wt.number_train,
            wt.train_index,
            COUNT(*)                                        AS wagon_total,
            COUNT(tw.waybill_id)                           AS matched_wagons,
            MIN(
                CASE
                    WHEN wt.remaining_distance ~ '^[0-9]+$'
                    THEN wt.remaining_distance::int
                    ELSE NULL
                END
            )                                              AS min_km,
            r.id                                           AS route_id,
            r.status                                       AS route_status
        FROM wagon_trips wt
        LEFT JOIN trip_waybills tw ON tw.wagon_trip_id = wt.id
        LEFT JOIN railway_routes r  ON r.train_number  = wt.number_train
        WHERE wt.is_active = true
          AND wt.number_train IS NOT NULL
          AND TRIM(COALESCE(wt.destination_station_code, '')) = :dst
        GROUP BY wt.number_train, wt.train_index, r.id, r.status
        ORDER BY min_km ASC NULLS LAST
    """), {"dst": DELIVERY_STATION}).mappings().all()

    result = []
    for r in rows:
        result.append({
            "train_number": r["number_train"],
            "train_index": r["train_index"] or "",
            "wagon_total": r["wagon_total"],
            "matched_wagons": r["matched_wagons"],
            "min_km": r["min_km"],
            "ready": r["min_km"] is not None and r["min_km"] <= 150,
            "route_id": str(r["route_id"]) if r["route_id"] else None,
            "route_status": r["route_status"],
        })
    return {"items": result, "total": len(result)}


# ─── GET /v2/routes/{route_id} ────────────────────────────────────────────────

@router.get("/routes/{route_id}")
def get_route(
    route_id: UUID,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """Маршрут: снимок состава + список уже созданных заявок."""
    route = db.query(models.RailwayRoute).filter(models.RailwayRoute.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    # Если snapshot ещё не сформирован — берём живые данные
    snapshot = route.snapshot_data or _build_snapshot(db, route.train_number)

    orders_by_waybill = {str(o.waybill_id): _order_out(o) for o in route.orders if o.waybill_id}

    wagons_out = []
    for item in snapshot:
        wb_id = item.get("waybill_id")
        wagons_out.append({
            **item,
            "order": orders_by_waybill.get(str(wb_id)) if wb_id else None,
        })

    return {
        "id": str(route.id),
        "train_number": route.train_number,
        "train_index": route.train_index or "",
        "status": route.status,
        "created_at": route.created_at.isoformat() if route.created_at else None,
        "wagons": wagons_out,
        "orders": [_order_out(o) for o in route.orders],
    }


def _build_snapshot(db: Session, train_number: str) -> list:
    """Строит снимок состава поезда из живых данных wagon_trips."""
    rows = db.execute(text("""
        SELECT
            wt.id           AS trip_id,
            w.railway_carriage_number AS wagon_number,
            wt.remaining_distance,
            wt.last_station_name,
            wt.last_operation_name,
            tw.waybill_id,
            ew.waybill_number,
            ew.consignee_name,
            ew.shipper_name,
            eww.cargo_name
        FROM wagon_trips wt
        JOIN wagons w ON w.id = wt.wagon_id
        LEFT JOIN trip_waybills tw ON tw.wagon_trip_id = wt.id
        LEFT JOIN etran_waybills ew ON ew.id = tw.waybill_id
        LEFT JOIN etran_waybill_wagons eww
               ON eww.waybill_id = ew.id
              AND eww.railway_carriage_number = w.railway_carriage_number
        WHERE wt.is_active = true
          AND wt.number_train = :tn
          AND TRIM(COALESCE(wt.destination_station_code, '')) = :dst
        ORDER BY w.railway_carriage_number
    """), {"tn": train_number, "dst": DELIVERY_STATION}).mappings().all()

    return [
        {
            "trip_id": str(r["trip_id"]),
            "wagon_number": r["wagon_number"],
            "remaining_distance": r["remaining_distance"],
            "last_station_name": r["last_station_name"] or "",
            "last_operation_name": r["last_operation_name"] or "",
            "waybill_id": str(r["waybill_id"]) if r["waybill_id"] else None,
            "waybill_number": r["waybill_number"] or "",
            "consignee_name": r["consignee_name"] or "",
            "shipper_name": r["shipper_name"] or "",
            "cargo_name": r["cargo_name"] or "",
        }
        for r in rows
    ]


# ─── POST /v2/routes/{route_id}/orders ───────────────────────────────────────

@router.post("/routes/{route_id}/orders")
def create_order(
    route_id: UUID,
    body: OrderCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    route = db.query(models.RailwayRoute).filter(models.RailwayRoute.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    # Один заказ на накладную в рамках маршрута
    existing = db.query(models.ReceivingOrder).filter(
        models.ReceivingOrder.route_id == route_id,
        models.ReceivingOrder.waybill_id == body.waybill_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Заявка для этой накладной уже существует")

    order = models.ReceivingOrder(
        route_id=route_id,
        waybill_id=body.waybill_id,
        client_name=body.client_name,
        contract_number=body.contract_number,
        status=body.status or "new",
        comment=body.comment,
        created_by=user.login,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _order_out(order)


# ─── PATCH /v2/orders/{order_id} ─────────────────────────────────────────────

@router.patch("/orders/{order_id}")
def update_order(
    order_id: UUID,
    body: OrderUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    order = db.query(models.ReceivingOrder).filter(models.ReceivingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    if body.client_name is not None:
        order.client_name = body.client_name
    if body.contract_number is not None:
        order.contract_number = body.contract_number
    if body.status is not None:
        order.status = body.status
    if body.comment is not None:
        order.comment = body.comment

    db.commit()
    db.refresh(order)
    return _order_out(order)


# ─── DELETE /v2/orders/{order_id} ────────────────────────────────────────────

@router.delete("/orders/{order_id}")
def delete_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    order = db.query(models.ReceivingOrder).filter(models.ReceivingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    db.delete(order)
    db.commit()
    return {"ok": True}


# ─── GET /v2/routes/{route_id}/export ────────────────────────────────────────

@router.get("/routes/{route_id}/export")
def export_route(
    route_id: UUID,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """Экспорт заявок маршрута в JSON для передачи в 1С."""
    route = db.query(models.RailwayRoute).filter(models.RailwayRoute.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    export = {
        "train_number": route.train_number,
        "train_index": route.train_index or "",
        "route_id": str(route.id),
        "created_at": route.created_at.isoformat() if route.created_at else None,
        "orders": [],
    }
    for o in route.orders:
        wb = o.waybill
        export["orders"].append({
            "order_id": str(o.id),
            "waybill_number": wb.waybill_number if wb else "",
            "client_name": o.client_name or "",
            "contract_number": o.contract_number or "",
            "status": o.status or "new",
            "comment": o.comment or "",
            "consignee_name": wb.consignee_name if wb else "",
            "shipper_name": wb.shipper_name if wb else "",
            "cargo_name": wb.cargo_name if wb else "",
        })

    # Помечаем маршрут закрытым после экспорта
    route.status = "closed"
    db.commit()

    return export
