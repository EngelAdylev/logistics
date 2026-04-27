/**
 * Конфигурация колонок для таблицы вагонов внутри поезда (TrainComposition).
 * Аналогично hierarchyColumnsConfig.js для Дислокации.
 * Таблица использует горизонтальный скролл (overflow-x: auto).
 *
 * Данные собираются на бэке из:
 * - wagon_trips (базовые данные рейса)
 * - etran_waybills (накладные)
 * - etran_waybill_wagons (технические данные вагона)
 *
 * filterable: false — числа, даты, уникальные идентификаторы
 * (остальные фильтруются по умолчанию)
 */

export const TRAIN_COMPOSITION_COLUMNS = [
  // ═══════════════════════════════════════════════════════════════════
  // Основные данные (видимые по умолчанию)
  // ═════════════════════════════════════════════════════════════════════
  { id: 'wagon_number',           label: 'Вагон',               accessorKey: 'wagon_number',                              isRequired: true,  isDefaultVisible: true,  width: '90px'  },
  { id: 'waybill_number',         label: 'Накладная',            accessorKey: 'waybill_number',                            isRequired: false, isDefaultVisible: true,  width: '100px' },
  { id: 'container_number',       label: 'Контейнер',            accessorKey: 'container_number',                          isRequired: false, isDefaultVisible: true,  width: '110px' },
  { id: 'shipper_name',           label: 'Отправитель',          accessorKey: 'shipper_name',                              isRequired: false, isDefaultVisible: true,  width: '170px' },
  { id: 'consignee_name',         label: 'Получатель',           accessorKey: 'consignee_name',                            isRequired: false, isDefaultVisible: true,  width: '170px' },
  { id: 'cargo_name',             label: 'Груз',                 accessorKey: 'cargo_name',                                isRequired: false, isDefaultVisible: true,  width: '200px' },
  { id: 'remaining_distance',     label: 'Остаток, км',          accessorKey: 'remaining_distance',                        isRequired: false, isDefaultVisible: true,  width: '80px'  },
  { id: 'client_name',            label: 'Клиент',               accessorKey: 'client_name',                               isRequired: false, isDefaultVisible: true,  width: '140px' },

  // ═══════════════════════════════════════════════════════════════════
  // Маршрут (доп. информация)
  // ═════════════════════════════════════════════════════════════════════
  { id: 'departure_station_name',   label: 'Отправление',          accessorKey: 'departure_station_name',                  isRequired: false, isDefaultVisible: false, width: '150px' },
  { id: 'destination_station_name', label: 'Назначение',           accessorKey: 'destination_station_name',                isRequired: false, isDefaultVisible: false, width: '150px' },
  { id: 'last_operation_name',      label: 'Последняя операция',   accessorKey: 'last_operation_name',                     isRequired: false, isDefaultVisible: false, width: '150px' },
  { id: 'last_station_name',        label: 'Текущая станция',      accessorKey: 'last_station_name',                       isRequired: false, isDefaultVisible: false, width: '150px' },

  // ═══════════════════════════════════════════════════════════════════
  // Технические характеристики вагона
  // ═════════════════════════════════════════════════════════════════════
  { id: 'lifting_capacity',       label: 'Грузоподъёмность',     accessorKey: 'lifting_capacity',       filterable: false, isRequired: false, isDefaultVisible: false, width: '110px' },
  { id: 'axles_count',            label: 'Осей',                 accessorKey: 'axles_count',            filterable: false, isRequired: false, isDefaultVisible: false, width: '60px'  },
  { id: 'ownership',              label: 'Собственность',        accessorKey: 'ownership',                                 isRequired: false, isDefaultVisible: false, width: '130px' },
  { id: 'weight_net',             label: 'Вес нетто',            accessorKey: 'weight_net',             filterable: false, isRequired: false, isDefaultVisible: false, width: '90px'  },
  { id: 'wagon_model',            label: 'Модель вагона',        accessorKey: 'wagon_model',                               isRequired: false, isDefaultVisible: false, width: '130px' },
  { id: 'wagon_type',             label: 'Род вагона',           accessorKey: 'wagon_type',                                isRequired: false, isDefaultVisible: false, width: '100px' },
  { id: 'renter',                 label: 'Арендатор',            accessorKey: 'renter',                                    isRequired: false, isDefaultVisible: false, width: '120px' },
  { id: 'next_repair_date',       label: 'Дата ремонта',         accessorKey: 'next_repair_date',       filterable: false, isRequired: false, isDefaultVisible: false, width: '130px' },

  // ═══════════════════════════════════════════════════════════════════
  // Груз и контейнер
  // ═════════════════════════════════════════════════════════════════════
  { id: 'cargo_weight',           label: 'Вес груза',            accessorKey: 'cargo_weight',           filterable: false, isRequired: false, isDefaultVisible: false, width: '90px'  },
  { id: 'zpu_number',             label: 'ЗПУ №',                accessorKey: 'zpu_number',             filterable: false, isRequired: false, isDefaultVisible: false, width: '100px' },
  { id: 'zpu_type',               label: 'Тип ЗПУ',              accessorKey: 'zpu_type',                                  isRequired: false, isDefaultVisible: false, width: '100px' },

  // ═══════════════════════════════════════════════════════════════════
  // Комментарии
  // ═════════════════════════════════════════════════════════════════════
  { id: 'last_comment_text',      label: 'Последний комментарий', accessorKey: 'last_comment_text',                        isRequired: false, isDefaultVisible: false, width: '220px' },
];

export const TRAIN_COMPOSITION_TABLE_KEY = 'train_composition_wagons_table';
