# 🚂 Railway Wagon Tracking System — Полная архитектура

## СОДЕРЖАНИЕ
1. **Бизнес-контекст** — зачем это нужно
2. **Модели данных** — что живёт в БД
3. **Поток данных** — откуда берутся данные и как они трансформируются
4. **Синхронизация** — сердце системы (8 шагов)
5. **API endpoints** — что экспортируется наружу
6. **Критические правила** — бизнес-ограничения

---

## 1️⃣ БИЗНЕС-КОНТЕКСТ

### Предмет
РЖД-вагоны на станции **Круглое Поле (648400)** (завод). Каждый вагон следует от отправления до нас, потом от нас до пункта назначения.

### Три потока информации

#### **Поток A: РЖД-дислокация** (дерт/часы)
- Источник: webhook от РЖД `POST /webhooks/dislocation`
- Данные: где вагон сейчас, номер поезда, ближайшая станция, km до пункта назначения, операция (погрузка/разгрузка)
- Точность: микро-секунды, но дублируются (один вагон прибывает, потом уезжает — могут быть N обновлений за час)
- Хранится в: `dislocation` (raw, история)

#### **Поток B: ЭТРАН-накладные** (часы/дни)
- Источник: webhook от РЖД `POST /webhooks/etran` (ГУ-27 бланки)
- Данные: список вагонов в конкретной накладной, груз, отправитель, получатель, контейнеры
- Хранится в: `etran_waybills` + `etran_waybill_wagons` (с ссылкой на наш вагон)

#### **Поток C: Заявки на приёмку** (пользователи вводят вручную)
- Источник: UI "Поезда" → "Назначить клиентов"
- Данные: какие вагоны из какого поезда получает конкретный клиент
- Хранится в: `receiving_orders` + `receiving_order_items` (с ссылкой на вагон + накладную)
- **Экспорт**: JSON → 1С (система учёта)

---

## 2️⃣ МОДЕЛИ ДАННЫХ

### Слой 1: RAW (как поступило от РЖД)
```
dislocation (сырые пакеты)
├─ railway_carriage_number: "42691234"
├─ flight_start_date: timestamp (когда вагон выехал со станции отправления)
├─ flight_start_station_code: "648400" или "648401"
├─ date_time_of_operation: timestamp (когда случилась последняя операция)
├─ station_code_performing_operation: код станции
├─ operation_code_railway_carriage: "96" (прибыл), "20" (убыл), etc.
├─ remaining_distance: km до пункта назначения
├─ number_train: номер поезда (может меняться! переледование)
├─ waybill_number: номер накладной (грязный, много дублей)
└─ flight_id: UUID (ссылка на wagon_trips, добавляется при синхе)

tracking_wagons (LEGACY — старая витрина, сейчас неуправляемая)
├─ railway_carriage_number
├─ flight_start_date (нормализованная дата, день МСК)
├─ current_station_name
├─ is_active: true/false (архив)
└─ comments: WagonComment[]
```

### Слой 2: ИЕРАРХИЯ (нормализованная, основная модель)
```
wagons (уровень вагона — один номер = одна запись)
├─ railway_carriage_number: UNIQUE "42691234"
├─ is_active: true если есть активный рейс
├─ owner: "РЖД" (мастер-данные)
├─ type: "платформа" или "крытый"
└─ trips: WagonTrip[]  ← много рейсов!

wagon_trips (рейс вагона — один вагон может быть в N рейсах)
├─ id: UUID
├─ wagon_id: ссылка на вагон
├─ flight_start_date: дата начала рейса (canonical UTC, no microseconds)
├─ flight_number: 1, 2, 3... (порядковый номер для рейса у этого вагона)
├─ departure_station_code: "648400" (нормализованный, ключ для дедупликации)
├─ departure_station_name: "Круглое Поле"
├─ destination_station_code: "628406" и т.д.
├─ destination_station_name: "Сосновоборск"
├─ number_train: (денормализовано, может быть несколько!)
├─ remaining_distance: (последнее известное значение)
├─ is_active: true/false (рейс завершён)
├─ last_operation_date: (денормализовано для быстрого доступа)
├─ last_operation_name: "Убыл"
├─ last_station_name: текущая станция
├─ operations: WagonTripOperation[]
├─ comments: TripComment[]
└─ trip_waybills: TripWaybill[]  (ссылки на ЭТРАН)

wagon_trip_operations (история дислокации конкретного рейса)
├─ trip_id: ссылка на рейс
├─ operation_datetime: когда
├─ operation_code: "96" / "20"
├─ station_name: где
├─ remaining_distance: сколько км осталось
└─ UNIQUE (trip_id, datetime, code)  ← один рейс = упорядоченный лог операций
```

