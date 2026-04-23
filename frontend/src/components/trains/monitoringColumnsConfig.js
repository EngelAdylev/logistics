/**
 * Конфигурация колонок для таблицы вагонов поездов в статусе «Мониторинг».
 * Отдельный конфиг — мониторинг это только отслеживание дислокации,
 * не состав рейса. Настройки хранятся независимо от маршрутных таблиц.
 *
 * Данные: wagon_trips + wagons + (LEFT JOIN) etran_waybills + etran_waybill_wagons
 */

export const MONITORING_COLUMNS = [
  // ─── Основные (видимые по умолчанию) ────────────────────────────────────
  { id: 'wagon_number',           label: 'Вагон',               accessorKey: 'wagon_number',           isRequired: true, isDefaultVisible: true,  width: '95px'  },
  { id: 'remaining_distance',     label: 'Остаток, км',          accessorKey: 'remaining_distance',     isDefaultVisible: true,  width: '85px',  filterable: false },
  { id: 'last_station_name',      label: 'Текущая станция',      accessorKey: 'last_station_name',      isDefaultVisible: true,  width: '160px' },
  { id: 'last_operation_name',    label: 'Последняя операция',   accessorKey: 'last_operation_name',    isDefaultVisible: true,  width: '160px' },
  { id: 'last_operation_date',    label: 'Дата операции',        accessorKey: 'last_operation_date',    isDefaultVisible: true,  width: '120px', filterable: false },
  { id: 'waybill_number',         label: 'Накладная',            accessorKey: 'waybill_number',         isDefaultVisible: true,  width: '105px' },
  { id: 'container_number',       label: 'Контейнер',            accessorKey: 'container_number',       isDefaultVisible: true,  width: '115px' },
  { id: 'shipper_name',           label: 'Отправитель',          accessorKey: 'shipper_name',           isDefaultVisible: true,  width: '170px' },
  { id: 'consignee_name',         label: 'Получатель',           accessorKey: 'consignee_name',         isDefaultVisible: true,  width: '170px' },
  { id: 'cargo_name',             label: 'Груз',                 accessorKey: 'cargo_name',             isDefaultVisible: true,  width: '180px' },

  // ─── Маршрут (скрыты по умолчанию) ──────────────────────────────────────
  { id: 'departure_station_name',    label: 'Отправление',       accessorKey: 'departure_station_name',    isDefaultVisible: false, width: '150px' },
  { id: 'destination_station_name',  label: 'Назначение',        accessorKey: 'destination_station_name',  isDefaultVisible: false, width: '150px' },

  // ─── Технические данные вагона (скрыты по умолчанию) ────────────────────
  { id: 'cargo_weight',           label: 'Вес груза',            accessorKey: 'cargo_weight',           isDefaultVisible: false, width: '90px'  },
  { id: 'lifting_capacity',       label: 'Грузоподъёмность',     accessorKey: 'lifting_capacity',       isDefaultVisible: false, width: '115px' },
  { id: 'weight_net',             label: 'Вес нетто',            accessorKey: 'weight_net',             isDefaultVisible: false, width: '90px'  },
  { id: 'ownership',              label: 'Собственность',        accessorKey: 'ownership',              isDefaultVisible: false, width: '130px' },
  { id: 'wagon_model',            label: 'Модель вагона',        accessorKey: 'wagon_model',            isDefaultVisible: false, width: '130px' },
  { id: 'axles_count',            label: 'Осей',                 accessorKey: 'axles_count',            isDefaultVisible: false, width: '60px'  },
  { id: 'renter',                 label: 'Арендатор',            accessorKey: 'renter',                 isDefaultVisible: false, width: '120px' },
  { id: 'next_repair_date',       label: 'Дата ремонта',         accessorKey: 'next_repair_date',       isDefaultVisible: false, width: '120px' },
  { id: 'zpu_number',             label: 'ЗПУ №',                accessorKey: 'zpu_number',             isDefaultVisible: false, width: '100px' },
  { id: 'zpu_type',               label: 'Тип ЗПУ',              accessorKey: 'zpu_type',               isDefaultVisible: false, width: '100px' },
];

export const MONITORING_TABLE_KEY = 'monitoring_wagons_table';
