import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { api } from '../../api';
import WagonRow from './WagonRow';

/** Разбивает строку ввода по пробелу/переносу/запятой → массив токенов */
function parseTokens(input) {
  return input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

/** Возвращает true, если строка val содержит хотя бы один токен из tokens */
function matchesAny(val, tokens) {
  const lower = (val || '').toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

export default function HierarchyView({ isActive }) {
  const [wagons, setWagons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Групповой комментарий
  const [selectedWagonIds, setSelectedWagonIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCommentText, setBulkCommentText] = useState('');
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyResult, setBulkApplyResult] = useState(null);

  // фильтр по номеру вагона (клиентский, мультизначный)
  const [wagonSearch, setWagonSearch] = useState('');

  // expanded state
  const [expandedWagonIds, setExpandedWagonIds] = useState(new Set());
  const [tripsByWagonId, setTripsByWagonId] = useState(new Map());
  const [tripsLoading, setTripsLoading] = useState(new Map());
  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [operationsByTripId, setOperationsByTripId] = useState(new Map());
  const [opsLoading, setOpsLoading] = useState(new Map());

  const fetchWagons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: 1, limit: 9999 });
      if (isActive !== undefined) params.append('is_active', isActive);
      const res = await api.get(`/v2/wagons?${params}`);
      setWagons(res.data.items || []);
      setTotal(res.data.total || 0);
      setExpandedWagonIds(new Set());
      setExpandedTripIds(new Set());
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
  }, [isActive]);

  // Клиентский мультизначный фильтр по номеру вагона
  const filteredWagons = useMemo(() => {
    const tokens = parseTokens(wagonSearch.toLowerCase());
    if (!tokens.length) return wagons;
    return wagons.filter((w) => matchesAny(w.railway_carriage_number, tokens));
  }, [wagons, wagonSearch]);

  // --- Выбор вагонов ---
  const toggleWagonSelect = (id) => {
    setSelectedWagonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWagons = () => {
    setSelectedWagonIds(new Set(filteredWagons.map((w) => w.id)));
  };

  const clearSelection = () => setSelectedWagonIds(new Set());

  // --- Групповой комментарий ---
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

    if (tripsByWagonId.has(wagonId)) return;

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

  const hasSearch = wagonSearch.trim().length > 0;

  const toolbar = (
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
        Вагонов: {total}
        {hasSearch && filteredWagons.length !== total && ` (показано: ${filteredWagons.length})`}
      </div>
      <div className="h-view-toolbar-right">
        <button type="button" className="h-bulk-select-btn" onClick={selectAllWagons}>
          Выбрать всё
        </button>
        {selectedWagonIds.size > 0 && (
          <button type="button" className="h-bulk-clear-btn" onClick={clearSelection}>
            Сбросить выбор
          </button>
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
  );

  if (loading) return <div className="data-loading">Загрузка вагонов…</div>;

  if (error) {
    return (
      <div className="data-error">
        {error}
        <button type="button" className="retry-btn" onClick={fetchWagons}>
          Повторить
        </button>
      </div>
    );
  }

  if (wagons.length === 0) {
    return (
      <div className="h-view-wrapper">
        {toolbar}
        <div className="data-loading">Вагонов не найдено</div>
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
              <th>Номер вагона</th>
              <th>Статус</th>
              <th>Рейсы</th>
              <th>Комментарий</th>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {filteredWagons.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-table-message">Нет вагонов по запросу</td>
              </tr>
            ) : (
              filteredWagons.map((wagon) => (
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
                  isSelected={selectedWagonIds.has(wagon.id)}
                  onToggleSelect={toggleWagonSelect}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal массового комментария */}
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
