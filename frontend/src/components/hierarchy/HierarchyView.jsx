import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MessageSquarePlus, Layers, FilterX, ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../../api';
import WagonRow from './WagonRow';
import { HIERARCHY_COLUMNS } from './hierarchyColumnsConfig';
import ColumnFilter from '../../table/ColumnFilter';
import ColumnVisibilityPanel from '../../table/ColumnVisibilityPanel';
import { applyFilters, groupByTrain, EMPTY_TRAIN_LABEL } from '../../table/tableUtils';
import { ChevronDown, ChevronRight } from 'lucide-react';

function parseTokens(input) {
  return input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

function matchesAny(val, tokens) {
  const lower = (val || '').toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

const DEFAULT_VISIBLE_IDS = HIERARCHY_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id);

export default function HierarchyView({ isActive, refreshKey }) {
  const [wagons, setWagons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Search
  const [wagonSearch, setWagonSearch] = useState('');

  // Column config
  const [visibleColumnIds, setVisibleColumnIds] = useState(DEFAULT_VISIBLE_IDS);
  const [columnFilters, setColumnFilters] = useState({});

  // Sort by date
  const [sortDir, setSortDir] = useState(null); // null | 'desc' | 'asc'

  // Group by train
  const [groupByTrainEnabled, setGroupByTrainEnabled] = useState(false);
  const [collapsedTrains, setCollapsedTrains] = useState(new Set());

  // Group comment
  const [selectedWagonIds, setSelectedWagonIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCommentText, setBulkCommentText] = useState('');
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyResult, setBulkApplyResult] = useState(null);

  const fetchWagons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: 1, limit: 9999 });
      if (isActive !== undefined) params.append('is_active', isActive);
      const res = await api.get(`/v2/wagons?${params}`);
      setWagons(res.data.items || []);
      setTotal(res.data.total || 0);
      setSelectedWagonIds(new Set());
    } catch (e) {
      setError('Не удалось загрузить список вагонов.');
      setWagons([]);
    } finally {
      setLoading(false);
    }
  }, [isActive]);

  useEffect(() => {
    setWagonSearch('');
    fetchWagons();
  }, [isActive, refreshKey]);

  // Client-side wagon search filter
  const searchedWagons = useMemo(() => {
    const tokens = parseTokens(wagonSearch.toLowerCase());
    if (!tokens.length) return wagons;
    return wagons.filter((w) => matchesAny(w.railway_carriage_number, tokens));
  }, [wagons, wagonSearch]);

  // Column filters + sort
  const filteredWagons = useMemo(() => {
    const filtered = applyFilters(searchedWagons, columnFilters);
    if (!sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const ta = a.last_operation_date ? new Date(a.last_operation_date).getTime() : 0;
      const tb = b.last_operation_date ? new Date(b.last_operation_date).getTime() : 0;
      return sortDir === 'desc' ? tb - ta : ta - tb;
    });
  }, [searchedWagons, columnFilters, sortDir]);

  const handleFilterChange = (colId, vals) => {
    setColumnFilters((prev) => ({ ...prev, [colId]: vals }));
  };
  const handleResetFilters = () => setColumnFilters({});

  // Group by train
  const groups = useMemo(() => {
    const raw = groupByTrain(filteredWagons);
    if (!groupByTrainEnabled) return raw;
    // Сортировка вагонов внутри каждой группы по номеру вагона (числовая)
    const sorted = new Map();
    for (const [key, rows] of raw.entries()) {
      sorted.set(key, [...rows].sort((a, b) =>
        String(a.number_railway_carriage_on_train || '').localeCompare(
          String(b.number_railway_carriage_on_train || ''), undefined, { numeric: true }
        )
      ));
    }
    return sorted;
  }, [filteredWagons, groupByTrainEnabled]);

  const toggleTrain = (trainKey) => {
    setCollapsedTrains((prev) => {
      const next = new Set(prev);
      if (next.has(trainKey)) next.delete(trainKey);
      else next.add(trainKey);
      return next;
    });
  };

  // Visible cols
  const visibleCols = visibleColumnIds.length
    ? HIERARCHY_COLUMNS.filter((c) => visibleColumnIds.includes(c.id))
    : HIERARCHY_COLUMNS.filter((c) => c.isDefaultVisible !== false);

  // Selection
  const toggleWagonSelect = (id) => {
    setSelectedWagonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllWagons = () => setSelectedWagonIds(new Set(filteredWagons.map((w) => w.id)));
  const clearSelection = () => setSelectedWagonIds(new Set());

  // Bulk comment
  const handleBulkCommentApply = async () => {
    const text = bulkCommentText.trim();
    if (!text || selectedWagonIds.size === 0) return;
    setBulkApplyLoading(true);
    setBulkApplyResult(null);
    try {
      const res = await api.post('/v2/comment-constructor/apply', {
        entity_type: 'wagon',
        entity_ids: Array.from(selectedWagonIds),
        text,
      });
      setBulkApplyResult(res.data);
      if (res.data.status === 'success' || res.data.success_count > 0) {
        setBulkCommentText('');
        setSelectedWagonIds(new Set());
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

  const hasSearch = wagonSearch.trim().length > 0;
  const hasFilters = Object.keys(columnFilters).length > 0;

  const renderWagonRow = (wagon) => (
    <WagonRow
      key={wagon.id}
      wagon={wagon}
      isSelected={selectedWagonIds.has(wagon.id)}
      onToggleSelect={toggleWagonSelect}
      visibleCols={visibleCols}
      isGrouped={groupByTrainEnabled}
    />
  );

  if (loading) return <div className="data-loading">Загрузка вагонов…</div>;
  if (error) return (
    <div className="data-error">
      {error}
      <button type="button" className="retry-btn" onClick={fetchWagons}>Повторить</button>
    </div>
  );

  const colCountMain = 2 + visibleCols.length; // checkbox + expand + cols

  return (
    <div className="h-view-wrapper">
      {/* Search + selection + bulk comment toolbar */}
      <div className="h-view-toolbar">
        <div className="h-search-box">
          <textarea
            className="h-search-input h-search-textarea"
            placeholder={'Поиск по номеру вагона…\nМожно вставить несколько (через пробел или Enter)'}
            value={wagonSearch}
            onChange={(e) => setWagonSearch(e.target.value)}
            rows={2}
          />
          {hasSearch && (
            <button type="button" className="h-search-clear" onClick={() => setWagonSearch('')} title="Сбросить">✕</button>
          )}
        </div>
        <div className="h-view-meta">
          вагонов на слежении: {total}
          {(hasSearch || hasFilters) && filteredWagons.length !== total && ` (показано: ${filteredWagons.length})`}
        </div>
        <div className="h-view-toolbar-right">
          <button type="button" className="h-bulk-select-btn" onClick={selectAllWagons}>Выбрать всё</button>
          {selectedWagonIds.size > 0 && (
            <button type="button" className="h-bulk-clear-btn" onClick={clearSelection}>Сбросить выбор</button>
          )}
          <button
            type="button"
            className="h-bulk-comment-btn"
            disabled={selectedWagonIds.size === 0}
            onClick={() => { setBulkApplyResult(null); setBulkModalOpen(true); }}
          >
            <MessageSquarePlus size={18} />
            Добавить комментарий{selectedWagonIds.size > 0 ? ` (${selectedWagonIds.size})` : ''}
          </button>
        </div>
      </div>

      {/* Table controls toolbar */}
      <div className="table-toolbar">
        <button
          type="button"
          className={`group-toggle ${groupByTrainEnabled ? 'active' : ''}`}
          onClick={() => setGroupByTrainEnabled(!groupByTrainEnabled)}
          title="Группировать по поезду"
        >
          <Layers size={18} />
          {groupByTrainEnabled ? 'Группировка по поезду вкл.' : 'Группировать по поезду'}
        </button>
        <button
          type="button"
          className={`reset-filters-btn ${hasFilters ? 'active' : ''}`}
          onClick={handleResetFilters}
          disabled={!hasFilters}
        >
          <FilterX size={18} />
          Сбросить фильтры
        </button>
        <ColumnVisibilityPanel
          visibleColumnIds={visibleColumnIds}
          onVisibilityChange={setVisibleColumnIds}
          columns={HIERARCHY_COLUMNS}
        />
      </div>

      {/* Table */}
      <div className="h-table-scroll">
        <table className="excel-table h-wagon-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} title="Выбор" />
              {groupByTrainEnabled && <th className="group-col" />}
              {visibleCols.slice(0, 1).map((col) => (
                <th key={col.id} className="th-with-filter">
                  <span className="th-label">{col.label}</span>
                  {col.filterable && (
                    <ColumnFilter
                      columnId={col.accessorKey || col.id}
                      label={col.label}
                      rows={searchedWagons}
                      activeValues={columnFilters?.[col.accessorKey || col.id]}
                      onApply={(vals) => handleFilterChange(col.accessorKey || col.id, vals)}
                      onClear={() => handleFilterChange(col.accessorKey || col.id, [])}
                    />
                  )}
                </th>
              ))}
              <th style={{ width: 80 }}>Рейсы</th>
              {visibleCols.slice(1).map((col) => (
                <th key={col.id} className="th-with-filter">
                  <span className="th-label">{col.label}</span>
                  {col.id === 'last_operation_date' && (
                    <button
                      type="button"
                      className={`sort-btn ${sortDir ? 'active' : ''}`}
                      onClick={() => setSortDir((d) => d === null ? 'desc' : d === 'desc' ? 'asc' : null)}
                      title={sortDir === 'desc' ? 'Сначала новые → нажми для старых' : sortDir === 'asc' ? 'Сначала старые → нажми для сброса' : 'Сортировать по дате'}
                    >
                      {sortDir === 'desc' ? <ArrowDown size={14} /> : sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowUpDown size={14} />}
                    </button>
                  )}
                  {col.filterable && (
                    <ColumnFilter
                      columnId={col.accessorKey || col.id}
                      label={col.label}
                      rows={searchedWagons}
                      activeValues={columnFilters?.[col.accessorKey || col.id]}
                      onApply={(vals) => handleFilterChange(col.accessorKey || col.id, vals)}
                      onClear={() => handleFilterChange(col.accessorKey || col.id, [])}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredWagons.length === 0 ? (
              <tr>
                <td colSpan={colCountMain + (groupByTrainEnabled ? 1 : 0)} className="empty-table-message">
                  Нет вагонов по запросу
                </td>
              </tr>
            ) : groupByTrainEnabled ? (
              Array.from(groups.entries()).map(([trainKey, rows]) => {
                const displayLabel = trainKey === EMPTY_TRAIN_LABEL ? trainKey : `Поезд ${trainKey}`;
                const count = rows.length;
                const wagonWord = count === 1 ? 'вагон' : count >= 2 && count <= 4 ? 'вагона' : 'вагонов';
                const collapsed = collapsedTrains.has(trainKey);
                return (
                  <React.Fragment key={trainKey}>
                    <tr
                      className="group-header-row"
                      onClick={() => toggleTrain(trainKey)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggleTrain(trainKey)}
                    >
                      <td />
                      <td className="group-col">
                        <span className="group-caret">{collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
                      </td>
                      <td colSpan={visibleCols.length + 1}>
                        <span className="group-title">{displayLabel} ({count} {wagonWord})</span>
                      </td>
                    </tr>
                    {!collapsed && rows.map((wagon) => renderWagonRow(wagon))}
                  </React.Fragment>
                );
              })
            ) : (
              filteredWagons.map((wagon) => renderWagonRow(wagon))
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk comment modal */}
      {bulkModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          onClick={() => !bulkApplyLoading && setBulkModalOpen(false)}
        >
          <div className="modal-content h-bulk-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Массовый комментарий</h3>
            <p className="h-bulk-modal-count">Выбрано вагонов: <strong>{selectedWagonIds.size}</strong></p>
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
              <button type="button" className="cancel-btn" onClick={() => !bulkApplyLoading && setBulkModalOpen(false)} disabled={bulkApplyLoading}>
                Отмена
              </button>
              <button type="button" className="save-btn" onClick={handleBulkCommentApply} disabled={bulkApplyLoading || !bulkCommentText.trim()}>
                {bulkApplyLoading ? 'Сохранение…' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
