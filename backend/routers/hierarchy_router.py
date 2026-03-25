"""
Роутер иерархической модели v2: /v2/wagons, /v2/trips, /v2/wagon-comments, /v2/trip-comments.
Все эндпоинты требуют авторизации.
"""
import math
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from auth import get_current_user, require_role
from database import get_db
from models import (
    CommentHistory,
    TripComment,
    User,
    Wagon,
    WagonEntityComment,
    WagonTrip,
)
from schemas import (
    CommentConstructorApplyRequest,
    CommentConstructorApplyResult,
    CommentConstructorSearchItem,
    CommentCreateRequest,
    CommentEditRequest,
    CommentHistoryOut,
    PaginatedResponse,
    SyncV2Result,
    TripCommentOut,
    WagonCommentOut,
    WagonOut,
    WagonTripOperationOut,
    WagonTripOut,
)

router = APIRouter(prefix="/v2", tags=["hierarchy-v2"])


# ─── Вагоны ──────────────────────────────────────────────────────────────────

@router.get("/wagons", response_model=PaginatedResponse[WagonOut])
def list_wagons(
    is_active: Optional[bool] = Query(None, description="Фильтр по активности"),
    wagon_number: Optional[str] = Query(None, description="Фильтр по номеру вагона"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=10000),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    """Список вагонов с пагинацией и подсчётом рейсов."""
    q = db.query(Wagon)
    if is_active is not None:
        q = q.filter(Wagon.is_active == is_active)
    if wagon_number:
        q = q.filter(Wagon.railway_carriage_number.ilike(f"%{wagon_number}%"))
    # Сортировка по последней активности рейса — самые активные вагоны первыми
    last_op_subq = (
        select(func.max(WagonTrip.last_operation_date))
        .where(WagonTrip.wagon_id == Wagon.id)
        .correlate(Wagon)
        .scalar_subquery()
    )
    q = q.order_by(last_op_subq.desc().nullslast(), Wagon.railway_carriage_number)

    total = q.count()
    wagons = q.offset((page - 1) * limit).limit(limit).all()

    # Батч-загрузка счётчиков и последнего комментария
    wagon_ids = [w.id for w in wagons]
    trip_counts: dict = {}
    active_trip_counts: dict = {}
    wagon_last_comment: dict = {}
    wagon_last_trip: dict = {}
    if wagon_ids:
        for row in db.query(WagonTrip.wagon_id, func.count()).filter(
            WagonTrip.wagon_id.in_(wagon_ids)
        ).group_by(WagonTrip.wagon_id).all():
            trip_counts[row[0]] = row[1]
        for row in db.query(WagonTrip.wagon_id, func.count()).filter(
            WagonTrip.wagon_id.in_(wagon_ids), WagonTrip.is_active == True
        ).group_by(WagonTrip.wagon_id).all():
            active_trip_counts[row[0]] = row[1]
        # DISTINCT ON — один последний комментарий на вагон
        for row in db.execute(
            text("""
                SELECT DISTINCT ON (wagon_id) wagon_id, comment_text
                FROM wagon_entity_comments
                WHERE wagon_id = ANY(:ids)
                ORDER BY wagon_id, created_at DESC
            """),
            {"ids": wagon_ids},
        ):
            wagon_last_comment[row[0]] = row[1]

        # Батч-загрузка полей последнего активного рейса
        for row in db.execute(text("""
            SELECT DISTINCT ON (wagon_id)
                wagon_id,
                last_station_name,
                last_operation_name,
                last_operation_date,
                number_train,
                train_index,
                number_railway_carriage_on_train,
                departure_station_name,
                destination_station_name,
                waybill_number,
                remaining_distance
            FROM wagon_trips
            WHERE wagon_id = ANY(:ids)
              AND is_active = true
            ORDER BY wagon_id, last_operation_date DESC NULLS LAST
        """), {"ids": wagon_ids}):
            wagon_last_trip[row[0]] = row

    items = []
    for w in wagons:
        last_trip = wagon_last_trip.get(w.id)
        items.append(
            WagonOut(
                id=w.id,
                railway_carriage_number=w.railway_carriage_number,
                is_active=w.is_active,
                trip_count=trip_counts.get(w.id, 0),
                active_trip_count=active_trip_counts.get(w.id, 0),
                last_comment_text=wagon_last_comment.get(w.id),
                number_train=last_trip[4] if last_trip else None,
                train_index=last_trip[5] if last_trip else None,
                number_railway_carriage_on_train=last_trip[6] if last_trip else None,
                last_station_name=last_trip[1] if last_trip else None,
                last_operation_name=last_trip[2] if last_trip else None,
                last_operation_date=last_trip[3] if last_trip else None,
                departure_station_name=last_trip[7] if last_trip else None,
                destination_station_name=last_trip[8] if last_trip else None,
                waybill_number=last_trip[9] if last_trip else None,
                remaining_distance=last_trip[10] if last_trip else None,
                created_at=w.created_at,
                updated_at=w.updated_at,
            )
        )

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


# ─── Рейсы ───────────────────────────────────────────────────────────────────

@router.get("/wagons/{wagon_id}/trips", response_model=PaginatedResponse[WagonTripOut])
def list_trips(
    wagon_id: UUID,
    include_archived: bool = Query(True, description="Включать архивные рейсы"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    """Список рейсов конкретного вагона."""
    wagon = db.query(Wagon).filter(Wagon.id == wagon_id).first()
    if not wagon:
        raise HTTPException(status_code=404, detail={"error": "WAGON_NOT_FOUND", "message": "Вагон не найден"})

    q = db.query(WagonTrip).filter(WagonTrip.wagon_id == wagon_id)
    if not include_archived:
        q = q.filter(WagonTrip.is_active == True)
    q = q.order_by(WagonTrip.flight_start_date.desc())

    total = q.count()
    trips = q.offset((page - 1) * limit).limit(limit).all()

    # Батч-загрузка последнего комментария к рейсам
    trip_ids = [t.id for t in trips]
    trip_last_comment: dict = {}
    if trip_ids:
        for row in db.execute(
            text("""
                SELECT DISTINCT ON (trip_id) trip_id, comment_text
                FROM trip_comments
                WHERE trip_id = ANY(:ids)
                ORDER BY trip_id, created_at DESC
            """),
            {"ids": trip_ids},
        ):
            trip_last_comment[row[0]] = row[1]

    items = []
    for t in trips:
        out = WagonTripOut.model_validate(t)
        out.last_comment_text = trip_last_comment.get(t.id)
        items.append(out)

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


@router.get("/trips", response_model=PaginatedResponse[WagonTripOut])
def list_all_trips(
    is_active: Optional[bool] = Query(None, description="Фильтр по активности рейса"),
    wagon_number: Optional[str] = Query(None, description="Фильтр по номеру вагона (частичное совпадение)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=10000),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    """Список всех рейсов с пагинацией."""
    q = db.query(WagonTrip, Wagon.railway_carriage_number).join(
        Wagon, WagonTrip.wagon_id == Wagon.id
    )
    if is_active is not None:
        q = q.filter(WagonTrip.is_active == is_active)
    if wagon_number:
        q = q.filter(Wagon.railway_carriage_number.ilike(f"%{wagon_number}%"))
    q = q.order_by(WagonTrip.flight_number.asc().nullslast(), WagonTrip.flight_start_date.asc().nullslast())

    total = q.count()
    rows = q.offset((page - 1) * limit).limit(limit).all()

    # Батч-загрузка последнего комментария
    trip_ids = [trip.id for trip, _ in rows]
    trip_last_comment: dict = {}
    if trip_ids:
        for row in db.execute(
            text("""
                SELECT DISTINCT ON (trip_id) trip_id, comment_text
                FROM trip_comments
                WHERE trip_id = ANY(:ids)
                ORDER BY trip_id, created_at DESC
            """),
            {"ids": trip_ids},
        ):
            trip_last_comment[row[0]] = row[1]

    items = []
    for trip, carriage_number in rows:
        out = WagonTripOut.model_validate(trip)
        out.railway_carriage_number = carriage_number
        out.last_comment_text = trip_last_comment.get(trip.id)
        items.append(out)

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


# ─── Операции ────────────────────────────────────────────────────────────────

_CONTAINER_CONCAT = """
    TRIM(BOTH ', ' FROM CONCAT_WS(', ',
        NULLIF(TRIM(COALESCE(d.container_number1,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number2,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number3,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number4,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number5,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number6,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number7,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number8,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number9,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number10,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number11,'')), ''),
        NULLIF(TRIM(COALESCE(d.container_number12,'')), '')
    ))
"""

@router.get("/trips/{trip_id}/operations", response_model=PaginatedResponse[WagonTripOperationOut])
def list_operations(
    trip_id: UUID,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    """
    Список операций рейса из таблицы dislocation (по полю flight_id).
    Сортировка: новые сверху.
    """
    trip = db.query(WagonTrip).filter(WagonTrip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail={"error": "TRIP_NOT_FOUND", "message": "Рейс не найден"})

    total = db.execute(
        text("""
            SELECT COUNT(*) FROM (
                SELECT DISTINCT
                    date_time_of_operation::timestamptz,
                    operation_code_railway_carriage,
                    station_code_performing_operation
                FROM dislocation
                WHERE flight_id = :tid
            ) sub
        """),
        {"tid": trip_id},
    ).scalar() or 0

    rows = db.execute(
        text(f"""
            SELECT id, trip_id, operation_datetime, operation_code, operation_name,
                   station_code, station_name, remaining_distance, number_train,
                   train_index, number_railway_carriage_on_train, waybill_number, container_numbers
            FROM (
                SELECT DISTINCT ON (
                    d.date_time_of_operation::timestamptz,
                    d.operation_code_railway_carriage,
                    d.station_code_performing_operation
                )
                    d._id                                      AS id,
                    d.flight_id                                AS trip_id,
                    d.date_time_of_operation::timestamptz      AS operation_datetime,
                    d.operation_code_railway_carriage          AS operation_code,
                    oc.name                                    AS operation_name,
                    d.station_code_performing_operation        AS station_code,
                    rs.name                                    AS station_name,
                    d.remaining_distance::text AS remaining_distance,
                    d.number_train,
                    d.train_index,
                    d.number_railway_carriage_on_train,
                    d.waybill_number,
                    {_CONTAINER_CONCAT}                        AS container_numbers
                FROM dislocation d
                LEFT JOIN operation_code oc
                    ON d.operation_code_railway_carriage = oc.operation_code_railway_carriage
                LEFT JOIN railway_station rs
                    ON d.station_code_performing_operation::text = rs.esr_code
                WHERE d.flight_id = :tid
                ORDER BY d.date_time_of_operation::timestamptz,
                         d.operation_code_railway_carriage,
                         d.station_code_performing_operation
            ) sub
            ORDER BY operation_datetime DESC
            OFFSET :offset LIMIT :limit
        """),
        {"tid": trip_id, "offset": (page - 1) * limit, "limit": limit},
    ).mappings().all()

    items = [
        WagonTripOperationOut(
            id=row["id"],
            trip_id=row["trip_id"],
            operation_datetime=row["operation_datetime"],
            operation_code=row["operation_code"],
            operation_name=row["operation_name"],
            station_code=row["station_code"],
            station_name=row["station_name"],
            remaining_distance=row["remaining_distance"],
            number_train=row["number_train"],
            train_index=row["train_index"],
            number_railway_carriage_on_train=row["number_railway_carriage_on_train"],
            waybill_number=row["waybill_number"],
            container_numbers=row["container_numbers"],
            created_at=None,
        )
        for row in rows
    ]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


# ─── Комментарии к вагону ─────────────────────────────────────────────────────

@router.get("/wagons/{wagon_id}/comments", response_model=list[WagonCommentOut])
def get_wagon_comments(
    wagon_id: UUID,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    wagon = db.query(Wagon).filter(Wagon.id == wagon_id).first()
    if not wagon:
        raise HTTPException(status_code=404, detail={"error": "WAGON_NOT_FOUND", "message": "Вагон не найден"})
    comments = (
        db.query(WagonEntityComment)
        .filter(WagonEntityComment.wagon_id == wagon_id)
        .order_by(WagonEntityComment.created_at.asc())
        .all()
    )
    return [WagonCommentOut.model_validate(c) for c in comments]


@router.post("/wagons/{wagon_id}/comments", response_model=WagonCommentOut, status_code=201)
def add_wagon_comment(
    wagon_id: UUID,
    body: CommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wagon = db.query(Wagon).filter(Wagon.id == wagon_id).first()
    if not wagon:
        raise HTTPException(status_code=404, detail={"error": "WAGON_NOT_FOUND", "message": "Вагон не найден"})
    comment = WagonEntityComment(
        wagon_id=wagon_id,
        comment_text=body.text,
        author_name=current_user.login,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return WagonCommentOut.model_validate(comment)


@router.put("/wagon-comments/{comment_id}", response_model=WagonCommentOut)
def edit_wagon_comment(
    comment_id: UUID,
    body: CommentEditRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(WagonEntityComment).filter(WagonEntityComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail={"error": "COMMENT_NOT_FOUND", "message": "Комментарий не найден"})

    old_text = comment.comment_text
    new_text = body.text

    if old_text == new_text:
        return WagonCommentOut.model_validate(comment)

    # Сохраняем историю
    history_entry = CommentHistory(
        entity_type="wagon",
        entity_id=comment_id,
        changed_by=current_user.login,
        old_text=old_text,
        new_text=new_text,
    )
    db.add(history_entry)
    comment.comment_text = new_text
    db.commit()
    db.refresh(comment)
    return WagonCommentOut.model_validate(comment)


@router.get("/wagon-comments/{comment_id}/history", response_model=list[CommentHistoryOut])
def get_wagon_comment_history(
    comment_id: UUID,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    history = (
        db.query(CommentHistory)
        .filter(CommentHistory.entity_type == "wagon", CommentHistory.entity_id == comment_id)
        .order_by(CommentHistory.changed_at.asc())
        .all()
    )
    return [CommentHistoryOut.model_validate(h) for h in history]


# ─── Комментарии к рейсу ──────────────────────────────────────────────────────

@router.get("/trips/{trip_id}/comments", response_model=list[TripCommentOut])
def get_trip_comments(
    trip_id: UUID,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    trip = db.query(WagonTrip).filter(WagonTrip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail={"error": "TRIP_NOT_FOUND", "message": "Рейс не найден"})
    comments = (
        db.query(TripComment)
        .filter(TripComment.trip_id == trip_id)
        .order_by(TripComment.created_at.asc())
        .all()
    )
    return [TripCommentOut.model_validate(c) for c in comments]


@router.post("/trips/{trip_id}/comments", response_model=TripCommentOut, status_code=201)
def add_trip_comment(
    trip_id: UUID,
    body: CommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trip = db.query(WagonTrip).filter(WagonTrip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail={"error": "TRIP_NOT_FOUND", "message": "Рейс не найден"})
    comment = TripComment(
        trip_id=trip_id,
        comment_text=body.text,
        author_name=current_user.login,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return TripCommentOut.model_validate(comment)


@router.put("/trip-comments/{comment_id}", response_model=TripCommentOut)
def edit_trip_comment(
    comment_id: UUID,
    body: CommentEditRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(TripComment).filter(TripComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail={"error": "COMMENT_NOT_FOUND", "message": "Комментарий не найден"})

    old_text = comment.comment_text
    new_text = body.text

    if old_text == new_text:
        return TripCommentOut.model_validate(comment)

    history_entry = CommentHistory(
        entity_type="trip",
        entity_id=comment_id,
        changed_by=current_user.login,
        old_text=old_text,
        new_text=new_text,
    )
    db.add(history_entry)
    comment.comment_text = new_text
    db.commit()
    db.refresh(comment)
    return TripCommentOut.model_validate(comment)


@router.get("/trip-comments/{comment_id}/history", response_model=list[CommentHistoryOut])
def get_trip_comment_history(
    comment_id: UUID,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    history = (
        db.query(CommentHistory)
        .filter(CommentHistory.entity_type == "trip", CommentHistory.entity_id == comment_id)
        .order_by(CommentHistory.changed_at.asc())
        .all()
    )
    return [CommentHistoryOut.model_validate(h) for h in history]


# ─── Конструктор комментариев (массовое назначение) ──────────────────────────

import logging as _logging

MAX_BULK_COMMENT_IDS = 200
_logger_cc = _logging.getLogger(__name__)


@router.post("/comment-constructor/apply", response_model=CommentConstructorApplyResult)
def comment_constructor_apply(
    body: CommentConstructorApplyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Массовое назначение комментария выбранным объектам."""
    unique_ids = list(dict.fromkeys(body.entity_ids))
    if len(unique_ids) > MAX_BULK_COMMENT_IDS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "TOO_MANY_IDS",
                "message": f"Максимум {MAX_BULK_COMMENT_IDS} объектов за одну операцию.",
            },
        )

    author = current_user.login or "user"
    success_count = 0
    failed_ids: list[UUID] = []

    for eid in unique_ids:
        try:
            if body.entity_type == "wagon":
                w = db.query(Wagon).filter(Wagon.id == eid).first()
                if not w:
                    failed_ids.append(eid)
                    continue
                c = WagonEntityComment(wagon_id=eid, comment_text=body.text, author_name=author)
            else:
                t = db.query(WagonTrip).filter(WagonTrip.id == eid).first()
                if not t:
                    failed_ids.append(eid)
                    continue
                c = TripComment(trip_id=eid, comment_text=body.text, author_name=author)
            db.add(c)
            success_count += 1
        except Exception as ex:
            _logger_cc.warning("comment_constructor: failed entity_id=%s: %s", eid, ex)
            failed_ids.append(eid)

    db.commit()

    total = len(unique_ids)
    failed_count = len(failed_ids)
    status = "success" if failed_count == 0 else ("partial" if success_count > 0 else "failure")
    msg = (
        f"Применено к {success_count} из {total} объектов."
        if failed_count > 0
        else f"Комментарий успешно применён к {success_count} объектам."
    )

    _logger_cc.info(
        "comment_constructor: apply login=%s entity_type=%s requested=%d success=%d failed=%d",
        current_user.login, body.entity_type, total, success_count, failed_count,
    )

    return CommentConstructorApplyResult(
        total_requested=total,
        success_count=success_count,
        failed_count=failed_count,
        failed_ids=failed_ids,
        status=status,
        message=msg,
    )


# ─── Синхронизация ────────────────────────────────────────────────────────────

@router.post("/sync", response_model=SyncV2Result)
def sync_v2(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Полная пересборка иерархической модели из dislocation.
    """
    import logging
    _logger = logging.getLogger(__name__)
    _logger.info("sync_v2: started by login=%s", current_user.login)
    try:
        from services.sync_service_v2 import sync_new_model
        stats = sync_new_model(db)
        _logger.info("sync_v2: done stats=%s", stats)
        result = SyncV2Result(**stats)
        if result.status == "failure":
            raise HTTPException(
                status_code=500,
                detail={"error": "SYNC_V2_FAILED", "message": f"Sync failed with {result.errors} error(s)"},
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("sync_v2 failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"error": "SYNC_V2_FAILED", "message": str(e)},
        )
