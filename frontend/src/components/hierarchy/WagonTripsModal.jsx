import React, { useState, useEffect } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { api } from '../../api';
import WagonComments from './WagonComments';
import TripOperationsModal from './TripOperationsModal';

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

export default function WagonTripsModal({ wagon, onClose }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedTrip, setSelectedTrip] = useState(null);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get(
          `/v2/wagons/${wagon.id}/trips?include_archived=true&limit=200`
        );
        setTrips(res.data.items || []);
      } catch {
        setTrips([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [wagon.id]);

  return (
    <div
      className="h-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="h-modal h-trips-modal">

        {/* Шапка */}
        <div className="h-modal-header">
          <div>
            <div className="h-modal-title">
              Вагон {wagon.railway_carriage_number}
            </div>
            <div className="h-modal-subtitle">
              <span className={`h-status-badge ${wagon.is_active ? 'h-status-active' : 'h-status-archived'}`}>
                {wagon.is_active ? 'Активен' : 'Архив'}
              </span>
              <span className="h-modal-tripcount">
                · всего рейсов: {wagon.trip_count ?? 0}
                {wagon.active_trip_count > 0 && `, активных: ${wagon.active_trip_count}`}
              </span>
            </div>
          </div>
          <div className="h-modal-header-right">
            <button
              type="button"
              className="h-comment-icon-btn"
              onClick={() => setShowComments(true)}
              title="Комментарии к вагону"
            >
              <MessageSquare size={16} />
            </button>
            <button
              type="button"
              className="h-modal-close"
              onClick={onClose}
              title="Закрыть"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Тело: таблица рейсов */}
        <div className="h-modal-body">
          {loading ? (
            <div className="h-ops-loading">Загрузка рейсов…</div>
          ) : trips.length === 0 ? (
            <div className="h-ops-empty">Рейсов нет</div>
          ) : (
            <>
              <div style={{ padding: '8px 12px 4px', fontSize: '0.78rem', color: '#94a3b8' }}>
                Нажмите на рейс для просмотра операций
              </div>
              <table className="h-modal-table">
                <thead>
                  <tr>
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
                  {trips.map((trip) => {
                    const dep = trip.departure_station_name || trip.departure_station_code || '—';
                    const dst = trip.destination_station_name || trip.destination_station_code || '—';
                    return (
                      <tr
                        key={trip.id}
                        className="h-modal-trip-row"
                        onClick={() => setSelectedTrip(trip)}
                        title="Нажмите для просмотра операций"
                      >
                        <td>
                          {trip.flight_number != null
                            ? <span className="h-flight-number">№{trip.flight_number}</span>
                            : <span className="h-flight-number h-flight-number--empty">—</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(trip.flight_start_date)}</td>
                        <td className="h-trip-route">
                          <span className="h-route-from">{dep}</span>
                          <span className="h-route-arrow"> → </span>
                          <span className="h-route-to">{dst}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{trip.number_train || '—'}</td>
                        <td>
                          <div>{trip.last_operation_name || '—'}</div>
                          {trip.last_station_name && (
                            <div className="h-lastop-station">{trip.last_station_name}</div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                          {formatDateTime(trip.last_operation_date)}
                        </td>
                        <td>
                          <span className={`h-status-badge ${trip.is_active ? 'h-status-active' : 'h-status-archived'}`}>
                            {trip.is_active ? 'Активен' : 'Архив'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* Модалка операций рейса (поверх текущей) */}
      {selectedTrip && (
        <TripOperationsModal
          trip={selectedTrip}
          wagon={wagon}
          onClose={() => setSelectedTrip(null)}
        />
      )}

      {/* Комментарии к вагону */}
      {showComments && (
        <WagonComments wagon={wagon} onClose={() => setShowComments(false)} />
      )}
    </div>
  );
}
