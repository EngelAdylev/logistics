"""
Скрипт миграции для перехода от старой схемы users (username) к новой (login).
Запускать один раз: python scripts/migrate_db.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/logistics_service")


def run():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        # Проверяем, есть ли колонка username (старая схема)
        r = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'users' AND column_name IN ('username', 'login')
        """))
        cols = [row[0] for row in r]
        if "username" in cols and "login" not in cols:
            conn.execute(text("ALTER TABLE users RENAME COLUMN username TO login"))
            conn.commit()
            print("Renamed username -> login")
        # Добавляем новые колонки если их нет
        for col, sql in [
            ("is_active", "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true"),
            ("created_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now()"),
            ("updated_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()"),
            ("token_version", "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"Added {col}")
            except Exception as e:
                print(f"Skip {col}: {e}")
        # Создаём user_sessions
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                refresh_token_hash TEXT NOT NULL,
                user_agent TEXT,
                ip TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                revoked_at TIMESTAMP WITH TIME ZONE
            )
        """))
        conn.commit()
        print("user_sessions table ready")
    print("Migration done.")


if __name__ == "__main__":
    run()
