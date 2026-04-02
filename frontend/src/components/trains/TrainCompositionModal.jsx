import React, { useState, useEffect } from 'react';
import { X, Download, Plus, Pencil, Trash2, Check } from 'lucide-react';
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

function OrderForm({ waybillId, routeId, existing, onSaved, onCancel }) {
  const [form, setForm] = useState(existing ? {
    client_name: existing.client_name || '',
    contract_number: existing.contract_number || '',
    status: existing.status || 'new',
    comment: existing.comment || '',
  } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      if (existing) {
        await api.patch(`/v2/orders/${existing.id}`, form);
      } else {
        await api.post(`/v2/routes/${routeId}/orders`, {
          waybill_id: waybillId,
          ...form,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="order-form">
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
        <button type="button" className="cancel-btn" onClick={onCancel} disabled={saving}>Отмена</button>
        <button type="button" className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : existing ? 'Сохранить' : 'Создать'}
        </button>
      </div>
    </div>
  );
}

export default function TrainCompositionModal({ routeId, trainNumber, onClose }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingWaybillId, setEditingWaybillId] = useState(null); // null = нет формы; 'new_<waybillId>' = новая
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const fetchRoute = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/v2/routes/${routeId}`);
      setRoute(res.data);
    } catch (e) {
      setError('Не удалось загрузить состав поезда');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoute();
  }, [routeId]);

  const handleSaved = () => {
    setEditingWaybillId(null);
    setEditingOrderId(null);
    fetchRoute();
  };

  const handleDelete = async (orderId) => {
    if (!window.confirm('Удалить заявку?')) return;
    try {
      await api.delete(`/v2/orders/${orderId}`);
      fetchRoute();
    } catch (e) {
      alert('Ошибка удаления');
    }
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
      fetchRoute(); // обновить статус (closed)
    } catch (e) {
      alert('Ошибка экспорта');
    } finally {
      setExporting(false);
    }
  };

  const isClosed = route?.status === 'closed';
  const ordersCount = route?.orders?.length || 0;

  return (
    <div className="modal-overlay" role="dialog" onClick={onClose}>
      <div
        className="modal-content trains-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="trains-modal-header">
          <div>
            <h3>Поезд {trainNumber}</h3>
            {route && (
              <span className="trains-modal-meta">
                {route.wagons?.length || 0} вагонов · {ordersCount} заявок
                {isClosed && <span className="route-status route-status--closed" style={{ marginLeft: 8 }}>Закрыт</span>}
              </span>
            )}
          </div>
          <div className="trains-modal-header-actions">
            {!isClosed && ordersCount > 0 && (
              <button
                type="button"
                className="trains-export-btn"
                onClick={handleExport}
                disabled={exporting}
                title="Сформировать JSON и отправить в 1С"
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
            <div className="h-table-scroll">
              <table className="excel-table compact-table trains-composition-table">
                <thead>
                  <tr>
                    <th>Вагон</th>
                    <th>Накладная</th>
                    <th>Отправитель</th>
                    <th>Получатель</th>
                    <th>Груз</th>
                    <th>Остаток</th>
                    <th>Заявка</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {route.wagons.map((wagon) => {
                    const order = wagon.order;
                    const isFormOpen =
                      editingWaybillId === wagon.waybill_id ||
                      editingOrderId === order?.id;

                    return (
                      <React.Fragment key={wagon.trip_id}>
                        <tr className={order ? 'wagon-row wagon-row--has-order' : 'wagon-row'}>
                          <td><strong>{wagon.wagon_number}</strong></td>
                          <td>{wagon.waybill_number || <span className="text-muted">—</span>}</td>
                          <td className="cell-truncate" title={wagon.shipper_name}>{wagon.shipper_name || '—'}</td>
                          <td className="cell-truncate" title={wagon.consignee_name}>{wagon.consignee_name || '—'}</td>
                          <td className="cell-truncate" title={wagon.cargo_name}>{wagon.cargo_name || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{wagon.remaining_distance || '—'}</td>
                          <td>
                            {order ? (
                              <OrderBadge status={order.status} />
                            ) : (
                              wagon.waybill_id ? (
                                <span className="text-muted">нет</span>
                              ) : (
                                <span className="text-muted">нет накладной</span>
                              )
                            )}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {wagon.waybill_id && !isClosed && (
                              order ? (
                                <>
                                  <button
                                    type="button"
                                    className="icon-action-btn"
                                    title="Редактировать"
                                    onClick={() => {
                                      setEditingOrderId(isFormOpen ? null : order.id);
                                      setEditingWaybillId(null);
                                    }}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-action-btn icon-action-btn--danger"
                                    title="Удалить"
                                    onClick={() => handleDelete(order.id)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="trains-action-btn trains-action-btn--create"
                                  onClick={() => {
                                    setEditingWaybillId(isFormOpen ? null : wagon.waybill_id);
                                    setEditingOrderId(null);
                                  }}
                                >
                                  <Plus size={13} /> Создать
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                        {isFormOpen && (
                          <tr>
                            <td colSpan={8} style={{ padding: '4px 8px 8px' }}>
                              <OrderForm
                                waybillId={wagon.waybill_id}
                                routeId={routeId}
                                existing={editingOrderId === order?.id ? order : null}
                                onSaved={handleSaved}
                                onCancel={() => { setEditingWaybillId(null); setEditingOrderId(null); }}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
