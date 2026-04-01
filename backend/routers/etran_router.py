"""
Роутер для приёма данных ЭТРАН (накладные ГУ-27).
POST /etran/webhook — принимает JSON-пакет из DATAREON, дедуплицирует, upsert.

Формат пакета (v2):
    {"waybill": { "waybill_number": "...", "waybill_status": "...", ..., "MessageId": "...", "Version": 3 }}
Поддерживается и старый формат:
    {"GU27": [{"waybill": {...}}], "MessageID": "..."}
"""
import logging
import traceback
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
    return {"status": "ok", "service": "etran", "endpoint": "/etran/webhook", "method": "POST"}


@router.post("/health")
def etran_health_post():
    """POST на health — для диагностики если DATAREON шлёт не туда."""
    return {"status": "ok", "message": "POST works, but send to /etran/webhook"}


# Допустимые статусы (lower-case) — остальные отсеиваем
ALLOWED_STATUSES = {
    "в пути",
    "работа с документом окончена",
    "работа с документами окончена",  # на случай обоих вариантов
    "груз прибыл",
    "получатель уведомлен",
    "раскредитован",
}


def _parse_datetime(val) -> Optional[datetime]:
    """Парсим дату из JSON ЭТРАН. Возвращает None для пустых/нулевых дат."""
    if not val or str(val).startswith("0001-01-01"):
        return None
    try:
        if isinstance(val, str):
            val = val.replace("Z", "+00:00")
            return datetime.fromisoformat(val)
        return val
    except (ValueError, TypeError):
        return None


def _s(val) -> str:
    """Безопасно превращает значение в stripped строку."""
    return (str(val) if val is not None else "").strip()


def _clean_date_str(val) -> Optional[str]:
    """Для Text-полей дат: возвращает строку или None.
    '0001-01-01...' — нулевая дата в системе ЭТРАН, трактуем как None."""
    s = _s(val)
    if not s or s.startswith("0001-01-01"):
        return None
    return s


def _extract_waybill_data(waybill: dict) -> dict:
    """Извлекает плоские поля накладной из JSON."""
    return {
        "waybill_number": _s(waybill.get("waybill_number")),
        "waybill_identifier": _s(waybill.get("waybill_identifier")),
        "status": _s(waybill.get("waybill_status")),
        "departure_station_code": _s(waybill.get("departure_station_code")),
        "departure_station_name": _s(waybill.get("departure_station")),
        "destination_station_code": _s(waybill.get("destination_station_code")),
        "destination_station_name": _s(waybill.get("destination_station")),
        "departure_country": _s(waybill.get("departure_country")),
        "destination_country": _s(waybill.get("destination_country")),
        "shipper_name": _s(waybill.get("shipper_name")),
        "consignee_name": _s(waybill.get("consignee_name")),
        "consignee_address": _s(waybill.get("consignee_address")),
        "payer": _s(waybill.get("payer")),
        "payer_code": _s(waybill.get("payer_code")),
        "waybill_type": _s(waybill.get("waybill_type")),
        "shipment_type": _s(waybill.get("shipment_type")),
        "shipment_speed": _s(waybill.get("shipment_speed")),
        "form_type": _s(waybill.get("form_type")),
        "responsible_person": _s(waybill.get("responsible_person")),
        "waybill_created_at": _parse_datetime(waybill.get("waybill_created_at")),
        "accepted_at": _parse_datetime(waybill.get("accepted_at")),
        "departure_at": _parse_datetime(waybill.get("departure_at")),
        "delivery_deadline": _parse_datetime(waybill.get("delivery_deadline")),
    }


