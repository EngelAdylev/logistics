import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../api';

const ROUTE_STATUS_LABEL = { open: 'Открыт', closed: 'Закрыт' };
const ROUTE_STATUS_CLS   = { open: 'route-status route-status--open', closed: 'route-status route-status--closed' };

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function OrderDetail({ wagons }) {
  if (!wagons || wagons.length === 0)
    return <div className="lkds-detail-empty">Нет вагонов в заявке</div>;
  return (
    <div className="lkds-detail">
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
          {wagons.map((w, i) => (
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
  );
}

export default function OrdersListView({ refreshKey }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const fetch = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/v2/orders')
      .then(res => setOrders(res.data.items || []))
      .catch(() => setError('Не удалось загрузить заявки'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch(); }, [refreshKey, fetch]);

  if (loading) return <div className="data-loading">Загрузка заявок…</div>;
  if (error)   return <div className="data-error">{error} <button className="retry-btn" onClick={fetch}>Повторить</button></div>;
  if (orders.length === 0) return (
    <div className="trains-empty">
      <p>Нет заявок</p>
      <p className="trains-empty-hint">Заявки создаются на вкладке «Поезда» при назначении клиентов</p>
    </div>
  );

  return (
    <div className="lkds-list">
      <div className="lkds-list-header">
        <span style={{ width: 24 }} />
        <span style={{ flex: '0 0 60px', textAlign: 'center' }}>№</span>
        <span style={{ flex: '0 0 160px' }}>Клиент</span>
        <span style={{ flex: '0 0 110px' }}>№ поезда</span>
        <span style={{ flex: '0 0 90px', textAlign: 'center' }}>Рейс</span>
        <span style={{ flex: '0 0 70px', textAlign: 'center' }}>Вагонов</span>
        <span style={{ flex: 1 }}>Комментарий</span>
        <span style={{ flex: '0 0 130px' }}>Дата создания</span>
      </div>

      {orders.map(o => {
        const isOpen = expanded === o.order_id;
        return (
          <div key={o.order_id} className={`trains-accordion${isOpen ? ' trains-accordion--open' : ''}`}>
            <div className="trains-accordion-row" style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : o.order_id)}>
              <span className="trains-accordion-chevron">
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </span>
              <span style={{ flex: '0 0 60px', textAlign: 'center', fontWeight: 700 }}>№{o.order_number}</span>
              <span style={{ flex: '0 0 160px', fontSize: 13 }}>{o.client_name || <span className="text-muted">—</span>}</span>
              <span style={{ flex: '0 0 110px', fontWeight: 600, fontSize: 14 }}>{o.train_number}</span>
              <span style={{ flex: '0 0 90px', textAlign: 'center' }}>
                <span className={ROUTE_STATUS_CLS[o.route_status] || 'route-status'}>
                  {ROUTE_STATUS_LABEL[o.route_status] || '—'}
                </span>
              </span>
              <span style={{ flex: '0 0 70px', textAlign: 'center', fontSize: 13 }}>{o.items_count}</span>
              <span style={{ flex: 1, fontSize: 12, color: '#64748b' }}>{o.comment || '—'}</span>
              <span style={{ flex: '0 0 130px', fontSize: 12, color: '#64748b' }}>{fmt(o.created_at)}</span>
            </div>
            {isOpen && (
              <div className="trains-accordion-body">
                <OrderDetail wagons={o.wagons} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
