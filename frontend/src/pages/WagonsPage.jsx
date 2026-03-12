import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import WagonsTable from '../table/WagonsTable';
import { TABLE_COLUMNS, TABLE_KEY } from '../table/tableColumnsConfig';
import HierarchyView from '../components/hierarchy/HierarchyView';

const DEFAULT_VISIBLE_COLUMN_IDS = TABLE_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id);

export default function WagonsPage() {
  const { loading: authLoading } = useAuth();
  const [tab, setTab] = useState('active');
  const [hierarchyFilter, setHierarchyFilter] = useState('active'); // 'active' | 'archive'
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

  const fetchData = async (keepDataOnError = false) => {
    setDataError(null);
    setDataLoading(true);
    try {
      const endpoint = tab === 'active' ? '/wagons/active' : '/wagons/archive';
      const res = await api.get(endpoint);
      setData(Array.isArray(res.data) ? res.data : []);
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

  useEffect(() => {
    if (authLoading) return;
    fetchData();
  }, [tab, authLoading]);

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
      const ok = await fetchData(true);
      if (!ok) {
        setDataError('Не удалось обновить таблицу. Показаны предыдущие данные.');
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

  return (
    <>
      <div className="tabs-row">
        <div className="tabs">
          <button
            type="button"
            onClick={() => setTab('active')}
            className={tab === 'active' ? 'active' : ''}
          >
            Активные
          </button>
          <button
            type="button"
            onClick={() => setTab('archive')}
            className={tab === 'archive' ? 'active' : ''}
          >
            Архив
          </button>
          <button
            type="button"
            onClick={() => setTab('hierarchy')}
            className={tab === 'hierarchy' ? 'active' : ''}
          >
            Матрёшка
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
          {!authLoading && (
            <HierarchyView
              isActive={
                hierarchyFilter === 'active' ? true
                  : hierarchyFilter === 'archive' ? false
                    : undefined
              }
            />
          )}
        </div>
      ) : (
        /* ── Вкладки Активные / Архив ── */
        <>
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
