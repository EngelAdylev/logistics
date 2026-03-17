# Деплой Railway Project

## Требования к серверу
- Docker Engine ≥ 24
- Docker Compose Plugin ≥ 2.20
- Открытый порт **80**
- Внешняя PostgreSQL-база данных (подключается через `DATABASE_URL`)

---

## Шаг 1. Клонировать репозиторий

```bash
git clone <repo_url> railway_project
cd railway_project
```

---

## Шаг 2. Создать .env

```bash
cp .env.example .env
nano .env
```

Заполнить:

```ini
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DBNAME
JWT_SECRET=<openssl rand -hex 32>
ADMIN_LOGIN=admin
ADMIN_PASSWORD=<сильный пароль>
```

---

## Шаг 3. Запустить

```bash
docker compose up -d --build
```

Приложение доступно на `http://SERVER_IP`.

---

## Архитектура

```
:80  →  [frontend: nginx]
              │
         /api/*  →  [backend: uvicorn :8000]
                          │
                    [External PostgreSQL]
```

- Frontend (nginx) принимает все запросы на порту 80
- `/api/*` проксируется на backend внутри Docker-сети
- Backend не экспонируется наружу

---

## Обновление

```bash
git pull
docker compose up -d --build
```

---

## Полезные команды

```bash
# Логи
docker compose logs -f backend
docker compose logs -f frontend

# Перезапуск
docker compose restart backend

# Остановить
docker compose down
```

---

## Troubleshooting

| Симптом | Причина |
|---|---|
| 502 Bad Gateway | Проверить `DATABASE_URL` в `.env` — доступна ли БД с сервера |
| Не авторизует | Проверить `JWT_SECRET` — должен быть одинаковым при перезапусках |
| Порт 80 занят | `ss -tlnp \| grep :80` — остановить nginx/apache системный |
