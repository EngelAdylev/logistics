import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MessageSquare } from 'lucide-react';
import OperationsTable from './OperationsTable';
import TripComments from './TripComments';

function formatDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatDateTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function TripRow({ trip, operations, operationsLoading, onExpand, isExpanded }) {
  const [showComments, setShowComments] = useState(false);

  const departure = trip.departure_station_name || trip.departure_station_code || '—';
  const destination = trip.destination_station_name || trip.destination_station_code || '—';

  return (
    <>
      <tr
        className={`h-trip-row ${isExpanded ? 'h-trip-row--expanded' : ''}`}
      >
        {/* Отступ + expand */}
        <td className="h-trip-indent">
          <button
            type="button"
            className="h-expand-btn"
            onClick={() => onExpand(trip.id)}
            title={isExpanded ? 'Свернуть операции' : 'Развернуть операции'}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>

        {/* Дата старта рейса */}
        <td className="h-trip-date">{formatDate(trip.flight_start_date)}</td>

        {/* Маршрут */}
        <td className="h-trip-route">
          <span className="h-route-from">{departure}</span>
          <span className="h-route-arrow"> → </span>
          <span className="h-route-to">{destination}</span>
        </td>

        {/* Поезд */}
        <td className="h-trip-train">
          {trip.number_train || '—'}
          {trip.train_index && <span className="h-train-index"> / {trip.train_index}</span>}
        </td>

        {/* Последняя операция */}
        <td className="h-trip-lastop">
          <div>{trip.last_operation_name || '—'}</div>
          {trip.last_station_name && (
            <div className="h-lastop-station">{trip.last_station_name}</div>
          )}
        </td>

        {/* Дата последней операции */}
        <td className="h-trip-lastdt">{formatDateTime(trip.last_operation_date)}</td>

        {/* Статус + действия */}
        <td className="h-trip-status">
          <span className={`h-status-badge ${trip.is_active ? 'h-status-active' : 'h-status-archived'}`}>
            {trip.is_active ? 'Активен' : 'Архив'}
          </span>
          <button
            type="button"
            className="h-comment-icon-btn"
            onClick={() => setShowComments(true)}
            title="Комментарии к рейсу"
          >
            <MessageSquare size={14} />
          </button>
        </td>
      </tr>

      {/* Строка с операциями (inline expand) */}
      {isExpanded && (
        <tr className="h-ops-row">
          <td />
          <td colSpan={6} className="h-ops-cell">
            <OperationsTable operations={operations} loading={operationsLoading} />
          </td>
        </tr>
      )}

      {/* Модальное окно комментариев */}
      {showComments && (
        <TripComments trip={trip} onClose={() => setShowComments(false)} />
      )}
    </>
  );
}
