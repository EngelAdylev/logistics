"""
Роутер «Поезда» — только для поставки (destination_station_code = 648400).

Эндпоинты:
  POST /v2/routes/snapshot-debug       — диагностика создания болванок
  GET  /v2/trains                      — список активных поездов
  GET  /v2/routes/{route_id}           — маршрут + состав + заявки
  POST /v2/routes/{route_id}/orders    — создать заявку (с несколькими вагонами)
  PATCH /v2/orders/{order_id}          — обновить шапку заявки
  DELETE /v2/orders/{order_id}         — удалить заявку целиком
  POST /v2/orders/{order_id}/items     — добавить вагон в существующую заявку
  DELETE /v2/order-items/{item_id}     — убрать вагон из заявки
  GET  /v2/routes/{route_id}/export    — JSON для 1С
"""
import logging
from typing import List, Optional
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

class OrderItemInput(BaseModel):
    wagon_number: str
    waybill_id: Optional[UUID] = None
    container_number: Optional[str] = None


class OrderCreate(BaseModel):
    client_name: Optional[str] = None
    contract_number: Optional[str] = None
    status: Optional[str] = "new"
    comment: Optional[str] = None
    items: List[OrderItemInput] = []


class OrderUpdate(BaseModel):
    client_name: Optional[str] = None
    contract_number: Optional[str] = None
    status: Optional[str] = None
    comment: Optional[str] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _item_out(item: models.ReceivingOrderItem) -> dict:
    return {
        "id": str(item.id),
        "order_id": str(item.order_id),
        "wagon_number": item.wagon_number,
        "waybill_id": str(item.waybill_id) if item.waybill_id else None,
        "waybill_number": item.waybill.waybill_number if item.waybill else None,
        "container_number": item.container_number or "",
    }


