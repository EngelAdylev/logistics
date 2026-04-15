import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../api';

const STATUS_LABEL = { open: 'Открыт', closed: 'Закрыт' };
const STATUS_CLS   = { open: 'route-status route-status--open', closed: 'route-status route-status--closed' };

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function RouteDetail({ wagons }) {
  if (!wagons || wagons.length === 0)
    return <div className="lkds-detail-empty">Нет вагонов в заявках</div>;

  // группируем по заявке
  const byOrder = [];
  const seen = {};
  wagons.forEach(w => {
    const key = w.order_id;
    if (!seen[key]) {
      seen[key] = { order_number: w.order_number, client_name: w.client_name, items: [] };
      byOrder.push(seen[key]);
    }
    seen[key].items.push(w);
  });

  return (
    <div className="lkds-detail">
      {byOrder.map(ord => (
        <div key={ord.order_number} className="lkds-detail-order">
          <div className="lkds-detail-order-header">
            <strong>Заявка №{ord.order_number}</strong>
            {ord.client_name && <span className="lkds-detail-client">{ord.client_name}</span>}
            <span className="lkds-detail-count">{ord.items.length} вагон(ов)</span>
          </div>
          <table className="excel-table compact-table lkds-inner-table">
            <thead>
              <tr>
                <th>Вагон</th>
                <th>Накладная</th>
                <th>Контейнер</th>
                <th>Отправитель</th>
                <th>Получатель</th>
                <th>Груз</th>
              </tr>
            </thead>
            <tbody>
              {ord.items.map((w, i) => (
                <tr key={i}>
                  <td><strong>{w.wagon_number}</strong></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{w.waybill_number || <span className="text-muted">—</span>}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{w.container_number || <span className="text-muted">—</span>}</td>
                  <td className="cell-truncate">{w.shipper_name || <span className="text-muted">—</span>}</td>
                  <td className="cell-truncate">{w.consignee_name || <span className="text-muted">—</span>}</td>
                  <td className="cell-truncate">{w.cargo_name || <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function RoutesListView({ refreshKey }) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const fetch = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/v2/routes')
      .then(res => setRoutes(res.data.items || []))
      .catch(() => setError('Не удалось загрузить рейсы'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch(); }, [refreshKey, fetch]);

  if (loading) return <div className="data-loading">Загрузка рейсов…</div>;
  if (error)   return <div className="data-error">{error} <button className="retry-btn" onClick={fetch}>Повторить</button></div>;
  if (routes.length === 0) return (
    <div className="trains-empty">
      <p>Нет рейсов в ЛКДС</p>
      <p className="trains-empty-hint">Рейсы создаются автоматически когда поезд подходит на расстояние ≤ 150 км</p>
    </div>
  );

  return (
    <div className="lkds-list">
      <div className="lkds-list-header">
        <span style={{ width: 24 }} />
        <span style={{ flex: '0 0 130px' }}>№ поезда</span>
        <span style={{ flex: '0 0 170px' }}>Индекс</span>
        <span style={{ flex: '0 0 100px', textAlign: 'center' }}>Статус</span>
        <span style={{ flex: '0 0 80px', textAlign: 'center' }}>Заявок</span>
        <span style={{ flex: '0 0 80px', textAlign: 'center' }}>Вагонов</span>
        <span style={{ flex: 1 }}>Дата создания</span>
      </div>

      {routes.map(r => {
        const isOpen = expanded === r.route_id;
        return (
          <div key={r.route_id} className={`trains-accordion${isOpen ? ' trains-accordion--open' : ''}`}>
            <div className="trains-accordion-row" style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : r.route_id)}>
              <span className="trains-accordion-chevron">
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </span>
              <span style={{ flex: '0 0 130px', fontWeight: 700, fontSize: 14 }}>{r.train_number}</span>
              <span style={{ flex: '0 0 170px', fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{r.train_index || '—'}</span>
              <span style={{ flex: '0 0 100px', textAlign: 'center' }}>
                <span className={STATUS_CLS[r.status] || 'route-status'}>{STATUS_LABEL[r.status] || r.status}</span>
              </span>
              <span style={{ flex: '0 0 80px', textAlign: 'center', fontSize: 13 }}>{r.orders_count}</span>
              <span style={{ flex: '0 0 80px', textAlign: 'center', fontSize: 13 }}>{r.items_count}</span>
              <span style={{ flex: 1, fontSize: 12, color: '#64748b' }}>{fmt(r.created_at)}</span>
            </div>
            {isOpen && (
              <div className="trains-accordion-body">
                <RouteDetail wagons={r.wagons} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
