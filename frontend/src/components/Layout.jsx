import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`app-container ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-name" title="Дислокация">
            {sidebarCollapsed ? 'Д' : 'Дислокация'}
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {sidebarCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
        </div>
        <div className="sidebar-nav">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')} end title="Слежение" onClick={() => setSidebarCollapsed(true)}>
            <LayoutDashboard size={20} />
            {!sidebarCollapsed && <span>Слежение</span>}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')} title="Админка" onClick={() => setSidebarCollapsed(true)}>
              <Users size={20} />
              {!sidebarCollapsed && <span>Админка</span>}
            </NavLink>
          )}
        </div>
        <div className="sidebar-user-info" title={user?.login}>
          {!sidebarCollapsed && (
            <>
              {user?.login} <span className="role-badge">{user?.role}</span>
            </>
          )}
        </div>
        <button type="button" onClick={logout} className="logout-btn" title="Выйти">
          <LogOut size={20} />
          {!sidebarCollapsed && <span>Выйти</span>}
        </button>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
