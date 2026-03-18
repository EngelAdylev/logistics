from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://admin:password123@db:5432/logistics_service"
    JWT_SECRET: str = "change-me-in-production-secret-key-min-32-chars"
    JWT_ALGO: str = "HS256"
    ACCESS_TTL_SECONDS: int = 3600
    REFRESH_TTL_SECONDS: int = 2592000
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_ATTEMPTS: int = 10
    RATE_LIMIT_WINDOW_SECONDS: int = 600

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings():
    return Settings()
