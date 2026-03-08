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
