from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, UniqueConstraint, Integer, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    login = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    role = Column(Text, nullable=False, default="user")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    token_version = Column(Integer, default=0)


class UserSession(Base):
    __tablename__ = "user_sessions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    refresh_token_hash = Column(Text, nullable=False)
    user_agent = Column(Text)
    ip = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))

class Dislocation(Base):
    __tablename__ = "dislocation"
    _id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    railway_carriage_number = Column(Text)
    flight_start_date = Column(DateTime(timezone=True))
    operation_code_railway_carriage = Column(Text)
    station_code_performing_operation = Column(Text)
    date_time_of_operation = Column(DateTime(timezone=True))
    # Ссылка на рейс (проставляется шедулером при синхронизации)
    flight_id = Column(UUID(as_uuid=True), nullable=True, index=True)

class OperationCode(Base):
    __tablename__ = "operation_code"
    operation_code_railway_carriage = Column(String, primary_key=True)
    mnemo_code = Column(String(50))
    name = Column(String(50))

class RailwayStation(Base):
    __tablename__ = "railway_station"
    id = Column(String(50), primary_key=True)
    code = Column(String(50))
    esr_code = Column(String(50))  # код ЕСР для JOIN с dislocation (station_code_*)
    name = Column(String(50))

class TrackingWagon(Base):
    __tablename__ = "tracking_wagons"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    railway_carriage_number = Column(Text, nullable=False, index=True)
    flight_start_date = Column(DateTime(timezone=True), nullable=False)
    departure_station_code = Column(Text)  # для нормализованного ключа (вагон, дата, станция)
    current_station_name = Column(Text)
    current_operation_name = Column(Text)
    last_operation_date = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)

    __table_args__ = (UniqueConstraint('railway_carriage_number', 'flight_start_date', name='_wagon_flight_uc'),)
    comments = relationship("WagonComment", back_populates="wagon")

class UserTablePreference(Base):
    __tablename__ = "user_table_preferences"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    table_key = Column(Text, nullable=False, index=True)
    visible_columns = Column(JSONB, nullable=False)  # array of column ids
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("user_id", "table_key", name="_user_table_pref_uc"),)


class WagonComment(Base):
    __tablename__ = "wagon_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tracking_id = Column(UUID(as_uuid=True), ForeignKey("tracking_wagons.id"))
    author_name = Column(Text)
    comment_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    wagon = relationship("TrackingWagon", back_populates="comments")


# ─── Иерархическая модель: Wagon → WagonTrip → WagonTripOperation ────────────

class Wagon(Base):
    """Верхнеуровневая сущность вагона. Один вагон = один railway_carriage_number."""
    __tablename__ = "wagons"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    railway_carriage_number = Column(Text, unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=False)  # True если есть хотя бы один активный рейс
    # Мастер-данные вагона (заполняются из внешних систем при наличии)
    owner = Column(Text)               # Владелец / принадлежность
    type = Column(Text)                # Тип вагона
    last_repair_date = Column(DateTime(timezone=True))  # Дата последнего ремонта
    next_repair_date = Column(DateTime(timezone=True))  # Дата следующего ремонта
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    trips = relationship("WagonTrip", back_populates="wagon", cascade="all, delete-orphan")
    comments = relationship("WagonEntityComment", back_populates="wagon", cascade="all, delete-orphan")


class WagonTrip(Base):
    """Рейс вагона. Один вагон → много рейсов. Основная единица слежения."""
    __tablename__ = "wagon_trips"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wagon_id = Column(UUID(as_uuid=True), ForeignKey("wagons.id"), nullable=False, index=True)
    flight_number = Column(Integer)    # Порядковый номер рейса у данного вагона (1, 2, 3 ...)
    flight_start_date = Column(DateTime(timezone=True), nullable=False)
    departure_station_code = Column(Text)
    departure_station_name = Column(Text)
    destination_station_code = Column(Text)
    destination_station_name = Column(Text)
    number_train = Column(Text)
    train_index = Column(Text)
    number_railway_carriage_on_train = Column(Text)
    waybill_number = Column(Text)
    remaining_distance = Column(Text)
    is_active = Column(Boolean, default=True)
    # Денормализованные поля последней операции (обновляются при каждой синхронизации)
    last_operation_date = Column(DateTime(timezone=True))
    last_operation_name = Column(Text)
    last_operation_code = Column(Text)
    last_station_name = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("wagon_id", "flight_start_date", name="_wagon_trip_uc"),)

    wagon = relationship("Wagon", back_populates="trips")
    operations = relationship("WagonTripOperation", back_populates="trip", cascade="all, delete-orphan")
    comments = relationship("TripComment", back_populates="trip", cascade="all, delete-orphan")
    trip_waybills = relationship("TripWaybill", back_populates="trip", cascade="all, delete-orphan")


