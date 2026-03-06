import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [error, setError] = useState('');
  const [rebuildInfo, setRebuildInfo] = useState(null);
  const [rebuildLoading, setRebuildLoading] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

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

  const handleRebuild = async () => {
    setRebuildLoading(true);
    setError('');
    setRebuildInfo(null);
    try {
      const res = await api.post('/admin/rebuild-tracking');
      setRebuildInfo(res.data);
    } catch (e) {
      console.error(e);
      setError('Не удалось выполнить пересборку витрины tracking_wagons');
    } finally {
      setRebuildLoading(false);
    }
  };

  return (
    <div className="admin-section">
      <h2>Управление пользователями</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="save-btn" onClick={handleRebuild} disabled={rebuildLoading}>
          {rebuildLoading ? 'Пересборка...' : 'Пересобрать tracking_wagons'}
        </button>
        {rebuildInfo && (
          <span style={{ color: '#475569', fontSize: 14 }}>
            создано: {rebuildInfo.created}, обновлено: {rebuildInfo.updated}, активных: {rebuildInfo.active}, в архиве: {rebuildInfo.archived}
          </span>
        )}
      </div>
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
      <table className="excel-table">
        <thead>
          <tr>
            <th>Логин</th>
            <th>Роль</th>
            <th>Активен</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.login}</td>
              <td>{u.role}</td>
              <td>{u.is_active !== false ? 'Да' : 'Нет'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
