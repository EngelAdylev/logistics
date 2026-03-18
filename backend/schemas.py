from pydantic import BaseModel, Field
from uuid import UUID
from typing import Optional


class LoginRequest(BaseModel):
    login: str
    password: str


class UserResponse(BaseModel):
    id: UUID
    login: str
    role: str

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class CreateUserRequest(BaseModel):
    login: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8)
    role: str = Field(default="user", pattern="^(user|admin)$")


class PatchUserRequest(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None


class ErrorResponse(BaseModel):
    error: str
    message: str


# --- Схема строки таблицы вагонов для API ---
from datetime import datetime


# --- Настройки видимости колонок таблицы ---
from typing import List


class TableSettingsOut(BaseModel):
    table_key: str
    visible_columns: List[str]


class TableSettingsUpdateRequest(BaseModel):
    visible_columns: List[str] = Field(..., min_length=1)


# --- Схема строки таблицы вагонов ---
class TrackingWagonTableRowOut(BaseModel):
    """Response schema для строк таблицы активных/архивных вагонов."""
    id: UUID
    railway_carriage_number: str
    flight_start_date: Optional[datetime] = None
    current_station_name: Optional[str] = None
    current_operation_name: Optional[str] = None
    last_operation_date: Optional[datetime] = None
    is_active: bool
    number_train: Optional[str] = None
    train_index: Optional[str] = None
    number_railway_carriage_on_train: Optional[str] = None
    last_comment_text: Optional[str] = None
    # Расширенные поля из dislocation
    remaining_distance: Optional[str] = None
    remaining_mileage: Optional[str] = None
    waybill_number: Optional[str] = None
    type_railway_carriage: Optional[str] = None
    owners_administration: Optional[str] = None
    container_numbers: Optional[str] = None
    destination_station_name: Optional[str] = None
    departure_station_name: Optional[str] = None

    class Config:
        from_attributes = True


# ─── Схемы иерархической модели (v2) ─────────────────────────────────────────

from typing import Generic, TypeVar

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    limit: int
    pages: int


class WagonOut(BaseModel):
    id: UUID
    railway_carriage_number: str
    is_active: bool
    trip_count: int = 0
    active_trip_count: int = 0
    last_comment_text: Optional[str] = None
    # Поля последнего активного рейса
    number_train: Optional[str] = None
    train_index: Optional[str] = None
    number_railway_carriage_on_train: Optional[str] = None
    last_station_name: Optional[str] = None
    last_operation_name: Optional[str] = None
    last_operation_date: Optional[datetime] = None
    departure_station_name: Optional[str] = None
    destination_station_name: Optional[str] = None
    waybill_number: Optional[str] = None
    # Мастер-данные (заполняются из внешних систем)
    owner: Optional[str] = None
    type: Optional[str] = None
    last_repair_date: Optional[datetime] = None
    next_repair_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class WagonTripOut(BaseModel):
    id: UUID
    wagon_id: UUID
    railway_carriage_number: Optional[str] = None
    flight_number: Optional[int] = None   # Порядковый номер рейса у данного вагона
    flight_start_date: Optional[datetime] = None
    departure_station_code: Optional[str] = None
    departure_station_name: Optional[str] = None
    destination_station_code: Optional[str] = None
    destination_station_name: Optional[str] = None
    number_train: Optional[str] = None
    train_index: Optional[str] = None
    number_railway_carriage_on_train: Optional[str] = None
    is_active: bool
    last_operation_date: Optional[datetime] = None
    last_operation_name: Optional[str] = None
    last_operation_code: Optional[str] = None
    last_station_name: Optional[str] = None
    last_comment_text: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class WagonTripOperationOut(BaseModel):
    id: UUID
    trip_id: UUID
    operation_datetime: Optional[datetime] = None
    operation_code: Optional[str] = None
    operation_name: Optional[str] = None
    station_code: Optional[str] = None
    station_name: Optional[str] = None
    remaining_distance: Optional[str] = None
    number_train: Optional[str] = None
    train_index: Optional[str] = None
    number_railway_carriage_on_train: Optional[str] = None
    waybill_number: Optional[str] = None
    container_numbers: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class WagonCommentOut(BaseModel):
    id: UUID
    wagon_id: UUID
    comment_text: str
    author_name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TripCommentOut(BaseModel):
    id: UUID
    trip_id: UUID
    comment_text: str
    author_name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CommentHistoryOut(BaseModel):
    id: UUID
    entity_type: str
    entity_id: UUID
    changed_by: str
    changed_at: Optional[datetime] = None
    old_text: Optional[str] = None
    new_text: str

    class Config:
        from_attributes = True


class CommentCreateRequest(BaseModel):
    text: str = Field(..., min_length=1)


class CommentEditRequest(BaseModel):
    text: str = Field(..., min_length=1)


class CommentConstructorSearchItem(BaseModel):
    """Строка результата поиска для конструктора комментариев."""
    entity_type: str  # "wagon" | "trip"
    entity_id: UUID
    railway_carriage_number: str
    flight_number: Optional[int] = None
    flight_start_date: Optional[datetime] = None
    route: Optional[str] = None
    status: Optional[str] = None
    last_operation_name: Optional[str] = None


class CommentConstructorApplyRequest(BaseModel):
    entity_type: str  # "wagon" | "trip"
    entity_ids: list[UUID]
    text: str = Field(..., min_length=1, max_length=2000)


class CommentConstructorApplyResult(BaseModel):
    total_requested: int
    success_count: int
    failed_count: int
    failed_ids: list[UUID] = []
    status: str  # "success" | "partial" | "failure"
    message: str


class SyncV2Result(BaseModel):
    wagons_created: int = 0
    wagons_updated: int = 0
    trips_created: int = 0
    trips_updated: int = 0
    operations_inserted: int = 0
    errors: int = 0
    status: str = "success"
    trips_normalized_deactivated: int = 0
    trips_merged: int = 0  # объединённые дубли (один рейс на вагон/день)
