/**
 * Конфигурация колонок таблицы "Вагоны на слежении".
 */
export const HIERARCHY_COLUMNS = [
  { id: 'railway_carriage_number', label: 'Вагон', accessorKey: 'railway_carriage_number', filterable: true, isRequired: true, isDefaultVisible: true },
  { id: 'number_train', label: '№ поезда', accessorKey: 'number_train', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'train_index', label: 'Индекс поезда', accessorKey: 'train_index', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'number_railway_carriage_on_train', label: '№ ваг. на поезде', accessorKey: 'number_railway_carriage_on_train', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_station_name', label: 'Станция операции', accessorKey: 'last_station_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_operation_name', label: 'Операция', accessorKey: 'last_operation_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_operation_date', label: 'Время операции', accessorKey: 'last_operation_date', filterable: false, isRequired: false, isDefaultVisible: true },
  { id: 'remaining_distance', label: 'Остаток (км)', accessorKey: 'remaining_distance', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'departure_station_name', label: 'Станция отправления', accessorKey: 'departure_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'destination_station_name', label: 'Станция назначения', accessorKey: 'destination_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'waybill_number', label: '№ накладной', accessorKey: 'waybill_number', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_comment_text', label: 'Последний комментарий', accessorKey: 'last_comment_text', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'chat', label: 'Чат', accessorKey: null, filterable: false, isRequired: true, isDefaultVisible: true },
];

export const HIERARCHY_TABLE_KEY = 'hierarchy_wagons_table';
