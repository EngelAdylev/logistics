import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, Download, Plus, Pencil, Trash2, Minus, Train, Search, FilterX, X, Package, ClipboardList, MessageSquare, Info, Clock } from 'lucide-react';
import { api } from '../../api';
import ColumnFilter from '../../table/ColumnFilter';
import ColumnVisibilityPanel from '../../table/ColumnVisibilityPanel';
import { TRAIN_COMPOSITION_COLUMNS, TRAIN_COMPOSITION_TABLE_KEY } from './trainCompositionColumnsConfig';

/* ─── helpers ─── */
function rowKey(wagon) {
  if (wagon.waybill_id && wagon.container_number)
    return `wb:${wagon.waybill_id}:ktk:${wagon.container_number}`;
  if (wagon.waybill_id)
    return `wb:${wagon.waybill_id}:wagon:${wagon.wagon_number}`;
  return `wagon:${wagon.wagon_number}`;
}

function KmBadge({ km }) {
  if (km === null || km === undefined) return <span className="km-badge km-badge--unknown">—</span>;
  if (km <= 150) return <span className="km-badge km-badge--near">{km} км</span>;
  return <span className="km-badge km-badge--far">{km} км</span>;
}

function RouteStatus({ routeStatus, ready }) {
  if (routeStatus === 'closed') return <span className="route-status route-status--closed">Закрыт</span>;
  if (routeStatus === 'open')   return <span className="route-status route-status--open">Открыт</span>;
  if (ready) return <span className="route-status route-status--pending">Формируется…</span>;
  return <span className="route-status route-status--monitoring">Мониторинг</span>;
}

const ORDER_COLORS = ['#dbeafe','#dcfce7','#fef9c3','#fce7f3','#ede9fe','#ffedd5'];
const ORDER_BORDER = ['#93c5fd','#86efac','#fde68a','#f9a8d4','#c4b5fd','#fdba74'];
const STATUS_LABELS = { new: 'Новая', in_progress: 'В работе', done: 'Выполнена' };

function OrderBadge({ status }) {
  const cls = { new: 'order-badge order-badge--new', in_progress: 'order-badge order-badge--progress', done: 'order-badge order-badge--done' }[status] || 'order-badge';
  return <span className={cls}>{STATUS_LABELS[status] || status}</span>;
}

/* ─── форма ─── */
const EMPTY_FORM = { client_name: '', comment: '' };

function OrderFormPanel({ routeId, existing, selectedKeys, allWagons, onSaved, onCancel }) {
  const isCreate = !existing;
  const [form, setForm] = useState(existing ? {
    client_name: existing.client_name || '',
    comment: existing.comment || '',
  } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (isCreate && selectedKeys.size === 0) { setErr('Выберите хотя бы одну строку'); return; }
    setSaving(true); setErr('');
    try {
      if (isCreate) {
        const items = [...selectedKeys].map((key) => {
          if (key.startsWith('wagon:')) return { wagon_number: key.slice(6), waybill_id: null, container_number: null };
          const w = allWagons.find((w) => rowKey(w) === key);
          return { wagon_number: w?.wagon_number || '', waybill_id: w?.waybill_id || null, container_number: w?.container_number || null };
        });
        await api.post(`/v2/routes/${routeId}/orders`, { ...form, items });
      } else {
        await api.patch(`/v2/orders/${existing.id}`, form);
      }
      onSaved();
    } catch (e) {
      const d = e.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Ошибка сохранения');
    } finally { setSaving(false); }
  };

  return (
    <div className="tof-panel">
      <div className="tof-header">
        {isCreate
          ? <><Plus size={13} /> Назначить клиента {selectedKeys.size > 0 && <span className="tof-count">{selectedKeys.size} стр.</span>}</>
          : <><Pencil size={13} /> Заявка №{existing.order_number}</>}
      </div>
      <div className="tof-row">
        <div className="tof-field">
          <span className="tof-label">Клиент</span>
          <input className="tof-input" value={form.client_name}
            onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
            placeholder="Название клиента" autoFocus />
        </div>
        <div className="tof-field tof-field--comment">
          <span className="tof-label">Комментарий</span>
          <input className="tof-input" value={form.comment}
            onChange={e => setForm(p => ({ ...p, comment: e.target.value }))}
            placeholder="Необязательно" />
        </div>
        <div className="tof-actions">
          <button type="button" className="cancel-btn" onClick={onCancel} disabled={saving}>Отмена</button>
          <button type="button" className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? '…' : isCreate ? 'Присвоить' : 'Сохранить'}
          </button>
        </div>
      </div>
      {err && <div className="tof-error">{err}</div>}
    </div>
  );
}

