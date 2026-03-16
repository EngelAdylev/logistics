import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MessageSquare } from 'lucide-react';
import TripRow from './TripRow';
import WagonComments from './WagonComments';

export default function WagonRow({
  wagon,
  trips,
  tripsLoading,
  operations,      // Map<trip_id, WagonTripOperation[]>
  opsLoading,      // Map<trip_id, boolean>
  expandedTripIds, // Set<trip_id>
  onWagonExpand,
  onTripExpand,
  isExpanded,
  isSelected,
  onToggleSelect,
}) {
  const [showComments, setShowComments] = useState(false);

  return (
    <>
      {/* Строка вагона */}
      <tr className={`h-wagon-row ${isExpanded ? 'h-wagon-row--expanded' : ''}`}>
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

        <td className="h-wagon-number">
          <strong>{wagon.railway_carriage_number}</strong>
        </td>

        <td className="h-wagon-status">
          <span className={`h-status-badge ${wagon.is_active ? 'h-status-active' : 'h-status-archived'}`}>
            {wagon.is_active ? 'Активен' : 'Архив'}
          </span>
        </td>

        <td className="h-wagon-trips">
          <span title="Всего рейсов">{wagon.trip_count ?? 0}</span>
          {wagon.active_trip_count > 0 && (
            <span className="h-wagon-active-trips" title="Активных рейсов">
              {' '}({wagon.active_trip_count} акт.)
            </span>
          )}
        </td>

        <td className="h-last-comment">
          {wagon.last_comment_text
            ? <span className="h-last-comment-text">{wagon.last_comment_text}</span>
            : '—'}
        </td>

        <td className="h-wagon-actions">
          <button
            type="button"
            className="h-comment-icon-btn"
            onClick={() => setShowComments(true)}
            title="Комментарии к вагону"
          >
            <MessageSquare size={15} />
          </button>
        </td>
      </tr>

      {/* Рейсы (inline expand) */}
      {isExpanded && (
        <tr className="h-trips-row">
          {onToggleSelect != null && <td />}
          <td />
          <td colSpan={5} className="h-trips-cell">
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

      {/* Модальное окно комментариев */}
      {showComments && (
        <WagonComments wagon={wagon} onClose={() => setShowComments(false)} />
      )}
    </>
  );
}
