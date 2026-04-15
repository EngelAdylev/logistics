/**
 * Конфигурация колонок для таблицы вагонов внутри поезда (TrainComposition).
 * Аналогично hierarchyColumnsConfig.js для Дислокации.
 * Таблица использует горизонтальный скролл (overflow-x: auto).
 */

export const TRAIN_COMPOSITION_COLUMNS = [
  { id: 'wagon_number', label: 'Вагон', accessorKey: 'wagon_number', filterable: false, isRequired: true, isDefaultVisible: true, width: '90px' },
  { id: 'waybill_number', label: 'Накладная', accessorKey: 'waybill_number', filterable: false, isRequired: false, isDefaultVisible: true, width: '100px' },
  { id: 'container_number', label: 'Контейнер', accessorKey: 'container_number', filterable: false, isRequired: false, isDefaultVisible: true, width: '110px' },
  { id: 'shipper_name', label: 'Отправитель', accessorKey: 'shipper_name', filterable: false, isRequired: false, isDefaultVisible: true, width: '180px' },
  { id: 'consignee_name', label: 'Получатель', accessorKey: 'consignee_name', filterable: false, isRequired: false, isDefaultVisible: true, width: '180px' },
  { id: 'cargo_name', label: 'Груз', accessorKey: 'cargo_name', filterable: false, isRequired: false, isDefaultVisible: true, width: '220px' },
  { id: 'departure_station_name', label: 'Отправление', accessorKey: 'departure_station_name', filterable: false, isRequired: false, isDefaultVisible: false, width: '150px' },
  { id: 'destination_station_name', label: 'Назначение', accessorKey: 'destination_station_name', filterable: false, isRequired: false, isDefaultVisible: false, width: '150px' },
  { id: 'remaining_distance', label: 'Остаток, км', accessorKey: 'remaining_distance', filterable: false, isRequired: false, isDefaultVisible: true, width: '75px' },
  { id: 'lifting_capacity', label: 'Грузоподъёмность', accessorKey: 'lifting_capacity', filterable: false, isRequired: false, isDefaultVisible: false, width: '110px' },
  { id: 'ownership', label: 'Собственность', accessorKey: 'ownership', filterable: false, isRequired: false, isDefaultVisible: false, width: '120px' },
  { id: 'weight_net', label: 'Вес нетто', accessorKey: 'weight_net', filterable: false, isRequired: false, isDefaultVisible: false, width: '90px' },
  { id: 'cargo_weight', label: 'Вес груза', accessorKey: 'cargo_weight', filterable: false, isRequired: false, isDefaultVisible: false, width: '90px' },
  { id: 'zpu_number', label: 'ЗПУ №', accessorKey: 'zpu_number', filterable: false, isRequired: false, isDefaultVisible: false, width: '90px' },
  { id: 'wagon_model', label: 'Модель вагона', accessorKey: 'wagon_model', filterable: false, isRequired: false, isDefaultVisible: false, width: '120px' },
  { id: 'client_name', label: 'Клиент', accessorKey: 'client_name', filterable: false, isRequired: false, isDefaultVisible: true, width: '140px' },
];

export const TRAIN_COMPOSITION_TABLE_KEY = 'train_composition_wagons_table';
