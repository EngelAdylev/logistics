from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, UniqueConstraint, Integer
from sqlalchemy.dialects.postgresql import UUID
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

class OperationCode(Base):
    __tablename__ = "operation_code"
    operation_code_railway_carriage = Column(String, primary_key=True)
    mnemo_code = Column(String(50))
    name = Column(String(50))

class RailwayStation(Base):
    __tablename__ = "railway_station"
    id = Column(String(50), primary_key=True)
    code = Column(String(50))
    name = Column(String(50))

class TrackingWagon(Base):
    __tablename__ = "tracking_wagons"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    railway_carriage_number = Column(Text, nullable=False, index=True)
    flight_start_date = Column(DateTime(timezone=True), nullable=False)
    current_station_name = Column(Text)
    current_operation_name = Column(Text)
    last_operation_date = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)

    __table_args__ = (UniqueConstraint('railway_carriage_number', 'flight_start_date', name='_wagon_flight_uc'),)
    comments = relationship("WagonComment", back_populates="wagon")

class WagonComment(Base):
    __tablename__ = "wagon_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tracking_id = Column(UUID(as_uuid=True), ForeignKey("tracking_wagons.id"))
    author_name = Column(Text)
    comment_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    wagon = relationship("TrackingWagon", back_populates="comments")