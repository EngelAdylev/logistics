import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { api } from '../../api';
import WagonRow from './WagonRow';

export default function HierarchyView({ isActive, onMetaChange }) {
  const [wagons, setWagons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedWagonIds, setSelectedWagonIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCommentText, setBulkCommentText] = useState('');
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyResult, setBulkApplyResult] = useState(null);

  // page state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  // фильтр по номеру вагона
  const [wagonSearch, setWagonSearch] = useState('');
  const [wagonSearchInput, setWagonSearchInput] = useState('');

  // expanded state
  const [expandedWagonIds, setExpandedWagonIds] = useState(new Set());
  const [tripsByWagonId, setTripsByWagonId] = useState(new Map());
  const [tripsLoading, setTripsLoading] = useState(new Map());
  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [operationsByTripId, setOperationsByTripId] = useState(new Map());
  const [opsLoading, setOpsLoading] = useState(new Map());

  const fetchWagons = useCallback(async (p = 1, search = wagonSearch) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT });
      if (isActive !== undefined) params.append('is_active', isActive);
      if (search.trim()) params.append('wagon_number', search.trim());
      const res = await api.get(`/v2/wagons?${params}`);
      setWagons(res.data.items || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.pages || 1);
      setPage(p);
      // Сбрасываем раскрытые элементы при смене страницы
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
    onMetaChange?.({ total, totalPages, page });
  }, [total, totalPages, page, onMetaChange]);

  useEffect(() => {
    setPage(1);
    setWagonSearch('');
    setWagonSearchInput('');
    fetchWagons(1, '');
  }, [isActive]);

  const handleWagonFilterApply = (val) => {
    const s = (val ?? wagonSearchInput).toString().trim();
    setWagonSearchInput(s);
    setWagonSearch(s);
    setPage(1);
    fetchWagons(1, s);
  };

  const handleWagonFilterClear = () => {
    setWagonSearchInput('');
    setWagonSearch('');
    setPage(1);
    fetchWagons(1, '');
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

  const toggleWagonSelect = (id) => {
    setSelectedWagonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWagons = () => {
    setSelectedWagonIds(new Set(wagons.map((w) => w.id)));
  };

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

  const toolbar = (
    <div className="h-view-toolbar">
      <div className="h-view-toolbar-right">
        <button
          type="button"
          className="h-bulk-select-btn"
          onClick={selectAllWagons}
        >
          Выбрать всё на странице
        </button>
        {selectedWagonIds.size > 0 && (
          <button
            type="button"
            className="h-bulk-clear-btn"
            onClick={clearSelection}
          >
            Сбросить выбор
          </button>
        )}
        <button
          type="button"
          className="h-bulk-comment-btn"
          disabled={selectedWagonIds.size === 0}
          onClick={() => {
            setBulkApplyResult(null);
            setBulkModalOpen(true);
          }}
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
        <button type="button" className="retry-btn" onClick={() => fetchWagons(page)}>
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
              <th style={{ width: 44 }} />
              <th style={{ width: 32 }} />
              <th className="th-with-filter th-filter-has-input">
                <span className="th-label">Номер вагона</span>
                <div className="th-filter-input-wrap">
                  <input
                    type="text"
                    className="th-filter-input"
                    placeholder="Поиск…"
                    value={wagonSearchInput}
                    onChange={(e) => setWagonSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleWagonFilterApply()}
                  />
                  {wagonSearchInput ? (
                    <button type="button" className="th-filter-clear" onClick={handleWagonFilterClear} title="Сбросить">✕</button>
                  ) : null}
                </div>
              </th>
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
                isSelected={selectedWagonIds.has(wagon.id)}
                onToggleSelect={toggleWagonSelect}
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

      {/* Modal массового комментария */}
      {bulkModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          onClick={() => !bulkApplyLoading && setBulkModalOpen(false)}
        >
          <div className="modal-content h-bulk-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Массовый комментарий</h3>
            <p className="h-bulk-modal-count">Выбрано записей: <strong>{selectedWagonIds.size}</strong></p>
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
