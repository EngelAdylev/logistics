import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MessageSquare } from 'lucide-react';
import TripRow from './TripRow';
import WagonComments from './WagonComments';

const MAX_COMMENT_LENGTH = 60;

function formatDate(v) {
  return v ? new Date(v).toLocaleString() : '—';
}

function renderCell(wagon, col, onShowComments) {
  if (col.id === 'last_operation_date') return formatDate(wagon[col.accessorKey]);
  if (col.id === 'last_comment_text') {
    const text = wagon[col.accessorKey]?.toString?.()?.trim?.() ?? '';
    if (!text) return '—';
    const truncated = text.length > MAX_COMMENT_LENGTH ? `${text.slice(0, MAX_COMMENT_LENGTH)}…` : text;
    return <span title={text.length > MAX_COMMENT_LENGTH ? text : undefined}>{truncated}</span>;
  }
  if (col.id === 'chat') {
    return (
      <button
        type="button"
        className="h-comment-icon-btn"
        onClick={() => onShowComments()}
        title="Комментарии к вагону"
      >
        <MessageSquare size={15} />
      </button>
    );
  }
  const v = wagon[col.accessorKey];
  return v?.toString?.()?.trim?.() ?? '—';
}

export default function WagonRow({
  wagon,
  trips,
  tripsLoading,
  operations,
  opsLoading,
  expandedTripIds,
  onWagonExpand,
  onTripExpand,
  isExpanded,
  isSelected,
  onToggleSelect,
  visibleCols,
  isGrouped,
}) {
  const [showComments, setShowComments] = useState(false);

  return (
    <>
      <tr className={`h-wagon-row ${isExpanded ? 'h-wagon-row--expanded' : ''}`}>
        {/* Checkbox */}
        {onToggleSelect != null && (
          <td className="h-wagon-check">
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={() => onToggleSelect(wagon.id)}
              className="h-bulk-checkbox"
              title="Выбрать"
            />
          </td>
        )}
        {/* Expand button */}
        <td className="h-wagon-expand">
          <button
            type="button"
            className="h-expand-btn h-expand-btn--wagon"
            onClick={() => onWagonExpand(wagon.id)}
            title={isExpanded ? 'Свернуть рейсы' : 'Развернуть рейсы'}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        {/* Dynamic columns */}
        {visibleCols.map((col) => (
          <td key={col.id} className={col.id === 'railway_carriage_number' ? 'h-wagon-number' : undefined}>
            {col.id === 'railway_carriage_number'
              ? <strong>{wagon.railway_carriage_number}</strong>
              : renderCell(wagon, col, () => setShowComments(true))}
          </td>
        ))}
      </tr>

      {/* Trips expand row */}
      {isExpanded && (
        <tr className="h-trips-row">
          {onToggleSelect != null && <td />}
          {isGrouped && <td />}
          <td />
          <td colSpan={visibleCols.length} className="h-trips-cell">
            {tripsLoading ? (
              <div className="h-ops-loading">Загрузка рейсов…</div>
            ) : !trips || trips.length === 0 ? (
              <div className="h-ops-empty">Рейсов нет</div>
            ) : (
              <table className="h-trips-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>№ рейса</th>
                    <th>Дата рейса</th>
                    <th>Маршрут</th>
                    <th>Поезд</th>
                    <th>Последняя операция</th>
                    <th>Дата опер.</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <TripRow
                      key={trip.id}
                      trip={trip}
                      operations={operations.get(trip.id)}
                      operationsLoading={opsLoading.get(trip.id) ?? false}
                      isExpanded={expandedTripIds.has(trip.id)}
                      onExpand={onTripExpand}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}

      {showComments && (
        <WagonComments wagon={wagon} onClose={() => setShowComments(false)} />
      )}
    </>
  );
}
