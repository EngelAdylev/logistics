import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../api';
import WagonRow from './WagonRow';

export default function HierarchyView({ isActive }) {
  const [wagons, setWagons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // page state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  // expanded state
  const [expandedWagonIds, setExpandedWagonIds] = useState(new Set());
  const [tripsByWagonId, setTripsByWagonId] = useState(new Map());
  const [tripsLoading, setTripsLoading] = useState(new Map());
  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [operationsByTripId, setOperationsByTripId] = useState(new Map());
  const [opsLoading, setOpsLoading] = useState(new Map());

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
      // Сбрасываем раскрытые элементы при смене страницы
      setExpandedWagonIds(new Set());
      setExpandedTripIds(new Set());
    } catch (e) {
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

  // --- Раскрытие вагона: загружаем рейсы ---
  const handleWagonExpand = async (wagonId) => {
    const next = new Set(expandedWagonIds);
    if (next.has(wagonId)) {
      next.delete(wagonId);
      setExpandedWagonIds(next);
      return;
    }
    next.add(wagonId);
    setExpandedWagonIds(next);

    if (tripsByWagonId.has(wagonId)) return; // уже загружены

    setTripsLoading((prev) => new Map(prev).set(wagonId, true));
    try {
      const res = await api.get(`/v2/wagons/${wagonId}/trips?include_archived=true&limit=200`);
      setTripsByWagonId((prev) => new Map(prev).set(wagonId, res.data.items || []));
    } catch {
      setTripsByWagonId((prev) => new Map(prev).set(wagonId, []));
    } finally {
      setTripsLoading((prev) => { const m = new Map(prev); m.delete(wagonId); return m; });
    }
  };

  // --- Раскрытие рейса: загружаем операции ---
  const handleTripExpand = async (tripId) => {
    const next = new Set(expandedTripIds);
    if (next.has(tripId)) {
      next.delete(tripId);
      setExpandedTripIds(next);
      return;
    }
    next.add(tripId);
    setExpandedTripIds(next);

    if (operationsByTripId.has(tripId)) return; // уже загружены

    setOpsLoading((prev) => new Map(prev).set(tripId, true));
    try {
      const res = await api.get(`/v2/trips/${tripId}/operations?limit=500`);
      setOperationsByTripId((prev) => new Map(prev).set(tripId, res.data.items || []));
    } catch {
      setOperationsByTripId((prev) => new Map(prev).set(tripId, []));
    } finally {
      setOpsLoading((prev) => { const m = new Map(prev); m.delete(tripId); return m; });
    }
  };

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
      </div>

      <div className="table-scroll">
        <table className="excel-table h-wagon-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th>Номер вагона</th>
              <th>Статус</th>
              <th>Рейсы</th>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {wagons.map((wagon) => (
              <WagonRow
                key={wagon.id}
                wagon={wagon}
                trips={tripsByWagonId.get(wagon.id)}
                tripsLoading={tripsLoading.has(wagon.id)}
                operations={operationsByTripId}
                opsLoading={opsLoading}
                expandedTripIds={expandedTripIds}
                isExpanded={expandedWagonIds.has(wagon.id)}
                onWagonExpand={handleWagonExpand}
                onTripExpand={handleTripExpand}
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
    </div>
  );
}