### Слой 3: ЭТРАН (накладные)
```
etran_waybills (наши координаты для груза)
├─ waybill_number: "А123-456" (может повторяться в разных пакетах)
├─ source_message_id: ID пакета (UNIQUE с waybill_number)
├─ status: "В пути", "Груз прибыл"
├─ shipper_name: "ООО Альфа"
├─ consignee_name: "ООО Бета"
├─ departure_station_code: "648400"
├─ destination_station_code: "628406"
└─ wagons: EtranWaybillWagon[]

etran_waybill_wagons (вагон + контейнер из накладной)
├─ waybill_id: ссылка на накладную
├─ railway_carriage_number: "42691234"
├─ container_number: "КТК1234" или NULL (порожний вагон)
├─ cargo_name: первый груз (для быстрого доступа)
├─ wagon_id: ссылка на наш Wagon (опционально, заполняется при матчинге)
└─ UNIQUE (waybill_id, carriage_number, container_number)

trip_waybills (связь рейса с накладными)
├─ wagon_trip_id: ссылка на рейс
├─ waybill_id: ссылка на накладную
└─ UNIQUE (trip, waybill)  ← один рейс может быть в N накладных
```

### Слой 4: ЗАЯВКИ И ПОЕЗДА
```
railway_routes (болванка поезда)
├─ train_number: "9876" UNIQUE
├─ train_index: индекс (может быть NULL)
├─ snapshot_data: JSONB (состав на момент создания)
├─ status: "open" / "closed"
└─ orders: ReceivingOrder[]

receiving_orders (заявка на приёмку)
├─ order_number: 1, 2, 3... (глобальный счётчик)
├─ route_id: ссылка на поезд
├─ client_name: кто забирает
├─ status: "new" / "in_progress" / "done"
└─ items: ReceivingOrderItem[]

receiving_order_items (строка заявки = КТК)
├─ order_id: ссылка на заявку
├─ route_id: ссылка на поезд
├─ waybill_id: ссылка на ЭТРАН (опционально)
├─ wagon_number: "42691234"
├─ container_number: "КТК1234" или NULL
└─ 3 уникальных индекса (partial):
   - (route, waybill, container) WHERE waybill IS NOT NULL AND container IS NOT NULL
   - (route, waybill, wagon)    WHERE waybill IS NOT NULL AND container IS NULL
   - (route, wagon)              WHERE waybill IS NULL
```

### Слой 5: КОММЕНТАРИИ И ЛОГИ
```
wagon_entity_comments (долгоживущие комментарии по вагону)
├─ wagon_id
├─ comment_text
└─ author_name, created_at, updated_at

trip_comments (оперативные комментарии по рейсу)
├─ trip_id
├─ comment_text
└─ author_name, created_at, updated_at

comment_history (аудит всех изменений)
├─ entity_type: "wagon" / "trip"
├─ entity_id
├─ old_text / new_text
├─ changed_by
└─ changed_at

etran_incoming_log (лог всех входящих пакетов ЭТРАН)
├─ message_id
├─ waybill_number
├─ status_received
├─ action_taken: "created" / "updated" / "filtered_out"
└─ raw_payload: JSONB (весь пакет для aудита)
```

---

## 3️⃣ ПОТОК ДАННЫХ (DATA FLOW)

