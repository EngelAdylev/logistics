import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, Users, PanelLeftClose, PanelLeft, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import './Sidebar.css';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const [isExpanded, setIsExpanded] = useState(true);
  const [searchActive, setSearchActive] = useState(false);

  // 2x2 grid of circles (логотип)
  const LogoCircles = () => (
    <svg width="32" height="32" viewBox="0 0 32 32" className="sidebar-logo-svg">
      <circle cx="8" cy="8" r="5.5" fill="#1E40AF" />
      <circle cx="24" cy="8" r="5.5" fill="#3B82F6" />
      <circle cx="8" cy="24" r="5.5" fill="#60A5FA" />
      <circle cx="24" cy="24" r="5.5" fill="#1E40AF" />
    </svg>
  );

  return (
    <aside className={`sidebar ${isExpanded ? 'sidebar--expanded' : 'sidebar--collapsed'}`}>
      {/* Header с логотипом */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <LogoCircles />
          {isExpanded && <span className="sidebar-logo-text">Логистика</span>}
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Свернуть' : 'Развернуть'}
        >
          {isExpanded ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
        </button>
      </div>

      {/* Search box */}
      <div className="sidebar-search">
        <button
          type="button"
          className="sidebar-search-btn"
          onClick={() => setSearchActive(!searchActive)}
          title="Поиск"
        >
          <Search size={20} />
        </button>
        {isExpanded && searchActive && (
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="Найти..."
            autoFocus
            onBlur={() => setSearchActive(false)}
          />
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`
          }
          title="Слежение"
          end
        >
          <LayoutDashboard size={20} />
          {isExpanded && <span>Слежение</span>}
        </NavLink>

        <NavLink
          to="/waybills"
          className={({ isActive }) =>
            `sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`
          }
          title="Накладные"
        >
          <FileText size={20} />
          {isExpanded && <span>Накладные</span>}
        </NavLink>

        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`
            }
            title="Админка"
          >
            <Users size={20} />
            {isExpanded && <span>Админка</span>}
          </NavLink>
        )}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-env-badge">
          <span className="sidebar-env-text">local</span>
        </div>

        <div className="sidebar-user-avatar">
          <div className="avatar-gradient" title={user?.login || 'User'} />
          {isExpanded && user?.login && (
            <span className="sidebar-user-name">{user.login.slice(0, 1).toUpperCase()}</span>
          )}
        </div>

        <button
          type="button"
          className="sidebar-logout"
          onClick={logout}
          title="Выйти"
        >
          {isExpanded ? 'Выйти' : ''}
        </button>
      </div>
    </aside>
  );
}
