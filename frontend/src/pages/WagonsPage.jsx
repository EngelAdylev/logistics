import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import HierarchyView from '../components/hierarchy/HierarchyView';
import TripsView from '../components/hierarchy/TripsView';

export default function WagonsPage() {
  const { loading: authLoading } = useAuth();

  // Вкладки: Дислокация | Рейсы
  const [tab, setTab] = useState('hierarchy');

  const [hierarchyFilter, setHierarchyFilter] = useState('active');
  const [tripsFilter, setTripsFilter] = useState('active');

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [hierarchyMeta, setHierarchyMeta] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncMessage('Шаг 1/2: загрузка данных…');
    try {
      // Шаг 1: старый синк (dislocation → tracking_wagons)
      const res = await api.post('/wagons/sync');
      const d = res.data;
      const status = d.sync_status || (d.success ? 'success' : 'failure');
      if (status === 'failure') {
        setSyncMessage('Синхронизация завершилась с ошибкой.');
        return;
      }

      // Шаг 2: новый синк (dislocation → wagons/wagon_trips)
      setSyncMessage('Шаг 2/2: обновление дислокации…');
      try {
        await api.post('/v2/sync');
      } catch (e2) {
        const detail2 = e2.response?.data?.detail;
        if (typeof detail2 === 'object' && detail2?.error === 'SYNC_IN_PROGRESS') {
          setSyncMessage('Обновление уже выполняется.');
          return;
        }
        // v2 sync не критичен — показываем предупреждение, но не блокируем
        let errMsg = '';
        if (detail2 && typeof detail2 === 'object') {
          errMsg = detail2.message || detail2.detail || detail2.error || JSON.stringify(detail2);
        } else {
          errMsg = String(detail2 || e2.message || 'неизвестная ошибка');
        }
        setSyncMessage(`Данные загружены, но дислокация не обновилась: ${errMsg}`);
        return;
      }

      const statusMsg = status === 'partial_failure'
        ? 'Синхронизация завершена с ошибками. Часть данных обновлена.'
        : 'Данные обновлены.';
      setSyncMessage(
        `${statusMsg} Создано: ${d.created ?? 0}, обновлено: ${d.updated ?? 0}${d.errors ? `, ошибок: ${d.errors}` : ''}.`
      );
      // Перезагружаем таблицу дислокации
      setRefreshKey((k) => k + 1);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (typeof detail === 'object' && detail?.error === 'SYNC_IN_PROGRESS') {
        setSyncMessage(detail.message || 'Обновление уже выполняется.');
      } else {
        setSyncMessage('Не удалось запустить обновление данных.');
      }
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="wagons-page">
      <div className="tabs-row">
        <div className="tabs">
          <button
            type="button"
            onClick={() => setTab('hierarchy')}
            className={tab === 'hierarchy' ? 'active' : ''}
          >
            Дислокация
          </button>
          <button
            type="button"
            onClick={() => setTab('trips')}
            className={tab === 'trips' ? 'active' : ''}
          >
            Рейсы
          </button>
        </div>
        <div className="sync-block">
          <button
            type="button"
            className="sync-btn"
            onClick={handleSync}
            disabled={syncLoading}
            title="Подтянуть последние данные из источника"
          >
            <RefreshCw size={18} className={syncLoading ? 'spin' : ''} />
            {syncLoading ? 'Обновление…' : 'Обновить данные'}
          </button>
          {syncMessage && <span className="sync-message">{syncMessage}</span>}
        </div>
      </div>

      {tab === 'hierarchy' ? (
        /* ── Вкладка Дислокация ── */
        <div className="h-tab-content">
          <div className="h-filter-block">
            <div className="h-filter-toggle">
              <button
                type="button"
                className={hierarchyFilter === 'active' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setHierarchyFilter('active')}
              >
                Активные
              </button>
              <button
                type="button"
                className={hierarchyFilter === 'archive' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setHierarchyFilter('archive')}
              >
                Архивные
              </button>
              <button
                type="button"
                className={hierarchyFilter === 'all' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setHierarchyFilter('all')}
              >
                Все
              </button>
            </div>
            {hierarchyMeta != null && (
              <div className="h-view-meta">
                вагонов на слежении: {hierarchyMeta.total}
                {hierarchyMeta.totalPages > 1 && ` · стр. ${hierarchyMeta.page} из ${hierarchyMeta.totalPages}`}
              </div>
            )}
          </div>
          {!authLoading && (
            <HierarchyView
              isActive={
                hierarchyFilter === 'active' ? true
                  : hierarchyFilter === 'archive' ? false
                    : undefined
              }
              onMetaChange={setHierarchyMeta}
              refreshKey={refreshKey}
            />
          )}
        </div>
      ) : (
        /* ── Вкладка Рейсы ── */
        <div className="h-tab-content">
          <div className="h-filter-block">
            <div className="h-filter-toggle">
              <button
                type="button"
                className={tripsFilter === 'active' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setTripsFilter('active')}
              >
                Активные
              </button>
              <button
                type="button"
                className={tripsFilter === 'archive' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setTripsFilter('archive')}
              >
                Архивные
              </button>
              <button
                type="button"
                className={tripsFilter === 'all' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
                onClick={() => setTripsFilter('all')}
              >
                Все
              </button>
            </div>
          </div>
          {!authLoading && (
            <TripsView
              isActive={
                tripsFilter === 'active' ? true
                  : tripsFilter === 'archive' ? false
                    : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
