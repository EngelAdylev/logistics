import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

const REBUILD_WARNING =
  'Использовать только при необходимости пересчёта витрины после изменений логики или исправления данных. Комментарии не удаляются.';

export default function AdminPage() {
  const { loading: authLoading } = useAuth();
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState(null);
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [error, setError] = useState('');
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildResult, setRebuildResult] = useState(null);

  const fetchUsers = async () => {
    setUsersError(null);
    setUsersLoading(true);
    try {
      const res = await api.get('/users');
      setUsers(res.data || []);
    } catch (e) {
      console.error(e);
      const status = e.response?.status;
      setUsersError(
        status === 401 ? 'Сессия истекла. Войдите снова.' : 'Не удалось загрузить список пользователей.'
      );
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchUsers();
  }, [authLoading]);

  const handleRebuild = async () => {
    setRebuildConfirmOpen(false);
    setRebuildLoading(true);
    setError('');
    setRebuildResult(null);
    try {
      const res = await api.post('/admin/rebuild-tracking');
      setRebuildResult(res.data);
    } catch (e) {
      setError('Не удалось выполнить полную пересборку.');
    } finally {
      setRebuildLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', {
        login: newLogin,
        password: newPassword,
        role: newRole,
      });
      setNewLogin('');
      setNewPassword('');
      fetchUsers();
    } catch (err) {
      const d = err.response?.data?.detail;
      if (typeof d === 'object' && d?.message) {
        setError(d.message);
      } else {
        setError('Ошибка при создании пользователя');
      }
    }
  };

  if (authLoading) {
    return (
      <div className="admin-section">
        <div className="data-loading">Проверка авторизации…</div>
      </div>
    );
  }

  return (
    <div className="admin-section">
      <h2>Управление пользователями</h2>

      <div className="admin-toolbar">
        <button
          type="button"
          className="rebuild-btn"
          onClick={() => setRebuildConfirmOpen(true)}
          disabled={rebuildLoading}
        >
          {rebuildLoading ? 'Выполняется…' : 'Полная пересборка данных'}
        </button>
        {rebuildResult && (
          <span className="rebuild-result">
            Создано: {rebuildResult.created}, обновлено: {rebuildResult.updated}, активных: {rebuildResult.active}, в архиве: {rebuildResult.archived}
          </span>
        )}
      </div>
      {rebuildConfirmOpen && (
        <div className="modal-overlay" onClick={() => setRebuildConfirmOpen(false)} role="dialog">
          <div className="modal-content rebuild-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Полная пересборка витрины</h3>
            <p className="rebuild-warning">{REBUILD_WARNING}</p>
            <div className="modal-actions">
              <button type="button" className="cancel-btn" onClick={() => setRebuildConfirmOpen(false)}>
                Отмена
              </button>
              <button type="button" className="save-btn" onClick={handleRebuild} disabled={rebuildLoading}>
                Выполнить пересборку
              </button>
            </div>
          </div>
        </div>
      )}

      <form className="add-user-form" onSubmit={handleCreateUser}>
        <input
          value={newLogin}
          onChange={(e) => setNewLogin(e.target.value)}
          placeholder="Логин"
          required
        />
        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Пароль"
          type="password"
          required
        />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="save-btn">
          Добавить
        </button>
      </form>
      {error && <p className="admin-error">{error}</p>}
      {usersError && (
        <div className="data-error">
          {usersError}
          <button type="button" className="retry-btn" onClick={() => fetchUsers()}>
            Повторить
          </button>
        </div>
      )}
      {usersLoading && <div className="data-loading">Загрузка списка пользователей…</div>}
      {!usersLoading && (
        <table className="excel-table">
          <thead>
            <tr>
              <th>Логин</th>
              <th>Роль</th>
              <th>Активен</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !usersError ? (
              <tr><td colSpan={3}>Нет пользователей</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>{u.login}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active !== false ? 'Да' : 'Нет'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
