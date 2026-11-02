import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProfileProvider } from './context/ProfileContext';
import { ShareNotifProvider } from './context/ShareNotifContext';
import { NavbarProvider } from './context/NavbarContext';

import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Passwords from './pages/Passwords';
import Folders from './pages/Folders';
import Users from './pages/Users';
import Teams from './pages/Teams';
import Settings from './pages/Settings';
import PublicShare from './pages/PublicShare';
import ShareManager from './pages/ShareManager';
import ActivityLogs from './pages/ActivityLogs';
import Categories from './pages/Categories';
import ExternalUsers from './pages/ExternalUsers';
import keyshareLogo from './assets/images/keyShare-logo.png';

import './styles/theme.css';
import './styles/layout.css';
import './styles/navbar.css';
import './styles/sidebar.css';
import './styles/dashboard.css';
import './styles/table.css';
import './styles/forms.css';
import './styles/modal.css';
import './styles/settings.css';
import './styles/responsive.css';
import './styles/auth.css';

const AppLayout = ({ children, collapsed, mobileOpen, onToggle, onOverlayClick, onMenuClick,loading }) => (
  <div className="app-container">
    <Sidebar
      collapsed={collapsed}
      mobileOpen={mobileOpen}
      onOverlayClick={onOverlayClick}
      onMenuClick={onMenuClick}
    />
    <div className={`main-wrapper ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Navbar
        collapsed={collapsed}
        onToggleSidebar={onToggle}
      />
      <main className="main-content page-enter">
        {loading && <div className="top-progress" />}
        {children}
      </main>
    </div>
  </div>
);

const AuthenticatedRoutes = () => {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed]   = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isMobile = () => window.innerWidth <= 768;

  const handleToggle = () => {
    if (isMobile()) {
      setMobileOpen(prev => !prev);
    } else {
      setCollapsed(prev => !prev);
    }
  };

  useEffect(() => {
    const handleResize = () => {
      if (!isMobile()) setMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const layoutProps = {
  collapsed,
  mobileOpen,loading,
  onToggle: handleToggle,
  onOverlayClick: () => setMobileOpen(false),
  onMenuClick: () => setMobileOpen(false),
};

  if (loading) {
    return (
      <div className="preloader">
        <div>
          <img src={keyshareLogo} alt="KeyShare Logo" className="preloader-logo" />
        </div>
        <div className="preloader-brand">KEYSHARE</div>
        <div className="preloader-sub">Secure Password Management</div>
        <div className="preloader-bar-wrap">
          <div className="preloader-bar" />
        </div>
        <div className="preloader-text">Loading...</div>
      </div>
    );
  }

  if (!user) {
    window.location.replace('/__catalyst/auth/login');
    return null;
  }

  return (
    <Routes>
      <Route path="/" element={
        <AppLayout {...layoutProps}><Dashboard /></AppLayout>
      } />
      <Route path="/passwords" element={
        <AppLayout {...layoutProps}><Passwords /></AppLayout>
      } />
      <Route path="/folders" element={
        <AppLayout {...layoutProps}><Folders /></AppLayout>
      } />
      <Route path="/shares" element={
        <AppLayout {...layoutProps}><ShareManager /></AppLayout>
      } />
      <Route path="/users" element={
        <AppLayout {...layoutProps}><Users /></AppLayout>
      } />
      <Route path="/teams" element={
        <AppLayout {...layoutProps}><Teams /></AppLayout>
      } />
      <Route path="/settings" element={
        <AppLayout {...layoutProps}><Settings /></AppLayout>
      } />
      <Route path="/activity" element={
        <AppLayout {...layoutProps}><ActivityLogs /></AppLayout>
      } />
      <Route path="/categories" element={                    
        <AppLayout {...layoutProps}><Categories /></AppLayout>
      } />
      <Route path="/external-users" element={
        <AppLayout {...layoutProps}><ExternalUsers /></AppLayout>
      } />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/share/:token" element={<PublicShare />} />
          <Route path="/*" element={
            <AuthProvider>
              <ProfileProvider>
                <NavbarProvider>
                  <ShareNotifProvider>
                    <AuthenticatedRoutes />
                  </ShareNotifProvider>
                </NavbarProvider>
              </ProfileProvider>
            </AuthProvider>
          } />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;