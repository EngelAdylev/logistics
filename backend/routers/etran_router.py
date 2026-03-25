"""
Роутер для приёма данных ЭТРАН (накладные ГУ-27).
POST /etran/webhook — принимает JSON-пакет из DATAREON, дедуплицирует, upsert.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db
import models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/etran", tags=["etran"])


@router.get("/health")
def etran_health():
    """Проверка что роутер ЭТРАН зарегистрирован и работает."""
    return {"status": "ok", "service": "etran", "endpoint": "/etran/webhook"}


# Допустимые статусы — остальные отсеиваем
ALLOWED_STATUSES = {
    "в пути",
    "работа с документами окончена",
    "груз прибыл",
    "получатель уведомлен",
    "раскредитован",
}


def _parse_datetime(val) -> Optional[datetime]:
    """Парсим дату из JSON ЭТРАН. Возвращает None для пустых/нулевых дат."""
    if not val or val == "0001-01-01T00:00:00Z":
        return None
    try:
        if isinstance(val, str):
            # Поддерживаем формат ISO 8601
            val = val.replace("Z", "+00:00")
            return datetime.fromisoformat(val)
        return val
    except (ValueError, TypeError):
        return None


def _extract_waybill_data(waybill: dict) -> dict:
    """Извлекает плоские поля накладной из JSON."""
    return {
        "waybill_number": (waybill.get("waybill_number") or "").strip(),
        "waybill_identifier": (waybill.get("waybill_identifier") or "").strip(),
        "status": (waybill.get("waybill_status") or "").strip(),
        "departure_station_code": (waybill.get("departure_station_code") or "").strip(),
        "departure_station_name": (waybill.get("departure_station") or "").strip(),
        "destination_station_code": (waybill.get("destination_station_code") or "").strip(),
        "destination_station_name": (waybill.get("destination_station") or "").strip(),
        "shipper_name": (waybill.get("shipper_name") or "").strip(),
        "consignee_name": (waybill.get("consignee_name") or "").strip(),
        "consignee_address": (waybill.get("consignee_address") or "").strip(),
        "payer": (waybill.get("payer") or "").strip(),
        "payer_code": (waybill.get("payer_code") or "").strip(),
        "waybill_type": (waybill.get("waybill_type") or "").strip(),
        "shipment_type": (waybill.get("shipment_type") or "").strip(),
        "shipment_speed": (waybill.get("shipment_speed") or "").strip(),
        "form_type": (waybill.get("form_type") or "").strip(),
        "waybill_created_at": _parse_datetime(waybill.get("waybill_created_at")),
        "accepted_at": _parse_datetime(waybill.get("accepted_at")),
        "departure_at": _parse_datetime(waybill.get("departure_at")),
        "delivery_deadline": _parse_datetime(waybill.get("delivery_deadline")),
    }


def _extract_wagons(waybill: dict) -> list[dict]:
    """Извлекает вагоны + контейнеры из JSON накладной."""
    carriages = waybill.get("waybill_railway_carriage") or []
    containers = waybill.get("waybill_container") or []
    products = waybill.get("waybill_product") or []

    # Индексируем контейнеры по номеру вагона
    container_map = {}
    for c in containers:
        cn = (c.get("carriage_number") or "").strip()
        if cn:
            container_map[cn] = c

    # Первый продукт — для cargo_name / cargo_weight
    first_product = products[0] if products else {}

    result = []
    for carr in carriages:
        rn = (carr.get("railway_number") or "").strip()
        if not rn:
            continue
        cont = container_map.get(rn, {})
        result.append({
            "railway_carriage_number": rn,
            "lifting_capacity": str(carr.get("railway_lifting_capacity") or ""),
            "axles_count": carr.get("axles_count"),
            "ownership": (carr.get("ownership") or "").strip(),
            "weight_net": str(carr.get("railway_weight_net") or ""),
            "container_number": (cont.get("container_number") or "").strip(),
            "container_length": str(cont.get("container_length") or ""),
            "container_owner": (cont.get("owner") or "").strip(),
            "cargo_name": (first_product.get("etsng_name") or first_product.get("cargo_full_name") or "").strip(),
            "cargo_weight": str(first_product.get("cargo_weight") or ""),
        })
    return result


def _log_incoming(db: Session, message_id: str, waybill_number: str,
                  status: str, action: str, details: str = "", raw: dict = None):
    """Записывает в аудит-лог."""
    entry = models.EtranIncomingLog(
        message_id=message_id,
        waybill_number=waybill_number,
        status_received=status,
        action_taken=action,
        details=details,
        raw_payload=raw,
    )
    db.add(entry)


@router.post("/webhook")
async def etran_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Приём JSON-пакета ГУ-27 из DATAREON.
    Дедупликация по waybill_number: если накладная уже есть — обновляем статус.
    Всегда возвращает 200 OK (чтобы DATAREON не ретраил).
    """
    try:
        payload = await request.json()
    except Exception as e:
        logger.warning("etran_webhook: invalid JSON: %s", e)
        return {"status": "error", "message": "Invalid JSON", "processed": 0}

    message_id = payload.get("MessageID", "")
    gu27_list = payload.get("GU27") or []

    if not gu27_list:
        logger.info("etran_webhook: empty GU27 array, message_id=%s", message_id)
        return {"status": "ok", "message": "No GU27 data", "processed": 0}

    stats = {"processed": 0, "created": 0, "updated": 0, "skipped": 0, "filtered_out": 0}

    for item in gu27_list:
        waybill = item.get("waybill") or item  # на случай если структура без обёртки
        data = _extract_waybill_data(waybill)
        waybill_number = data["waybill_number"]
        status = data["status"]

        if not waybill_number:
            logger.warning("etran_webhook: empty waybill_number, skipping")
            continue

        stats["processed"] += 1

        # Фильтр по статусу
        if status.lower() not in ALLOWED_STATUSES:
            _log_incoming(db, message_id, waybill_number, status, "filtered_out",
                          f"Статус '{status}' не в допустимых")
            stats["filtered_out"] += 1
            continue

        # Ищем существующую накладную
        existing = db.query(models.EtranWaybill).filter(
            models.EtranWaybill.waybill_number == waybill_number
        ).first()

        if existing:
            # Проверяем изменился ли статус
            if existing.status == status:
                _log_incoming(db, message_id, waybill_number, status, "skipped",
                              f"Статус не изменился: '{status}'")
                stats["skipped"] += 1
                continue

            # Статус изменился — обновляем
            old_status = existing.status
            existing.status = status
            existing.status_updated_at = datetime.now(timezone.utc)
            existing.raw_data = payload
            existing.updated_at = datetime.now(timezone.utc)

            # Обновляем поля которые могли измениться
            for field in ["departure_station_code", "departure_station_name",
                          "destination_station_code", "destination_station_name",
                          "shipper_name", "consignee_name", "consignee_address",
                          "payer", "payer_code", "accepted_at", "departure_at",
                          "delivery_deadline"]:
                if data.get(field):
                    setattr(existing, field, data[field])

            # Пересоздаём вагоны (состав мог измениться)
            wagon_data = _extract_wagons(waybill)
            _upsert_wagons(db, existing.id, wagon_data)

            _log_incoming(db, message_id, waybill_number, status, "updated",
                          f"Статус: '{old_status}' → '{status}'")
            stats["updated"] += 1
            logger.info("etran_webhook: updated waybill=%s status='%s'->'%s'",
                        waybill_number, old_status, status)
        else:
            # Новая накладная
            new_wb = models.EtranWaybill(
                waybill_number=data["waybill_number"],
                waybill_identifier=data["waybill_identifier"],
                status=data["status"],
                status_updated_at=datetime.now(timezone.utc),
                departure_station_code=data["departure_station_code"],
                departure_station_name=data["departure_station_name"],
                destination_station_code=data["destination_station_code"],
                destination_station_name=data["destination_station_name"],
                shipper_name=data["shipper_name"],
                consignee_name=data["consignee_name"],
                consignee_address=data["consignee_address"],
                payer=data["payer"],
                payer_code=data["payer_code"],
                waybill_type=data["waybill_type"],
                shipment_type=data["shipment_type"],
                shipment_speed=data["shipment_speed"],
                form_type=data["form_type"],
                waybill_created_at=data["waybill_created_at"],
                accepted_at=data["accepted_at"],
                departure_at=data["departure_at"],
                delivery_deadline=data["delivery_deadline"],
                raw_data=payload,
                is_relevant=True,
            )
            db.add(new_wb)
            db.flush()  # Получаем id для вагонов

            # Вагоны
            wagon_data = _extract_wagons(waybill)
            for w in wagon_data:
                wg = models.EtranWaybillWagon(
                    waybill_id=new_wb.id,
                    **w,
                )
                db.add(wg)

            _log_incoming(db, message_id, waybill_number, status, "created",
                          f"Новая накладная, вагонов: {len(wagon_data)}")
            stats["created"] += 1
            logger.info("etran_webhook: created waybill=%s status='%s' wagons=%d",
                        waybill_number, status, len(wagon_data))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("etran_webhook: commit failed: %s", e)
        return {"status": "error", "message": str(e), **stats}

    return {"status": "ok", **stats}


