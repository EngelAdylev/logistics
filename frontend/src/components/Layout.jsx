import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="logo">LOGISTICS</div>
        <div className="user-info">
          {user?.login} <span className="role-badge">{user?.role}</span>
        </div>
        <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')} end>
          <LayoutDashboard size={20} /> Слежение
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
            <Users size={20} /> Админка
          </NavLink>
        )}
        <button type="button" onClick={logout} className="logout-btn">
          <LogOut size={20} /> Выйти
        </button>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
