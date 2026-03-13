import React, { useMemo, useState } from 'react';
import { MessageSquarePlus, ChevronDown, ChevronRight, Layers, FilterX, ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react';
import ColumnVisibilityPanel from './ColumnVisibilityPanel';
import { TABLE_COLUMNS } from './tableColumnsConfig';
import { applyFilters, groupByTrain, getTrainGroupKey, EMPTY_TRAIN_LABEL } from './tableUtils';
import ColumnFilter from './ColumnFilter';

const MAX_COMMENT_LENGTH = 60;

function formatDate(v) {
  return v ? new Date(v).toLocaleString() : '—';
}

function LastCommentCell({ value }) {
  const text = value?.toString?.()?.trim?.() ?? '';
  if (!text) return '—';
  const truncated = text.length > MAX_COMMENT_LENGTH ? `${text.slice(0, MAX_COMMENT_LENGTH)}…` : text;
  return (
    <span title={text.length > MAX_COMMENT_LENGTH ? text : undefined}>{truncated}</span>
  );
}

export default function WagonsTable({ data, columnFilters, onFilterChange, onResetFilters, onOpenComment, visibleColumnIds, onVisibilityChange, wagonCounts }) {
  const [groupByTrainEnabled, setGroupByTrainEnabled] = useState(false);
  const [collapsedTrains, setCollapsedTrains] = useState(new Set());
  const [sortDir, setSortDir] = useState(null); // null | 'desc' | 'asc'

  const filteredData = useMemo(() => {
    const seen = new Set();
    return applyFilters(data, columnFilters).filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [data, columnFilters]);

  const sortedData = useMemo(() => {
    if (!sortDir) return filteredData;
    return [...filteredData].sort((a, b) => {
      const ta = a.last_operation_date ? new Date(a.last_operation_date).getTime() : 0;
      const tb = b.last_operation_date ? new Date(b.last_operation_date).getTime() : 0;
      return sortDir === 'desc' ? tb - ta : ta - tb;
    });
  }, [filteredData, sortDir]);

  const groups = useMemo(() => groupByTrain(sortedData), [sortedData]);

  const toggleTrain = (trainKey) => {
    setCollapsedTrains((prev) => {
      const next = new Set(prev);
      if (next.has(trainKey)) next.delete(trainKey);
      else next.add(trainKey);
      return next;
    });
  };

  const visibleCols = visibleColumnIds?.length
    ? TABLE_COLUMNS.filter((c) => visibleColumnIds.includes(c.id))
    : TABLE_COLUMNS.filter((c) => c.isDefaultVisible !== false);
  const filterableCols = visibleCols.filter((c) => c.filterable);

  const renderCell = (row, col) => {
    if (col.id === 'last_operation_date') return formatDate(row[col.accessorKey]);
    if (col.id === 'last_comment_text' || col.id === 'container_numbers') {
      return <LastCommentCell value={row[col.accessorKey]} />;
    }
    if (col.id === 'chat') {
      return (
        <button
          type="button"
          className="comment-btn"
          onClick={() => onOpenComment(row)}
          aria-label="Комментарий"
        >
          <MessageSquarePlus size={16} />
        </button>
      );
    }
    const v = row[col.accessorKey];
    return v?.toString?.()?.trim?.() ?? '—';
  };

  const rowsToRender = groupByTrainEnabled
    ? Array.from(groups.entries()).map(([trainKey, rows]) => ({
        isGroup: true,
        trainKey,
        rows,
        collapsed: collapsedTrains.has(trainKey),
      }))
    : sortedData.map((row) => ({ isGroup: false, row }));

  return (
    <div className="wagons-table-wrapper">
      <div className="table-toolbar">
        <button
          type="button"
          className={`group-toggle ${groupByTrainEnabled ? 'active' : ''}`}
          onClick={() => setGroupByTrainEnabled(!groupByTrainEnabled)}
          title="Группировать по поезду"
        >
          <Layers size={18} />
          {groupByTrainEnabled ? 'Группировка по поезду вкл.' : 'Группировать по поезду'}
        </button>
        <button
          type="button"
          className={`reset-filters-btn ${Object.keys(columnFilters || {}).length > 0 ? 'active' : ''}`}
          onClick={onResetFilters}
          title="Сбросить все фильтры"
          disabled={!columnFilters || Object.keys(columnFilters).length === 0}
        >
          <FilterX size={18} />
          Сбросить фильтры
        </button>
        <ColumnVisibilityPanel
          visibleColumnIds={visibleColumnIds}
          onVisibilityChange={onVisibilityChange}
        />
        {wagonCounts && (
          <div className="wagon-counts">
            <span className="wagon-count wagon-count--active" title="Активных вагонов">
              Активных: {wagonCounts.active ?? '…'}
            </span>
            <span className="wagon-count wagon-count--archived" title="Архивных вагонов">
              Архивных: {wagonCounts.archived ?? '…'}
            </span>
          </div>
        )}
      </div>

      <div className="table-scroll">
        <table className="excel-table">
          <thead>
            <tr>
              {groupByTrainEnabled && <th className="group-col" />}
              {visibleCols.map((col) => (
                <th key={col.id} className="th-with-filter">
                  <span className="th-label">{col.label}</span>
                  {col.id === 'last_operation_date' && (
                    <button
                      type="button"
                      className={`sort-btn ${sortDir ? 'active' : ''}`}
                      onClick={() => setSortDir((d) => d === null ? 'desc' : d === 'desc' ? 'asc' : null)}
                      title={sortDir === 'desc' ? 'Сначала новые → нажми для старых' : sortDir === 'asc' ? 'Сначала старые → нажми для сброса' : 'Сортировать по дате'}
                    >
                      {sortDir === 'desc' ? <ArrowDown size={14} /> : sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowUpDown size={14} />}
                    </button>
                  )}
                  {col.filterable && (
                    <ColumnFilter
                      columnId={col.accessorKey || col.id}
                      label={col.label}
                      rows={data}
                      activeValues={columnFilters?.[col.accessorKey || col.id]}
                      onApply={(vals) => onFilterChange(col.accessorKey || col.id, vals)}
                      onClear={() => onFilterChange(col.accessorKey || col.id, [])}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsToRender.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length + (groupByTrainEnabled ? 1 : 0)} className="empty-table-message">
                  Нет данных
                </td>
              </tr>
            )}
            {rowsToRender.map((item, idx) => {
              if (item.isGroup) {
                const { trainKey, rows, collapsed } = item;
                const displayLabel = trainKey === EMPTY_TRAIN_LABEL ? trainKey : `Поезд ${trainKey}`;
                const count = rows.length;
                const wagonWord = count === 1 ? 'вагон' : count >= 2 && count <= 4 ? 'вагона' : 'вагонов';
                return (
                  <React.Fragment key={trainKey}>
                    <tr
                      className="group-header-row"
                      onClick={() => toggleTrain(trainKey)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggleTrain(trainKey)}
                    >
                      <td className="group-col">
                        <span className="group-caret">{collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
                      </td>
                      <td colSpan={visibleCols.length}>
                        <span className="group-title">
                          {displayLabel} ({count} {wagonWord})
                        </span>
                      </td>
                    </tr>
                    {!collapsed &&
                      rows.map((row) => (
                        <tr key={row.id}>
                          <td className="group-col" />
                          {visibleCols.map((col) => (
                            <td key={col.id}>{renderCell(row, col)}</td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                );
              }
              return (
                <tr key={item.row.id}>
                  {groupByTrainEnabled && <td className="group-col" />}
                  {visibleCols.map((col) => (
                    <td key={col.id}>{renderCell(item.row, col)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