def _upsert_wagons(db: Session, waybill_id, wagon_data: list[dict]):
    """Upsert вагонов: обновляем существующие, добавляем новые, удаляем лишние."""
    existing_wagons = db.query(models.EtranWaybillWagon).filter(
        models.EtranWaybillWagon.waybill_id == waybill_id
    ).all()
    existing_map = {w.railway_carriage_number: w for w in existing_wagons}

    incoming_numbers = set()
    for w in wagon_data:
        rn = w["railway_carriage_number"]
        incoming_numbers.add(rn)
        if rn in existing_map:
            # Обновляем
            ew = existing_map[rn]
            for field, val in w.items():
                setattr(ew, field, val)
        else:
            # Новый вагон
            new_wg = models.EtranWaybillWagon(waybill_id=waybill_id, **w)
            db.add(new_wg)

    # Удаляем вагоны которых больше нет в накладной
    for rn, ew in existing_map.items():
        if rn not in incoming_numbers:
            db.delete(ew)


# ─── Чтение данных (для фронтенда, потом) ────────────────────────────────────

@router.get("/waybills")
def list_waybills(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Список накладных ЭТРАН (для будущего UI)."""
    q = db.query(models.EtranWaybill).filter(models.EtranWaybill.is_relevant == True)
    if status:
        q = q.filter(models.EtranWaybill.status == status)
    q = q.order_by(models.EtranWaybill.updated_at.desc())
    total = q.count()
    items = q.offset(offset).limit(limit).all()
    return {"total": total, "items": items}


@router.get("/waybills/{waybill_number}")
def get_waybill(waybill_number: str, db: Session = Depends(get_db)):
    """Детали накладной + вагоны."""
    wb = db.query(models.EtranWaybill).filter(
        models.EtranWaybill.waybill_number == waybill_number
    ).first()
    if not wb:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Накладная не найдена")
    wagons = db.query(models.EtranWaybillWagon).filter(
        models.EtranWaybillWagon.waybill_id == wb.id
    ).all()
    return {"waybill": wb, "wagons": wagons}


@router.get("/log")
def get_log(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Аудит-лог входящих пакетов."""
    q = db.query(models.EtranIncomingLog).order_by(models.EtranIncomingLog.received_at.desc())
    total = q.count()
    items = q.offset(offset).limit(limit).all()
    return {"total": total, "items": items}
