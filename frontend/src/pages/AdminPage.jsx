import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

const REBUILD_WARNING =
  'Использовать только при необходимости пересчёта витрины после изменений логики или исправления данных. Комментарии не удаляются.';

const SYNC_V2_WARNING =
  'Запустит полную синхронизацию иерархической модели (Матрёшка): свяжет строки dislocation с рейсами, обновит денормализованные поля и статусы. Операция идемпотентна — безопасно запускать повторно.';

const CLEAR_DATA_WARNING =
  'Будут удалены все данные: dislocation, tracking_wagons, wagon_comments, wagons, wagon_trips, операции, комментарии. Пользователи и справочники сохраняются. Операция необратима.';

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
  const [syncV2ConfirmOpen, setSyncV2ConfirmOpen] = useState(false);
  const [syncV2Loading, setSyncV2Loading] = useState(false);
  const [syncV2Result, setSyncV2Result] = useState(null);
  const [syncV2Error, setSyncV2Error] = useState(null);
  const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false);
  const [clearDataLoading, setClearDataLoading] = useState(false);
  const [clearDataResult, setClearDataResult] = useState(null);
  const [clearDataError, setClearDataError] = useState(null);

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

  const handleClearData = async () => {
    setClearDataConfirmOpen(false);
    setClearDataLoading(true);
    setClearDataResult(null);
    setClearDataError(null);
    try {
      const res = await api.post('/admin/clear-data');
      setClearDataResult(res.data);
    } catch (e) {
      setClearDataError('Не удалось очистить данные.');
    } finally {
      setClearDataLoading(false);
    }
  };

  const handleSyncV2 = async () => {
    setSyncV2ConfirmOpen(false);
    setSyncV2Loading(true);
    setSyncV2Result(null);
    setSyncV2Error(null);
    try {
      const res = await api.post('/v2/sync');
      setSyncV2Result(res.data);
    } catch (e) {
      setSyncV2Error('Не удалось выполнить синхронизацию Матрёшки.');
    } finally {
      setSyncV2Loading(false);
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
          className="rebuild-btn rebuild-btn--danger"
          onClick={() => setClearDataConfirmOpen(true)}
          disabled={clearDataLoading}
        >
          {clearDataLoading ? 'Очистка…' : 'Очистить все данные'}
        </button>
        {clearDataResult && (
          <span className="rebuild-result rebuild-result--success">
            {clearDataResult.message} Удалено: dislocation={clearDataResult.cleared?.dislocation ?? 0}, tracking_wagons={clearDataResult.cleared?.tracking_wagons ?? 0}, wagons={clearDataResult.cleared?.wagons ?? 0}
          </span>
        )}
        {clearDataError && <span className="rebuild-result rebuild-result--error">{clearDataError}</span>}
      </div>

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

      <div className="admin-toolbar">
        <button
          type="button"
          className="rebuild-btn rebuild-btn--v2"
          onClick={() => setSyncV2ConfirmOpen(true)}
          disabled={syncV2Loading}
        >
          {syncV2Loading ? 'Синхронизация…' : 'Синхронизация Матрёшки (/v2/sync)'}
        </button>
        {syncV2Result && (
          <span className="rebuild-result">
            Вагонов: +{syncV2Result.wagons_created} / ~{syncV2Result.wagons_updated} · Рейсов: +{syncV2Result.trips_created} / ~{syncV2Result.trips_updated} · Операций привязано: {syncV2Result.operations_inserted} · Статус: {syncV2Result.status}
          </span>
        )}
        {syncV2Error && <span className="rebuild-result rebuild-result--error">{syncV2Error}</span>}
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

      {clearDataConfirmOpen && (
        <div className="modal-overlay" onClick={() => setClearDataConfirmOpen(false)} role="dialog">
          <div className="modal-content rebuild-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Очистка всех данных</h3>
            <p className="rebuild-warning">{CLEAR_DATA_WARNING}</p>
            <div className="modal-actions">
              <button type="button" className="cancel-btn" onClick={() => setClearDataConfirmOpen(false)}>
                Отмена
              </button>
              <button type="button" className="save-btn rebuild-btn--danger" onClick={handleClearData} disabled={clearDataLoading}>
                Очистить данные
              </button>
            </div>
          </div>
        </div>
      )}

      {syncV2ConfirmOpen && (
        <div className="modal-overlay" onClick={() => setSyncV2ConfirmOpen(false)} role="dialog">
          <div className="modal-content rebuild-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Синхронизация Матрёшки</h3>
            <p className="rebuild-warning">{SYNC_V2_WARNING}</p>
            <div className="modal-actions">
              <button type="button" className="cancel-btn" onClick={() => setSyncV2ConfirmOpen(false)}>
                Отмена
              </button>
              <button type="button" className="save-btn" onClick={handleSyncV2} disabled={syncV2Loading}>
                Запустить синхронизацию
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
