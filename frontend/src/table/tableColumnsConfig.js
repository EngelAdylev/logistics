/**
 * Конфигурация колонок таблицы вагонов.
 * Архитектурная основа для будущей настройки видимости столбцов.
 */
export const TABLE_COLUMNS = [
  { id: 'number_train', label: 'Поезд', accessorKey: 'number_train', filterable: true, visible: true },
  { id: 'train_index', label: 'Индекс поезда', accessorKey: 'train_index', filterable: true, visible: true },
  { id: 'railway_carriage_number', label: 'Номер вагона', accessorKey: 'railway_carriage_number', filterable: true, visible: true },
  { id: 'current_station_name', label: 'Станция', accessorKey: 'current_station_name', filterable: true, visible: true },
  { id: 'current_operation_name', label: 'Операция', accessorKey: 'current_operation_name', filterable: true, visible: true },
  { id: 'last_operation_date', label: 'Дата', accessorKey: 'last_operation_date', filterable: false, visible: true },
  { id: 'last_comment_text', label: 'Последний комментарий', accessorKey: 'last_comment_text', filterable: true, visible: true },
  { id: 'chat', label: 'Чат', accessorKey: null, filterable: false, visible: true },
];
