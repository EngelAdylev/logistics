import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, MessageSquare, FilterX } from 'lucide-react';
import { api } from '../../api';
import ColumnFilter from '../../table/ColumnFilter';
import { applyFilters } from '../../table/tableUtils';
import OperationsTable from './OperationsTable';
import TripComments from './TripComments';

function formatDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function TripsView({ isActive }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  const [columnFilters, setColumnFilters] = useState({});

  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [operationsByTripId, setOperationsByTripId] = useState(new Map());
  const [opsLoading, setOpsLoading] = useState(new Map());
  const [commentTrip, setCommentTrip] = useState(null);

  const fetchTrips = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT });
      if (isActive !== undefined) params.append('is_active', isActive);
      const res = await api.get(`/v2/trips?${params}`);
      setTrips(res.data.items || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.pages || 1);
      setPage(p);
      setExpandedTripIds(new Set());
      setColumnFilters({});
    } catch {
      setError('Не удалось загрузить рейсы.');
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [isActive]);

  useEffect(() => {
    setPage(1);
    fetchTrips(1);
  }, [isActive]);

  const handleFilterChange = (colId, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!values?.length) delete next[colId];
      else next[colId] = values;
      return next;
    });
  };

  const filteredTrips = useMemo(() => applyFilters(trips, columnFilters), [trips, columnFilters]);
  const hasActiveFilters = Object.keys(columnFilters).length > 0;

  const handleTripExpand = async (tripId) => {
    const next = new Set(expandedTripIds);
    if (next.has(tripId)) { next.delete(tripId); setExpandedTripIds(next); return; }
    next.add(tripId);
    setExpandedTripIds(next);
    if (operationsByTripId.has(tripId)) return;
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

  const toolbar = (
    <div className="h-view-toolbar">
      {hasActiveFilters && (
        <button
          type="button"
          className="reset-filters-btn active"
          onClick={() => setColumnFilters({})}
          title="Сбросить фильтры столбцов"
        >
          <FilterX size={16} /> Сбросить фильтры
        </button>
      )}
      <div className="h-view-meta">
        Рейсов: {total}
        {hasActiveFilters && ` (показано: ${filteredTrips.length})`}
        {totalPages > 1 && ` · стр. ${page} из ${totalPages}`}
      </div>
    </div>
  );

  if (loading) return <div className="data-loading">Загрузка рейсов…</div>;

  if (error) {
    return (
      <div className="data-error">
        {error}
        <button type="button" className="retry-btn" onClick={() => fetchTrips(page)}>Повторить</button>
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="h-view-wrapper">
        {toolbar}
        <div className="data-loading">Рейсов не найдено</div>
      </div>
    );
  }

  return (
    <div className="h-view-wrapper">
      {toolbar}

      <div className="table-scroll">
        <table className="excel-table h-wagon-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              {/* Вагон */}
              <th className="th-with-filter">
                <span className="th-label">Вагон</span>
                <ColumnFilter
                  columnId="railway_carriage_number"
                  label="Вагон"
                  rows={trips}
                  activeValues={columnFilters.railway_carriage_number}
                  onApply={(v) => handleFilterChange('railway_carriage_number', v)}
                  onClear={() => handleFilterChange('railway_carriage_number', [])}
                />
              </th>
              <th>№ рейса</th>
              <th>Дата рейса</th>
              {/* Откуда */}
              <th className="th-with-filter">
                <span className="th-label">Откуда</span>
                <ColumnFilter
                  columnId="departure_station_name"
                  label="Откуда"
                  rows={trips}
                  activeValues={columnFilters.departure_station_name}
                  onApply={(v) => handleFilterChange('departure_station_name', v)}
                  onClear={() => handleFilterChange('departure_station_name', [])}
                />
              </th>
              {/* Куда */}
              <th className="th-with-filter">
                <span className="th-label">Куда</span>
                <ColumnFilter
                  columnId="destination_station_name"
                  label="Куда"
                  rows={trips}
                  activeValues={columnFilters.destination_station_name}
                  onApply={(v) => handleFilterChange('destination_station_name', v)}
                  onClear={() => handleFilterChange('destination_station_name', [])}
                />
              </th>
              {/* Поезд */}
              <th className="th-with-filter">
                <span className="th-label">Поезд</span>
                <ColumnFilter
                  columnId="number_train"
                  label="Поезд"
                  rows={trips}
                  activeValues={columnFilters.number_train}
                  onApply={(v) => handleFilterChange('number_train', v)}
                  onClear={() => handleFilterChange('number_train', [])}
                />
              </th>
              <th>Последняя операция</th>
              <th>Дата операции</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrips.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-table-message">Нет данных по выбранным фильтрам</td>
              </tr>
            )}
            {filteredTrips.map((trip) => {
              const isExpanded = expandedTripIds.has(trip.id);
              const ops = operationsByTripId.get(trip.id);
              const opLoading = opsLoading.has(trip.id);
              const departure = trip.departure_station_name || trip.departure_station_code || '—';
              const destination = trip.destination_station_name || trip.destination_station_code || '—';

              return (
                <React.Fragment key={trip.id}>
                  <tr className={`h-trip-row ${isExpanded ? 'h-trip-row--expanded' : ''}`}>
                    <td className="h-trip-indent">
                      <button
                        type="button"
                        className="h-expand-btn"
                        onClick={() => handleTripExpand(trip.id)}
                        title={isExpanded ? 'Свернуть операции' : 'Развернуть операции'}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td className="h-wagon-num">{trip.railway_carriage_number || '—'}</td>
                    <td>{trip.flight_number ?? '—'}</td>
                    <td className="h-trip-date">{formatDate(trip.flight_start_date)}</td>
                    <td>{departure}</td>
                    <td>{destination}</td>
                    <td className="h-trip-train">
                      {trip.number_train || '—'}
                      {trip.train_index && <span className="h-train-index"> / {trip.train_index}</span>}
                    </td>
                    <td className="h-trip-lastop">
                      <div>{trip.last_operation_name || '—'}</div>
                      {trip.last_station_name && (
                        <div className="h-lastop-station">{trip.last_station_name}</div>
                      )}
                    </td>
                    <td className="h-trip-lastdt">{formatDateTime(trip.last_operation_date)}</td>
                    <td className="h-trip-status">
                      <span className={`h-status-badge ${trip.is_active ? 'h-status-active' : 'h-status-archived'}`}>
                        {trip.is_active ? 'Активен' : 'Архив'}
                      </span>
                      <button
                        type="button"
                        className="h-comment-icon-btn"
                        onClick={() => setCommentTrip(trip)}
                        title="Комментарии к рейсу"
                      >
                        <MessageSquare size={14} />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="h-ops-row">
                      <td />
                      <td colSpan={9} className="h-ops-cell">
                        <OperationsTable operations={ops} loading={opLoading} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="h-pagination">
          <button type="button" className="h-page-btn" disabled={page <= 1} onClick={() => fetchTrips(page - 1)}>
            ← Назад
          </button>
          <span className="h-page-info">{page} / {totalPages}</span>
          <button type="button" className="h-page-btn" disabled={page >= totalPages} onClick={() => fetchTrips(page + 1)}>
            Вперёд →
          </button>
        </div>
      )}

      {commentTrip && <TripComments trip={commentTrip} onClose={() => setCommentTrip(null)} />}
    </div>
  );
}
