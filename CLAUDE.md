# Railway Wagon Tracking System

Система автоматического слежения за железнодорожными вагонами на станции Круглое Поле (код 648400).
Получает поток дислокации РЖД, формирует рейсы, управляет приёмкой груза с экспортом в 1С.

## Стек

- **Frontend:** React 18 + Vite, без TypeScript, JSX
- **Backend:** Python 3.11, FastAPI, SQLAlchemy (async нет — sync engine)
- **БД:** PostgreSQL 15
- **Аутентификация:** JWT access tokens (15 мин) + refresh tokens (30 дней, httponly cookie)
- **Планировщик:** APScheduler (каждые 10 мин — sync_all)
- **Инфра:** Docker Compose (db + backend:8000 + frontend:3000)
- **Pydantic:** v2 (from_attributes=True, model_validate())

## Структура папок

```
backend/
  main.py                  — FastAPI app, startup-миграции, регистрация роутеров
  models.py                — все SQLAlchemy модели (wagons, wagon_trips, dislocation, orders, etc.)
  schemas.py               — Pydantic-схемы
  database.py              — engine, SessionLocal
  config.py                — настройки
  auth.py                  — JWT логика
  scheduler.py             — APScheduler, sync_all()
  wagon_table_service.py   — CTE-запрос для плоской таблицы дислокации
  table_settings.py        — пользовательские настройки таблиц
  routers/
    hierarchy_router.py    — /v2/* (вагоны, рейсы, операции, комментарии, синк)
    trains_router.py       — /v2/trains/*, /v2/routes, /v2/orders, заявки
    auth_router.py         — /auth/* (login, refresh, register)
    etran_router.py        — /etran/* (накладные ЭТРАН)
    dislocation_webhook_router.py — webhook приёма дислокации
    table_settings_router.py     — сохранение настроек таблиц
  services/
    sync_service_v2.py     — ядро: 8-шаговая синхронизация (квалификация → рейсы → архивация)
  scripts/                 — утилиты
  tests/

frontend/src/
  main.jsx                 — точка входа
  App.jsx                  — роутинг
  api.js                   — axios instance с interceptors (refresh token)
  index.css                — глобальные стили
  pages/
    WagonsPage.jsx         — главная страница (5 вкладок: Дислокация, Рейсы, Поезда, ЛКДС, Заявки)
    LoginPage.jsx          — авторизация
    AdminPage.jsx          — админ-панель
    WaybillsPage.jsx       — страница накладных
  components/
    Layout.jsx             — навигация
    hierarchy/             — компоненты матрёшки (вагон→рейс→операция)
    trains/                — TrainsView (главная таблица поездов), TrainComposition (inline состав с комментариями), RoutesListView, OrdersListView
  contexts/                — React context (auth)
  table/                   — компоненты таблиц (ColumnFilter, ColumnVisibilityPanel, etc.)
```

## Текущий статус

- [x] Автоматическая синхронизация дислокации (10 мин)
- [x] Иерархическая модель: вагоны → рейсы → операции
- [x] Архивация рейсов (8 условий: код 96, 20, 80, 85, станция 628406, 648400+2дня, etc.)
- [x] Реактивация ошибочно архивированных рейсов (Step 7b)
- [x] Болванки маршрутов при ≤150 км
- [x] Заявки на приёмку + экспорт JSON в 1С
- [x] Привязка wagon_trip_id в заявках (точная привязка при смене поезда)
- [x] Связь с ЭТРАН-накладными (trip_waybills)
- [x] Комментарии к вагонам и рейсам (с историей редактирования)
  - [x] Комментарии в Дислокации (вкладка HierarchyView)
  - [x] Комментарии в Поездах (вкладка TrainsView) — bulk select по wagon_id, форма с textarea, последний комментарий в таблице
- [x] Расширяемые строки: поезда, рейсы ЛКДС, заявки
- [x] Админ-only вкладки (Рейсы в ЛКДС, Заявки)
- [ ] В работе: стабилизация архивации, тестирование на продакшн-данных
- [ ] Планируется: уведомления (Telegram/email), аналитика, обратная связь из 1С

## Функции Поездов (TrainsView)

**Таблица поездов:**
- Колонки: №, Индекс, Вагонов (с дедупликацией по wagon_id), С накладной (только wagon_id с waybill_id), Контейнеров, Мин. остаток, Текущая станция (live), Последняя операция (live), Статус
- Поиск по номеру/индексу поезда (multi-token)
- Колоночные фильтры с поиском (Excel-like)
- Live статусы (станция, операция) из wagon_trips.last_station_name / last_operation_name
- Множественное раскрытие (expandedTrains Set)