class WagonTripOperation(Base):
    """Операция рейса. Детальная история событий дислокации."""
    __tablename__ = "wagon_trip_operations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("wagon_trips.id"), nullable=False, index=True)
    operation_datetime = Column(DateTime(timezone=True), index=True)
    operation_code = Column(Text)
    operation_name = Column(Text)
    station_code = Column(Text)
    station_name = Column(Text)
    remaining_distance = Column(Text)
    number_train = Column(Text)
    train_index = Column(Text)
    waybill_number = Column(Text)
    container_numbers = Column(Text)  # предварительно склеенные "c1, c2, ..."
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("trip_id", "operation_datetime", "operation_code", name="_trip_op_uc"),)

    trip = relationship("WagonTrip", back_populates="operations")


class WagonEntityComment(Base):
    """Комментарий уровня вагона (долгоживущий контекст по вагону)."""
    __tablename__ = "wagon_entity_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wagon_id = Column(UUID(as_uuid=True), ForeignKey("wagons.id"), nullable=False, index=True)
    comment_text = Column(Text, nullable=False)
    author_name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    wagon = relationship("Wagon", back_populates="comments")


class TripComment(Base):
    """Комментарий уровня рейса (оперативный контекст по конкретной перевозке)."""
    __tablename__ = "trip_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("wagon_trips.id"), nullable=False, index=True)
    comment_text = Column(Text, nullable=False)
    author_name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    trip = relationship("WagonTrip", back_populates="comments")


class CommentHistory(Base):
    """История изменений комментариев (wagon и trip уровней)."""
    __tablename__ = "comment_history"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(Text, nullable=False)   # 'wagon' или 'trip'
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    changed_by = Column(Text, nullable=False)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())
    old_text = Column(Text)
    new_text = Column(Text, nullable=False)


# ─── ЭТРАН: накладные ГУ-27 ──────────────────────────────────────────────────

class EtranWaybill(Base):
    """Накладная ЭТРАН. Один waybill_number может повторяться в нескольких пакетах."""
    __tablename__ = "etran_waybills"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    waybill_number = Column(Text, nullable=False, index=True)
    source_message_id = Column(Text, index=True)
    waybill_identifier = Column(Text)
    status = Column(Text, nullable=False)              # "В пути", "Груз прибыл", ...
    status_updated_at = Column(DateTime(timezone=True))
    # Маршрут
    departure_station_code = Column(Text)
    departure_station_name = Column(Text)
    destination_station_code = Column(Text)
    destination_station_name = Column(Text)
    departure_country = Column(Text)
    destination_country = Column(Text)
    # Участники
    shipper_name = Column(Text)
    consignee_name = Column(Text)
    consignee_address = Column(Text)
    payer = Column(Text)
    payer_code = Column(Text)
    responsible_person = Column(Text)
    # Даты
    waybill_created_at = Column(DateTime(timezone=True))
    accepted_at = Column(DateTime(timezone=True))
    departure_at = Column(DateTime(timezone=True))
    delivery_deadline = Column(DateTime(timezone=True))
    # Тип
    waybill_type = Column(Text)
    shipment_type = Column(Text)
    shipment_speed = Column(Text)
    form_type = Column(Text)
    # Сырой JSON (весь пакет для аудита)
    raw_data = Column(JSONB)
    # Служебные
    is_relevant = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("waybill_number", "source_message_id", name="_etran_waybill_message_uc"),)

    wagons = relationship("EtranWaybillWagon", back_populates="waybill", cascade="all, delete-orphan")
    trip_waybills = relationship("TripWaybill", back_populates="waybill", cascade="all, delete-orphan")


class EtranWaybillWagon(Base):
    """Вагон из накладной ЭТРАН. Одна накладная → много вагонов."""
    __tablename__ = "etran_waybill_wagons"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    waybill_id = Column(UUID(as_uuid=True), ForeignKey("etran_waybills.id", ondelete="CASCADE"), nullable=False, index=True)
    railway_carriage_number = Column(Text, nullable=False)
    lifting_capacity = Column(Text)
    axles_count = Column(Integer)
    ownership = Column(Text)
    weight_net = Column(Text)
    # Контейнер (если есть)
    container_number = Column(Text)
    container_length = Column(Text)
    container_owner = Column(Text)
    zpu_number = Column(Text)
    zpu_type = Column(Text)
    # Вагон: доп. данные
    renter = Column(Text)
    wagon_model = Column(Text)
    next_repair_date = Column(Text)
    # Груз (первый продукт из накладной — для быстрого доступа)
    cargo_name = Column(Text)
    cargo_weight = Column(Text)
    # Связь с нашей системой (заполняется при матчинге)
    wagon_id = Column(UUID(as_uuid=True), ForeignKey("wagons.id"), nullable=True)
    # Служебные
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("waybill_id", "railway_carriage_number", "container_number", name="_etran_wb_wagon_uc"),)

    waybill = relationship("EtranWaybill", back_populates="wagons")


