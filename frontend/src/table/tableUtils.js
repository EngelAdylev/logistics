/**
 * Утилиты для таблицы: группировка, фильтрация.
 */

export const EMPTY_TRAIN_LABEL = 'Без поезда';

/** Нормализует значение поезда для группировки (пустое → "Без поезда"). */
export function getTrainGroupKey(value) {
  const v = value?.toString?.()?.trim?.();
  return v ? v : EMPTY_TRAIN_LABEL;
}

/** Группирует строки по number_train. */
export function groupByTrain(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = getTrainGroupKey(row.number_train);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

export const EMPTY_DISTANCE_LABEL = 'Нет данных';

/** Нормализует значение remaining_distance для группировки. */
export function getDistanceGroupKey(value) {
  const v = value?.toString?.()?.trim?.();
  if (!v || v === '—') return EMPTY_DISTANCE_LABEL;
  return `${v} км`;
}

/** Группирует строки по remaining_distance (точные значения). */
export function groupByDistance(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = getDistanceGroupKey(row.remaining_distance);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  // Сортируем группы: числа по возрастанию, "Нет данных" в конец
  const sorted = new Map(
    [...groups.entries()].sort((a, b) => {
      if (a[0] === EMPTY_DISTANCE_LABEL) return 1;
      if (b[0] === EMPTY_DISTANCE_LABEL) return -1;
      const numA = parseFloat(a[0]) || 0;
      const numB = parseFloat(b[0]) || 0;
      return numA - numB;
    })
  );
  return sorted;
}

/** Нормализует значение для сравнения с фильтром. */
function getFilterValue(row, colId) {
  if (colId === 'last_comment_text') {
    const v = row[colId]?.toString?.()?.trim?.() ?? '';
    return v ? 'Есть' : 'Нет';
  }
  const val = row[colId];
  const str = val?.toString?.()?.trim?.() ?? '';
  return str || EMPTY_TRAIN_LABEL;
}

/** Фильтрация строк по активным фильтрам. */
export function applyFilters(rows, columnFilters) {
  if (!columnFilters || Object.keys(columnFilters).length === 0) return rows;
  return rows.filter((row) => {
    for (const [colId, selectedValues] of Object.entries(columnFilters)) {
      if (!selectedValues?.length) continue;
      const normalized = getFilterValue(row, colId);
      if (!selectedValues.includes(normalized)) return false;
    }
    return true;
  });
}

/** Собирает уникальные значения по столбцу из данных. */
export function getUniqueValues(rows, accessorKey) {
  if (accessorKey === 'last_comment_text') {
    const hasComment = rows.some((r) => (r[accessorKey]?.toString?.()?.trim?.() || '').length > 0);
    const hasNoComment = rows.some((r) => !(r[accessorKey]?.toString?.()?.trim?.() || '').length);
    const out = [];
    if (hasComment) out.push('Есть');
    if (hasNoComment) out.push('Нет');
    return out;
  }
  const set = new Set();
  for (const row of rows) {
    const v = row[accessorKey];
    const str = v?.toString?.()?.trim?.() ?? '';
    set.add(str || EMPTY_TRAIN_LABEL);
  }
  return Array.from(set).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
}
