from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, UniqueConstraint, Integer
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