class TripWaybill(Base):
    """Связь накладной с рейсом вагона. Один рейс может иметь несколько накладных."""
    __tablename__ = "trip_waybills"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wagon_trip_id = Column(UUID(as_uuid=True), ForeignKey("wagon_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    waybill_id = Column(UUID(as_uuid=True), ForeignKey("etran_waybills.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("wagon_trip_id", "waybill_id", name="_trip_waybill_uc"),)

    trip = relationship("WagonTrip", back_populates="trip_waybills")
    waybill = relationship("EtranWaybill", back_populates="trip_waybills")


class EtranIncomingLog(Base):
    """Лог входящих пакетов ЭТРАН (аудит)."""
    __tablename__ = "etran_incoming_log"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(Text)
    waybill_number = Column(Text)
    status_received = Column(Text)
    action_taken = Column(Text)    # "created" / "updated" / "skipped" / "filtered_out"
    details = Column(Text)
    received_at = Column(DateTime(timezone=True), server_default=func.now())
    raw_payload = Column(JSONB)


# ─── Поезда: маршруты и заявки на получение ──────────────────────────────────

class RailwayRoute(Base):
    """Болванка поезда — снимок состава, создаётся автоматически когда MIN(km) ≤ 150."""
    __tablename__ = "railway_routes"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    train_number = Column(Text, nullable=False, unique=True, index=True)
    route_number = Column(Integer, nullable=False, unique=True,
                          server_default=text("nextval('railway_route_number_seq')"))
    train_index = Column(Text)
    snapshot_data = Column(JSONB)   # список вагонов в момент создания
    route_payload = Column(JSONB)   # пакет route+orders при первой операции 80
    route_payload_created_at = Column(DateTime(timezone=True))
    status = Column(Text, default='open')   # open / closed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    orders = relationship("ReceivingOrder", back_populates="route", cascade="all, delete-orphan")


class ReceivingOrder(Base):
    """Заявка на получение груза. Одна заявка = несколько вагонов/накладных (строки в items)."""
    __tablename__ = "receiving_orders"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_number = Column(Integer, nullable=False,
                          server_default=text("nextval('receiving_orders_number_seq')"))  # автоинкремент
    route_id = Column(UUID(as_uuid=True), ForeignKey("railway_routes.id", ondelete="CASCADE"), nullable=False, index=True)
    client_name = Column(Text)
    contract_number = Column(Text)
    status = Column(Text, default='new')   # new / in_progress / done
    comment = Column(Text)
    created_by = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    route = relationship("RailwayRoute", back_populates="orders")
    items = relationship("ReceivingOrderItem", back_populates="order", cascade="all, delete-orphan")


class ReceivingOrderItem(Base):
    """Строка заявки — один КТК (накладная + вагон + контейнер).
    Если вагон порожний (нет КТК) — ключ: накладная + вагон.
    Если нет накладной — ключ: вагон.
    Partial unique indexes создаются в миграции.
    """
    __tablename__ = "receiving_order_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("receiving_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    route_id = Column(UUID(as_uuid=True), ForeignKey("railway_routes.id", ondelete="CASCADE"), nullable=False, index=True)
    waybill_id = Column(UUID(as_uuid=True), ForeignKey("etran_waybills.id", ondelete="SET NULL"), nullable=True, index=True)
    wagon_number = Column(Text, nullable=False)
    container_number = Column(Text, nullable=True)   # None = порожний вагон

    # Partial unique indexes (созданы вручную в миграции):
    # UNIQUE(route_id, waybill_id, container_number) WHERE waybill_id IS NOT NULL AND container_number IS NOT NULL
    # UNIQUE(route_id, waybill_id)                   WHERE waybill_id IS NOT NULL AND container_number IS NULL
    # UNIQUE(route_id, wagon_number)                  WHERE waybill_id IS NULL
    __table_args__ = ()

    order = relationship("ReceivingOrder", back_populates="items")
    waybill = relationship("EtranWaybill")
