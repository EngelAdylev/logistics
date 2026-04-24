import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Search, FileText, Box, Train, Clock, CheckCircle } from 'lucide-react';
import { api } from '../api';

// ─── СТАТУСЫ: Разделение на "В движении" и "Завершённые" ───
const IN_PROGRESS_STATUSES = new Set([
  'в пути',
  'груз принят к перевозке',
  'груз завезен полностью',
  'на подходе',
  'погрузка на вагон',
  'переадресован',
  'заготовка',
  'заготовка импорта, транзита',
  'заготовка по назначению',
  'заготовка по перегрузу',
  'заготовка при сторно по отправлению',
  'заготовка уведомления',
  'накладная заполнена грузоотправителем',
  'накладная предъявлена',
  'на границе (не исп.)',
  'на визировании',
  'автоматический прием',
  'заадресован',
  'завизирована',
  'принят по стыку (не исп.)',
  'грузоотправитель накладную получил',
  'изменение уведомления',
  'согласование уведомления',
  'изменено назначение',
  'передан в техпд',
]);

const COMPLETED_STATUSES = new Set([
  // Успешно доставлено
  'груз прибыл',
  'получатель уведомлен',
  // Расчёты
  'раскредитован',
  'раскредитование отменено',
  // Завершение документов
  'работа с документом окончена',
  'работа с документами окончена',
  // Проблемы
  'груз не прибыл',
  'испорчен',
  'испорчен после сторно',
  'испорчен с.333 не прошло',
  'просрочен',
  'отказ грузоотправителя',
  'отказ в согласовании',
  'отказ от уведомления',
  'отклонен',
  'приемосдатчиком не принято',
  'информация с номерного бланка испорчена',
  'не оплачен',
  'ожидание ответа для порчи',
  'ожидание ответа о выгрузке',
  // Отмены и сторно
  'сторнирован в пути',
  'сторнирован по назначению',
  'сторнирован по отправлению',
  'сторно по отправлению отменено',
  'ожидание сторно в пути',
  'ожидание сторно по назначению',
  'ожидание сторно по отправлению',
  'данные сторно по назначению внесены',
  'данные сторно по отправлению внесены',
  // Прочие
  'приемосдатчиком принято',
  'приложение к претензии (деньги)',
  'приложение к претензии (плательщик)',
  'приложение к претензии (реквизиты)',
  'приложение к претензии закрыто',
  'приложение экспедитора к претензии',
  'необходима отмена с.251',
  'ожидание отметки таможни',
  'ожидание согласования заявки гу-12',
]);

const STATUS_MAP = {
  'в пути':                        { color: '#1976d2', bg: '#e3f2fd',  label: 'В пути' },
  'работа с документами окончена':  { color: '#e65100', bg: '#fff3e0',  label: 'Документы' },
  'работа с документом окончена':   { color: '#e65100', bg: '#fff3e0',  label: 'Документы' },
  'груз прибыл':                    { color: '#2e7d32', bg: '#e8f5e9',  label: 'Прибыл' },
  'получатель уведомлен':           { color: '#7b1fa2', bg: '#f3e5f5',  label: 'Уведомлён' },
  'раскредитован':                  { color: '#c62828', bg: '#fce4ec',  label: 'Раскредитован' },
};

