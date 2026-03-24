/**
 * Конфигурация колонок таблицы "Вагоны на слежении".
 * width — рекомендуемая ширина колонки (CSS value). При table-layout:fixed таблица строго 100%.
 */
export const HIERARCHY_COLUMNS = [
  { id: 'railway_carriage_number', label: 'Вагон', accessorKey: 'railway_carriage_number', filterable: true, isRequired: true, isDefaultVisible: true, width: '90px' },
  { id: 'number_train', label: '№ поезда', accessorKey: 'number_train', filterable: true, isRequired: false, isDefaultVisible: true, width: '80px' },
  { id: 'train_index', label: 'Индекс поезда', accessorKey: 'train_index', filterable: true, isRequired: false, isDefaultVisible: false, width: '90px' },
  { id: 'number_railway_carriage_on_train', label: '№ ваг.', accessorKey: 'number_railway_carriage_on_train', filterable: true, isRequired: false, isDefaultVisible: true, width: '50px' },
  { id: 'last_station_name', label: 'Станция', accessorKey: 'last_station_name', filterable: true, isRequired: false, isDefaultVisible: true, width: '120px' },
  { id: 'last_operation_name', label: 'Операция', accessorKey: 'last_operation_name', filterable: true, isRequired: false, isDefaultVisible: true, width: '120px' },
  { id: 'last_operation_date', label: 'Дата опер.', accessorKey: 'last_operation_date', filterable: false, isRequired: false, isDefaultVisible: true, width: '110px' },
  { id: 'remaining_distance', label: 'Ост. км', accessorKey: 'remaining_distance', filterable: true, isRequired: false, isDefaultVisible: false, width: '55px' },
  { id: 'departure_station_name', label: 'Отправление', accessorKey: 'departure_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'destination_station_name', label: 'Назначение', accessorKey: 'destination_station_name', filterable: true, isRequired: false, isDefaultVisible: false },
  { id: 'waybill_number', label: 'Накладная', accessorKey: 'waybill_number', filterable: true, isRequired: false, isDefaultVisible: true, width: '90px' },
  { id: 'last_comment_text', label: 'Комментарий', accessorKey: 'last_comment_text', filterable: true, isRequired: false, isDefaultVisible: true },
  { id: 'chat', label: '', accessorKey: null, filterable: false, isRequired: true, isDefaultVisible: true, width: '36px' },
];

export const HIERARCHY_TABLE_KEY = 'hierarchy_wagons_table';
