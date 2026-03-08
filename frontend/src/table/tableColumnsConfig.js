/**
 * Конфигурация колонок таблицы вагонов.
 * isRequired — колонку нельзя скрыть.
 * isDefaultVisible — показывать по умолчанию для новых пользователей.
 */
export const TABLE_COLUMNS = [
  { id: 'number_train', label: '№ поезда', accessorKey: 'number_train', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'train_index', label: 'Индекс поезда', accessorKey: 'train_index', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'railway_carriage_number', label: 'Вагон', accessorKey: 'railway_carriage_number', filterable: true, isRequired: true, isDefaultVisible: true },
  { id: 'current_station_name', label: 'Станция операции', accessorKey: 'current_station_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'current_operation_name', label: 'Операция', accessorKey: 'current_operation_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_operation_date', label: 'Время операции', accessorKey: 'last_operation_date', filterable: false, isRequired: false, isDefaultVisible: true },
  { id: 'remaining_distance', label: 'Остаточное расстояние', accessorKey: 'remaining_distance', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'remaining_mileage', label: 'Остаток пробега', accessorKey: 'remaining_mileage', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'waybill_number', label: '№ накладной', accessorKey: 'waybill_number', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'container_numbers', label: '№ КТК', accessorKey: 'container_numbers', filterable: false, isRequired: false, isDefaultVisible: false },
  { id: 'destination_station_name', label: 'Станция назначения', accessorKey: 'destination_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'departure_station_name', label: 'Станция отправления', accessorKey: 'departure_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'type_railway_carriage', label: 'Модель вагона', accessorKey: 'type_railway_carriage', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'owners_administration', label: 'Собственник', accessorKey: 'owners_administration', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'last_comment_text', label: 'Последний комментарий', accessorKey: 'last_comment_text', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'chat', label: 'Чат', accessorKey: null, filterable: false, isRequired: true, isDefaultVisible: true },
];

export const TABLE_KEY = 'wagons_table';
