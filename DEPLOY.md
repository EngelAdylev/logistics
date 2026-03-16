# Инструкция по деплою — Railway Project

## Что получает DevOps

| Файл / директория | Описание |
|---|---|
| `backend/` | FastAPI-приложение (Python 3.10) |
| `frontend/` | React-приложение (Vite, собирается в Docker) |
| `docker-compose.prod.yml` | Production-конфиг без БД (БД внешняя) |
| `init-letsencrypt.sh` | Скрипт первичного получения SSL-сертификата |
| `.env.example` | Шаблон переменных окружения |

**База данных внешняя** — контейнер БД не запускается.
Схема применяется автоматически при старте backend (SQLAlchemy `create_all`).

---

## Требования к серверу

- Ubuntu 22.04 / Debian 12 (рекомендуется)
- Docker Engine ≥ 24
- Docker Compose Plugin ≥ 2.20
- Открытые порты: **80** (HTTP / Let's Encrypt challenge) и **443** (HTTPS)
- DNS: домен должен указывать на IP сервера **до** запуска

---

## Шаг 1. Скопировать проект на сервер

```bash
# Вариант A — если репозиторий доступен
git clone <repo_url> railway_project
cd railway_project

# Вариант B — из архива
tar -xzf railway_project.tar.gz
cd railway_project
```

---

## Шаг 2. Создать .env

```bash
cp .env.example .env
nano .env   # или любой редактор
```

Заполнить все поля:

```ini
DOMAIN=yourdomain.com           # FQDN, без https://
CERTBOT_EMAIL=you@example.com   # email для Let's Encrypt

# Внешняя PostgreSQL:
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DBNAME

# JWT secret (сгенерировать):
# openssl rand -hex 32
JWT_SECRET=<64-символьная строка>

ADMIN_LOGIN=admin
ADMIN_PASSWORD=<сильный пароль>
```

> **Важно:** `.env` должен лежать в корне проекта рядом с `docker-compose.prod.yml`.
> Никогда не коммитьте `.env` в git.

---

## Шаг 3. Получить SSL-сертификат (первый раз)

```bash
chmod +x init-letsencrypt.sh
./init-letsencrypt.sh
```

Скрипт:
1. Создаёт временный самоподписанный сертификат
2. Поднимает nginx для прохождения HTTP-challenge
3. Получает реальный сертификат от Let's Encrypt
4. Перезагружает nginx с рабочим сертификатом

> Если домен ещё не смотрит на сервер — сертификат не выдастся. Сначала настройте DNS.

---

## Шаг 4. Запустить все сервисы

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Проверить статус:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend --tail=50
```

---

## Шаг 5. Первичная инициализация данных (один раз)

После первого запуска таблицы создаются автоматически.
Нужно вручную запустить полную синхронизацию иерархической модели:

```bash
# Получить JWT токен администратора
TOKEN=$(curl -s -X POST https://${DOMAIN}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Запустить полную пересборку
curl -X POST https://${DOMAIN}/api/v2/sync \
  -H "Authorization: Bearer $TOKEN"
```

> Это занимает несколько минут при большом объёме данных.
> Дальнейшие синхронизации выполняются автоматически каждые 10 минут.

---

## Архитектура сервисов

```
Internet → 443/80
              │
        [frontend: nginx]
              │
         /api/*  → proxy_pass → [backend: uvicorn :8000]
              │                       │
              │                  [External PostgreSQL]
              │
         /*  → /usr/share/nginx/html (React SPA)
```

- **frontend** (nginx) слушает 80 и 443, отдаёт статику React, проксирует `/api/*` на backend
- **backend** (uvicorn) слушает только внутри Docker-сети (не экспонируется наружу)
- **certbot** автообновляет SSL каждые 12 часов

---

## Обновление приложения

```bash
git pull                    # получить новый код
docker compose -f docker-compose.prod.yml up -d --build
# (старые контейнеры заменятся новыми, downtime ~5-10 сек)
```

---

## Полезные команды

```bash
# Логи backend в реальном времени
docker compose -f docker-compose.prod.yml logs -f backend

# Логи frontend (nginx)
docker compose -f docker-compose.prod.yml logs -f frontend

# Перезапустить только backend
docker compose -f docker-compose.prod.yml restart backend

# Остановить всё
docker compose -f docker-compose.prod.yml down

# Остановить и удалить образы
docker compose -f docker-compose.prod.yml down --rmi all
```

---

## Troubleshooting

| Симптом | Что проверить |
|---|---|
| 502 Bad Gateway | `docker logs railway_backend` — скорее всего ошибка подключения к БД |
| SSL-сертификат не выдаётся | DNS домена указывает на нужный IP? Порт 80 открыт? |
| Backend падает при старте | Проверить `DATABASE_URL` в `.env` — доступна ли внешняя БД с сервера |
| Certbot не обновляет сертификат | `docker logs railway_certbot` — проверить ошибки renewal |
| Приложение не авторизует | Проверить `JWT_SECRET` в `.env` — должен быть одинаковым при перезапуске |

---

## Создание архива для передачи (запускать у разработчика)

```bash
cd /path/to/railway_project
git archive --format=tar.gz --prefix=railway_project/ HEAD \
  -o /tmp/railway_project.tar.gz

# Проверить содержимое
tar -tzf /tmp/railway_project.tar.gz | head -30
```

`git archive` автоматически исключает `node_modules/`, `postgres_data/`, `.env` и всё из `.gitignore`.
