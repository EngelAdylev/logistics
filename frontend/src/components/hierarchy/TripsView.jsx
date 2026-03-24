import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, MessageSquare, MessageSquarePlus, FilterX, ArrowUpDown, ArrowDown, ArrowUp, CheckSquare, XSquare, Search } from 'lucide-react';
import { api } from '../../api';
import ColumnFilter from '../../table/ColumnFilter';
import ColumnVisibilityPanel from '../../table/ColumnVisibilityPanel';
import { applyFilters } from '../../table/tableUtils';
import { TRIPS_COLUMNS } from './tripsColumnsConfig';
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

function parseTokens(input) {
  return input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

function matchesAny(val, tokens) {
  const lower = (val || '').toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

const DEFAULT_VISIBLE_IDS = TRIPS_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id);

export default function TripsView({ isActive }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  const [visibleColumnIds, setVisibleColumnIds] = useState(DEFAULT_VISIBLE_IDS);
  const [columnFilters, setColumnFilters] = useState({});
  const [wagonSearch, setWagonSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState(null);

  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [operationsByTripId, setOperationsByTripId] = useState(new Map());
  const [opsLoading, setOpsLoading] = useState(new Map());
  const [commentTrip, setCommentTrip] = useState(null);

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

  const searchedTrips = useMemo(() => {
    const tokens = parseTokens(wagonSearch.toLowerCase());
    if (!tokens.length) return trips;
    return trips.filter((t) => matchesAny(t.railway_carriage_number, tokens));
  }, [trips, wagonSearch]);

  const filteredTrips = useMemo(() => {
    const filtered = applyFilters(searchedTrips, columnFilters);
    if (!sortField || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const ta = a[sortField] ? new Date(a[sortField]).getTime() : 0;
      const tb = b[sortField] ? new Date(b[sortField]).getTime() : 0;
      return sortDir === 'desc' ? tb - ta : ta - tb;
    });
  }, [searchedTrips, columnFilters, sortField, sortDir]);

  const hasSearch = wagonSearch.trim().length > 0;
  const hasFilters = Object.keys(columnFilters).length > 0;

  const handleFilterChange = (colId, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!values?.length) delete next[colId];
      else next[colId] = values;
      return next;
    });
  };

  const handleSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); return; }
    if (sortDir === 'desc') { setSortDir('asc'); return; }
    setSortField(null); setSortDir(null);
  };

  const sortIcon = (field, size = 13) => {
    if (sortField !== field) return <ArrowUpDown size={size} />;
    return sortDir === 'desc' ? <ArrowDown size={size} /> : <ArrowUp size={size} />;
  };

  const toggleTripSelect = (id) => {
    setSelectedTripIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllTrips = () => setSelectedTripIds(new Set(filteredTrips.map((t) => t.id)));
  const clearTripSelection = () => setSelectedTripIds(new Set());

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

  const visibleCols = visibleColumnIds.length
    ? TRIPS_COLUMNS.filter((c) => visibleColumnIds.includes(c.id))
    : TRIPS_COLUMNS.filter((c) => c.isDefaultVisible !== false);

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
        <div className="h-compact-toolbar">
          <div className="h-compact-toolbar-left">
            <span className="h-compact-meta">0</span>
          </div>
        </div>
        <div className="data-loading">Рейсов не найдено</div>
      </div>
    );
  }

  // +2 for checkbox + expand columns
  const colCount = 2 + visibleCols.length;

  const renderCell = (col, trip) => {
    const departure = trip.departure_station_name || trip.departure_station_code || '—';
    const destination = trip.destination_station_name || trip.destination_station_code || '—';

    switch (col.id) {
      case 'railway_carriage_number':
        return <td key={col.id} className="h-wagon-num">{trip.railway_carriage_number || '—'}</td>;
      case 'flight_start_date':
        return <td key={col.id} className="h-trip-date">{formatDate(trip.flight_start_date)}</td>;
      case 'departure_station_name':
        return <td key={col.id}>{departure}</td>;
      case 'destination_station_name':
        return <td key={col.id}>{destination}</td>;
      case 'number_train':
        return (
          <td key={col.id} className="h-trip-train">
            {trip.number_train || '—'}
            {trip.train_index && <span className="h-train-index"> / {trip.train_index}</span>}
          </td>
        );
      case 'number_railway_carriage_on_train':
        return <td key={col.id}>{trip.number_railway_carriage_on_train || '—'}</td>;
      case 'last_operation_name':
        return (
          <td key={col.id} className="h-trip-lastop">
            <div>{trip.last_operation_name || '—'}</div>
            {trip.last_station_name && <div className="h-lastop-station">{trip.last_station_name}</div>}
          </td>
        );
      case 'last_operation_date':
        return <td key={col.id} className="h-trip-lastdt">{formatDateTime(trip.last_operation_date)}</td>;
      case 'last_station_name':
        return <td key={col.id}>{trip.last_station_name || '—'}</td>;
      case 'remaining_distance':
        return <td key={col.id}>{trip.remaining_distance || '—'}</td>;
      case 'is_active':
        return (
          <td key={col.id} className="h-trip-status">
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
        );
      case 'last_comment_text':
        return (
          <td key={col.id} className="h-last-comment">
            {trip.last_comment_text
              ? <span className="h-last-comment-text">{trip.last_comment_text}</span>
              : '—'}
          </td>
        );
      default:
        return <td key={col.id}>—</td>;
    }
  };

  return (
    <div className="h-view-wrapper">
      {/* Compact single-row toolbar */}
      <div className="h-compact-toolbar">
        <div className="h-compact-toolbar-left">
          <button
            type="button"
            className={`compact-icon-btn ${searchOpen || hasSearch ? 'active' : ''}`}
            onClick={() => setSearchOpen((v) => !v)}
            title="Поиск по номеру вагона"
          >
            <Search size={15} />
          </button>
          {searchOpen && (
            <div className="h-compact-search">
              <input
                type="text"
                className="h-compact-search-input"
                placeholder="Номера через пробел…"
                value={wagonSearch}
                onChange={(e) => setWagonSearch(e.target.value)}
                autoFocus
              />
              {hasSearch && (
                <button type="button" className="h-compact-search-clear" onClick={() => setWagonSearch('')}>✕</button>
              )}
            </div>
          )}
          <span className="h-compact-meta">
            {total}{(hasSearch || hasFilters) && filteredTrips.length !== total && ` / ${filteredTrips.length}`}
          </span>
        </div>
        <div className="h-compact-toolbar-right">
          <button
            type="button"
            className={`compact-icon-btn ${hasFilters ? 'warning' : ''}`}
            onClick={() => { setColumnFilters({}); setWagonSearch(''); }}
            disabled={!hasFilters && !hasSearch}
            title="Сбросить все фильтры"
          >
            <FilterX size={15} />
          </button>
          <ColumnVisibilityPanel
            visibleColumnIds={visibleColumnIds}
            onVisibilityChange={setVisibleColumnIds}
            columns={TRIPS_COLUMNS}
          />
          <span className="h-compact-divider" />
          <button
            type="button"
            className="compact-icon-btn"
            onClick={selectAllTrips}
            title="Выбрать все рейсы"
          >
            <CheckSquare size={15} />
          </button>
          {selectedTripIds.size > 0 && (
            <button
              type="button"
              className="compact-icon-btn"
              onClick={clearTripSelection}
              title="Сбросить выбор"
            >
              <XSquare size={15} />
            </button>
          )}
          <button
            type="button"
            className={`compact-icon-btn accent ${selectedTripIds.size === 0 ? '' : 'active'}`}
            disabled={selectedTripIds.size === 0}
            onClick={() => { setBulkApplyResult(null); setBulkModalOpen(true); }}
            title={`Массовый комментарий${selectedTripIds.size > 0 ? ` (${selectedTripIds.size})` : ''}`}
          >
            <MessageSquarePlus size={15} />
            {selectedTripIds.size > 0 && <span className="compact-icon-badge">{selectedTripIds.size}</span>}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="h-table-scroll">
        <table className="excel-table h-wagon-table compact-table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th style={{ width: 28 }} />
              {visibleCols.map((col) => (
                <th key={col.id} className="th-with-filter">
                  <span className="th-label">{col.label}</span>
                  {col.sortable && (
                    <button
                      type="button"
                      className={`sort-btn ${sortField === col.accessorKey ? 'active' : ''}`}
                      onClick={() => handleSort(col.accessorKey)}
                      title={
                        sortField === col.accessorKey && sortDir === 'desc' ? 'Сначала новые → нажми для старых'
                          : sortField === col.accessorKey && sortDir === 'asc' ? 'Сначала старые → нажми для сброса'
                            : `Сортировать по ${col.label.toLowerCase()}`
                      }
                    >
                      {sortIcon(col.accessorKey)}
                    </button>
                  )}
                  {col.filterable && (
                    <ColumnFilter
                      columnId={col.accessorKey || col.id}
                      label={col.label}
                      rows={searchedTrips}
                      activeValues={columnFilters[col.accessorKey || col.id]}
                      onApply={(v) => handleFilterChange(col.accessorKey || col.id, v)}
                      onClear={() => handleFilterChange(col.accessorKey || col.id, [])}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredTrips.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty-table-message">Нет данных по выбранным фильтрам</td>
              </tr>
            )}
            {filteredTrips.map((trip) => {
              const isExpanded = expandedTripIds.has(trip.id);
              const ops = operationsByTripId.get(trip.id);
              const opLoading = opsLoading.has(trip.id);

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
                    {visibleCols.map((col) => renderCell(col, trip))}
                  </tr>
                  {isExpanded && (
                    <tr className="h-ops-row">
                      <td />
                      <td />
                      <td colSpan={visibleCols.length} className="h-ops-cell">
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
