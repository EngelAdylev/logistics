import React, { useState, useEffect } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { api } from '../../api';
import OperationsTable from './OperationsTable';
import TripComments from './TripComments';

export default function TripOperationsModal({ trip, wagon, onClose }) {
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/v2/trips/${trip.id}/operations?limit=500`);
        setOperations(res.data.items || []);
      } catch {
        setOperations([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [trip.id]);

  const dep = trip.departure_station_name || trip.departure_station_code || '—';
  const dst = trip.destination_station_name || trip.destination_station_code || '—';

  return (
    <div
      className="h-modal-overlay--ops"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="h-modal h-ops-modal">

        {/* Шапка */}
        <div className="h-modal-header">
          <div>
            <div className="h-modal-title">
              {trip.flight_number != null
                ? <span>Рейс <span className="h-flight-number">№{trip.flight_number}</span></span>
                : 'Рейс —'}
              {' '}
              <span style={{ fontWeight: 'normal', fontSize: '0.9rem', color: '#475569' }}>
                {dep} → {dst}
              </span>
            </div>
            <div className="h-modal-subtitle">
              <span>Вагон {wagon.railway_carriage_number}</span>
              <span>·</span>
              <span className={`h-status-badge ${trip.is_active ? 'h-status-active' : 'h-status-archived'}`}>
                {trip.is_active ? 'Активен' : 'Архив'}
              </span>
              {trip.number_train && (
                <>
                  <span>·</span>
                  <span>Поезд {trip.number_train}</span>
                </>
              )}
            </div>
          </div>
          <div className="h-modal-header-right">
            <button
              type="button"
              className="h-comment-icon-btn"
              onClick={() => setShowComments(true)}
              title="Комментарии к рейсу"
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

        {/* Тело: операции */}
        <div className="h-modal-body">
          <OperationsTable operations={operations} loading={loading} />
        </div>
      </div>

      {/* Комментарии к рейсу (поверх всего) */}
      {showComments && (
        <TripComments trip={trip} onClose={() => setShowComments(false)} />
      )}
    </div>
  );
}
