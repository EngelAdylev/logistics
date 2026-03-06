from datetime import datetime
from pydantic import BaseModel, Field, field_validator
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


class UserOut(BaseModel):
    """Безопасная схема для выдачи списка пользователей (без password_hash, token_version и т.д.)."""
    id: UUID
    login: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None

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


# --- Комментарии ---

class CommentAuthorOut(BaseModel):
    id: UUID
    login: str

    class Config:
        from_attributes = True


class CommentOut(BaseModel):
    id: UUID
    comment_text: str
    created_at: datetime
    author_id: Optional[UUID] = None
    author_login: Optional[str] = None

    class Config:
        from_attributes = True


class CommentCreateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)

    @field_validator("text", mode="before")
    @classmethod
    def trim_and_validate(cls, v: str) -> str:
        if not isinstance(v, str):
            raise ValueError("comment_text must be a string")
        v = v.strip()
        if not v:
            raise ValueError("comment_text cannot be empty")
        if len(v) > 1000:
            raise ValueError("comment_text must be at most 1000 characters")
        return v
