import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Search, Package, FileText } from 'lucide-react';
import { api } from '../api';

const STATUS_COLORS = {
  'в пути': '#e3f2fd',
  'работа с документами окончена': '#fff3e0',
  'груз прибыл': '#e8f5e9',
  'получатель уведомлен': '#f3e5f5',
  'раскредитован': '#fce4ec',
};

export default function WaybillsPage() {
  const [waybills, setWaybills] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState('');

  const fetchWaybills = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/etran/waybills', { params });
      setWaybills(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      console.error('Failed to fetch waybills:', e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchWaybills();
  }, [fetchWaybills]);

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const statuses = ['в пути', 'работа с документами окончена', 'груз прибыл', 'получатель уведомлен', 'раскредитован'];

  return (
    <div className="wagons-page">
      <div className="tabs-row">
        <div className="tabs">
          <button type="button" className="active">
            <FileText size={16} style={{ marginRight: 4 }} />
            Накладные ЭТРАН
          </button>
        </div>
      </div>

      <div className="h-tab-content">
        <div className="h-filter-block">
          <div className="h-filter-toggle">
            <button
              type="button"
              className={!statusFilter ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
              onClick={() => setStatusFilter('')}
            >
              Все
            </button>
            {statuses.map(s => (
              <button
                key={s}
                type="button"
                className={statusFilter === s ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                style={{ fontSize: '11px' }}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="wb-search-block" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <Search size={14} />
            <input
              type="text"
              placeholder="Поиск по номеру накладной..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: '3px 8px',
                fontSize: '12px',
                border: '1px solid #d0d5dd',
                borderRadius: 4,
                width: 200,
                outline: 'none',
              }}
            />
          </div>
          <div className="h-view-meta" style={{ marginLeft: 12 }}>
            накладных: {total}
          </div>
        </div>

        <div className="h-view-wrapper">
          <div className="h-table-scroll">
            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>Загрузка...</div>
            ) : waybills.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>Нет накладных</div>
            ) : (
              <table className="h-wagon-table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th style={{ width: 130 }}>Накладная</th>
                    <th style={{ width: 110 }}>Статус</th>
                    <th>Ст. отправления</th>
                    <th>Ст. назначения</th>
                    <th>Грузоотправитель</th>
                    <th>Грузополучатель</th>
                    <th style={{ width: 50 }}>Вагонов</th>
                    <th style={{ width: 140 }}>Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {waybills.map(wb => (
                    <React.Fragment key={wb.id}>
                      <tr
                        className="h-wagon-row"
                        onClick={() => toggleExpand(wb.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ textAlign: 'center', padding: '2px 4px' }}>
                          {expandedIds.has(wb.id)
                            ? <ChevronDown size={14} />
                            : <ChevronRight size={14} />
                          }
                        </td>
                        <td style={{ fontWeight: 600 }}>{wb.waybill_number}</td>
                        <td>
                          <span
                            className="wb-status-badge"
                            style={{
                              background: STATUS_COLORS[wb.status?.toLowerCase()] || '#f5f5f5',
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontSize: '11px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {wb.status}
                          </span>
                        </td>
                        <td>{wb.departure_station_name}</td>
                        <td>{wb.destination_station_name}</td>
                        <td>{wb.shipper_name}</td>
                        <td>{wb.consignee_name}</td>
                        <td style={{ textAlign: 'center' }}>{wb.wagon_count}</td>
                        <td style={{ fontSize: '11px', color: '#666' }}>
                          {wb.updated_at ? new Date(wb.updated_at).toLocaleString('ru-RU') : '—'}
                        </td>
                      </tr>
                      {expandedIds.has(wb.id) && wb.wagons && wb.wagons.length > 0 && (
                        <tr className="wb-wagons-expanded">
                          <td colSpan={9} style={{ padding: 0 }}>
                            <div style={{ padding: '4px 8px 4px 40px', background: '#fafbfc' }}>
                              <table className="h-wagon-table" style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th style={{ width: 130 }}>№ вагона</th>
                                    <th style={{ width: 150 }}>№ контейнера</th>
                                    <th style={{ width: 60 }}>Длина КТК</th>
                                    <th>Груз</th>
                                    <th style={{ width: 100 }}>Вес груза</th>
                                    <th style={{ width: 100 }}>Владелец</th>
                                    <th style={{ width: 100 }}>ЗПУ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {wb.wagons.map((w, idx) => (
                                    <tr key={w.id || idx}>
                                      <td style={{ fontWeight: 500 }}>{w.railway_carriage_number}</td>
                                      <td>{w.container_number || '—'}</td>
                                      <td style={{ textAlign: 'center' }}>{w.container_length || '—'}</td>
                                      <td>{w.cargo_name || '—'}</td>
                                      <td>{w.cargo_weight || '—'}</td>
                                      <td>{w.ownership || '—'}</td>
                                      <td>{w.zpu_number || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