def _extract_wagons(waybill: dict) -> list[dict]:
    """Извлекает вагоны + контейнеры из JSON накладной.
    Один вагон с N контейнерами → N строк.
    Вагон без контейнера → 1 строка с пустым container_number.
    """
    carriages = waybill.get("waybill_railway_carriage") or []
    containers = waybill.get("waybill_container") or []
    products = waybill.get("waybill_product") or []
    zpu_list = waybill.get("waybill_zpu") or []

    # Индексируем контейнеры по номеру вагона (1:N)
    container_map: dict[str, list[dict]] = {}
    for c in containers:
        cn = _s(c.get("carriage_number"))
        if cn:
            container_map.setdefault(cn, []).append(c)

    # ZPU по номеру контейнера (может быть container_number_zpu или container_number)
    zpu_map = {}
    for z in zpu_list:
        zn = _s(z.get("container_number_zpu") or z.get("container_number") or z.get("zpu_container_number"))
        if zn:
            zpu_map[zn] = z

    # Первый продукт — для cargo_name / cargo_weight
    first_product = products[0] if products else {}

    result = []
    for carr in carriages:
        rn = _s(carr.get("railway_number"))
        if not rn:
            continue

        base = {
            "railway_carriage_number": rn,
            "lifting_capacity": _s(carr.get("railway_lifting_capacity")),
            "axles_count": carr.get("axles_count"),
            "ownership": _s(carr.get("ownership")),
            "renter": _s(carr.get("renter")),
            "weight_net": _s(carr.get("railway_weight_net")),
            "wagon_model": _s(carr.get("model")),
            "next_repair_date": _clean_date_str(carr.get("date_of_next_repair")),
            "cargo_name": _s(first_product.get("etsng_name") or first_product.get("cargo_full_name")),
            "cargo_weight": _s(first_product.get("cargo_weight")),
        }

        wagon_containers = container_map.get(rn, [])
        if wagon_containers:
            for cont in wagon_containers:
                cont_num = _s(cont.get("container_number"))
                zpu = zpu_map.get(cont_num, {})
                row = {
                    **base,
                    "container_number": cont_num,
                    "container_length": _s(cont.get("container_length")),
                    "container_owner": _s(cont.get("owner")),
                    # ZPU: поле может называться "zpu", "zpu_number", "number"
                    "zpu_number": _s(zpu.get("zpu") or zpu.get("zpu_number") or zpu.get("number")),
                    "zpu_type": _s(zpu.get("zpu_type") or zpu.get("type")),
                }
                result.append(row)
        else:
            result.append({
                **base,
                "container_number": "",
                "container_length": "",
                "container_owner": "",
                "zpu_number": "",
                "zpu_type": "",
            })

    return result


def _extract_message_id(payload: dict, waybill: dict) -> str:
    """Извлекает MessageId из любого формата пакета."""
    return (
        payload.get("MessageID")
        or payload.get("MessageId")
        or waybill.get("MessageId")
        or waybill.get("MessageID")
        or ""
    )


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


def _process_one_waybill(db: Session, waybill: dict, message_id: str,
                         payload: dict, stats: dict):
    """Обрабатывает одну накладную: upsert пакета + синхронизация статуса по номеру."""
    data = _extract_waybill_data(waybill)
    waybill_number = data["waybill_number"]
    status = data["status"]

    if not waybill_number:
        logger.warning("etran_webhook: empty waybill_number, skipping")
        return

    stats["processed"] += 1

    # Фильтр по статусу
    if status.lower() not in ALLOWED_STATUSES:
        _log_incoming(db, message_id, waybill_number, status, "filtered_out",
                      f"Статус '{status}' не в допустимых")
        stats["filtered_out"] += 1
        return

    existing = None
    if message_id:
        existing = db.query(models.EtranWaybill).filter(
            models.EtranWaybill.waybill_number == waybill_number,
            models.EtranWaybill.source_message_id == message_id,
        ).first()

    if not existing and data.get("waybill_identifier"):
        existing = db.query(models.EtranWaybill).filter(
            models.EtranWaybill.waybill_number == waybill_number,
            models.EtranWaybill.waybill_identifier == data["waybill_identifier"],
        ).order_by(models.EtranWaybill.updated_at.desc()).first()

    siblings = db.query(models.EtranWaybill).filter(
        models.EtranWaybill.waybill_number == waybill_number
    ).all()

    if existing:
        old_status = existing.status
        existing.status = status
        existing.status_updated_at = datetime.now(timezone.utc)
        existing.raw_data = payload
        existing.updated_at = datetime.now(timezone.utc)
        if message_id:
            existing.source_message_id = message_id

        for field in ["departure_station_code", "departure_station_name",
                      "destination_station_code", "destination_station_name",
                      "departure_country", "destination_country",
                      "shipper_name", "consignee_name", "consignee_address",
                      "payer", "payer_code", "responsible_person",
                      "accepted_at", "departure_at", "delivery_deadline"]:
            if data.get(field):
                setattr(existing, field, data[field])

        wagon_data = _extract_wagons(waybill)
        _upsert_wagons(db, existing.id, wagon_data)

        # Статус должен оставаться единым по одному номеру накладной,
        # даже если один номер хранится в нескольких пакетах.
        for sibling in siblings:
            if sibling.id == existing.id:
                continue
            sibling.status = status
            sibling.status_updated_at = datetime.now(timezone.utc)
            sibling.updated_at = datetime.now(timezone.utc)

        action = "updated" if old_status != status else "refreshed"
        _log_incoming(db, message_id, waybill_number, status, action,
                      f"Статус: '{old_status}' → '{status}', вагонов в пакете: {len(wagon_data)}")
        if old_status != status:
            stats["updated"] += 1
        else:
            stats["skipped"] += 1
        logger.info("etran_webhook: %s waybill=%s message_id=%s wagons=%d",
                    action, waybill_number, message_id or "", len(wagon_data))
    else:
        new_wb = models.EtranWaybill(
            waybill_number=data["waybill_number"],
            source_message_id=message_id or None,
            waybill_identifier=data["waybill_identifier"],
            status=data["status"],
            status_updated_at=datetime.now(timezone.utc),
            departure_station_code=data["departure_station_code"],
            departure_station_name=data["departure_station_name"],
            destination_station_code=data["destination_station_code"],
            destination_station_name=data["destination_station_name"],
            departure_country=data["departure_country"],
            destination_country=data["destination_country"],
            shipper_name=data["shipper_name"],
            consignee_name=data["consignee_name"],
            consignee_address=data["consignee_address"],
            payer=data["payer"],
            payer_code=data["payer_code"],
            waybill_type=data["waybill_type"],
            shipment_type=data["shipment_type"],
            shipment_speed=data["shipment_speed"],
            form_type=data["form_type"],
            responsible_person=data["responsible_person"],
            waybill_created_at=data["waybill_created_at"],
            accepted_at=data["accepted_at"],
            departure_at=data["departure_at"],
            delivery_deadline=data["delivery_deadline"],
            raw_data=payload,
            is_relevant=True,
        )
        db.add(new_wb)
        db.flush()

        wagon_data = _extract_wagons(waybill)
        for w in wagon_data:
            wg = models.EtranWaybillWagon(waybill_id=new_wb.id, **w)
            db.add(wg)

        for sibling in siblings:
            sibling.status = status
            sibling.status_updated_at = datetime.now(timezone.utc)
            sibling.updated_at = datetime.now(timezone.utc)

        _log_incoming(db, message_id, waybill_number, status, "created",
                      f"Новая накладная, вагонов: {len(wagon_data)}")
        stats["created"] += 1
        logger.info("etran_webhook: created waybill=%s status='%s' wagons=%d",
                    waybill_number, status, len(wagon_data))


