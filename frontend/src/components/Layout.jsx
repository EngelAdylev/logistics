import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Layout/Sidebar';
import Topbar from './Layout/Topbar';

export default function Layout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
