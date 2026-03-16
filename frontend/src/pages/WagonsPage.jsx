import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import WagonsTable from '../table/WagonsTable';
import { TABLE_COLUMNS, TABLE_KEY } from '../table/tableColumnsConfig';
import HierarchyView from '../components/hierarchy/HierarchyView';
import TripsView from '../components/hierarchy/TripsView';

const DEFAULT_VISIBLE_COLUMN_IDS = TABLE_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id);

export default function WagonsPage() {
  const { loading: authLoading } = useAuth();

  // Главные вкладки: Дислокация | Матрёшка | Рейсы
  const [tab, setTab] = useState('dislocation');

  // Переключатель внутри вкладки Дислокация
  const [dislocationFilter, setDislocationFilter] = useState('active'); // 'active' | 'archive' | 'all'

  // Переключатели в Матрёшка и Рейсы
  const [hierarchyFilter, setHierarchyFilter] = useState('active');
  const [tripsFilter, setTripsFilter] = useState('active');

  const [data, setData] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedWagon, setSelectedWagon] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [columnFilters, setColumnFilters] = useState({});
  const [visibleColumnIds, setVisibleColumnIds] = useState(DEFAULT_VISIBLE_COLUMN_IDS);
  const [settingsError, setSettingsError] = useState('');
  const [wagonCounts, setWagonCounts] = useState({ active: null, archived: null });
  const [hierarchyMeta, setHierarchyMeta] = useState(null);
  const [tripsMeta, setTripsMeta] = useState(null);

  const fetchData = async (keepDataOnError = false) => {
    setDataError(null);
    setDataLoading(true);
    try {
      if (dislocationFilter === 'all') {
        const [activeRes, archiveRes] = await Promise.all([
          api.get('/wagons/active'),
          api.get('/wagons/archive'),
        ]);
        setData([
          ...(Array.isArray(activeRes.data) ? activeRes.data : []),
          ...(Array.isArray(archiveRes.data) ? archiveRes.data : []),
        ]);
      } else {
        const endpoint = dislocationFilter === 'active' ? '/wagons/active' : '/wagons/archive';
        const res = await api.get(endpoint);
        setData(Array.isArray(res.data) ? res.data : []);
      }
      return true;
    } catch (e) {
      console.error(e);
      const status = e.response?.status;
      const msg = status === 401
        ? 'Сессия истекла. Войдите снова.'
        : status >= 500
          ? 'Ошибка сервера. Попробуйте позже.'
          : 'Не удалось загрузить данные.';
      setDataError(msg);
      if (!keepDataOnError) setData([]);
      return false;
    } finally {
      setDataLoading(false);
    }
  };

  const fetchComments = async (trackingId) => {
    try {
      const res = await api.get(`/wagons/${trackingId}/comments`);
      setComments(res.data || []);
    } catch (e) {
      console.error(e);
      setComments([]);
    }
  };

  // Загружаем данные при переключении вкладки на Дислокацию или смене фильтра
  useEffect(() => {
    if (authLoading) return;
    if (tab === 'dislocation') {
      setColumnFilters({});
      fetchData();
    }
  }, [tab, dislocationFilter, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (authLoading) return;
    const loadSummary = async () => {
      try {
        const res = await api.get('/wagons/summary');
        setWagonCounts(res.data);
      } catch {
        // не критично
      }
    };
    loadSummary();
  }, [authLoading]);

  useEffect(() => {
    if (authLoading) return;
    const loadSettings = async () => {
      try {
        const res = await api.get(`/table-settings/${TABLE_KEY}`);
        if (res.data?.visible_columns?.length) {
          setVisibleColumnIds(res.data.visible_columns);
        }
      } catch {
        // остаёмся на DEFAULT_VISIBLE_COLUMN_IDS
      }
    };
    loadSettings();
  }, [authLoading]);

  const handleVisibilityChange = async (newVisibleIds) => {
    setVisibleColumnIds(newVisibleIds);
    setSettingsError('');
    try {
      await api.put(`/table-settings/${TABLE_KEY}`, { visible_columns: newVisibleIds });
    } catch (e) {
      setSettingsError('Не удалось сохранить настройки колонок');
    }
  };

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncMessage('');
    try {
      const res = await api.post('/wagons/sync');
      const d = res.data;
      const status = d.sync_status || (d.success ? 'success' : 'failure');
      const statusMsg = status === 'success'
        ? 'Данные обновлены.'
        : status === 'partial_failure'
          ? 'Синхронизация завершена с ошибками. Часть данных обновлена.'
          : 'Синхронизация завершилась с ошибкой.';
      setSyncMessage(
        `${statusMsg} Создано: ${d.created ?? 0}, обновлено: ${d.updated ?? 0}${d.errors ? `, ошибок: ${d.errors}` : ''}.`
      );
      if (tab === 'dislocation') {
        const ok = await fetchData(true);
        if (!ok) setDataError('Не удалось обновить таблицу. Показаны предыдущие данные.');
      }
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

  const openModal = (wagon) => {
    setSelectedWagon(wagon);
    setCommentText('');
    setIsModalOpen(true);
    fetchComments(wagon.id);
  };

  const handleSaveComment = async () => {
    if (!selectedWagon) return;
    try {
      await api.post(`/wagons/${selectedWagon.id}/comments`, { text: commentText });
      setIsModalOpen(false);
      setCommentText('');
      fetchComments(selectedWagon.id);
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleFilterChange = (columnId, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!values?.length) delete next[columnId];
      else next[columnId] = values;
      return next;
    });
  };

  // Переключатель фильтра для вкладки Дислокация
  const DislocationFilterToggle = () => (
    <div className="h-filter-block">
      <div className="h-filter-toggle">
        <button
          type="button"
          className={dislocationFilter === 'active' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
          onClick={() => setDislocationFilter('active')}
        >
          Активные
        </button>
        <button
          type="button"
          className={dislocationFilter === 'archive' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
          onClick={() => setDislocationFilter('archive')}
        >
          Архивные
        </button>
        <button
          type="button"
          className={dislocationFilter === 'all' ? 'h-filter-btn h-filter-btn--active' : 'h-filter-btn'}
          onClick={() => setDislocationFilter('all')}
        >
          Все
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="tabs-row">
        <div className="tabs">
          <button
            type="button"
            onClick={() => setTab('dislocation')}
            className={tab === 'dislocation' ? 'active' : ''}
          >
            Дислокация
          </button>
          <button
            type="button"
            onClick={() => setTab('hierarchy')}
            className={tab === 'hierarchy' ? 'active' : ''}
          >
            Матрёшка
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
        /* ── Вкладка Матрёшка ── */
        <div>
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
                Вагонов: {hierarchyMeta.total}
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
            />
          )}
        </div>
      ) : tab === 'trips' ? (
        /* ── Вкладка Рейсы ── */
        <div>
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
            {tripsMeta != null && (
              <div className="h-view-meta">
                Рейсов: {tripsMeta.total}
                {tripsMeta.hasActiveFilters && ` (показано: ${tripsMeta.filteredCount})`}
                {tripsMeta.totalPages > 1 && ` · стр. ${tripsMeta.page} из ${tripsMeta.totalPages}`}
              </div>
            )}
          </div>
          {!authLoading && (
            <TripsView
              isActive={
                tripsFilter === 'active' ? true
                  : tripsFilter === 'archive' ? false
                    : undefined
              }
              onMetaChange={setTripsMeta}
            />
          )}
        </div>
      ) : (
        /* ── Вкладка Дислокация ── */
        <>
          <DislocationFilterToggle />
          {settingsError && <div className="settings-error">{settingsError}</div>}
          {dataError && (
            <div className="data-error">
              {dataError}
              <button type="button" className="retry-btn" onClick={() => fetchData()}>
                Повторить
              </button>
            </div>
          )}
          {authLoading && <div className="data-loading">Проверка авторизации…</div>}
          {!authLoading && dataLoading && <div className="data-loading">Загрузка таблицы…</div>}
          {!authLoading && !dataLoading && (
            <WagonsTable
              data={data}
              columnFilters={columnFilters}
              onFilterChange={handleFilterChange}
              onResetFilters={() => setColumnFilters({})}
              onOpenComment={openModal}
              visibleColumnIds={visibleColumnIds}
              onVisibilityChange={handleVisibilityChange}
              wagonCounts={wagonCounts}
            />
          )}
        </>
      )}

      {isModalOpen && selectedWagon && (
        <div className="modal-overlay" role="dialog">
          <div className="modal-content">
            <h3>Комментарий для {selectedWagon.railway_carriage_number}</h3>
            <div className="comments-list">
              {comments.map((c) => (
                <div key={c.id} className="comment-item">
                  <strong>{c.author_name || '—'}</strong>: {c.comment_text}
                  {c.created_at && (
                    <span className="comment-date">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Новый комментарий"
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setIsModalOpen(false)} className="cancel-btn">
                Закрыть
              </button>
              <button type="button" onClick={handleSaveComment} className="save-btn">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