```
         ┌─── РЖД webhook (дислокация) ──┐
         │                                 │
         └──> [dislocation table] (raw)   │
              (история всех событий)      │
              │                            │
              └──> SCHEDULER каждые 10 мин │
                   (sync_all)              │
                   │                       │
                   ├─> [sync_service_v2] ◄─┘
                   │   (8 шагов)
                   │
                   ├─> Шаг 1: fetch qualifying (ТЗ №1)
                   │   - фильтруем dislocation по кодам операций (96, 20, 80, 85)
                   │   - убираем дубли по (вагон, дата, станция отправления)
                   │
                   ├─> Шаг 2: create/find wagons + trips
                   │   - на каждой паре создаём Wagon + WagonTrip
                   │   - ключ рейса: (вагон_номер, day_msk, dep_station_code)
                   │
                   ├─> Шаг 3: batch update dislocation.flight_id
                   │   - dislocation → wagon_trips (привязка)
                   │
                   ├─> Шаг 4: denormalize wagon_trips
                   │   - UPDATE last_operation_date, last_operation_name, etc.
                   │
                   ├─> Шаг 5: assgin flight_numbers
                   │   - 1, 2, 3... для каждого вагона
                   │
                   ├─> Шаг 6: create operations + merge
                   │   - WagonTripOperation из dislocation
                   │   - один рейс = упорядоченный лог
                   │
                   ├─> Шаг 7: archive logic
                   │   - рейсы с операцией "96" (код архива) → is_active=false
                   │
                   ├─> Шаг 7b: reactivation
                   │   - если рейс повторно был виден, снимаем архив
                   │
                   ├─> Шаг 8: link waybills
                   │   - trip → etran_waybill (по wagon_number)
                   │
                   └─> Шаг 9: ensure bolvankas
                       - если min(km) ≤ 150, создаём railway_routes болванку
```

---

## 4️⃣ СИНХРОНИЗАЦИЯ (THE HEART) — 8 ШАГОВ

### ТЗ №1: Квалификация (Step 1)

**Проблема**: В `dislocation` один вагон присутствует N раз (разные станции, разные операции).
```
dislocation:
  42691234 | 2025-01-15 | 648400 | 96 (прибыл) | 2025-01-15 10:00
  42691234 | 2025-01-15 | 648400 | 20 (убыл)   | 2025-01-15 11:00
  42691234 | 2025-01-16 | 628406 | 96 (прибыл) | 2025-01-16 10:00  ← новый рейс!
  42691234 | 2025-01-16 | 628406 | 20 (убыл)   | 2025-01-16 11:00
```

**Решение**: Берём уникальные пары `(wagon_number, flight_start_date, departure_station)`:
- Пара 1: `(42691234, 2025-01-15, 648400)` = рейс 1
- Пара 2: `(42691234, 2025-01-16, 628406)` = рейс 2

**SQL в scheduler.py — `_fetch_qualifying_rows()`**:
```sql
WHERE operation_code_railway_carriage IN ('96', '20', '80', '85')
GROUP BY railway_carriage_number, DATE(flight_start_date), flight_start_station_code
```

Также отфильтровываются:
- Удалённые записи (marked as deleted)
- Рейсы кроме как на станцию 648400 или уходящие со 648400 (ТЗ №1)

### ТЗ №2: Ключ рейса — (вагон, дата, станция)

Один вагон может за день приехать со СВОЕЙ станции и уехать в ДРУГУЮ:
```
Рейс 1: А → Круглое Поле (648400)  — приезд на нашу станцию
Рейс 2: Круглое Поле → Б             — уезд с нашей станции

Ключ Рейса 1: (вагон, 2025-01-15, станция_A)
Ключ Рейса 2: (вагон, 2025-01-15, 648400)
```

**Нормализация даты** (бизнес-дата в МСК):
```python
def _business_date(dt: datetime) -> date:
    """
    Дата в МСК (UTC+3).
    2025-01-15 22:00 UTC → 2025-01-16 01:00 МСК → 2025-01-16 (один день в МСК)
    """
    return (dt.astimezone(UTC) + timedelta(hours=3)).date()
```

