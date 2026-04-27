import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
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

  // Client dropdown state
  const [clientSearch, setClientSearch] = useState('');
  const [clientOptions, setClientOptions] = useState([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef(null);
  const clientDropdownRef = useRef(null);

  const isCreate = !existing;

  // Fetch clients on search
  useEffect(() => {
    if (!clientSearch.trim()) {
      setClientOptions([]);
      return;
    }
    const fetchClients = async () => {
      try {
        const res = await api.get('/v2/clients', { params: { search: clientSearch } });
        setClientOptions(res.data.items || []);
      } catch (e) {
        console.error('Failed to fetch clients:', e);
      }
    };
    const timer = setTimeout(fetchClients, 300);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        clientDropdownRef.current && !clientDropdownRef.current.contains(e.target) &&
        clientInputRef.current && !clientInputRef.current.contains(e.target)
      ) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClientSelect = (client) => {
    setForm((p) => ({ ...p, client_name: client.code }));
    setClientSearch('');
    setShowClientDropdown(false);
    setClientOptions([]);
  };

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
        <div style={{ position: 'relative' }}>
          <label>
            Клиент
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                ref={clientInputRef}
                className="order-form-input"
                value={form.client_name || clientSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setClientSearch(val);
                  if (form.client_name && val !== form.client_name) {
                    setForm((p) => ({ ...p, client_name: val }));
                  }
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Найти клиента по коду или названию"
                autoComplete="off"
              />
              {form.client_name && (
                <button
                  type="button"
                  onClick={() => {
                    setForm((p) => ({ ...p, client_name: '' }));
                    setClientSearch('');
                    setClientOptions([]);
                  }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    fontSize: '1.2rem',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </label>
          {showClientDropdown && clientOptions.length > 0 && (
            <div
              ref={clientDropdownRef}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                maxHeight: 200,
                overflowY: 'auto',
                zIndex: 1000,
                marginTop: 2,
              }}
            >
              {clientOptions.map((client) => (
                <div
                  key={client.id}
                  onClick={() => handleClientSelect(client)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f1f5f9',
                    fontSize: '0.85rem',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.target.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.target.style.background = 'white')}
                >
                  <strong>{client.code}</strong>
                  {client.name && <span style={{ color: '#64748b', marginLeft: 6 }}>— {client.name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
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
