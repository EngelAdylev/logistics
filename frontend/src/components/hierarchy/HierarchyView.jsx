import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api';
import WagonRow from './WagonRow';
import WagonTripsModal from './WagonTripsModal';

export default function HierarchyView({ isActive }) {
  const [wagons, setWagons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  // Выбранный вагон → открывает модалку рейсов
  const [selectedWagon, setSelectedWagon] = useState(null);

  const fetchWagons = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT });
      if (isActive !== undefined) params.append('is_active', isActive);
      const res = await api.get(`/v2/wagons?${params}`);
      setWagons(res.data.items || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.pages || 1);
      setPage(p);
    } catch {
      setError('Не удалось загрузить список вагонов.');
      setWagons([]);
    } finally {
      setLoading(false);
    }
  }, [isActive]);

  useEffect(() => {
    setPage(1);
    fetchWagons(1);
  }, [isActive]);

  if (loading) return <div className="data-loading">Загрузка вагонов…</div>;

  if (error) {
    return (
      <div className="data-error">
        {error}
        <button type="button" className="retry-btn" onClick={() => fetchWagons(page)}>
          Повторить
        </button>
      </div>
    );
  }

  if (wagons.length === 0) {
    return <div className="data-loading">Вагонов не найдено</div>;
  }

  return (
    <div className="h-view-wrapper">
      <div className="h-view-meta">
        Вагонов: {total}
        {totalPages > 1 && ` · стр. ${page} из ${totalPages}`}
        <span style={{ marginLeft: 12, color: '#94a3b8', fontSize: '0.8rem' }}>
          Нажмите на вагон для просмотра рейсов
        </span>
      </div>

      <div className="table-scroll">
        <table className="excel-table h-wagon-table">
          <thead>
            <tr>
              <th>Номер вагона</th>
              <th>Статус</th>
              <th>Рейсы</th>
            </tr>
          </thead>
          <tbody>
            {wagons.map((wagon) => (
              <WagonRow
                key={wagon.id}
                wagon={wagon}
                onSelect={setSelectedWagon}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="h-pagination">
          <button
            type="button"
            className="h-page-btn"
            disabled={page <= 1}
            onClick={() => fetchWagons(page - 1)}
          >
            ← Назад
          </button>
          <span className="h-page-info">{page} / {totalPages}</span>
          <button
            type="button"
            className="h-page-btn"
            disabled={page >= totalPages}
            onClick={() => fetchWagons(page + 1)}
          >
            Вперёд →
          </button>
        </div>
      )}

      {/* Модалка рейсов */}
      {selectedWagon && (
        <WagonTripsModal
          wagon={selectedWagon}
          onClose={() => setSelectedWagon(null)}
        />
      )}
    </div>
  );
}