Микросекунды убираются → каноническая форма (UTC, no microseconds).

### ТЗ №3-5: Создание wagons/trips + привязка + денормализация

**Шаг 2**: Для каждой qualifying пары создаём:
```python
wagon = Wagon(railway_carriage_number="42691234")  # если не существует
trip = WagonTrip(
    wagon_id=wagon.id,
    flight_start_date=canonical_dt,  # 2025-01-15T00:00:00 UTC (день)
    flight_number=1,
    departure_station_code="648400",
    is_active=True,
)
```

**Шаг 3**: Batch UPDATE dislocation.flight_id:
```sql
UPDATE dislocation d
SET flight_id = wt.id
FROM wagon_trips wt
WHERE d.railway_carriage_number = wt.wagon.railway_carriage_number
  AND d.flight_start_date (как дата МСК) = wt.flight_start_date (как дата МСК)
  AND d.departure_station_code = wt.departure_station_code
  AND d.flight_id IS NULL
```

**Шаг 4**: Денормализация (UPDATE wagon_trips):
```sql
UPDATE wagon_trips wt
SET 
  last_operation_date = (SELECT MAX(date_time_of_operation) FROM dislocation WHERE flight_id = wt.id),
  last_operation_name = ...,
  last_station_name = ...,
  remaining_distance = ...,
  number_train = ...,
FROM dislocation d WHERE d.flight_id = wt.id
```

**Шаг 5**: Assign flight_numbers (1, 2, 3... per wagon):
```sql
UPDATE wagon_trips wt
SET flight_number = ROW_NUMBER() OVER (PARTITION BY wagon_id ORDER BY flight_start_date)
```

### ТЗ №6-7: Операции + архивация

**Шаг 6a**: Создаём WagonTripOperation:
```python
for d_row in dislocation:
    if d_row.flight_id:
        op = WagonTripOperation(
            trip_id=d_row.flight_id,
            operation_datetime=d_row.date_time_of_operation,
            operation_code=d_row.operation_code,
            station_name=...,
        )
        db.add(op)
```

**Шаг 6b**: Merge дублей (один рейс на ключ):
```sql
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY wagon_id, business_date, dep_station
    ORDER BY flight_start_date, id
  ) AS rn
  FROM wagon_trips
)
DELETE FROM wagon_trips WHERE id IN (SELECT id FROM dups WHERE rn > 1)
```

### ТЗ №7: Архивация

**Правило**: Рейс архивируется, если:
1. **Код операции 96** (прибыл на станцию) — признак завершения рейса
2. ИЛИ **день >= сейчас + 2 дня** и рейс на нашу станцию (648400)
   - вагон не должен стоять на нас дольше 2 дней
3. ИЛИ **станция 648400** и **операция 20** (убыл) — уехал со станции

```python
# Архивируем
is_archived = (
    has_operation_96 or  # прибыл (завершил рейс)
    (destination == "648400" and days_on_station > 2) or  # застрял на нас
    (station == "648400" and has_operation_20)  # убыл с нашей станции
)
```

### ТЗ №7b: Реактивация (ТЗ №5)

Если вагон был ошибочно архивирован, но потом появился в новом пакете дислокации:
```python
if trip.is_active == False:  # был в архиве
    and trip.id in new_dislocation_package:  # вдруг появился
        trip.is_active = True  # вытаскиваем из архива
```

### ТЗ №8: Trip Waybills

После синха связываем рейсы с ЭТРАН-накладными:
```sql
INSERT INTO trip_waybills (trip_id, waybill_id)
SELECT wt.id, ew.id
FROM wagon_trips wt
JOIN wagons w ON w.id = wt.wagon_id
JOIN etran_waybill_wagons eww ON eww.railway_carriage_number = w.railway_carriage_number
JOIN etran_waybills ew ON ew.id = eww.waybill_id
WHERE wt.is_active = true AND ew.is_relevant = true
ON CONFLICT DO NOTHING
```

---

## 5️⃣ API ENDPOINTS (ЧТО ЭКСПОРТИРУЕТСЯ НАРУЖУ)