**Состав поезда (TrainComposition):**
- Встроенная (inline) таблица вагонов при раскрытии поезда
- Выбор и видимость колонок через ColumnVisibilityPanel (8 основных + 4 маршрута + 7 технических + 3 груза + 1 комментарий = 24 колонки)
- Sticky горизонтальный скролл (синхронизация между основной таблицей и липким скроллом внизу)
- **Заявки (Orders):** Назначение клиентов с выбором накладных (mode='create'), редактирование (mode='edit'), удаление вагонов, экспорт JSON
- **Комментарии (Comments):** 
  - Режим 'add': выбор ALL строк вагона по wagon_id (не по row key), форма с textarea
  - POST /v2/comment-constructor/apply с entity_type='wagon' и entity_ids (UUIDs)
  - Столбец last_comment_text показывает последний комментарий
  - Синхронизирует с Дислокацией через один эндпоинт

**Дефаулты видимости колонок:**
- Видны: Вагон, Накладная, Контейнер, Отправитель, Получатель, Груз, Остаток, Клиент
- Скрыты по умолчанию: станции, технические, груз/контейнер, комментарии
- Пользовательские настройки сохраняются в localStorage

## Ключевые решения

- **Почему две модели данных (старая flat + новая иерархическая):** переходный период, старая `tracking_wagons` поддерживается для обратной совместимости, новая `/v2/*` — основная
- **Почему бизнес-дата (day precision) вместо точного timestamp:** источник присылает одну дату с микросекундной разницей → дубли рейсов; нормализация до дня решает проблему
- **Почему денормализация last_op полей в wagon_trips:** избежать JOIN на каждый запрос к дислокации; обновляется при синке
- **Почему wagon_trip_id в order_items:** вагон может мигрировать между поездами (перицепка); привязка к рейсу, а не к поезду, гарантирует что заявка «не потеряется»
- **Почему partial unique indexes:** один вагон может иметь несколько строк (разные накладные/контейнеры); составной ключ зависит от наличия waybill и container
- **Почему fail-safe при 0 результатах синка:** если источник прислал пустые данные — не архивируем, иначе вся база уйдёт в архив
- **Почему 150 км для болванки:** ~1.5-3 часа хода поезда, достаточно для подготовки документов

## Соглашения

- **Именование переменных:** snake_case (Python), camelCase (JS/React)
- **API:** REST, префикс `/v2/` для иерархической модели; старые эндпоинты `/wagons/*` — legacy
- **Компоненты React:** JSX, функциональные компоненты + hooks, без TypeScript
- **SQL в синке:** raw SQL через `text()` (производительность), ORM — для CRUD-операций в роутерах
- **Миграции:** startup-миграции в `main.py` (IF NOT EXISTS / DO $$ ... $$), не Alembic в продакшне
- **Язык UI:** русский
- **Коммиты:** на английском

## Критические бизнес-правила

- Станция 648400 = Круглое Поле (наш завод)
- Рейс архивируется только при явном терминальном коде (никогда по таймауту кроме правила 648400+2дня)
- У вагона не может быть >1 активного рейса одновременно (Step 8 — нормализация)
- Одна строка заявки не может быть в двух заявках (partial unique index)
- Экспорт JSON → маршрут закрыт → необратимо

## API Reference (Поезда + Комментарии)

### GET /v2/trains
Список активных поездов с назначением на 648400.
```
Response: { items: [...], total: int }
Поля item: train_number, train_index, wagon_total (DISTINCT), matched_wagons (с накладной),
  container_count, min_km, last_operation_name, last_station_name, ready (bool),
  route_id (UUID|null), route_status ("open"|"closed"|null)
```

### GET /v2/routes/{route_id}
Состав поезда (snapshot) + заявки.
```
Response: { id, train_number, train_index, status, wagons: [...], orders: [...] }
Поля wagon: trip_id, wagon_id, wagon_number, remaining_distance, last_station_name,
  last_operation_name, departure_station_name, destination_station_name,
  waybill_id, waybill_number, container_number, shipper_name, consignee_name,
  cargo_name, cargo_weight, lifting_capacity, ownership, weight_net,
  zpu_number, zpu_type, wagon_model, axles_count, renter, next_repair_date,
  last_comment_text, last_comment_author, order (obj|null), item_id (UUID|null)
```

### POST /v2/routes/{route_id}/orders
Создать заявку. Body: `{ client_name, contract_number, status, comment, items: [{wagon_number, waybill_id, container_number}] }`

### PATCH /v2/orders/{order_id}
Обновить шапку заявки. Body: `{ client_name?, contract_number?, status?, comment? }`

### DELETE /v2/orders/{order_id}
Удалить заявку целиком (каскад на items).

### DELETE /v2/order-items/{item_id}
Убрать один вагон из заявки.

