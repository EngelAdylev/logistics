/**
 * Конфигурация колонок таблицы "Рейсы".
 * width — рекомендуемая ширина колонки (CSS value). При table-layout:fixed таблица строго 100%.
 */
export const TRIPS_COLUMNS = [
  { id: 'railway_carriage_number', label: 'Вагон', accessorKey: 'railway_carriage_number', filterable: true, isRequired: true, isDefaultVisible: true, width: '90px' },
  { id: 'flight_start_date', label: 'Дата рейса', accessorKey: 'flight_start_date', filterable: false, isRequired: false, isDefaultVisible: true, sortable: true, width: '85px' },
  { id: 'departure_station_name', label: 'Откуда', accessorKey: 'departure_station_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'destination_station_name', label: 'Куда', accessorKey: 'destination_station_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'number_train', label: 'Поезд', accessorKey: 'number_train', filterable: true, isRequired: false, isDefaultVisible: true, width: '80px' },
  { id: 'number_railway_carriage_on_train', label: '№ ваг.', accessorKey: 'number_railway_carriage_on_train', filterable: false, isRequired: false, isDefaultVisible: true, width: '50px' },
  { id: 'last_operation_name', label: 'Операция', accessorKey: 'last_operation_name', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'last_operation_date', label: 'Дата опер.', accessorKey: 'last_operation_date', filterable: false, isRequired: false, isDefaultVisible: true, sortable: true, width: '110px' },
  { id: 'last_station_name', label: 'Станция', accessorKey: 'last_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'remaining_distance', label: 'Ост. км', accessorKey: 'remaining_distance', filterable: false, isRequired: false, isDefaultVisible: false, width: '55px' },
  { id: 'is_active', label: 'Статус', accessorKey: null, filterable: false, isRequired: true, isDefaultVisible: true, width: '70px' },
  { id: 'last_comment_text', label: 'Комментарий', accessorKey: 'last_comment_text', filterable: false, isRequired: true, isDefaultVisible: true },
];

export const TRIPS_TABLE_KEY = 'trips_table';
