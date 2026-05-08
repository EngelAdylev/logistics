import React from 'react';
import { Bell } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import './Topbar.css';

export default function Topbar({ breadcrumbs = [] }) {
  const { user } = useAuth();

  return (
    <header className="topbar">
      {/* Breadcrumbs */}
      <div className="topbar-breadcrumbs">
        {breadcrumbs.length > 0 ? (
          <>
            {breadcrumbs.map((crumb, idx) => (
              <div key={idx} className="topbar-breadcrumb">
                {idx > 0 && <span className="topbar-separator">—</span>}
                <span
                  className={`topbar-breadcrumb-text ${
                    idx === breadcrumbs.length - 1 ? 'topbar-breadcrumb-text--current' : ''
                  }`}
                >
                  {crumb}
                </span>
              </div>
            ))}
          </>
        ) : (
          <span className="topbar-breadcrumb-text">Главная</span>
        )}
      </div>

      {/* Right side: Bell + Avatar */}
      <div className="topbar-right">
        <button className="topbar-bell" title="Уведомления">
          <Bell size={20} />
          <span className="topbar-notification-badge" />
        </button>

        <div className="topbar-user-avatar">
          <div className="avatar-gradient" title={user?.login || 'User'} />
          <span className="topbar-user-initials">
            {user?.login?.slice(0, 1).toUpperCase() || 'U'}
          </span>
        </div>
      </div>
    </header>
  );
}
