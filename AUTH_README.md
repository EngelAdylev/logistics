# Аутентификация

## Вход в систему

- **URL приложения:** http://localhost:3000
- **API:** http://localhost:8000

### Учётные данные по умолчанию

При первом запуске создаётся администратор:

- **Логин:** `admin`
- **Пароль:** `admin12345`

> В продакшене задайте `ADMIN_LOGIN` и `ADMIN_PASSWORD` в переменных окружения.

## Роли

| Роль   | Доступ                                        |
|--------|-----------------------------------------------|
| `user` | Вагоны, комментарии                           |
| `admin`| Вагоны, комментарии + админка пользователей   |

## API

- `POST /auth/login` — вход (JSON: `login`, `password`)
- `POST /auth/refresh` — обновление access token (cookie)
- `POST /auth/logout` — выход
- `GET /auth/me` — текущий пользователь

Защищённые эндпоинты требуют заголовок: `Authorization: Bearer <access_token>`.

## Конфигурация (backend .env)

```
JWT_SECRET=your-secret-key-min-32-chars
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
ADMIN_LOGIN=admin
ADMIN_PASSWORD=admin12345
```
