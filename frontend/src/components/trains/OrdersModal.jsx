import React, { useState } from 'react';
import { api } from '../../api';

const EMPTY_FORM = {
  client_name: '',
  contract_number: '',
  status: 'new',
  comment: '',
};

export function OrdersModal({ routeId, existing, selectedWagons, allWagons, onSaved, onCancel }) {
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
        // selectedWagons содержит ключи вида "wb:{wid}:ktk:{ktk}" или "wagon:NUMBER"
        const items = [...selectedWagons].map((key) => {
          if (key.startsWith('wagon:')) {
            const wn = key.slice(6);
            return { wagon_number: wn, waybill_id: null, container_number: null };
          }
          // ключ "wb:{waybill_id}:ktk:{container}"
          const wagon = allWagons.find((w) => rowKey(w) === key);
          return {
            wagon_number: wagon?.wagon_number || '',
            waybill_id: wagon?.waybill_id || null,
            container_number: wagon?.container_number || null,
          };
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
          {saving ? 'Сохранение…' : isCreate ? 'Присвоить клиента' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

// Ключ строки: накладная+КТК / накладная без КТК / вагон без накладной
function rowKey(wagon) {
  if (wagon.waybill_id) {
    return `wb:${wagon.waybill_id}:ktk:${wagon.container_number || ''}`;
  }
  return `wagon:${wagon.wagon_number}`;
}