def _order_out(o: models.ReceivingOrder) -> dict:
    return {
        "id": str(o.id),
        "order_number": o.order_number,
        "route_id": str(o.route_id),
        "client_name": o.client_name or "",
        "contract_number": o.contract_number or "",
        "status": o.status or "new",
        "comment": o.comment or "",
        "created_by": o.created_by or "",
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        "items": [_item_out(i) for i in o.items],
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
                    'container_number',   eww.container_number,
                    'consignee_name',     ew.consignee_name,
                    'shipper_name',       ew.shipper_name,
                    'cargo_name',         eww.cargo_name,
                    'remaining_distance', wt.remaining_distance,
                    'last_station_name',  wt.last_station_name,
                    'last_operation_name', wt.last_operation_name
                ) ORDER BY w.railway_carriage_number, ew.waybill_number) AS snapshot
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
    Включает LIVE-данные: текущую станцию и последнюю операцию (обновляются при синхе).
    """
    rows = db.execute(text("""
        SELECT
            wt.number_train,
            wt.train_index,
            COUNT(DISTINCT w.id)                           AS wagon_total,
            COUNT(DISTINCT CASE WHEN tw.waybill_id IS NOT NULL THEN w.id END) AS matched_wagons,
            COUNT(
                DISTINCT CASE
                    WHEN NULLIF(BTRIM(eww.container_number), '') IS NOT NULL
                    THEN NULLIF(BTRIM(eww.container_number), '')
                    ELSE NULL
                END
            ) AS container_count,
            MIN(
                CASE
                    WHEN wt.remaining_distance ~ '^[0-9]+$'
                    THEN wt.remaining_distance::int
                    ELSE NULL
                END
            )                                              AS min_km,
            MAX(wt.last_operation_date)                    AS last_operation_date,
            (ARRAY_AGG(wt.last_operation_name ORDER BY wt.last_operation_date DESC NULLS LAST))[1] AS last_operation_name,
            (ARRAY_AGG(wt.last_station_name ORDER BY wt.last_operation_date DESC NULLS LAST))[1] AS last_station_name,
            r.id                                           AS route_id,
            r.status                                       AS route_status
        FROM wagon_trips wt
        JOIN wagons w ON w.id = wt.wagon_id
        LEFT JOIN trip_waybills tw ON tw.wagon_trip_id = wt.id
        LEFT JOIN etran_waybills ew ON ew.id = tw.waybill_id
        LEFT JOIN etran_waybill_wagons eww ON eww.waybill_id = ew.id AND eww.railway_carriage_number = w.railway_carriage_number
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
            "container_count": r["container_count"] or 0,
            "min_km": r["min_km"],
            "last_operation_date": r["last_operation_date"].isoformat() if r["last_operation_date"] else None,
            "last_operation_name": r["last_operation_name"] or "",
            "last_station_name": r["last_station_name"] or "",
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
    """Маршрут: снимок состава + список заявок с вложенными строками."""
    route = db.query(models.RailwayRoute).filter(models.RailwayRoute.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    # Для открытых маршрутов всегда берём живые данные — правильная разбивка
    # по (вагон + накладная + КТК). Для закрытых — живые данные если вагоны ещё
    # активны, иначе сохранённый снапшот.
    live = _build_snapshot(db, route.train_number)
    if live:
        snapshot = live
    else:
        snapshot = route.snapshot_data or []

    # Строим карту: ключ → {order, item_id}
    # Ключ = "wb:{waybill_id}:ktk:{container}" если есть накладная+КТК
    #         "wb:{waybill_id}:"                если накладная без КТК (порожний)
    #         "wagon:{wagon_number}"            если нет накладной
    def _item_key(waybill_id, container_number, wagon_number):
        if waybill_id and container_number:
            return f"wb:{waybill_id}:ktk:{container_number}"
        if waybill_id:
            return f"wb:{waybill_id}:wagon:{wagon_number}"
        return f"wagon:{wagon_number}"

    item_order_map: dict = {}
    for order in route.orders:
        for item in order.items:
            key = _item_key(
                str(item.waybill_id) if item.waybill_id else None,
                item.container_number,
                item.wagon_number,
            )
            item_order_map[key] = {
                "order": _order_out(order),
                "item_id": str(item.id),
            }

    wagons_out = []
    for snap in snapshot:
        wb_id = snap.get("waybill_id")
        key = _item_key(wb_id, snap.get("container_number"), snap.get("wagon_number"))
        assigned = item_order_map.get(key)
        wagons_out.append({
            **snap,
            "order": assigned["order"] if assigned else None,
            "item_id": assigned["item_id"] if assigned else None,
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
    """Строит снимок состава поезда из живых данных wagon_trips.
    Одна строка = один (вагон + накладная). Вагон с 2 накладными → 2 строки.
    Вагон без накладной → 1 строка с waybill_id=null.

    Собирает полные данные из:
    - wagon_trips (базовые данные рейса)
    - etran_waybills (накладная)
    - etran_waybill_wagons (вагон в накладной с техническими данными)
    - wagon_entity_comments (комментарии к вагонам)
    """
    rows = db.execute(text("""
        SELECT
            wt.id                              AS trip_id,
            w.id                               AS wagon_id,
            w.railway_carriage_number         AS wagon_number,
            wt.remaining_distance,
            wt.last_station_name,
            wt.last_operation_name,
            wt.departure_station_name,
            wt.destination_station_name,
            tw.waybill_id,
            ew.waybill_number,
            ew.consignee_name,
            ew.shipper_name,
            eww.cargo_name,
            eww.cargo_weight,
            eww.container_number,
            eww.lifting_capacity,
            eww.ownership,
            eww.weight_net,
            eww.zpu_number,
            eww.zpu_type,
            eww.wagon_model,
            eww.axles_count,
            eww.renter,
            eww.next_repair_date,
            (SELECT comment_text FROM wagon_entity_comments
             WHERE wagon_id = w.id ORDER BY created_at DESC LIMIT 1) AS last_comment_text,
            (SELECT author_name FROM wagon_entity_comments
             WHERE wagon_id = w.id ORDER BY created_at DESC LIMIT 1) AS last_comment_author
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
        ORDER BY w.railway_carriage_number, ew.waybill_number
    """), {"tn": train_number, "dst": DELIVERY_STATION}).mappings().all()

    return [
        {
            "trip_id": str(r["trip_id"]),
            "wagon_id": str(r["wagon_id"]),
            "wagon_number": r["wagon_number"],
            "remaining_distance": r["remaining_distance"],
            "last_station_name": r["last_station_name"] or "",
            "last_operation_name": r["last_operation_name"] or "",
            "departure_station_name": r["departure_station_name"] or "",
            "destination_station_name": r["destination_station_name"] or "",
            "waybill_id": str(r["waybill_id"]) if r["waybill_id"] else None,
            "waybill_number": r["waybill_number"] or "",
            "container_number": r["container_number"] or "",
            "shipper_name": r["shipper_name"] or "",
            "consignee_name": r["consignee_name"] or "",
            "cargo_name": r["cargo_name"] or "",
            "cargo_weight": r["cargo_weight"] or "",
            "lifting_capacity": r["lifting_capacity"] or "",
            "ownership": r["ownership"] or "",
            "weight_net": r["weight_net"] or "",
            "zpu_number": r["zpu_number"] or "",
            "zpu_type": r["zpu_type"] or "",
            "wagon_model": r["wagon_model"] or "",
            "axles_count": r["axles_count"],
            "renter": r["renter"] or "",
            "next_repair_date": r["next_repair_date"],
            "last_comment_text": r["last_comment_text"] or "",
            "last_comment_author": r["last_comment_author"] or "",
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
    """Создать заявку с набором вагонов (items)."""
    route = db.query(models.RailwayRoute).filter(models.RailwayRoute.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    if not body.items:
        raise HTTPException(status_code=422, detail="Необходимо выбрать хотя бы одну накладную")

    # Проверить что ни одна строка уже не занята другой заявкой
    for it in body.items:
        if it.waybill_id:
            q = db.query(models.ReceivingOrderItem).filter(
                models.ReceivingOrderItem.route_id == route_id,
                models.ReceivingOrderItem.waybill_id == it.waybill_id,
            )
            if it.container_number:
                q = q.filter(models.ReceivingOrderItem.container_number == it.container_number)
            else:
                # без контейнера — уникальность по (waybill_id + wagon_number)
                q = q.filter(
                    models.ReceivingOrderItem.container_number.is_(None),
                    models.ReceivingOrderItem.wagon_number == it.wagon_number,
                )
            if q.first():
                raise HTTPException(status_code=409,
                    detail="Эта накладная/КТК уже входит в другую заявку")
        else:
            if db.query(models.ReceivingOrderItem).filter(
                models.ReceivingOrderItem.route_id == route_id,
                models.ReceivingOrderItem.waybill_id.is_(None),
                models.ReceivingOrderItem.wagon_number == it.wagon_number,
            ).first():
                raise HTTPException(status_code=409,
                    detail=f"Вагон {it.wagon_number} (без накладной) уже в другой заявке")

    order = models.ReceivingOrder(
        route_id=route_id,
        client_name=body.client_name,
        contract_number=body.contract_number,
        status=body.status or "new",
        comment=body.comment,
        created_by=user.login,
    )
    db.add(order)
    db.flush()  # получаем order.id

    for it in body.items:
        db.add(models.ReceivingOrderItem(
            order_id=order.id,
            route_id=route_id,
            waybill_id=it.waybill_id,
            wagon_number=it.wagon_number,
            container_number=it.container_number or None,
        ))

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
    """Обновить шапку заявки (клиент, договор, статус, комментарий)."""
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
    """Удалить заявку целиком (все строки каскадно)."""
    order = db.query(models.ReceivingOrder).filter(models.ReceivingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    db.delete(order)
    db.commit()
    return {"ok": True}


# ─── POST /v2/orders/{order_id}/items ────────────────────────────────────────

@router.post("/orders/{order_id}/items")
def add_order_item(
    order_id: UUID,
    body: OrderItemInput,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """Добавить вагон в существующую заявку."""
    order = db.query(models.ReceivingOrder).filter(models.ReceivingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    if body.waybill_id:
        q = db.query(models.ReceivingOrderItem).filter(
            models.ReceivingOrderItem.route_id == order.route_id,
            models.ReceivingOrderItem.waybill_id == body.waybill_id,
        )
        if body.container_number:
            q = q.filter(models.ReceivingOrderItem.container_number == body.container_number)
        else:
            q = q.filter(
                models.ReceivingOrderItem.container_number.is_(None),
                models.ReceivingOrderItem.wagon_number == body.wagon_number,
            )
        conflict = q.first()
    else:
        conflict = db.query(models.ReceivingOrderItem).filter(
            models.ReceivingOrderItem.route_id == order.route_id,
            models.ReceivingOrderItem.waybill_id.is_(None),
            models.ReceivingOrderItem.wagon_number == body.wagon_number,
        ).first()
    if conflict:
        raise HTTPException(status_code=409,
            detail="Эта накладная/КТК уже входит в другую заявку")

    item = models.ReceivingOrderItem(
        order_id=order_id,
        route_id=order.route_id,
        waybill_id=body.waybill_id,
        wagon_number=body.wagon_number,
        container_number=body.container_number or None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


# ─── DELETE /v2/order-items/{item_id} ────────────────────────────────────────

@router.delete("/order-items/{item_id}")
def delete_order_item(
    item_id: UUID,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """Убрать вагон из заявки (удалить строку)."""
    item = db.query(models.ReceivingOrderItem).filter(models.ReceivingOrderItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Строка заявки не найдена")
    db.delete(item)
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
        order_data = {
            "order_id": str(o.id),
            "client_name": o.client_name or "",
            "contract_number": o.contract_number or "",
            "status": o.status or "new",
            "comment": o.comment or "",
            "wagons": [],
        }
        for item in o.items:
            wb = item.waybill
            order_data["wagons"].append({
                "wagon_number": item.wagon_number,
                "waybill_id": str(item.waybill_id) if item.waybill_id else None,
                "waybill_number": wb.waybill_number if wb else "",
                "consignee_name": wb.consignee_name if wb else "",
                "shipper_name": wb.shipper_name if wb else "",
            })
        export["orders"].append(order_data)

    # Помечаем маршрут закрытым после экспорта
    route.status = "closed"
    db.commit()

    return export
