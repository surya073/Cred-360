import React, { useState, useEffect, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProfileProvider } from './context/ProfileContext';
import { ShareNotifProvider } from './context/ShareNotifContext';
import { NavbarProvider } from './context/NavbarContext';
import { TimezoneProvider, useTimeZone } from './context/TimezoneContext';

import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import KeyShareLogo from './components/KeyShareLogo';

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
import './styles/polish.css';
import './styles/glass.css';
import './styles/nexus-dashboard.css';
import './styles/shell-nexus.css';
import './styles/unified.css';
import './styles/toast.css';
import './styles/datatable.css';
import './styles/premium.css';

// Route-level code splitting: each page loads on demand
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Passwords = lazy(() => import('./pages/Passwords'));
const Folders = lazy(() => import('./pages/Folders'));
const Users = lazy(() => import('./pages/Users'));
const Teams = lazy(() => import('./pages/Teams'));
const Settings = lazy(() => import('./pages/Settings'));
const PublicShare = lazy(() => import('./pages/PublicShare'));
const Login = lazy(() => import('./pages/Login'));
const ShareManager = lazy(() => import('./pages/ShareManager'));
const ActivityLogs = lazy(() => import('./pages/ActivityLogs'));
const Categories = lazy(() => import('./pages/Categories'));
const ExternalUsers = lazy(() => import('./pages/ExternalUsers'));

// One persistent shell: Sidebar/Navbar stay mounted across navigation (no refetch / re-init);
// only the page area is keyed by path so it re-plays its enter animation.
const AppLayout = ({ collapsed, mobileOpen, onToggle, onOverlayClick, onMenuClick, loading }) => {
  const { pathname } = useLocation();
  return (
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
        <main key={pathname} className="main-content page-enter">
          {loading && <div className="top-progress" />}
          {/* Each page is its own chunk, so the first load only ships what is needed */}
          <Suspense fallback={<div className="top-progress" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

const AuthenticatedRoutes = () => {
  const { user, loading } = useAuth();
  const { timeZone } = useTimeZone();
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
          <KeyShareLogo size={76} className="preloader-logo" />
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

  // Not signed in → embedded Catalyst sign-in widget (no redirect to hosted page)
  if (!user) return <Suspense fallback={null}><Login /></Suspense>;

  return (
    // keyed by time zone so every page re-renders its dates when the zone changes
    <Routes key={timeZone}>
      <Route element={<AppLayout {...layoutProps} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/passwords" element={<Passwords />} />
        <Route path="/folders" element={<Folders />} />
        <Route path="/shares" element={<ShareManager />} />
        <Route path="/users" element={<Users />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/activity" element={<ActivityLogs />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/external-users" element={<ExternalUsers />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <ThemeProvider>
     <TimezoneProvider>
      <HashRouter>
        <Routes>
          <Route path="/share/:token" element={<Suspense fallback={null}><PublicShare /></Suspense>} />
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
     </TimezoneProvider>
    </ThemeProvider>
  );
}

export default App;