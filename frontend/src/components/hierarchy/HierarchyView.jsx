import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MessageSquarePlus, Layers, FilterX, ArrowUpDown, ArrowDown, ArrowUp, CheckSquare, XSquare, Search, Ruler } from 'lucide-react';
import { api } from '../../api';
import WagonRow from './WagonRow';
import { HIERARCHY_COLUMNS } from './hierarchyColumnsConfig';
import ColumnFilter from '../../table/ColumnFilter';
import ColumnVisibilityPanel from '../../table/ColumnVisibilityPanel';
import { applyFilters, groupByTrain, groupByDistance, EMPTY_TRAIN_LABEL, EMPTY_DISTANCE_LABEL } from '../../table/tableUtils';
import { ChevronDown, ChevronRight } from 'lucide-react';

function parseTokens(input) {
  return input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

function matchesAny(val, tokens) {
  const lower = (val || '').toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

const DEFAULT_VISIBLE_IDS = HIERARCHY_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id);

export default function HierarchyView({ isActive, direction, refreshKey }) {
  const [wagons, setWagons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  const [wagonSearch, setWagonSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState(DEFAULT_VISIBLE_IDS);
  const [columnFilters, setColumnFilters] = useState({});
  const [sortDir, setSortDir] = useState(null);
  const [groupByTrainEnabled, setGroupByTrainEnabled] = useState(false);
  const [groupByDistanceEnabled, setGroupByDistanceEnabled] = useState(false);
  const [collapsedTrains, setCollapsedTrains] = useState(new Set());
  const [collapsedDistances, setCollapsedDistances] = useState(new Set());

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
      if (direction) {
        params.append('direction', direction);
      } else if (isActive !== undefined) {
        params.append('is_active', isActive);
      }
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
  }, [isActive, direction]);

  useEffect(() => {
    setWagonSearch('');
    fetchWagons();
  }, [isActive, direction, refreshKey]);

  const searchedWagons = useMemo(() => {
    const tokens = parseTokens(wagonSearch.toLowerCase());
    if (!tokens.length) return wagons;
    return wagons.filter((w) => matchesAny(w.railway_carriage_number, tokens));
  }, [wagons, wagonSearch]);

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

  // Группы по поезду (плоские)
  const trainGroups = useMemo(() => {
    if (!groupByTrainEnabled) return null;
    const raw = groupByTrain(filteredWagons);
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

  // Группы по расстоянию (плоские)
  const distanceGroups = useMemo(() => {
    if (!groupByDistanceEnabled) return null;
    return groupByDistance(filteredWagons);
  }, [filteredWagons, groupByDistanceEnabled]);

  // Вложенная группировка: расстояние → поезд
  const nestedGroups = useMemo(() => {
    if (!groupByDistanceEnabled || !groupByTrainEnabled) return null;
    const distGroups = groupByDistance(filteredWagons);
    const nested = new Map();
    for (const [distKey, rows] of distGroups.entries()) {
      const trainMap = groupByTrain(rows);
      // Сортируем внутри каждого поезда
      const sortedTrainMap = new Map();
      for (const [tKey, tRows] of trainMap.entries()) {
        sortedTrainMap.set(tKey, [...tRows].sort((a, b) =>
          String(a.number_railway_carriage_on_train || '').localeCompare(
            String(b.number_railway_carriage_on_train || ''), undefined, { numeric: true }
          )
        ));
      }
      nested.set(distKey, sortedTrainMap);
    }
    return nested;
  }, [filteredWagons, groupByDistanceEnabled, groupByTrainEnabled]);

  const toggleTrain = (trainKey) => {
    setCollapsedTrains((prev) => {
      const next = new Set(prev);
      if (next.has(trainKey)) next.delete(trainKey);
      else next.add(trainKey);
      return next;
    });
  };

  const toggleDistance = (distKey) => {
    setCollapsedDistances((prev) => {
      const next = new Set(prev);
      if (next.has(distKey)) next.delete(distKey);
      else next.add(distKey);
      return next;
    });
  };

  const visibleCols = visibleColumnIds.length
    ? HIERARCHY_COLUMNS.filter((c) => visibleColumnIds.includes(c.id))
    : HIERARCHY_COLUMNS.filter((c) => c.isDefaultVisible !== false);

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

  const isAnyGrouping = groupByTrainEnabled || groupByDistanceEnabled;

  const renderWagonRow = (wagon) => (
    <WagonRow
      key={wagon.id}
      wagon={wagon}
      isSelected={selectedWagonIds.has(wagon.id)}
      onToggleSelect={toggleWagonSelect}
      visibleCols={visibleCols}
      isGrouped={isAnyGrouping}
    />
  );

  const wagonWord = (count) => count === 1 ? 'вагон' : count >= 2 && count <= 4 ? 'вагона' : 'вагонов';

  const renderGroupCheckbox = (groupRows) => {
    const groupIds = groupRows.map((w) => w.id);
    const allSelected = groupIds.every((id) => selectedWagonIds.has(id));
    const someSelected = !allSelected && groupIds.some((id) => selectedWagonIds.has(id));
    return (
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected; }}
        onChange={() => {
          setSelectedWagonIds((prev) => {
            const next = new Set(prev);
            if (allSelected) groupIds.forEach((id) => next.delete(id));
            else groupIds.forEach((id) => next.add(id));
            return next;
          });
        }}
      />
    );
  };

  const renderTrainGroup = (trainKey, rows, parentCollapsed) => {
    if (parentCollapsed) return null;
    const collapsed = collapsedTrains.has(trainKey);
    const displayLabel = trainKey === EMPTY_TRAIN_LABEL ? trainKey : `Поезд ${trainKey}`;
    return (
      <React.Fragment key={trainKey}>
        <tr
          className="group-header-row"
          onClick={() => toggleTrain(trainKey)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && toggleTrain(trainKey)}
        >
          <td className="h-wagon-check" onClick={(e) => e.stopPropagation()}>
            {renderGroupCheckbox(rows)}
          </td>
          <td className="group-col">
            <span className="group-caret">{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span>
          </td>
          <td colSpan={visibleCols.length + 1}>
            <span className="group-title">{displayLabel} ({rows.length} {wagonWord(rows.length)})</span>
          </td>
        </tr>
        {!collapsed && rows.map((wagon) => renderWagonRow(wagon))}
      </React.Fragment>
    );
  };

  const renderTableBody = () => {
    if (filteredWagons.length === 0) {
      return (
        <tr>
          <td colSpan={colCountMain + (isAnyGrouping ? 1 : 0)} className="empty-table-message">
            Нет вагонов по запросу
          </td>
        </tr>
      );
    }

    // Вложенная: расстояние → поезд
    if (groupByDistanceEnabled && groupByTrainEnabled && nestedGroups) {
      return Array.from(nestedGroups.entries()).map(([distKey, trainMap]) => {
        const allRowsInDist = Array.from(trainMap.values()).flat();
        const distCollapsed = collapsedDistances.has(distKey);
        return (
          <React.Fragment key={`dist-${distKey}`}>
            <tr
              className="group-header-row group-header-row--distance"
              onClick={() => toggleDistance(distKey)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && toggleDistance(distKey)}
            >
              <td className="h-wagon-check" onClick={(e) => e.stopPropagation()}>
                {renderGroupCheckbox(allRowsInDist)}
              </td>
              <td className="group-col">
                <span className="group-caret">{distCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span>
              </td>
              <td colSpan={visibleCols.length + 1}>
                <span className="group-title group-title--distance">Остаток: {distKey} ({allRowsInDist.length} {wagonWord(allRowsInDist.length)})</span>
              </td>
            </tr>
            {!distCollapsed && Array.from(trainMap.entries()).map(([trainKey, rows]) =>
              renderTrainGroup(trainKey, rows, false)
            )}
          </React.Fragment>
        );
      });
    }

    // Только расстояние
    if (groupByDistanceEnabled && distanceGroups) {
      return Array.from(distanceGroups.entries()).map(([distKey, rows]) => {
        const distCollapsed = collapsedDistances.has(distKey);
        return (
          <React.Fragment key={`dist-${distKey}`}>
            <tr
              className="group-header-row group-header-row--distance"
              onClick={() => toggleDistance(distKey)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && toggleDistance(distKey)}
            >
              <td className="h-wagon-check" onClick={(e) => e.stopPropagation()}>
                {renderGroupCheckbox(rows)}
              </td>
              <td className="group-col">
                <span className="group-caret">{distCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span>
              </td>
              <td colSpan={visibleCols.length + 1}>
                <span className="group-title group-title--distance">Остаток: {distKey} ({rows.length} {wagonWord(rows.length)})</span>
              </td>
            </tr>
            {!distCollapsed && rows.map((wagon) => renderWagonRow(wagon))}
          </React.Fragment>
        );
      });
    }

    // Только поезд
    if (groupByTrainEnabled && trainGroups) {
      return Array.from(trainGroups.entries()).map(([trainKey, rows]) =>
        renderTrainGroup(trainKey, rows, false)
      );
    }

    // Без группировки
    return filteredWagons.map((wagon) => renderWagonRow(wagon));
  };

  if (loading) return <div className="data-loading">Загрузка…</div>;
  if (error) return (
    <div className="data-error">
      {error}
      <button type="button" className="retry-btn" onClick={fetchWagons}>Повторить</button>
    </div>
  );

  const colCountMain = 2 + visibleCols.length;

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
            {total}{(hasSearch || hasFilters) && filteredWagons.length !== total && ` / ${filteredWagons.length}`}
          </span>
        </div>
        <div className="h-compact-toolbar-right">
          <button
            type="button"
            className={`compact-icon-btn ${groupByTrainEnabled ? 'active' : ''}`}
            onClick={() => setGroupByTrainEnabled(!groupByTrainEnabled)}
            title={groupByTrainEnabled ? 'Убрать группировку по поезду' : 'Группировать по поезду'}
          >
            <Layers size={15} />
          </button>
          <button
            type="button"
            className={`compact-icon-btn ${groupByDistanceEnabled ? 'active' : ''}`}
            onClick={() => setGroupByDistanceEnabled(!groupByDistanceEnabled)}
            title={groupByDistanceEnabled ? 'Убрать группировку по расстоянию' : 'Группировать по остатку км'}
          >
            <Ruler size={15} />
          </button>
          <button
            type="button"
            className={`compact-icon-btn ${hasFilters ? 'warning' : ''}`}
            onClick={handleResetFilters}
            disabled={!hasFilters}
            title="Сбросить все фильтры"
          >
            <FilterX size={15} />
          </button>
          <ColumnVisibilityPanel
            visibleColumnIds={visibleColumnIds}
            onVisibilityChange={setVisibleColumnIds}
            columns={HIERARCHY_COLUMNS}
          />
          <span className="h-compact-divider" />
          <button
            type="button"
            className="compact-icon-btn"
            onClick={selectAllWagons}
            title="Выбрать все вагоны"
          >
            <CheckSquare size={15} />
          </button>
          {selectedWagonIds.size > 0 && (
            <button
              type="button"
              className="compact-icon-btn"
              onClick={clearSelection}
              title="Сбросить выбор"
            >
              <XSquare size={15} />
            </button>
          )}
          <button
            type="button"
            className={`compact-icon-btn accent ${selectedWagonIds.size === 0 ? '' : 'active'}`}
            disabled={selectedWagonIds.size === 0}
            onClick={() => { setBulkApplyResult(null); setBulkModalOpen(true); }}
            title={`Массовый комментарий${selectedWagonIds.size > 0 ? ` (${selectedWagonIds.size})` : ''}`}
          >
            <MessageSquarePlus size={15} />
            {selectedWagonIds.size > 0 && <span className="compact-icon-badge">{selectedWagonIds.size}</span>}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="h-table-scroll">
        <table className="excel-table h-wagon-table compact-table">
          <colgroup>
            <col style={{ width: 28 }} />
            {isAnyGrouping && <col style={{ width: 28 }} />}
            {visibleCols.slice(0, 1).map((col) => (
              <col key={`cg-${col.id}`} style={col.width ? { width: col.width } : undefined} />
            ))}
            <col style={{ width: 50 }} />
            {visibleCols.slice(1).map((col) => (
              <col key={`cg-${col.id}`} style={col.width ? { width: col.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {isAnyGrouping && <th className="group-col" />}
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
              <th style={{ whiteSpace: 'nowrap' }}>Рейсы</th>
              {visibleCols.slice(1).map((col) => (
                <th key={col.id} className="th-with-filter">
                  <span className="th-label">{col.label}</span>
                  {col.id === 'last_operation_date' && (
                    <button
                      type="button"
                      className={`sort-btn ${sortDir ? 'active' : ''}`}
                      onClick={() => setSortDir((d) => d === null ? 'desc' : d === 'desc' ? 'asc' : null)}
                      title={sortDir === 'desc' ? 'Новые → старые' : sortDir === 'asc' ? 'Старые → сброс' : 'Сортировать'}
                    >
                      {sortDir === 'desc' ? <ArrowDown size={13} /> : sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowUpDown size={13} />}
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
            {renderTableBody()}
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