function StatusBadge({ status }) {
  const s = STATUS_MAP[status?.toLowerCase()] || { color: '#555', bg: '#f5f5f5', label: status };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      color: s.color,
      background: s.bg,
      border: `1px solid ${s.color}22`,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function WaybillCard({ wb, isExpanded, onToggle }) {
  return (
    <div className="wb-card">
      {/* ── Шапка карточки ── */}
      <div className="wb-card-header" onClick={onToggle}>
        <div className="wb-card-expand">
          {isExpanded
            ? <ChevronDown size={16} strokeWidth={2} />
            : <ChevronRight size={16} strokeWidth={2} />
          }
        </div>
        <div className="wb-card-title">
          <FileText size={14} style={{ color: '#64748b', flexShrink: 0 }} />
          <span className="wb-card-number">{wb.waybill_number}</span>
          <StatusBadge status={wb.status} />
        </div>
        <div className="wb-card-meta">
          <span className="wb-card-route" title={`${wb.departure_station_name} → ${wb.destination_station_name}`}>
            {wb.departure_station_name || '?'} → {wb.destination_station_name || '?'}
          </span>
          <span className="wb-card-count">
            <Train size={12} /> {wb.wagon_count || 0} ваг.
          </span>
          <span className="wb-card-date">
            {wb.updated_at ? new Date(wb.updated_at).toLocaleDateString('ru-RU') : ''}
          </span>
        </div>
      </div>

      {/* ── Раскрытая часть — детали + вагоны ── */}
      {isExpanded && (
        <div className="wb-card-body">
          {/* Информация по накладной */}
          <div className="wb-card-info">
            <div className="wb-info-item">
              <span className="wb-info-label">Грузоотправитель</span>
              <span className="wb-info-value">{wb.shipper_name || '—'}</span>
            </div>
            <div className="wb-info-item">
              <span className="wb-info-label">Грузополучатель</span>
              <span className="wb-info-value">{wb.consignee_name || '—'}</span>
            </div>
            <div className="wb-info-item">
              <span className="wb-info-label">Ст. отправления</span>
              <span className="wb-info-value">{wb.departure_station_name || '—'}</span>
            </div>
            <div className="wb-info-item">
              <span className="wb-info-label">Ст. назначения</span>
              <span className="wb-info-value">{wb.destination_station_name || '—'}</span>
            </div>
          </div>

          {/* Таблица вагонов */}
          {wb.wagons && wb.wagons.length > 0 ? (
            <div className="wb-wagons-list">
              <div className="wb-wagons-header">
                <span style={{ width: 130 }}>Вагон</span>
                <span style={{ width: 160 }}>Контейнер</span>
                <span style={{ width: 50, textAlign: 'center' }}>КТК</span>
                <span style={{ flex: 1 }}>Груз</span>
                <span style={{ width: 90, textAlign: 'right' }}>Вес</span>
                <span style={{ width: 100 }}>Владелец</span>
                <span style={{ width: 130 }}>ЗПУ</span>
              </div>
              {wb.wagons.map((w, idx) => (
                <div className="wb-wagon-row" key={w.id || idx}>
                  <span style={{ width: 130, fontWeight: 600, color: '#1e293b' }}>
                    <Box size={12} style={{ color: '#94a3b8', marginRight: 4 }} />
                    {w.railway_carriage_number}
                  </span>
                  <span style={{ width: 160, fontFamily: 'monospace', fontSize: 12 }}>
                    {w.container_number || '—'}
                  </span>
                  <span style={{ width: 50, textAlign: 'center', color: '#64748b' }}>
                    {w.container_length || '—'}
                  </span>
                  <span style={{ flex: 1, color: '#475569' }}>{w.cargo_name || '—'}</span>
                  <span style={{ width: 90, textAlign: 'right', color: '#475569' }}>
                    {w.cargo_weight ? `${w.cargo_weight} т` : '—'}
                  </span>
                  <span style={{ width: 100, color: '#64748b', fontSize: 11 }}>{w.ownership || '—'}</span>
                  <span style={{ width: 130, color: '#64748b', fontSize: 11 }}>{w.zpu_number || '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>
              Нет данных по вагонам
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WaybillsPage() {
  const [allWaybills, setAllWaybills] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState('in_progress'); // 'in_progress' или 'completed'

  const fetchWaybills = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 500 }; // Загружаем больше для локальной фильтрации
      if (search) params.search = search;
      const res = await api.get('/etran/waybills', { params });
      setAllWaybills(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      console.error('Failed to fetch waybills:', e);
    } finally {
      setLoading(false);
    }
  }, [search]);

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

  // ─── Фильтрация накладных по вкладкам ───
  const getDisplayedWaybills = () => {
    if (activeTab === 'in_progress') {
      return allWaybills.filter(wb => IN_PROGRESS_STATUSES.has(wb.status?.toLowerCase()));
    } else {
      return allWaybills.filter(wb => COMPLETED_STATUSES.has(wb.status?.toLowerCase()));
    }
  };

  const displayedWaybills = getDisplayedWaybills();

  const inProgressCount = allWaybills.filter(wb => IN_PROGRESS_STATUSES.has(wb.status?.toLowerCase())).length;
  const completedCount = allWaybills.filter(wb => COMPLETED_STATUSES.has(wb.status?.toLowerCase())).length;

  return (
    <div className="wagons-page">
      <div className="tabs-row">
        <div className="tabs">
          <button
            type="button"
            className={activeTab === 'in_progress' ? 'active' : ''}
            onClick={() => setActiveTab('in_progress')}
          >
            <Clock size={16} style={{ marginRight: 4 }} />
            В движении
            <span style={{ marginLeft: 6, fontSize: '0.85em', opacity: 0.7 }}>({inProgressCount})</span>
          </button>
          <button
            type="button"
            className={activeTab === 'completed' ? 'active' : ''}
            onClick={() => setActiveTab('completed')}
          >
            <CheckCircle size={16} style={{ marginRight: 4 }} />
            Завершённые
            <span style={{ marginLeft: 6, fontSize: '0.85em', opacity: 0.7 }}>({completedCount})</span>
          </button>
        </div>
      </div>

      <div className="h-tab-content">
        <div className="h-filter-block">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={14} style={{ color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Поиск по номеру накладной..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="wb-search-input"
            />
          </div>
          <div className="h-view-meta" style={{ marginLeft: 12 }}>
            {activeTab === 'in_progress' ? 'В движении' : 'Завершённые'}: {displayedWaybills.length} из {total}
          </div>
        </div>

        <div className="h-view-wrapper">
          <div className="wb-cards-scroll">
            {loading ? (
              <div className="wb-empty">Загрузка...</div>
            ) : displayedWaybills.length === 0 ? (
              <div className="wb-empty">
                {activeTab === 'in_progress'
                  ? 'Нет накладных в движении'
                  : 'Нет завершённых накладных'}
              </div>
            ) : (
              <div className="wb-cards-list">
                {displayedWaybills.map(wb => (
                  <WaybillCard
                    key={wb.id}
                    wb={wb}
                    isExpanded={expandedIds.has(wb.id)}
                    onToggle={() => toggleExpand(wb.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