### Legacy endpoints (СТАРАЯ модель, остаються для совместимости)
```
GET /wagons/summary                    — counts active/archived
GET /wagons/active                     — список active wagons из tracking_wagons
GET /wagons/archive                    — список archived wagons
POST /wagons/sync                      — ручное обновление (старая логика)
```

### V2 endpoints (НОВАЯ иерархическая модель)

#### Вагоны
```
GET /v2/wagons?is_active=true&page=1&limit=50
    Response: { items: [{ id, railway_carriage_number, is_active, trips: [...], comments: [...] }] }

GET /v2/wagons/{wagon_id}
    Детальная информация о вагоне + все его рейсы

GET /v2/wagons/{wagon_id}/trips
    Все рейсы этого вагона
```

#### Рейсы (trips)
```
GET /v2/wagon-trips?is_active=true&page=1&limit=50
    Список рейсов со статусом

GET /v2/wagon-trips/{trip_id}
    Деталь рейса: all операции, all комментарии, waybills

GET /v2/wagon-trips/{trip_id}/operations
    История дислокации (упорядоченный лог)

GET /v2/wagon-trips/{trip_id}/comments
    Комментарии по рейсу

POST /v2/wagon-trips/{trip_id}/comments
    Добавить комментарий (вести оперативный лог)

PATCH /v2/wagon-trips/{trip_id}
    Обновить статус / denormalized fields (редко)
```

#### Поезда (trains) + болванки
```
GET /v2/trains?limit=50
    Список всех поездов (из railway_routes)
    Response: { items: [{ train_number, train_index, wagon_total, matched_wagons, min_km, status, route_id, ready }] }

GET /v2/routes/{route_id}
    Состав поезда (wagons + orders)

POST /v2/routes/{route_id}/orders
    Создать заявку (receiving_order + items)

PATCH /v2/orders/{order_id}
    Обновить заявку

DELETE /v2/orders/{order_id}
    Удалить заявку

DELETE /v2/order-items/{item_id}
    Удалить строку из заявки

GET /v2/routes/{route_id}/export
    Экспорт JSON → 1С
```

#### ЭТРАН-накладные
```
GET /v2/waybills?is_relevant=true&page=1
    Список накладных

GET /v2/waybills/{waybill_id}
    Деталь накладной + вагоны

POST /webhooks/etran (ВНУТРЕННИЙ — webhook от РЖД)
    Приём пакета ГУ-27, сохранение в etran_waybills + etran_waybill_wagons
```

#### Комментарии (конструктор массовых комментариев)
```
POST /v2/comment-constructor/apply
    { entity_type: "wagon", entity_ids: [...], text: "..." }
    Добавить один комментарий ко многим вагонам / рейсам сразу
```

#### Синхронизация (admin)
```
POST /wagons/sync
    Ручной sync (old model) — доступно любому user

POST /v2/sync
    Ручной sync (new model v2) — доступно только admin

POST /admin/rebuild-tracking
    Полная пересборка wagon_trips из dislocation

POST /admin/clear-data
    Очистить все бизнес-данные (для reset)

GET /admin/diagnostic
    Диагностика: counts, примеры, результаты qualifying-запроса

GET /admin/diagnostic/wagon/{wagon_number}
    Диагностика конкретного вагона: flight_dates vs trips
```

#### Аутентификация
```
POST /auth/login
    { login, password } → { access_token, refresh_token }

POST /auth/refresh
    Обновить access token

POST /auth/logout
    Revoke все sessions

GET /auth/me
    Текущий пользователь
```

---

## 6️⃣ КРИТИЧЕСКИЕ ПРАВИЛА (BUSINESS RULES)

### Rule 1: Ключ рейса
**Один рейс = вагон + календарный день (МСК) + станция отправления**

```
Вагон 42691234 может быть:
- 2025-01-15 со станции А
- 2025-01-15 со станции 648400 (Круглое Поле)
- 2025-01-16 со станции Б

Это разные рейсы! (4 уникальных рейса за 1.5 дня)
```