### GET /v2/routes/{route_id}/export
Экспорт JSON для 1С. **Необратимо** — маршрут переходит в status='closed'.

### POST /v2/comment-constructor/apply
Массовое добавление комментария к вагонам/рейсам.
```
Body: { entity_type: "wagon"|"trip", entity_ids: [UUID], text: string (1-2000) }
Response: { total_requested, success_count, failed_count, failed_ids, status, message }
Лимит: 200 entity_ids за запрос.
```

## State Management (TrainComposition)

В TrainComposition два независимых режима работают параллельно:

### Заявки (Orders)
```
mode: 'view' | 'create' | 'edit'
selectedKeys: Set<rowKey>         — ключ = wb:{waybill_id}:ktk:{container} или wagon:{number}
editingOrder: order object | null
```
Выбор идёт **по строке** (одна строка = одна накладная/КТК). Один вагон может иметь несколько строк.

### Комментарии (Comments)
```
commentMode: 'view' | 'add'
selectedWagons: Set<wagon_id>     — ключ = UUID вагона
commentText: string
```
Выбор идёт **по вагону** — клик на чекбокс выделяет ВСЕ строки этого wagon_id.

### Правило взаимоисключения
Кнопки "Назначить клиентов" и "Добавить комментарий" скрываются когда другой режим активен. Одновременно mode='create' и commentMode='add' невозможно через UI.

## Известные Edge Cases и Грабли

### 1. Вагон с несколькими накладными
Один wagon_number может иметь 2-3 строки в таблице (разные waybill_id/container_number). При подсчёте вагонов в поезде используй `COUNT(DISTINCT w.id)`, не `COUNT(*)`.

### 2. wagon_id vs wagon_number
`wagon_id` — UUID из таблицы wagons. `wagon_number` — строковый номер вагона (8 цифр). Для комментариев нужен `wagon_id` (UUID). Для заявок — `waybill_id` + `container_number`.

### 3. Закрытый маршрут (isClosed)
После экспорта JSON маршрут закрыт навсегда. В UI скрываются: кнопки назначения клиентов, комментариев, удаления заявок. Данные только на чтение.

### 4. Пустой snapshot
Если `_build_snapshot()` возвращает 0 строк — вагоны могли архивироваться между запросами. Маршрут показывает "Нет данных о составе поезда".

### 5. Перецепка вагона
Вагон может перейти из одного поезда в другой. Заявка привязана к `wagon_trip_id` (рейсу), а не к поезду. Если вагон перецеплен — он исчезнет из старого поезда и появится в новом, но заявка не потеряется.

### 6. Fail-safe синка
Если API РЖД вернул пустые данные (0 вагонов) — sync_service НЕ архивирует существующие рейсы. Иначе вся база уйдёт в архив.

### 7. Дубли при ARRAY_AGG
В GET /v2/trains используются `ARRAY_AGG(last_station_name ORDER BY last_operation_date DESC)` для получения live-статуса. Берём `[0]` элемент — это самая свежая запись. Если все null — покажется "—".

## Практические примеры

### Добавить новую колонку в таблицу состава

1. **Backend** (trains_router.py → `_build_snapshot()`):
   - Добавь поле в SELECT запрос
   - Добавь в return dict: `"new_field": r["new_field"] or ""`

2. **Frontend config** (trainCompositionColumnsConfig.js):
   ```js
   { id: 'new_field', label: 'Название', accessorKey: 'new_field',
     filterable: false, isRequired: false, isDefaultVisible: false, width: '120px' }
   ```

3. **Frontend render** (TrainsView.jsx → `renderCellValue()`):
   - Если нужна спецобработка (truncate, mono, date) — добавь `if (col.id === 'new_field')`
   - Если обычный текст — ничего не делай, отрисуется через default

### Добавить новый режим работы (по аналогии с комментариями)

1. Добавь state: `const [newMode, setNewMode] = useState('view');`
2. Добавь кнопку в toolbar с условием `mode === 'view' && commentMode === 'view' && newMode === 'view'`
3. Добавь форму после `{/* Форма комментария */}`
4. В таблице: добавь условие для чекбоксов `(mode === 'create' || commentMode === 'add' || newMode === 'active')`
5. Скрой action-колонку когда режим активен

### Отладка пустых данных в таблице

1. Открой Network → GET /v2/routes/{id} → проверь что поле есть в wagons[]
2. Если поле null — проблема в `_build_snapshot()`, проверь JOIN и SELECT
3. Если поле есть но не видно — проверь `visibleColumnIds` и `trainCompositionColumnsConfig.js`
4. Если поле видно но "—" — проверь `accessorKey` совпадает с ключом в JSON
