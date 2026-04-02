import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, Plus, Pencil, Trash2, Minus } from 'lucide-react';
import { api } from '../../api';

const STATUS_LABELS = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
};

const EMPTY_FORM = {
  client_name: '',
  contract_number: '',
  status: 'new',
  comment: '',
};

function OrderBadge({ status }) {
  const cls = {
    new: 'order-badge order-badge--new',
    in_progress: 'order-badge order-badge--progress',
    done: 'order-badge order-badge--done',
  }[status] || 'order-badge';
  return <span className={cls}>{STATUS_LABELS[status] || status}</span>;
}

/* ─── Форма (создание / редактирование шапки) ─── */
function OrderFormPanel({ routeId, existing, selectedWagons, allWagons, onSaved, onCancel }) {
  const [form, setForm] = useState(existing ? {
    client_name: existing.client_name || '',
    contract_number: existing.contract_number || '',
    status: existing.status || 'new',
    comment: existing.comment || '',
  } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const isCreate = !existing;

  const handleSave = async () => {
    if (isCreate && selectedWagons.size === 0) {
      setErr('Выберите хотя бы одну накладную');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      if (isCreate) {
        // selectedWagons содержит ключи: waybill_id или "wagon:NUMBER"
        const items = [...selectedWagons].map((key) => {
          if (key.startsWith('wagon:')) {
            const wn = key.slice(6);
            return { wagon_number: wn, waybill_id: null };
          }
          const wagon = allWagons.find((w) => w.waybill_id === key);
          return { wagon_number: wagon?.wagon_number || '', waybill_id: key };
        });
        await api.post(`/v2/routes/${routeId}/orders`, { ...form, items });
      } else {
        await api.patch(`/v2/orders/${existing.id}`, form);
      }
      onSaved();
    } catch (e) {
      const detail = e.response?.data?.detail;
      setErr(typeof detail === 'string' ? detail : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="order-form" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#1e293b' }}>
        {isCreate
          ? `Новая заявка — выбрано вагонов: ${selectedWagons.size}`
          : `Редактировать заявку — ${existing.client_name || 'без клиента'}`}
      </div>
      <div className="order-form-grid">
        <label>
          Клиент
          <input
            className="order-form-input"
            value={form.client_name}
            onChange={(e) => setForm((p) => ({ ...p, client_name: e.target.value }))}
            placeholder="Название клиента"
          />
        </label>
        <label>
          № договора
          <input
            className="order-form-input"
            value={form.contract_number}
            onChange={(e) => setForm((p) => ({ ...p, contract_number: e.target.value }))}
            placeholder="Номер договора"
          />
        </label>
        <label>
          Статус
          <select
            className="order-form-input"
            value={form.status}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
          >
            <option value="new">Новая</option>
            <option value="in_progress">В работе</option>
            <option value="done">Выполнена</option>
          </select>
        </label>
        <label className="order-form-comment">
          Комментарий
          <textarea
            className="order-form-input"
            value={form.comment}
            onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
            rows={2}
            placeholder="Необязательно"
          />
        </label>
      </div>
      {err && <div className="order-form-error">{err}</div>}
      <div className="order-form-actions">
        <button type="button" className="cancel-btn" onClick={onCancel} disabled={saving}>
          Отмена
        </button>
        <button type="button" className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : isCreate ? 'Создать заявку' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

/* ─── Главный компонент ─── */
export default function TrainCompositionModal({ routeId, trainNumber, onClose }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // mode: 'view' | 'create' | 'edit'
  const [mode, setMode] = useState('view');
  const [selectedWagons, setSelectedWagons] = useState(new Set()); // wagon_numbers в режиме create
  const [editingOrder, setEditingOrder] = useState(null); // order obj в режиме edit

  const [exporting, setExporting] = useState(false);

  const fetchRoute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/v2/routes/${routeId}`);
      setRoute(res.data);
    } catch {
      setError('Не удалось загрузить состав поезда');
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => { fetchRoute(); }, [fetchRoute]);

  const resetMode = () => {
    setMode('view');
    setSelectedWagons(new Set());
    setEditingOrder(null);
  };

  const handleSaved = () => {
    resetMode();
    fetchRoute();
  };

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm('Удалить заявку целиком?')) return;
    try {
      await api.delete(`/v2/orders/${orderId}`);
      fetchRoute();
    } catch {
      alert('Ошибка удаления');
    }
  };

  const handleRemoveItem = async (itemId) => {
    if (!window.confirm('Убрать вагон из заявки?')) return;
    try {
      await api.delete(`/v2/order-items/${itemId}`);
      fetchRoute();
    } catch {
      alert('Ошибка удаления строки');
    }
  };

  // Ключ строки для чекбокса: waybill_id если есть, иначе "wagon:NUMBER"
  const rowKey = (wagon) =>
    wagon.waybill_id ? wagon.waybill_id : `wagon:${wagon.wagon_number}`;

  const toggleWagon = (key) => {
    setSelectedWagons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/v2/routes/${routeId}/export`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `train_${trainNumber}_orders.json`;
      a.click();
      URL.revokeObjectURL(url);
      fetchRoute();
    } catch {
      alert('Ошибка экспорта');
    } finally {
      setExporting(false);
    }
  };

  const isClosed = route?.status === 'closed';
  const ordersCount = route?.orders?.length || 0;

  // Карта: order_id → уникальный цвет для визуального разделения
  const orderColors = {};
  const COLORS = ['#dbeafe', '#dcfce7', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5'];
  (route?.orders || []).forEach((o, idx) => {
    orderColors[o.id] = COLORS[idx % COLORS.length];
  });

  return (
    <div className="modal-overlay" role="dialog" onClick={onClose}>
      <div className="modal-content trains-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="trains-modal-header">
          <div>
            <h3>Поезд {trainNumber}</h3>
            {route && (
              <span className="trains-modal-meta">
                {route.wagons?.length || 0} вагонов · {ordersCount} заявок
                {isClosed && (
                  <span className="route-status route-status--closed" style={{ marginLeft: 8 }}>
                    Закрыт
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="trains-modal-header-actions">
            {!isClosed && mode === 'view' && (
              <button
                type="button"
                className="trains-action-btn trains-action-btn--create"
                onClick={() => { setMode('create'); setSelectedWagons(new Set()); }}
              >
                <Plus size={13} /> Новая заявка
              </button>
            )}
            {!isClosed && ordersCount > 0 && mode === 'view' && (
              <button
                type="button"
                className="trains-export-btn"
                onClick={handleExport}
                disabled={exporting}
              >
                <Download size={15} />
                {exporting ? 'Экспорт…' : 'Сформировать JSON'}
              </button>
            )}
            <button type="button" className="modal-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="trains-modal-body">
          {loading && <div className="data-loading">Загрузка…</div>}
          {error && <div className="data-error">{error}</div>}

          {!loading && !error && route && (
            <>
              {/* Форма создания / редактирования */}
              {(mode === 'create' || mode === 'edit') && (
                <OrderFormPanel
                  routeId={routeId}
                  existing={mode === 'edit' ? editingOrder : null}
                  selectedWagons={selectedWagons}
                  allWagons={route.wagons}
                  onSaved={handleSaved}
                  onCancel={resetMode}
                />
              )}

              {/* Легенда заявок */}
              {ordersCount > 0 && mode === 'view' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {route.orders.map((o) => (
                    <div
                      key={o.id}
                      style={{
                        background: orderColors[o.id],
                        borderRadius: 6,
                        padding: '3px 10px',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{o.client_name || 'Без клиента'}</span>
                      <OrderBadge status={o.status} />
                      <span style={{ color: '#64748b' }}>{o.items?.length || 0} ваг.</span>
                      {!isClosed && (
                        <>
                          <button
                            className="icon-action-btn"
                            title="Редактировать"
                            onClick={() => { setEditingOrder(o); setMode('edit'); }}
                            style={{ width: 20, height: 20 }}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            className="icon-action-btn icon-action-btn--danger"
                            title="Удалить заявку"
                            onClick={() => handleDeleteOrder(o.id)}
                            style={{ width: 20, height: 20 }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Таблица вагонов */}
              <div className="h-table-scroll">
                <table className="excel-table compact-table trains-composition-table">
                  <thead>
                    <tr>
                      {mode === 'create' && <th style={{ width: 32 }}></th>}
                      <th>Вагон</th>
                      <th>Накладная</th>
                      <th>Контейнер</th>
                      <th>Отправитель</th>
                      <th>Получатель</th>
                      <th>Груз</th>
                      <th>Остаток</th>
                      <th>Заявка</th>
                      {mode === 'view' && !isClosed && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {route.wagons.map((wagon) => {
                      const order = wagon.order;
                      const orderId = order?.id;
                      const rowBg = orderId ? orderColors[orderId] : undefined;
                      const key = rowKey(wagon);
                      const isSelected = selectedWagons.has(key);
                      const canSelect = mode === 'create' && !order;

                      return (
                        <tr
                          key={key}
                          className={order ? 'wagon-row wagon-row--has-order' : 'wagon-row'}
                          style={{
                            background: isSelected ? '#bfdbfe' : rowBg,
                            cursor: canSelect ? 'pointer' : 'default',
                          }}
                          onClick={canSelect ? () => toggleWagon(key) : undefined}
                        >
                          {/* Чекбокс (только в режиме создания) */}
                          {mode === 'create' && (
                            <td style={{ textAlign: 'center' }}>
                              {!order && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleWagon(key)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                            </td>
                          )}

                          <td><strong>{wagon.wagon_number}</strong></td>
                          <td>{wagon.waybill_number || <span className="text-muted">—</span>}</td>
                          <td>{wagon.container_number || <span className="text-muted">—</span>}</td>
                          <td className="cell-truncate" title={wagon.shipper_name}>{wagon.shipper_name || '—'}</td>
                          <td className="cell-truncate" title={wagon.consignee_name}>{wagon.consignee_name || '—'}</td>
                          <td className="cell-truncate" title={wagon.cargo_name}>{wagon.cargo_name || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{wagon.remaining_distance || '—'}</td>

                          {/* Статус заявки */}
                          <td>
                            {order ? (
                              <span style={{ fontSize: 12 }}>
                                {order.client_name
                                  ? <strong>{order.client_name}</strong>
                                  : <span className="text-muted">без клиента</span>}
                              </span>
                            ) : (
                              <span className="text-muted" style={{ fontSize: 12 }}>
                                {wagon.waybill_id ? '—' : 'нет накладной'}
                              </span>
                            )}
                          </td>

                          {/* Действия (только view mode) */}
                          {mode === 'view' && !isClosed && (
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {order && wagon.item_id && (
                                <button
                                  type="button"
                                  className="icon-action-btn icon-action-btn--danger"
                                  title="Убрать вагон из заявки"
                                  onClick={() => handleRemoveItem(wagon.item_id)}
                                >
                                  <Minus size={13} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {mode === 'create' && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                  Отметьте строки (накладные) которые войдут в заявку. Один вагон с двумя накладными = две строки, можно включить в разные заявки.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