### Rule 2: Дата нормализуется до дня в МСК
Микросекунды убираются. Timezone приводится к МСК для дедупликации.

```
2025-01-15 22:00 UTC = 2025-01-16 01:00 МСК
→ ключ = 2025-01-16
```

### Rule 3: Архивация по правилам
Рейс архивируется (is_active=false) только если:
- Явно указана операция 96 (код архива РЖД), ИЛИ
- Рейс на нашу станцию (648400) и стоит >2 дней, ИЛИ
- Убыл со станции 648400 (операция 20)

**Никогда по таймауту!** (кроме правила +2 дня для нашей станции)

### Rule 4: Один вагон не может быть в двух активных рейсах одновременно
При синхе проверяется дедупликация по (wagon_id, business_date, dep_station).
Если появилось несколько дублей — оставляется первый (по flight_start_date).

### Rule 5: Болванка поезда создаётся, когда MIN(km) ≤ 150 км
- Болванка = снимок состава в момент создания (snapshot_data)
- Болванка остаётся, пока поезд не закрыт вручную (status=closed)
- В болванке можно создавать заявки

### Rule 6: Одна строка заявки не может быть в двух заявках
Частичные уникальные индексы:
- (route, waybill, container) WHERE waybill IS NOT NULL AND container IS NOT NULL
- (route, waybill, wagon) WHERE waybill IS NOT NULL AND container IS NULL
- (route, wagon) WHERE waybill IS NULL

### Rule 7: Вагон без накладной (lonely wagon)
Вагон без ссылки на etran_waybills может быть в заявке:
```
receiving_order_item {
  wagon_number: "42691234",
  waybill_id: NULL,
  container_number: NULL
}
```

### Rule 8: ЭТРАН-пакет может повторяться
Один `waybill_number` может прийти в разных пакетах (разные message_id).
Constraint: `UNIQUE(waybill_number, source_message_id)` → одна строка на комбинацию.

### Rule 9: Реактивация (ТЗ №5)
Если рейс был архивирован, но потом появился в новом пакете дислокации → снять архив.
```python
if trip.is_active == false and trip.id in new_dislocation:
    trip.is_active = true
```

### Rule 10: Экспорт в 1С — необратим
Когда заявка помечена как `exported=true` или закрыта маршрут → никаких изменений.

---

## 7️⃣ КРИТИЧЕСКИЕ ФАЙЛЫ

```
backend/
├─ main.py                      Входная точка, startup-миграции, legacy endpoints
├─ models.py                    ВСЕ SQLAlchemy модели (25+ таблиц)
├─ database.py                  engine, SessionLocal
├─ config.py                    конфиг (DATABASE_URL, JWT_SECRET, etc.)
├─ auth.py                      JWT логика, password hashing
├─ scheduler.py                 APScheduler, sync_all() каждые 10 мин
│                                _fetch_qualifying_rows(), _parse_flight_start_date()
├─ wagon_table_service.py       CTE-запрос для витрины tracking_wagons (legacy)
├─ services/
│  └─ sync_service_v2.py        🔥 ЯДРО: 8-шаговая синхронизация (главный файл для рефакторинга!)
├─ routers/
│  ├─ auth_router.py            /auth/* endpoints
│  ├─ hierarchy_router.py       /v2/* (вагоны, рейсы, операции, комментарии)
│  ├─ trains_router.py          /v2/trains, /v2/routes, /v2/orders
│  ├─ etran_router.py           /v2/waybills, POST /webhooks/etran
│  ├─ dislocation_webhook_router.py  POST /webhooks/dislocation
│  └─ table_settings_router.py  Сохранение пользовательских настроек таблиц
├─ schemas.py                   Pydantic-модели для API
└─ tests/
   └─ test_sync_normalization.py Юнит-тесты синха
```

---

## 8️⃣ ГДЕ ЖИВЁТ БОЛЬ? (LEGACY债務)

