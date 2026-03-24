/**
 * Конфигурация колонок таблицы "Рейсы".
 */
export const TRIPS_COLUMNS = [
  { id: 'railway_carriage_number', label: 'Вагон', accessorKey: 'railway_carriage_number', filterable: true, isRequired: true, isDefaultVisible: true },
  { id: 'flight_start_date', label: 'Дата рейса', accessorKey: 'flight_start_date', filterable: false, isRequired: false, isDefaultVisible: true, sortable: true },
  { id: 'departure_station_name', label: 'Откуда', accessorKey: 'departure_station_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'destination_station_name', label: 'Куда', accessorKey: 'destination_station_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'number_train', label: 'Поезд', accessorKey: 'number_train', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'number_railway_carriage_on_train', label: '№ ваг. на поезде', accessorKey: 'number_railway_carriage_on_train', filterable: false, isRequired: false, isDefaultVisible: true },
  { id: 'last_operation_name', label: 'Последняя операция', accessorKey: 'last_operation_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_operation_date', label: 'Дата операции', accessorKey: 'last_operation_date', filterable: false, isRequired: false, isDefaultVisible: true, sortable: true },
  { id: 'last_station_name', label: 'Станция операции', accessorKey: 'last_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'remaining_distance', label: 'Остаток (км)', accessorKey: 'remaining_distance', filterable: false, isRequired: false, isDefaultVisible: false },
  { id: 'is_active', label: 'Статус', accessorKey: null, filterable: false, isRequired: true, isDefaultVisible: true },
  { id: 'last_comment_text', label: 'Комментарий', accessorKey: 'last_comment_text', filterable: false, isRequired: true, isDefaultVisible: true },
];

export const TRIPS_TABLE_KEY = 'trips_table';