/* ─── состав поезда (inline) ─── */
function TrainComposition({ routeId, trainNumber, onExported, visibleColumnIds, onVisibleColumnsChange }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'create' | 'edit'
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [editingOrder, setEditingOrder] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Комментарии: commentMode 'view' | 'add'
  const [commentMode, setCommentMode] = useState('view');
  const [selectedWagons, setSelectedWagons] = useState(new Set()); // Set of wagon_id
  const [commentText, setCommentText] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  // Фильтры колонок в таблице вагонов
  const [columnFilters, setColumnFilters] = useState({});

  // Таб-система для состава
  const [compTab, setCompTab] = useState('wagons'); // 'wagons' | 'orders' | 'info'

  // Липкий горизонтальный скролл
  const tableScrollRef = useRef(null);
  const stickyScrollRef = useRef(null);

  const handleTableScroll = (e) => {
    if (stickyScrollRef.current) {
      stickyScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const fetchRoute = useCallback(async () => {
    setLoading(true); setError(null);
    try { const res = await api.get(`/v2/routes/${routeId}`); setRoute(res.data); }
    catch { setError('Не удалось загрузить состав'); }
    finally { setLoading(false); }
  }, [routeId]);

  useEffect(() => { fetchRoute(); }, [fetchRoute]);

  const resetMode = () => { setMode('view'); setSelectedKeys(new Set()); setEditingOrder(null); };
  const handleSaved = () => { resetMode(); fetchRoute(); };

  const toggleKey = (key) => setSelectedKeys(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next;
  });

  const toggleWaybillGroup = (wagon) => {
    if (!wagon?.waybill_id) {
      toggleKey(rowKey(wagon));
      return;
    }

    const groupKeys = route.wagons
      .filter(w => !w.order && w.waybill_id === wagon.waybill_id)
      .map(w => rowKey(w));

    if (groupKeys.length === 0) return;

    setSelectedKeys(prev => {
      const next = new Set(prev);
      const allSelected = groupKeys.every(k => next.has(k));
      if (allSelected) {
        groupKeys.forEach(k => next.delete(k));
      } else {
        groupKeys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  // Комментарии: выбор всех строк вагона
  const toggleWagonForComment = (wagonId) => {
    const wagonRows = route.wagons.filter(w => w.wagon_id === wagonId);
    const allRowsSelected = wagonRows.every(w => selectedWagons.has(w.wagon_id));

    setSelectedWagons(prev => {
      const next = new Set(prev);
      if (allRowsSelected) {
        wagonRows.forEach(w => next.delete(w.wagon_id));
      } else {
        wagonRows.forEach(w => next.add(w.wagon_id));
      }
      return next;
    });
  };

  const handleSaveComment = async () => {
    if (selectedWagons.size === 0) {
      alert('Выберите хотя бы один вагон');
      return;
    }
    if (!commentText.trim()) {
      alert('Введите текст комментария');
      return;
    }
    setCommentSaving(true);
    try {
      const entityIds = Array.from(selectedWagons);
      await api.post('/v2/comment-constructor/apply', {
        entity_type: 'wagon',
        entity_ids: entityIds,
        text: commentText,
      });
      setCommentMode('view');
      setSelectedWagons(new Set());
      setCommentText('');
      fetchRoute();
    } catch (err) {
      const detail = err.response?.data?.detail;
      alert(typeof detail === 'string' ? detail : 'Ошибка сохранения комментария');
    } finally {
      setCommentSaving(false);
    }
  };

  const cancelComment = () => {
    setCommentMode('view');
    setSelectedWagons(new Set());
    setCommentText('');
  };

  // Фильтры колонок
  const handleFilterChange = (colId, vals) =>
    setColumnFilters(prev => ({ ...prev, [colId]: vals }));

  const handleResetFilters = () => setColumnFilters({});

  // Применяем фильтры к вагонам
  const filteredWagons = useMemo(() => {
    if (!route?.wagons) return [];
    let result = route.wagons;

    for (const [colId, vals] of Object.entries(columnFilters)) {
      if (!vals?.length) continue;
      result = result.filter(w => {
        const v = w[colId];
        const str = v?.toString?.()?.trim?.() ?? '';
        return vals.includes(str || '—');
      });
    }

    return result;
  }, [route?.wagons, columnFilters]);

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm('Удалить заявку?')) return;
    try { await api.delete(`/v2/orders/${orderId}`); fetchRoute(); } catch { alert('Ошибка удаления'); }
  };

  const handleRemoveItem = async (itemId) => {
    if (!window.confirm('Убрать из заявки?')) return;
    try { await api.delete(`/v2/order-items/${itemId}`); fetchRoute(); } catch { alert('Ошибка'); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/v2/routes/${routeId}/export`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `train_${trainNumber}_orders.json`; a.click();
      URL.revokeObjectURL(url); fetchRoute(); onExported?.();
    } catch { alert('Ошибка экспорта'); }
    finally { setExporting(false); }
  };

  const visibleCols = useMemo(() =>
    visibleColumnIds.length
      ? TRAIN_COMPOSITION_COLUMNS.filter(c => visibleColumnIds.includes(c.id))
      : TRAIN_COMPOSITION_COLUMNS.filter(c => c.isDefaultVisible !== false),
    [visibleColumnIds]
  );

  const isClosed = route?.status === 'closed';
  const ordersCount = route?.orders?.length || 0;
  const orderColors = {};
  const orderBorders = {};
  (route?.orders || []).forEach((o, i) => {
    orderColors[o.id] = ORDER_COLORS[i % ORDER_COLORS.length];
    orderBorders[o.id] = ORDER_BORDER[i % ORDER_BORDER.length];
  });

  if (loading) return <div className="trains-composition-loading"><div className="spinner-sm" />Загрузка состава…</div>;
  if (error)   return <div className="trains-composition-error">{error}</div>;
  if (!route)  return null;

  return (
    <div className="trains-composition-wrap">

      {/* Тулбар */}
      <div className="trains-composition-toolbar">
        <div className="trains-composition-toolbar-left">
          {!isClosed && mode === 'view' && commentMode === 'view' && (
            <button type="button" className="trains-action-btn trains-action-btn--create"
              onClick={() => { setMode('create'); setSelectedKeys(new Set()); }}>
              <Plus size={13} /> Назначить клиентов
            </button>
          )}
          {!isClosed && mode === 'view' && commentMode === 'view' && (
            <button type="button" className="trains-action-btn trains-action-btn--create"
              onClick={() => { setCommentMode('add'); setSelectedWagons(new Set()); }}>
              <MessageSquare size={14} /> Добавить комментарий
            </button>
          )}
          {!isClosed && ordersCount > 0 && mode === 'view' && commentMode === 'view' && (
            <button type="button" className="trains-export-btn" onClick={handleExport} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Экспорт…' : 'Сформировать JSON'}
            </button>
          )}
          {mode === 'view' && commentMode === 'view' && (
            <ColumnVisibilityPanel
              visibleColumnIds={visibleColumnIds}
              onVisibilityChange={onVisibleColumnsChange}
              columns={TRAIN_COMPOSITION_COLUMNS}
            />
          )}
          {mode === 'view' && commentMode === 'view' && Object.keys(columnFilters).some(k => columnFilters[k]?.length) && (
            <button type="button" className="compact-icon-btn warning" onClick={handleResetFilters} title="Сбросить фильтры">
              ✕ Фильтры
            </button>
          )}
        </div>

        {/* Карточки заявок */}
        {ordersCount > 0 && mode === 'view' && (
          <div className="trains-orders-legend">
            {route.orders.map((o, i) => (
              <div key={o.id} className="trains-order-card" style={{ background: orderColors[o.id], borderColor: orderBorders[o.id] }}>
                <span className="trains-order-card-num">№{o.order_number}</span>
                {o.client_name && <span className="trains-order-card-client">{o.client_name}</span>}
                <OrderBadge status={o.status} />
                <span className="trains-order-card-count">{o.items?.length || 0} стр.</span>
                {!isClosed && (
                  <span className="trains-order-card-actions">
                    <button className="icon-action-btn" title="Редактировать" onClick={() => { setEditingOrder(o); setMode('edit'); }}><Pencil size={11} /></button>
                    <button className="icon-action-btn icon-action-btn--danger" title="Удалить" onClick={() => handleDeleteOrder(o.id)}><Trash2 size={11} /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Таб-навигация */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginTop: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setCompTab('wagons')}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: compTab === 'wagons' ? 700 : 500,
            color: compTab === 'wagons' ? '#3b82f6' : '#6b7280',
            background: 'transparent',
            border: 'none',
            borderBottom: compTab === 'wagons' ? '3px solid #3b82f6' : 'none',
            marginBottom: '-2px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Package size={16} /> Состав ({route.wagons?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setCompTab('orders')}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: compTab === 'orders' ? 700 : 500,
            color: compTab === 'orders' ? '#3b82f6' : '#6b7280',
            background: 'transparent',
            border: 'none',
            borderBottom: compTab === 'orders' ? '3px solid #3b82f6' : 'none',
            marginBottom: '-2px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <ClipboardList size={16} /> Заявки ({ordersCount})
        </button>
        <button
          type="button"
          onClick={() => setCompTab('info')}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: compTab === 'info' ? 700 : 500,
            color: compTab === 'info' ? '#3b82f6' : '#6b7280',
            background: 'transparent',
            border: 'none',
            borderBottom: compTab === 'info' ? '3px solid #3b82f6' : 'none',
            marginBottom: '-2px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Info size={16} /> Инфо
        </button>
      </div>

      {/* Форма заявки */}
      {(mode === 'create' || mode === 'edit') && commentMode === 'view' && (
        <OrderFormPanel
          routeId={routeId}
          existing={mode === 'edit' ? editingOrder : null}
          selectedKeys={selectedKeys}
          allWagons={route.wagons}
          onSaved={handleSaved}
          onCancel={resetMode}
        />
      )}

      {/* Форма комментария */}
      {commentMode === 'add' && (
        <div className="tof-panel">
          <div className="tof-header">
            <MessageSquare size={14} /> Добавить комментарий {selectedWagons.size > 0 && <span className="tof-count">{selectedWagons.size} ваг.</span>}
          </div>
          <div className="tof-row">
            <div className="tof-field tof-field--comment">
              <span className="tof-label">Комментарий</span>
              <textarea className="tof-input"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Введите текст комментария…"
                rows={3}
                autoFocus
              />
            </div>
            <div className="tof-actions">
              <button type="button" className="cancel-btn" onClick={cancelComment} disabled={commentSaving}>Отмена</button>
              <button type="button" className="save-btn" onClick={handleSaveComment} disabled={commentSaving}>
                {commentSaving ? '…' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Подсказка в режиме выбора заявки */}
      {mode === 'create' && (
        <div className="trains-select-hint">
          Отметьте строки (накладные / КТК) которые войдут в заявку, затем заполните форму выше.
        </div>
      )}

      {/* Подсказка в режиме выбора комментария */}
      {commentMode === 'add' && (
        <div className="trains-select-hint">
          Отметьте вагоны для добавления комментария, затем заполните форму выше.
        </div>
      )}

      {/* ─── Таб: Состав вагонов ─── */}
      {compTab === 'wagons' && (
        <div className="trains-composition-scroll-wrapper">
        <div className="h-table-scroll" ref={tableScrollRef} onScroll={handleTableScroll}>
          <table className="excel-table compact-table trains-composition-table">
          <colgroup>
            {(mode === 'create' || commentMode === 'add') && <col style={{ width: 36 }} />}
            {visibleCols.map(col => (
              <col key={`cg-${col.id}`} style={col.width ? { width: col.width } : undefined} />
            ))}
            {mode === 'view' && commentMode === 'view' && !isClosed && <col style={{ width: 36 }} />}
          </colgroup>
          <thead>
            <tr>
              {(mode === 'create' || commentMode === 'add') && <th style={{ width: 36 }}></th>}
              {visibleCols.map(col => (
                <th key={col.id} style={col.width ? { width: col.width } : undefined} className="th-with-filter">
                  <span className="th-label">{col.label}</span>
                  {col.filterable !== false && mode === 'view' && commentMode === 'view' && (
                    <ColumnFilter
                      columnId={col.id}
                      label={col.label}
                      rows={route?.wagons || []}
                      activeValues={columnFilters[col.id]}
                      onApply={vals => handleFilterChange(col.id, vals)}
                      onClear={() => handleFilterChange(col.id, [])}
                    />
                  )}
                </th>
              ))}
              {mode === 'view' && commentMode === 'view' && !isClosed && <th style={{ width: 36 }}></th>}
            </tr>
          </thead>
          <tbody>
            {filteredWagons.map((wagon) => {
              const order = wagon.order;
              const key = rowKey(wagon);
              const isSelectedOrder = selectedKeys.has(key);
              const isSelectedComment = selectedWagons.has(wagon.wagon_id);
              const canSelectOrder = mode === 'create' && !order;
              const canSelectComment = commentMode === 'add';
              const rowBg = (isSelectedOrder || isSelectedComment) ? '#bfdbfe' : (order ? orderColors[order.id] : undefined);

              const renderCellValue = (col) => {
                if (col.id === 'client_name') {
                  const clientName = wagon.order?.client_name || '';
                  return clientName
                    ? <span className="cell-truncate" title={clientName}>{clientName}</span>
                    : <span className="text-muted">—</span>;
                }

                const val = wagon[col.accessorKey];
                if (val === null || val === undefined || val === '') {
                  return <span className="text-muted">—</span>;
                }

                // Специальная обработка для некоторых колонок
                if (col.id === 'wagon_number') {
                  return <strong>{val}</strong>;
                }

                if (col.id === 'waybill_number' || col.id === 'container_number' || col.id === 'zpu_number') {
                  return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{val}</span>;
                }

                if (col.id === 'shipper_name' || col.id === 'consignee_name' || col.id === 'cargo_name' ||
                    col.id === 'ownership' || col.id === 'wagon_model' || col.id === 'renter' ||
                    col.id === 'departure_station_name' || col.id === 'destination_station_name' ||
                    col.id === 'last_operation_name' || col.id === 'last_station_name' ||
                    col.id === 'last_comment_text') {
                  return <span className="cell-truncate" title={val}>{val}</span>;
                }

                // Числовые и размерные данные
                if (col.id === 'remaining_distance' || col.id === 'lifting_capacity' ||
                    col.id === 'weight_net' || col.id === 'cargo_weight' || col.id === 'axles_count') {
                  return <span style={{ textAlign: 'center' }}>{val}</span>;
                }

                // Даты
                if (col.id === 'next_repair_date') {
                  if (val && typeof val === 'string') {
                    const d = new Date(val);
                    return <span style={{ fontSize: '0.85rem' }}>{d.toLocaleDateString('ru-RU')}</span>;
                  }
                  return <span className="text-muted">—</span>;
                }

                // Остальное — как есть
                return val;
              };

              return (
                <tr key={key}
                  className={`wagon-row${order ? ' wagon-row--has-order' : ''}${isSelectedOrder || isSelectedComment ? ' wagon-row--selected' : ''}`}
                  style={{ background: rowBg, cursor: (canSelectOrder || canSelectComment) ? 'pointer' : 'default' }}
                  onClick={canSelectOrder ? () => toggleWaybillGroup(wagon) : (canSelectComment ? () => toggleWagonForComment(wagon.wagon_id) : undefined)}
                >
                  {(mode === 'create' || commentMode === 'add') && (
                    <td style={{ textAlign: 'center' }}>
                      {mode === 'create' && !order && (
                        <input type="checkbox" checked={isSelectedOrder} onChange={() => toggleWaybillGroup(wagon)} onClick={e => e.stopPropagation()} />
                      )}
                      {commentMode === 'add' && (
                        <input type="checkbox" checked={isSelectedComment} onChange={() => toggleWagonForComment(wagon.wagon_id)} onClick={e => e.stopPropagation()} />
                      )}
                    </td>
                  )}
                  {visibleCols.map(col => (
                    <td key={col.id} style={col.id === 'remaining_distance' ? { textAlign: 'center' } : undefined}>
                      {renderCellValue(col)}
                    </td>
                  ))}
                  {mode === 'view' && commentMode === 'view' && !isClosed && (
                    <td style={{ textAlign: 'center' }}>
                      {order && wagon.item_id && (
                        <button className="icon-action-btn icon-action-btn--danger" title="Убрать из заявки" onClick={() => handleRemoveItem(wagon.item_id)}><Minus size={12} /></button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

          {route.wagons.length === 0 && (
            <div className="trains-empty" style={{ padding: '20px 0' }}>Нет данных о составе поезда</div>
          )}

          {/* Липкий горизонтальный скролл внизу */}
          <div
            className="trains-composition-sticky-scroll"
            ref={stickyScrollRef}
            onScroll={(e) => {
              if (tableScrollRef.current) {
                tableScrollRef.current.scrollLeft = e.target.scrollLeft;
              }
            }}
          >
            <div style={{ height: '1px', width: tableScrollRef.current?.scrollWidth || '100%' }} />
          </div>
        </div>
      )}

      {/* ─── Таб: Заявки ─── */}
      {compTab === 'orders' && (
        <div style={{ padding: '16px' }}>
          {ordersCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#9ca3af' }}>
              Нет заявок
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {route.orders.map(o => (
                <div key={o.id} style={{
                  background: '#fff',
                  border: `2px solid ${orderBorders[o.id]}`,
                  borderRadius: 8,
                  padding: 16,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Заявка №{o.order_number}</div>
                    <OrderBadge status={o.status} />
                  </div>
                  {o.client_name && <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', marginBottom: 8 }}>{o.client_name}</div>}
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                    {o.items?.length || 0} вагон(ов) в заявке
                  </div>
                  {!isClosed && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="icon-action-btn" title="Редактировать" onClick={() => { setEditingOrder(o); setMode('edit'); }}><Pencil size={13} /></button>
                      <button className="icon-action-btn icon-action-btn--danger" title="Удалить" onClick={() => handleDeleteOrder(o.id)}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Таб: Информация ─── */}
      {compTab === 'info' && (
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Статус маршрута</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>
                <RouteStatus routeStatus={route.status} ready={false} />
              </div>
            </div>
            <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Вагонов в составе</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{route.wagons?.length || 0}</div>
            </div>
            <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Заявок создано</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{ordersCount}</div>
            </div>
            <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Дата создания</div>
              <div style={{ fontSize: 14, color: '#475569' }}>{new Date(route.created_at).toLocaleString('ru-RU')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── утилиты поиска ─── */
function parseTokens(input) {
  return input.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

function matchesAny(val, tokens) {
  const lower = (val || '').toLowerCase();
  return tokens.some(t => lower.includes(t));
}

function getStatusDisplay(t) {
  if (t.route_status === 'closed') return 'Закрыт';
  if (t.route_status === 'open')   return 'Открыт';
  if (t.ready)                     return 'Формируется';
  return 'Мониторинг';
}

/* ─── главный компонент ─── */
export default function TrainsView({ refreshKey }) {
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Множественное раскрытие
  const [expandedTrains, setExpandedTrains] = useState(new Set());

  // Поиск и фильтры
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});

  // Глобальная видимость колонок (для всех поездов)
  const DEFAULT_VISIBLE_IDS = TRAIN_COMPOSITION_COLUMNS
    .filter(c => c.isDefaultVisible !== false)
    .map(c => c.id);
  const [visibleColumnIds, setVisibleColumnIds] = useState(DEFAULT_VISIBLE_IDS);

  const fetchTrains = useCallback(async () => {
    setLoading(true); setError(null);
    try { const res = await api.get('/v2/trains'); setTrains(res.data.items || []); }
    catch { setError('Не удалось загрузить список поездов.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTrains(); }, [refreshKey, fetchTrains]);

  // Добавляем вычисляемое поле status_display для ColumnFilter
  const processedTrains = useMemo(() =>
    trains.map(t => ({ ...t, status_display: getStatusDisplay(t) })),
    [trains]
  );

  // Фильтрация: текстовый поиск + колоночные фильтры
  const filteredTrains = useMemo(() => {
    let result = processedTrains;

    const tokens = parseTokens(search.toLowerCase());
    if (tokens.length) {
      result = result.filter(t =>
        matchesAny(t.train_number, tokens) || matchesAny(t.train_index, tokens)
      );
    }

    for (const [colId, vals] of Object.entries(columnFilters)) {
      if (!vals?.length) continue;
      result = result.filter(t => {
        const v = t[colId];
        const str = v?.toString?.()?.trim?.() ?? '';
        return vals.includes(str || 'Без поезда');
      });
    }

    return result;
  }, [processedTrains, search, columnFilters]);

  const toggleTrain = (trainNumber, canExpand) => {
    if (!canExpand) return;
    setExpandedTrains(prev => {
      const next = new Set(prev);
      if (next.has(trainNumber)) next.delete(trainNumber);
      else next.add(trainNumber);
      return next;
    });
  };

  const handleFilterChange = (colId, vals) =>
    setColumnFilters(prev => ({ ...prev, [colId]: vals }));

  const handleResetFilters = () => setColumnFilters({});

  const hasSearch  = search.trim().length > 0;
  const hasFilters = Object.values(columnFilters).some(v => v?.length > 0);

  if (loading) return <div className="data-loading">Загрузка поездов…</div>;
  if (error)   return (
    <div className="data-error">
      {error}
      <button type="button" className="retry-btn" onClick={fetchTrains}>Повторить</button>
    </div>
  );

  if (trains.length === 0) return (
    <div className="trains-empty">
      <Train size={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
      <p>Нет активных поездов с назначением на станцию 648400</p>
      <p className="trains-empty-hint">Болванки создаются автоматически когда остаток ≤ 150 км</p>
    </div>
  );

  const TOTAL_COLS = 10; // chevron + 9 колонок данных (вагоны, накладные, контейнеры + 2 live колонки: станция, операция)

  return (
    <div className="h-view-wrapper">

      {/* ── Тулбар ── */}
      <div className="h-compact-toolbar">
        <div className="h-compact-toolbar-left">
          <button
            type="button"
            className={`compact-icon-btn ${searchOpen || hasSearch ? 'active' : ''}`}
            onClick={() => setSearchOpen(v => !v)}
            title="Поиск по номеру поезда или индексу"
          >
            <Search size={15} />
          </button>
          {searchOpen && (
            <div className="h-compact-search">
              <input
                type="text"
                className="h-compact-search-input"
                placeholder="Номер поезда или индекс через пробел…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              {hasSearch && (
                <button type="button" className="h-compact-search-clear" onClick={() => setSearch('')}>✕</button>
              )}
            </div>
          )}
          <span className="h-compact-meta">
            {trains.length}
            {(hasSearch || hasFilters) && filteredTrains.length !== trains.length && ` / ${filteredTrains.length}`}
          </span>
        </div>
        <div className="h-compact-toolbar-right">
          <button
            type="button"
            className={`compact-icon-btn ${hasFilters ? 'warning' : ''}`}
            onClick={handleResetFilters}
            disabled={!hasFilters}
            title="Сбросить все фильтры"
          >
            <FilterX size={15} />
          </button>
        </div>
      </div>

      {/* ── Таблица ── */}
      <div className="h-table-scroll">
        <table className="excel-table compact-table trains-main-table">
          <colgroup>
            <col style={{ width: 28 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 85 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th className="th-with-filter">
                <span className="th-label">№ поезда</span>
                <ColumnFilter
                  columnId="train_number"
                  label="№ поезда"
                  rows={processedTrains}
                  activeValues={columnFilters.train_number}
                  onApply={vals => handleFilterChange('train_number', vals)}
                  onClear={() => handleFilterChange('train_number', [])}
                />
              </th>
              <th className="th-with-filter">
                <span className="th-label">Индекс</span>
                <ColumnFilter
                  columnId="train_index"
                  label="Индекс"
                  rows={processedTrains}
                  activeValues={columnFilters.train_index}
                  onApply={vals => handleFilterChange('train_index', vals)}
                  onClear={() => handleFilterChange('train_index', [])}
                />
              </th>
              <th style={{ textAlign: 'center' }}>
                <span className="th-label">Вагонов</span>
              </th>
              <th style={{ textAlign: 'center' }}>
                <span className="th-label">С накладной</span>
              </th>
              <th style={{ textAlign: 'center' }}>
                <span className="th-label">Контейнеров</span>
              </th>
              <th style={{ textAlign: 'center' }}>
                <span className="th-label">Мин. остаток</span>
              </th>
              <th>
                <span className="th-label">Текущая станция</span>
              </th>
              <th>
                <span className="th-label">Последняя операция</span>
              </th>
              <th className="th-with-filter" style={{ textAlign: 'center' }}>
                <span className="th-label">Статус</span>
                <ColumnFilter
                  columnId="status_display"
                  label="Статус"
                  rows={processedTrains}
                  activeValues={columnFilters.status_display}
                  onApply={vals => handleFilterChange('status_display', vals)}
                  onClear={() => handleFilterChange('status_display', [])}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTrains.length === 0 ? (
              <tr>
                <td colSpan={TOTAL_COLS} className="empty-table-message">
                  Нет поездов по запросу
                </td>
              </tr>
            ) : (
              filteredTrains.map(t => {
                const isExpanded = expandedTrains.has(t.train_number);

                return (
                  <React.Fragment key={t.train_number}>
                    <tr
                      className={`train-row${isExpanded ? ' train-row--expanded' : ''}${t.ready ? ' train-row--ready' : ''}`}
                      onClick={() => toggleTrain(t.train_number, true)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ textAlign: 'center', color: '#94a3b8', padding: '10px 8px' }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', padding: '10px 12px' }}>
                        {t.train_number}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', padding: '10px 8px' }}>
                        {t.train_index || <span className="text-muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 13, padding: '10px 8px', fontWeight: 500 }}>{t.wagon_total}</td>
                      <td style={{ textAlign: 'center', fontSize: 13, padding: '10px 8px', fontWeight: 500 }}>{t.matched_wagons}</td>
                      <td style={{ textAlign: 'center', fontSize: 13, padding: '10px 8px', color: t.container_count > 0 ? '#059669' : '#94a3b8', fontWeight: 500 }}>
                        {t.container_count}
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 8px' }}><KmBadge km={t.min_km} /></td>
                      <td style={{ fontSize: 13, color: '#475569', padding: '10px 8px' }} className="cell-truncate" title={t.last_station_name || '—'}>
                        {t.last_station_name || <span className="text-muted">—</span>}
                      </td>
                      <td style={{ fontSize: 13, color: '#475569', padding: '10px 8px' }} className="cell-truncate" title={t.last_operation_name || '—'}>
                        {t.last_operation_name || <span className="text-muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>
                        <RouteStatus routeStatus={t.route_status} ready={t.ready} />
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="train-composition-row">
                        <td colSpan={TOTAL_COLS} style={{ padding: '12px', background: '#ffffff', borderRadius: '0 0 8px 8px' }}>
                          {t.route_id ? (
                            <TrainComposition
                              routeId={t.route_id}
                              trainNumber={t.train_number}
                              onExported={fetchTrains}
                              visibleColumnIds={visibleColumnIds}
                              onVisibleColumnsChange={setVisibleColumnIds}
                            />
                          ) : (
                            <div style={{ padding: '32px 24px', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', gap: 8 }}>
                                <Clock size={20} style={{ color: '#f59e0b' }} /> Поезд в статусе мониторинг
                              </div>
                              <div style={{ fontSize: 12, color: '#9ca3af' }}>Рейс будет создан когда остаток станет ≤ 150 км</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
