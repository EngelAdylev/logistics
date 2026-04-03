import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Download, Plus, Pencil, Trash2, Minus, Train } from 'lucide-react';
import { api } from '../../api';

/* ─── helpers ─── */
function rowKey(wagon) {
  if (wagon.waybill_id) return `wb:${wagon.waybill_id}:ktk:${wagon.container_number || ''}`;
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
const EMPTY_FORM = { client_name: '', contract_number: '', status: 'new', comment: '' };

function OrderFormPanel({ routeId, existing, selectedKeys, allWagons, onSaved, onCancel }) {
  const isCreate = !existing;
  const [form, setForm] = useState(existing ? {
    client_name: existing.client_name || '',
    contract_number: existing.contract_number || '',
    status: existing.status || 'new',
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
    <div className="trains-order-form-panel">
      <div className="trains-order-form-title">
        {isCreate
          ? <><Plus size={14} /> Назначить клиента <span className="trains-order-form-count">выбрано строк: {selectedKeys.size}</span></>
          : <><Pencil size={14} /> Редактировать заявку №{existing.order_number}</>}
      </div>
      <div className="order-form-grid">
        <label>Клиент<input className="order-form-input" value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Название клиента" autoFocus /></label>
        <label>№ договора<input className="order-form-input" value={form.contract_number} onChange={e => setForm(p => ({ ...p, contract_number: e.target.value }))} placeholder="Номер договора" /></label>
        <label>Статус
          <select className="order-form-input" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
            <option value="new">Новая</option>
            <option value="in_progress">В работе</option>
            <option value="done">Выполнена</option>
          </select>
        </label>
        <label className="order-form-comment">Комментарий
          <textarea className="order-form-input" value={form.comment} onChange={e => setForm(p => ({ ...p, comment: e.target.value }))} rows={2} placeholder="Необязательно" />
        </label>
      </div>
      {err && <div className="order-form-error">{err}</div>}
      <div className="order-form-actions">
        <button type="button" className="cancel-btn" onClick={onCancel} disabled={saving}>Отмена</button>
        <button type="button" className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : isCreate ? 'Присвоить клиента' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

/* ─── состав поезда (inline) ─── */
function TrainComposition({ routeId, trainNumber, onExported }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('view');
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [editingOrder, setEditingOrder] = useState(null);
  const [exporting, setExporting] = useState(false);

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
          {!isClosed && mode === 'view' && (
            <button type="button" className="trains-action-btn trains-action-btn--create"
              onClick={() => { setMode('create'); setSelectedKeys(new Set()); }}>
              <Plus size={13} /> Назначить клиентов
            </button>
          )}
          {!isClosed && ordersCount > 0 && mode === 'view' && (
            <button type="button" className="trains-export-btn" onClick={handleExport} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Экспорт…' : 'Сформировать JSON'}
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

      {/* Форма */}
      {(mode === 'create' || mode === 'edit') && (
        <OrderFormPanel
          routeId={routeId}
          existing={mode === 'edit' ? editingOrder : null}
          selectedKeys={selectedKeys}
          allWagons={route.wagons}
          onSaved={handleSaved}
          onCancel={resetMode}
        />
      )}

      {/* Подсказка в режиме выбора */}
      {mode === 'create' && (
        <div className="trains-select-hint">
          Отметьте строки (накладные / КТК) которые войдут в заявку, затем заполните форму выше.
        </div>
      )}

      {/* Таблица */}
      <div className="h-table-scroll">
        <table className="excel-table compact-table trains-composition-table">
          <thead>
            <tr>
              {mode === 'create' && <th style={{ width: 36 }}></th>}
              <th>Вагон</th>
              <th>Накладная</th>
              <th>Контейнер</th>
              <th>Отправитель</th>
              <th>Получатель</th>
              <th>Груз</th>
              <th style={{ textAlign: 'center' }}>Остаток, км</th>
              <th>Клиент</th>
              {mode === 'view' && !isClosed && <th style={{ width: 36 }}></th>}
            </tr>
          </thead>
          <tbody>
            {route.wagons.map((wagon) => {
              const order = wagon.order;
              const key = rowKey(wagon);
              const isSelected = selectedKeys.has(key);
              const canSelect = mode === 'create' && !order;
              const rowBg = isSelected ? '#bfdbfe' : (order ? orderColors[order.id] : undefined);

              return (
                <tr key={key}
                  className={`wagon-row${order ? ' wagon-row--has-order' : ''}${isSelected ? ' wagon-row--selected' : ''}`}
                  style={{ background: rowBg, cursor: canSelect ? 'pointer' : 'default' }}
                  onClick={canSelect ? () => toggleKey(key) : undefined}
                >
                  {mode === 'create' && (
                    <td style={{ textAlign: 'center' }}>
                      {!order && <input type="checkbox" checked={isSelected} onChange={() => toggleKey(key)} onClick={e => e.stopPropagation()} />}
                    </td>
                  )}
                  <td><strong>{wagon.wagon_number}</strong></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{wagon.waybill_number || <span className="text-muted">—</span>}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{wagon.container_number || <span className="text-muted">—</span>}</td>
                  <td className="cell-truncate" title={wagon.shipper_name}>{wagon.shipper_name || <span className="text-muted">—</span>}</td>
                  <td className="cell-truncate" title={wagon.consignee_name}>{wagon.consignee_name || <span className="text-muted">—</span>}</td>
                  <td className="cell-truncate" title={wagon.cargo_name}>{wagon.cargo_name || <span className="text-muted">—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{wagon.remaining_distance || <span className="text-muted">—</span>}</td>
                  <td>
                    {order
                      ? <span className="trains-wagon-client">{order.client_name || <span className="text-muted">не указан</span>}</span>
                      : <span className="text-muted" style={{ fontSize: 11 }}>{wagon.waybill_id ? '—' : 'нет накладной'}</span>}
                  </td>
                  {mode === 'view' && !isClosed && (
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
    </div>
  );
}

/* ─── главный компонент ─── */
export default function TrainsView({ refreshKey }) {
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedTrain, setExpandedTrain] = useState(null);

  const fetchTrains = useCallback(async () => {
    setLoading(true); setError(null);
    try { const res = await api.get('/v2/trains'); setTrains(res.data.items || []); }
    catch { setError('Не удалось загрузить список поездов.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTrains(); }, [refreshKey, fetchTrains]);

  const toggle = (t) => {
    if (!t.route_id) return;
    setExpandedTrain(prev => prev === t.train_number ? null : t.train_number);
  };

  if (loading) return <div className="data-loading">Загрузка поездов…</div>;
  if (error)   return <div className="data-error">{error}<button type="button" className="retry-btn" onClick={fetchTrains}>Повторить</button></div>;

  if (trains.length === 0) return (
    <div className="trains-empty">
      <Train size={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
      <p>Нет активных поездов с назначением на станцию 648400</p>
      <p className="trains-empty-hint">Болванки создаются автоматически когда остаток ≤ 150 км</p>
    </div>
  );

  return (
    <div className="trains-view">

      {/* Шапка таблицы */}
      <div className="trains-list-header">
        <span style={{ width: 24 }}></span>
        <span style={{ flex: '0 0 130px' }}>№ поезда</span>
        <span style={{ flex: '0 0 150px' }}>Индекс</span>
        <span style={{ flex: '0 0 80px', textAlign: 'center' }}>Вагонов</span>
        <span style={{ flex: '0 0 90px', textAlign: 'center' }}>С накладной</span>
        <span style={{ flex: '0 0 110px', textAlign: 'center' }}>Мин. остаток</span>
        <span style={{ flex: '0 0 120px', textAlign: 'center' }}>Статус</span>
      </div>

      {/* Строки поездов */}
      {trains.map((t) => {
        const isExpanded = expandedTrain === t.train_number;
        const canExpand = !!t.route_id;

        return (
          <div key={t.train_number} className={`trains-accordion${isExpanded ? ' trains-accordion--open' : ''}${t.ready ? ' trains-accordion--ready' : ''}`}>
            <div
              className="trains-accordion-row"
              onClick={() => toggle(t)}
              style={{ cursor: canExpand ? 'pointer' : 'default' }}
              title={!canExpand ? (t.ready ? 'Болванка формируется…' : 'Доступно при остатке ≤ 150 км') : undefined}
            >
              <span className="trains-accordion-chevron">
                {canExpand
                  ? (isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)
                  : <span style={{ width: 15 }} />}
              </span>
              <span style={{ flex: '0 0 130px', fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{t.train_number}</span>
              <span style={{ flex: '0 0 150px', fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{t.train_index || '—'}</span>
              <span style={{ flex: '0 0 80px', textAlign: 'center', fontSize: 13 }}>{t.wagon_total}</span>
              <span style={{ flex: '0 0 90px', textAlign: 'center', fontSize: 13 }}>{t.matched_wagons}</span>
              <span style={{ flex: '0 0 110px', textAlign: 'center' }}><KmBadge km={t.min_km} /></span>
              <span style={{ flex: '0 0 120px', textAlign: 'center' }}><RouteStatus routeStatus={t.route_status} ready={t.ready} /></span>
            </div>

            {isExpanded && canExpand && (
              <div className="trains-accordion-body">
                <TrainComposition routeId={t.route_id} trainNumber={t.train_number} onExported={fetchTrains} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
