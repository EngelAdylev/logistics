"""
Создание администратора. Запуск: python scripts/create_admin.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
import models
from auth import hash_password

LOGIN = os.getenv("ADMIN_LOGIN", "admin")
PASSWORD = os.getenv("ADMIN_PASSWORD", "admin12345")


def main():
    db = SessionLocal()
    try:
        exists = db.query(models.User).filter(models.User.login == LOGIN).first()
        if exists:
            print(f"User {LOGIN} already exists. Update password.")
            exists.password_hash = hash_password(PASSWORD)
            exists.role = "admin"
            exists.is_active = True
            db.commit()
            print("Password updated.")
        else:
            user = models.User(
                login=LOGIN,
                password_hash=hash_password(PASSWORD),
                role="admin",
                is_active=True,
            )
            db.add(user)
            db.commit()
            print(f"Admin {LOGIN} created.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