def _safe_process(db: Session, waybill: dict, message_id: str,
                  payload: dict, stats: dict):
    """Обёртка над _process_one_waybill с перехватом ошибок.
    При исключении пишем в аудит-лог и продолжаем — не роняем весь запрос."""
    wb_number = _s(waybill.get("waybill_number"))
    try:
        _process_one_waybill(db, waybill, message_id, payload, stats)
    except Exception as exc:
        tb = traceback.format_exc()
        logger.exception("etran_webhook: error processing waybill=%s: %s", wb_number, exc)
        try:
            _log_incoming(db, message_id, wb_number,
                          _s(waybill.get("waybill_status")), "error",
                          f"{type(exc).__name__}: {exc}\n{tb}", payload)
            db.flush()
        except Exception:
            pass  # логирование не должно порождать новую ошибку
        stats.setdefault("errors", 0)
        stats["errors"] += 1


@router.post("/webhook")
@router.post("/webhook/")
async def etran_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Приём JSON-пакета ГУ-27 из DATAREON.
    Поддерживает два формата:
      1) Новый: {"waybill": {..., "MessageId": "..."}}
      2) Старый: {"GU27": [{"waybill": {...}}], "MessageID": "..."}
    Дедупликация по waybill_number: если накладная уже есть — обновляем статус.
    Всегда возвращает 200 OK (чтобы DATAREON не ретраил).
    """
    try:
        payload = await request.json()
    except Exception as e:
        logger.warning("etran_webhook: invalid JSON: %s", e)
        return {"status": "error", "message": "Invalid JSON", "processed": 0}

    stats = {"processed": 0, "created": 0, "updated": 0, "skipped": 0, "filtered_out": 0}

    # ─── Определяем формат пакета ──────────────────────────────────────────
    if "waybill" in payload and isinstance(payload["waybill"], dict):
        # Новый формат: {"waybill": {...}}
        waybill = payload["waybill"]
        message_id = _extract_message_id(payload, waybill)
        _safe_process(db, waybill, message_id, payload, stats)

    elif "GU27" in payload:
        # Старый формат: {"GU27": [...], "MessageID": "..."}
        message_id = payload.get("MessageID", "")
        gu27_list = payload.get("GU27") or []
        for item in gu27_list:
            waybill = item.get("waybill") or item
            _safe_process(db, waybill, message_id, payload, stats)

    else:
        # Неизвестный формат — пробуем как голый waybill
        message_id = _extract_message_id(payload, payload)
        if payload.get("waybill_number"):
            _safe_process(db, payload, message_id, payload, stats)
        else:
            logger.warning("etran_webhook: unknown payload format, keys=%s", list(payload.keys()))
            _log_incoming(db, "", "", "", "error",
                          f"Unknown format, keys: {list(payload.keys())}", payload)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("etran_webhook: commit failed: %s", e)
        return {"status": "error", "message": str(e), **stats}

    return {"status": "ok", **stats}


def _upsert_wagons(db: Session, waybill_id, wagon_data: list[dict]):
    """Upsert вагонов: ключ = (railway_carriage_number, container_number)."""
    existing_wagons = db.query(models.EtranWaybillWagon).filter(
        models.EtranWaybillWagon.waybill_id == waybill_id
    ).all()
    existing_map = {(w.railway_carriage_number, w.container_number or ""): w for w in existing_wagons}

    incoming_keys = set()
    for w in wagon_data:
        key = (w["railway_carriage_number"], w.get("container_number", ""))
        incoming_keys.add(key)
        if key in existing_map:
            ew = existing_map[key]
            for field, val in w.items():
                setattr(ew, field, val)
        else:
            new_wg = models.EtranWaybillWagon(waybill_id=waybill_id, **w)
            db.add(new_wg)

    for key, ew in existing_map.items():
        if key not in incoming_keys:
            db.delete(ew)


# ─── Чтение данных (для фронтенда) ──────────────────────────────────────────

@router.get("/waybills")
def list_waybills(
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Список накладных ЭТРАН с вложенными вагонами."""
    q = db.query(models.EtranWaybill).filter(models.EtranWaybill.is_relevant == True)
    if status:
        q = q.filter(models.EtranWaybill.status.ilike(f"%{status}%"))
    if search:
        q = q.filter(
            models.EtranWaybill.waybill_number.ilike(f"%{search}%")
        )
    q = q.order_by(models.EtranWaybill.updated_at.desc())
    total = q.count()
    waybills = q.offset(offset).limit(limit).all()

    wb_ids = [wb.id for wb in waybills]
    all_wagons = []
    if wb_ids:
        all_wagons = db.query(models.EtranWaybillWagon).filter(
            models.EtranWaybillWagon.waybill_id.in_(wb_ids)
        ).all()
    wagons_by_wb = {}
    for w in all_wagons:
        wagons_by_wb.setdefault(str(w.waybill_id), []).append({
            "id": str(w.id),
            "railway_carriage_number": w.railway_carriage_number,
            "container_number": w.container_number or "",
            "container_length": w.container_length or "",
            "container_owner": w.container_owner or "",
            "zpu_number": w.zpu_number or "",
            "zpu_type": getattr(w, "zpu_type", "") or "",
            "lifting_capacity": w.lifting_capacity or "",
            "ownership": w.ownership or "",
            "renter": getattr(w, "renter", "") or "",
            "weight_net": w.weight_net or "",
            "wagon_model": getattr(w, "wagon_model", "") or "",
            "cargo_name": w.cargo_name or "",
            "cargo_weight": w.cargo_weight or "",
        })

    items = []
    for wb in waybills:
        items.append({
            "id": str(wb.id),
            "waybill_number": wb.waybill_number,
            "waybill_identifier": wb.waybill_identifier or "",
            "status": wb.status,
            "status_updated_at": wb.status_updated_at.isoformat() if wb.status_updated_at else None,
            "departure_station_code": wb.departure_station_code or "",
            "departure_station_name": wb.departure_station_name or "",
            "destination_station_code": wb.destination_station_code or "",
            "destination_station_name": wb.destination_station_name or "",
            "departure_country": getattr(wb, "departure_country", "") or "",
            "destination_country": getattr(wb, "destination_country", "") or "",
            "shipper_name": wb.shipper_name or "",
            "consignee_name": wb.consignee_name or "",
            "payer": wb.payer or "",
            "shipment_type": wb.shipment_type or "",
            "responsible_person": getattr(wb, "responsible_person", "") or "",
            "cargo_name": wagons_by_wb.get(str(wb.id), [{}])[0].get("cargo_name", ""),
            "wagon_count": len(wagons_by_wb.get(str(wb.id), [])),
            "wagons": wagons_by_wb.get(str(wb.id), []),
            "created_at": wb.created_at.isoformat() if wb.created_at else None,
            "updated_at": wb.updated_at.isoformat() if wb.updated_at else None,
        })

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
