import React, { useState, useEffect } from 'react';
import { useReactTable, getCoreRowModel, flexRender } from '@tanstack/react-table';
import { MessageSquarePlus, RefreshCw } from 'lucide-react';
import { api } from '../api';

export default function WagonsPage() {
  const [tab, setTab] = useState('active');
  const [data, setData] = useState([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedWagon, setSelectedWagon] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);

  const fetchData = async () => {
    try {
      const endpoint = tab === 'active' ? '/wagons/active' : '/wagons/archive';
      const res = await api.get(endpoint);
      setData(res.data);
    } catch (e) {
      console.error(e);
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

  const wagonColumns = [
    { header: 'Номер вагона', accessorKey: 'railway_carriage_number' },
    { header: 'Станция', accessorKey: 'current_station_name' },
    { header: 'Операция', accessorKey: 'current_operation_name' },
    {
      header: 'Дата',
      accessorKey: 'last_operation_date',
      cell: (info) => {
        const v = info.getValue();
        return v ? new Date(v).toLocaleString() : '-';
      },
    },
    {
      header: 'Чат',
      cell: ({ row }) => (
        <button
          className="comment-btn"
          onClick={() => openModal(row.original)}
          type="button"
        >
          <MessageSquarePlus size={16} />
        </button>
      ),
    },
  ];

  const table = useReactTable({
    data,
    columns: wagonColumns,
    getCoreRowModel: getCoreRowModel(),
  });

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
      <table className="excel-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

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
