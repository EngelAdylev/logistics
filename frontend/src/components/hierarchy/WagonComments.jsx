import React, { useState, useEffect } from 'react';
import { api } from '../../api';

function formatDate(val) {
  if (!val) return '';
  return new Date(val).toLocaleString('ru-RU');
}

export default function WagonComments({ wagon, onClose }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [historyId, setHistoryId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadComments();
  }, [wagon.id]);

  const loadComments = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/v2/wagons/${wagon.id}/comments`);
      setComments(res.data || []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newText.trim()) return;
    setSaving(true);
    try {
      await api.post(`/v2/wagons/${wagon.id}/comments`, { text: newText.trim() });
      setNewText('');
      await loadComments();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (commentId) => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await api.put(`/v2/wagon-comments/${commentId}`, { text: editText.trim() });
      setEditingId(null);
      await loadComments();
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async (commentId) => {
    if (historyId === commentId) {
      setHistoryId(null);
      return;
    }
    setHistoryId(commentId);
    setHistoryLoading(true);
    try {
      const res = await api.get(`/v2/wagon-comments/${commentId}/history`);
      setHistory(res.data || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content h-comments-modal">
        <h3>Комментарии к вагону {wagon.railway_carriage_number}</h3>

        {loading ? (
          <div className="data-loading">Загрузка…</div>
        ) : (
          <div className="comments-list">
            {comments.length === 0 && (
              <div className="h-comments-empty">Комментариев нет</div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="comment-item">
                {editingId === c.id ? (
                  <div className="h-comment-edit">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                    />
                    <div className="h-comment-edit-actions">
                      <button
                        type="button"
                        className="save-btn"
                        onClick={() => handleEdit(c.id)}
                        disabled={saving}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="cancel-btn"
                        onClick={() => setEditingId(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="h-comment-header">
                      <strong>{c.author_name || '—'}</strong>
                      <span className="h-comment-actions">
                        <button
                          type="button"
                          className="h-comment-btn"
                          onClick={() => { setEditingId(c.id); setEditText(c.comment_text); }}
                          title="Редактировать"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className={`h-comment-btn ${historyId === c.id ? 'active' : ''}`}
                          onClick={() => loadHistory(c.id)}
                          title="История изменений"
                        >
                          🕐
                        </button>
                      </span>
                    </div>
                    <div>{c.comment_text}</div>
                    <span className="comment-date">
                      {formatDate(c.created_at)}
                      {c.updated_at && c.updated_at !== c.created_at && ' (изменён)'}
                    </span>

                    {historyId === c.id && (
                      <div className="h-history-block">
                        {historyLoading ? (
                          <div className="h-ops-loading">Загрузка истории…</div>
                        ) : history.length === 0 ? (
                          <div className="h-comments-empty">История изменений пуста</div>
                        ) : (
                          history.map((h) => (
                            <div key={h.id} className="h-history-item">
                              <span className="h-history-meta">{h.changed_by} · {formatDate(h.changed_at)}</span>
                              <div className="h-history-diff">
                                <span className="h-history-old">{h.old_text || '—'}</span>
                                {' → '}
                                <span className="h-history-new">{h.new_text}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Новый комментарий к вагону…"
          rows={3}
        />
        <div className="modal-actions">
          <button type="button" className="cancel-btn" onClick={onClose}>
            Закрыть
          </button>
          <button
            type="button"
            className="save-btn"
            onClick={handleAdd}
            disabled={saving || !newText.trim()}
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}
