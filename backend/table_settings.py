"""
Whitelist допустимых колонок и логика настроек таблицы.
"""
from typing import List, Optional

# Допустимые table_key
ALLOWED_TABLE_KEYS = {"wagons_table"}

# Допустимые колонки для wagons_table (id колонок)
WAGONS_TABLE_COLUMNS: List[str] = [
    "number_train",
    "train_index",
    "railway_carriage_number",
    "current_station_name",
    "current_operation_name",
    "last_operation_date",
    "remaining_distance",
    "remaining_mileage",
    "waybill_number",
    "container_numbers",
    "destination_station_name",
    "departure_station_name",
    "type_railway_carriage",
    "owners_administration",
    "last_comment_text",
    "chat",
]

# Обязательные колонки — нельзя скрыть
WAGONS_TABLE_REQUIRED: List[str] = ["railway_carriage_number", "chat"]

# Дефолтный набор видимых колонок (как раньше + новые скрыты по умолчанию)
WAGONS_TABLE_DEFAULT_VISIBLE: List[str] = [
    "number_train",
    "train_index",
    "railway_carriage_number",
    "current_station_name",
    "current_operation_name",
    "last_operation_date",
    "last_comment_text",
    "chat",
]

TABLE_WHITELIST = {
    "wagons_table": {
        "columns": WAGONS_TABLE_COLUMNS,
        "required": WAGONS_TABLE_REQUIRED,
        "default_visible": WAGONS_TABLE_DEFAULT_VISIBLE,
    },
}


def validate_visible_columns(table_key: str, visible_columns: List[str]) -> List[str]:
    """
    Валидирует список колонок. Возвращает очищенный список.
    Выбрасывает ValueError при невалидных данных.
    """
    if table_key not in ALLOWED_TABLE_KEYS:
        raise ValueError(f"Unknown table_key: {table_key}")
    cfg = TABLE_WHITELIST[table_key]
    allowed = set(cfg["columns"])
    required = set(cfg["required"])
    cleaned = [c for c in visible_columns if c in allowed]
    cleaned = list(dict.fromkeys(cleaned))  # preserve order, remove dupes
    if not required.issubset(set(cleaned)):
        raise ValueError("Required columns cannot be hidden")
    if not cleaned:
        raise ValueError("visible_columns cannot be empty")
    return cleaned


def get_default_visible_columns(table_key: str) -> List[str]:
    if table_key not in ALLOWED_TABLE_KEYS:
        raise ValueError(f"Unknown table_key: {table_key}")
    return TABLE_WHITELIST[table_key]["default_visible"].copy()
