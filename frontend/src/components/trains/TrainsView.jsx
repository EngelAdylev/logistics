import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api';
import TrainCompositionModal from './TrainCompositionModal';

function kmBadge(minKm) {
  if (minKm === null || minKm === undefined) return <span className="km-badge km-badge--unknown">—</span>;
  if (minKm <= 150) return <span className="km-badge km-badge--near">{minKm} км</span>;
  return <span className="km-badge km-badge--far">{minKm} км</span>;
}

function statusLabel(s) {
  if (s === 'closed') return <span className="route-status route-status--closed">Закрыт</span>;
  if (s === 'open') return <span className="route-status route-status--open">Открыт</span>;
  return null;
}

export default function TrainsView({ refreshKey }) {
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedTrain, setSelectedTrain] = useState(null);

  const fetchTrains = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/v2/trains');
      setTrains(res.data.items || []);
    } catch (e) {
      setError('Не удалось загрузить список поездов.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrains();
  }, [refreshKey]);

  const handleOpen = (train) => {
    if (!train.route_id) return;
    setSelectedTrain(train);
    setSelectedRouteId(train.route_id);
  };

  const handleCloseModal = () => {
    setSelectedRouteId(null);
    setSelectedTrain(null);
    fetchTrains();
  };

  if (loading) return <div className="data-loading">Загрузка поездов…</div>;
  if (error) return (
    <div className="data-error">
      {error}
      <button type="button" className="retry-btn" onClick={fetchTrains}>Повторить</button>
    </div>
  );

  if (trains.length === 0) {
    return (
      <div className="trains-empty">
        <p>Нет активных поездов с назначением на станцию 648400.</p>
        <p className="trains-empty-hint">Болванки создаются автоматически когда остаток ≤ 150 км.</p>
      </div>
    );
  }

  return (
    <div className="trains-view">
      <div className="h-table-scroll">
        <table className="excel-table compact-table trains-table">
          <thead>
            <tr>
              <th>№ поезда</th>
              <th>Индекс</th>
              <th style={{ textAlign: 'center' }}>Вагонов</th>
              <th style={{ textAlign: 'center' }}>С накладной</th>
              <th style={{ textAlign: 'center' }}>Мин. остаток</th>
              <th style={{ textAlign: 'center' }}>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {trains.map((t) => (
              <tr key={t.train_number} className={t.ready ? 'train-row train-row--ready' : 'train-row'}>
                <td><strong>{t.train_number}</strong></td>
                <td className="train-index-cell">{t.train_index || '—'}</td>
                <td style={{ textAlign: 'center' }}>{t.wagon_total}</td>
                <td style={{ textAlign: 'center' }}>{t.matched_wagons}</td>
                <td style={{ textAlign: 'center' }}>{kmBadge(t.min_km)}</td>
                <td style={{ textAlign: 'center' }}>
                  {t.route_id ? statusLabel(t.route_status) : (
                    t.ready
                      ? <span className="route-status route-status--pending">Формируется…</span>
                      : <span className="route-status route-status--monitoring">Мониторинг</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {t.route_id ? (
                    <button
                      type="button"
                      className="trains-action-btn trains-action-btn--open"
                      onClick={() => handleOpen(t)}
                    >
                      Заявки
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="trains-action-btn trains-action-btn--disabled"
                      disabled
                      title={t.ready ? 'Болванка создаётся…' : 'Доступно при остатке ≤ 150 км'}
                    >
                      {t.ready ? 'Формируется…' : 'Мониторинг'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRouteId && (
        <TrainCompositionModal
          routeId={selectedRouteId}
          trainNumber={selectedTrain?.train_number}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