### Проблема 1: Две модели данных одновременно
- **Old**: `tracking_wagons` (витрина, управляется scheduler'ом через merge)
- **New**: `wagon_trips` (иерархия, управляется sync_service_v2)

Обе живут, обе обновляются, часто расходятся.

**Solution**: Выставить tracking_wagons на архив, использовать только wagon_trips.

### Проблема 2: sync_service_v2.py — 400+ строк непроходимого кода
- 8 шагов перемешаны друг с другом
- Нет явной структуры (каждый шаг — отдельный метод?)
- Комментарии по-русски и по-английски
- Raw SQL + ORM перемешаны

**Solution**: Рефакторить на микрошаги:
```
sync_new_model()
├─ step_1_fetch_qualifying_pairs()
├─ step_2_upsert_wagons_and_trips()
├─ step_3_link_dislocation_to_trips()
├─ step_4_denormalize_trips()
├─ step_5_assign_flight_numbers()
├─ step_6_create_operations()
├─ step_6b_merge_duplicates()
├─ step_7_archive()
├─ step_7b_reactivate()
├─ step_8_link_waybills()
└─ step_9_create_bolvankas()
```

### Проблема 3: Миграции в main.py
Все миграции — в `startup_event()` как raw SQL. Нет версионирования.

**Solution**: Alembic для чистоты (опционально, для большого рефакта).

### Проблема 4: Нет обработки сбоев синха
Если scheduler упал на шаге 5 из 8 → данные в полусинхронизированном состоянии.

**Solution**: Транзакция на весь sync, откат при ошибке.

### Проблема 5: Старые эндпоинты на смешанных моделях
```
POST /wagons/sync           ← использует tracking_wagons + old logic
POST /v2/sync               ← использует wagon_trips + new logic
```

**Solution**: Убить /wagons/sync, оставить только /v2/sync.

---

## 9️⃣ ИСПОЛНЕНИЕ: С ЧЕГО НАЧАТЬ (REFACTORING ROADMAP)

### Неделя 1: Рефакторинг sync_service_v2.py
1. Выделить каждый шаг в отдельный метод
2. Обеспечить транзакции (всё или ничего)
3. Добавить логирование на каждый шаг
4. Написать unit-тесты для каждого шага (используя тестовую БД)
5. Убедиться, что это работает также как сейчас

### Неделя 2: Очистка моделей
1. Убить tracking_wagons (или перевести на read-only view)
2. Все API-endpoints → только на wagon_trips
3. Убить legacy /wagons/* endpoints (оставить /v2/*)
4. Проверить все ссылки

### Неделя 3: Рефакторинг роутеров
1. Объединить logic в чистые сервис-слои (не в роутерах)
2. Убрать дублирование между routers/hierarchy_router.py и routers/trains_router.py
3. Написать единый сервис для комментариев, операций, etc.

### После: Документирование + мониторинг
1. Обновить CLAUDE.md (этот файл)
2. Настроить логирование (структурированные логи)
3. Настроить мониторинг sync'а (alerts на ошибки)

---

## 🔟 SUMMARY (TL;DR)

| Концепт | Это | Пример |
|---------|-----|--------|
| **Wagon** | Верхнеуровневый идентификатор | #42691234 (один вагон, много рейсов) |
| **WagonTrip** | Одна перевозка вагона | #42691234 от 2025-01-15 со станции А |
| **Ключ рейса** | (вагон, день МСК, станция отправления) | Деду-плицирует микро-дубли из РЖД |
| **Архивация** | Рейс завершён | Операция 96, или >2 дня на нашей станции |
| **ЭТРАН** | Накладные + вагоны в накладных | Матчинг с wagon_trips |
| **Заявка** | Какие КТК забирает клиент | receiving_order + items |
| **Болванка** | Поезд, когда MIN(km) ≤ 150 | railway_routes (создаётся автоматически) |
| **Синх** | Все 8 шагов вместе | scheduler каждые 10 мин |

**Главное**: Система нормализует РЖД-дисло в иерархию (wagon → trips → operations), связывает с ЭТРАН, позволяет пользователям создавать заявки на приём.

Сейчас много легаси-кода и двойной логики. После рефакта станет чистая 3-слойная архитектура.
