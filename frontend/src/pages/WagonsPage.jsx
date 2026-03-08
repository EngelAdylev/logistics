import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import WagonsTable from '../table/WagonsTable';
import { TABLE_COLUMNS, TABLE_KEY } from '../table/tableColumnsConfig';

export default function WagonsPage() {
  const [tab, setTab] = useState('active');
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
  const [visibleColumnIds, setVisibleColumnIds] = useState(null);
  const [settingsError, setSettingsError] = useState('');

  const fetchData = async () => {
    setDataError(null);
    setDataLoading(true);
    try {
      const endpoint = tab === 'active' ? '/wagons/active' : '/wagons/archive';
      const res = await api.get(endpoint);
      setData(res.data || []);
    } catch (e) {
      console.error(e);
      const status = e.response?.status;
      const msg = status === 401
        ? 'Сессия истекла. Войдите снова.'
        : status >= 500
          ? 'Ошибка сервера. Попробуйте позже.'
          : 'Не удалось загрузить данные.';
      setDataError(msg);
      setData([]);
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
    fetchData();
  }, [tab]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await api.get(`/table-settings/${TABLE_KEY}`);
        if (res.data?.visible_columns?.length) {
          setVisibleColumnIds(res.data.visible_columns);
        } else {
          setVisibleColumnIds(TABLE_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id));
        }
      } catch {
        setVisibleColumnIds(TABLE_COLUMNS.filter((c) => c.isDefaultVisible !== false).map((c) => c.id));
      }
    };
    loadSettings();
  }, []);

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
      setSyncMessage(
        `Обновлено: создано ${d.created || 0}, обновлено ${d.updated || 0}${d.errors ? `, ошибок: ${d.errors}` : ''}.`
      );
      await fetchData();
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (typeof detail === 'object' && detail?.error === 'SYNC_IN_PROGRESS') {
        setSyncMessage(detail.message || 'Обновление уже выполняется.');
      } else {
        setSyncMessage('Не удалось обновить данные.');
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

      {settingsError && <div className="settings-error">{settingsError}</div>}
      {dataError && (
        <div className="data-error">
          {dataError}
          <button type="button" className="retry-btn" onClick={() => fetchData()}>
            Повторить
          </button>
        </div>
      )}
      {dataLoading && <div className="data-loading">Загрузка таблицы…</div>}
      {!dataLoading && (
      <WagonsTable
        data={data}
        columnFilters={columnFilters}
        onFilterChange={handleFilterChange}
        onResetFilters={() => setColumnFilters({})}
        onOpenComment={openModal}
        visibleColumnIds={visibleColumnIds}
        onVisibilityChange={handleVisibilityChange}
      />
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
