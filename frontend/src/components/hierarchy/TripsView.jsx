import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, MessageSquare, FilterX, MessageSquarePlus } from 'lucide-react';
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

/** Разбивает строку ввода по пробелу/переносу/запятой → массив токенов */
function parseTokens(input) {
  return input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

/** Возвращает true, если строка val содержит хотя бы один токен из tokens */
function matchesAny(val, tokens) {
  const lower = (val || '').toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

export default function TripsView({ isActive }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  const [columnFilters, setColumnFilters] = useState({});

  // wagonSearch — это только визуальное состояние textarea.
  // Результат поиска сразу конвертируется в columnFilters.railway_carriage_number.
  const [wagonSearch, setWagonSearch] = useState('');

  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [operationsByTripId, setOperationsByTripId] = useState(new Map());
  const [opsLoading, setOpsLoading] = useState(new Map());
  const [commentTrip, setCommentTrip] = useState(null);

  // Групповой комментарий
  const [selectedTripIds, setSelectedTripIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCommentText, setBulkCommentText] = useState('');
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyResult, setBulkApplyResult] = useState(null);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: 1, limit: 9999 });
      if (isActive !== undefined) params.append('is_active', isActive);
      const res = await api.get(`/v2/trips?${params}`);
      setTrips(res.data.items || []);
      setTotal(res.data.total || 0);
      setExpandedTripIds(new Set());
      setColumnFilters({});
      setWagonSearch('');
      setSelectedTripIds(new Set());
    } catch {
      setError('Не удалось загрузить рейсы.');
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [isActive]);

  useEffect(() => {
    fetchTrips();
  }, [isActive]);

  // Когда textarea меняется — синхронизируем в columnFilters.railway_carriage_number
  const handleWagonSearch = (value) => {
    setWagonSearch(value);
    const tokens = parseTokens(value.toLowerCase());
    if (!tokens.length) {
      setColumnFilters((prev) => { const n = { ...prev }; delete n.railway_carriage_number; return n; });
      return;
    }
    // Находим все уникальные номера вагонов которые совпадают с любым токеном
    const matched = [...new Set(
      trips.map((t) => t.railway_carriage_number).filter(Boolean).filter((num) => matchesAny(num, tokens)),
    )];
    setColumnFilters((prev) => {
      if (!matched.length) { const n = { ...prev }; delete n.railway_carriage_number; return n; }
      return { ...prev, railway_carriage_number: matched };
    });
  };

  const handleFilterChange = (colId, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!values?.length) delete next[colId];
      else next[colId] = values;
      return next;
    });
  };

  // Фильтрация только через columnFilters (wagonSearch синхронизирован туда)
  const filteredTrips = useMemo(() => applyFilters(trips, columnFilters), [trips, columnFilters]);

  const hasActiveFilters = Object.keys(columnFilters).length > 0;
  const hasWagonSearch = wagonSearch.trim().length > 0;

  // --- Выбор рейсов ---
  const toggleTripSelect = (id) => {
    setSelectedTripIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllTrips = () => {
    setSelectedTripIds(new Set(filteredTrips.map((t) => t.id)));
  };

  const clearTripSelection = () => setSelectedTripIds(new Set());

  // --- Групповой комментарий ---
  const handleBulkCommentApply = async () => {
    const text = bulkCommentText.trim();
    if (!text || selectedTripIds.size === 0) return;
    setBulkApplyLoading(true);
    setBulkApplyResult(null);
    try {
      const res = await api.post('/v2/comment-constructor/apply', {
        entity_type: 'trip',
        entity_ids: Array.from(selectedTripIds),
        text,
      });
      setBulkApplyResult(res.data);
      if (res.data.status === 'success' || res.data.success_count > 0) {
        setBulkCommentText('');
        setSelectedTripIds(new Set());
        setBulkModalOpen(false);
      }
    } catch (e) {
      setBulkApplyResult({
        status: 'failure',
        message: e.response?.data?.detail?.message || e.response?.data?.detail || 'Ошибка сохранения.',
      });
    } finally {
      setBulkApplyLoading(false);
    }
  };

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
      {/* Поиск по вагонам — синхронизируется с ColumnFilter */}
      <div className="h-search-box">
        <textarea
          className="h-search-input h-search-textarea"
          placeholder={'Поиск по номеру вагона…\nМожно вставить несколько (через пробел или Enter)'}
          value={wagonSearch}
          onChange={(e) => handleWagonSearch(e.target.value)}
          rows={2}
        />
        {hasWagonSearch && (
          <button type="button" className="h-search-clear" onClick={() => handleWagonSearch('')} title="Сбросить">✕</button>
        )}
      </div>

      {/* Кнопка сброса всех фильтров */}
      {hasActiveFilters && (
        <button
          type="button"
          className="reset-filters-btn active"
          onClick={() => { setColumnFilters({}); setWagonSearch(''); }}
          title="Сбросить все фильтры"
        >
          <FilterX size={16} /> Сбросить фильтры
        </button>
      )}

      <div className="h-view-meta">
        Рейсов: {total}
        {hasActiveFilters && ` (показано: ${filteredTrips.length})`}
      </div>

      <div className="h-view-toolbar-right">
        <button type="button" className="h-bulk-select-btn" onClick={selectAllTrips}>
          Выбрать всё
        </button>
        {selectedTripIds.size > 0 && (
          <button type="button" className="h-bulk-clear-btn" onClick={clearTripSelection}>
            Сбросить выбор
          </button>
        )}
        <button
          type="button"
          className="h-bulk-comment-btn"
          disabled={selectedTripIds.size === 0}
          onClick={() => { setBulkApplyResult(null); setBulkModalOpen(true); }}
        >
          <MessageSquarePlus size={18} />
          Добавить комментарий{selectedTripIds.size > 0 ? ` (${selectedTripIds.size})` : ''}
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="data-loading">Загрузка рейсов…</div>;

  if (error) {
    return (
      <div className="data-error">
        {error}
        <button type="button" className="retry-btn" onClick={fetchTrips}>Повторить</button>
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
              <th style={{ width: 32 }} />
              {/* Вагон: activeValues отражает и поиск и ColumnFilter */}
              <th className="th-with-filter">
                <span className="th-label">Вагон</span>
                <ColumnFilter
                  columnId="railway_carriage_number"
                  label="Вагон"
                  rows={trips}
                  activeValues={columnFilters.railway_carriage_number}
                  onApply={(v) => { setWagonSearch(''); handleFilterChange('railway_carriage_number', v); }}
                  onClear={() => { setWagonSearch(''); handleFilterChange('railway_carriage_number', []); }}
                />
              </th>
              <th>№ рейса</th>
              <th>Дата рейса</th>
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
              <th>№ ваг. на поезде</th>
              <th>Последняя операция</th>
              <th>Дата операции</th>
              <th>Статус</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrips.length === 0 && (
              <tr>
                <td colSpan={12} className="empty-table-message">Нет данных по выбранным фильтрам</td>
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
                    <td className="h-wagon-check">
                      <input
                        type="checkbox"
                        checked={selectedTripIds.has(trip.id)}
                        onChange={() => toggleTripSelect(trip.id)}
                        className="h-bulk-checkbox"
                        title="Выбрать"
                      />
                    </td>
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
                    <td>{trip.number_railway_carriage_on_train || '—'}</td>
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
                    <td className="h-last-comment">
                      {trip.last_comment_text
                        ? <span className="h-last-comment-text">{trip.last_comment_text}</span>
                        : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="h-ops-row">
                      <td />
                      <td />
                      <td colSpan={10} className="h-ops-cell">
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

      {commentTrip && <TripComments trip={commentTrip} onClose={() => setCommentTrip(null)} />}

      {/* Modal массового комментария */}
      {bulkModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          onClick={() => !bulkApplyLoading && setBulkModalOpen(false)}
        >
          <div className="modal-content h-bulk-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Массовый комментарий</h3>
            <p className="h-bulk-modal-count">Выбрано рейсов: <strong>{selectedTripIds.size}</strong></p>
            <label className="h-bulk-modal-label">
              <textarea
                value={bulkCommentText}
                onChange={(e) => setBulkCommentText(e.target.value)}
                placeholder="Введите текст комментария…"
                className="h-bulk-modal-textarea"
                rows={4}
                maxLength={2000}
              />
              <span className="h-bulk-char-count">{bulkCommentText.length} / 2000</span>
            </label>
            {bulkApplyResult && (
              <div className={`h-bulk-result h-bulk-result--${bulkApplyResult.status}`}>
                {bulkApplyResult.message}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => !bulkApplyLoading && setBulkModalOpen(false)}
                disabled={bulkApplyLoading}
              >
                Отмена
              </button>
              <button
                type="button"
                className="save-btn"
                onClick={handleBulkCommentApply}
                disabled={bulkApplyLoading || !bulkCommentText.trim()}
              >
                {bulkApplyLoading ? 'Сохранение…' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
