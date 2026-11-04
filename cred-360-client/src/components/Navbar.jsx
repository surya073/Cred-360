import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useProfile } from '../context/ProfileContext';
import { useNavbar } from '../context/NavbarContext';
import NotificationPanel from './NotificationPanel';
import GlobalSearch from './GlobalSearch';
import Tooltip from './Tooltip';
import KeyShareLogo from './KeyShareLogo';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  RiSunLine, RiMoonLine,
  RiUserLine, RiLogoutBoxLine,
  RiNotification3Line, RiShieldUserLine,
  RiMenuLine, RiMenuFoldLine, RiSettings3Line,
  RiSearchLine, RiFilterLine, RiTeamLine
} from 'react-icons/ri';

// ── Breadcrumb config ────────────────────────────────────────
const BREADCRUMB_MAP = {
  '/':                { module: 'CRED 360', section: null,      page: 'Dashboard'      },
  '/passwords':       { module: 'CRED 360', section: 'Vault',   page: 'Passwords'      },
  '/folders':         { module: 'CRED 360', section: 'Vault',   page: 'Folders'        },
  '/categories':      { module: 'CRED 360', section: 'Vault',   page: 'Categories'     },
  '/shares':          { module: 'CRED 360', section: 'Sharing', page: 'Share Manager'  },
  '/external-users':  { module: 'CRED 360', section: 'Sharing', page: 'External Users' },
  '/users':           { module: 'CRED 360', section: null,   page: 'Users'          },
  '/teams':           { module: 'CRED 360', section: null,   page: 'Teams'          },
  '/settings':        { module: 'CRED 360', section: 'Account', page: 'Settings'       },
  '/activity':        { module: 'CRED 360', section: null,   page: 'Activity Logs'  },
};

const getBreadcrumb = (pathname) => {
  const match = Object.keys(BREADCRUMB_MAP)
    .sort((a, b) => b.length - a.length)
    .find(key => pathname === key || pathname.startsWith(key + '/'));
  return BREADCRUMB_MAP[match] ?? { module: 'CRED 360', section: null, page: 'Page' };
  //     ^^^^^^^^^^^^^^^^^^^^ was returning `match` (the key), not the map value
};

// ── Component ────────────────────────────────────────────────
const Navbar = ({ collapsed, onToggleSidebar }) => {
  const { user, logout }                       = useAuth();
  const { theme, toggleTheme }                 = useTheme();
  const { profileImageUrl }                    = useProfile();
  const { recordCount, filterCount,
          setRecordCount, setFilterCount }      = useNavbar();
  const navigate                               = useNavigate();
  const location                               = useLocation();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen,    setNotifOpen]    = useState(false);
  const [searchOpen,   setSearchOpen]   = useState(false);
  const dropdownRef                     = useRef(null);
  const breadcrumb                      = getBreadcrumb(location.pathname);

  // Outside click — close dropdown
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

// Route change — close panels + reset counts
  useEffect(() => {
    setDropdownOpen(false);
    setNotifOpen(false);
    setSearchOpen(false);
    setRecordCount(0);
    setFilterCount(0);
  }, [location.pathname, setRecordCount, setFilterCount]);

// Ctrl+K / Cmd+K global shortcut
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const getInitials = () => {
    if (!user) return 'U';
    return (user.first_name || user.email_id || 'U').charAt(0).toUpperCase();
  };

  const getDisplayName = () => {
    if (!user) return 'User';
    if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`;
    return user.first_name || user.email_id || 'User';
  };

  const goTo = (path) => { navigate(path); setDropdownOpen(false); };

  const AvatarContent = () => profileImageUrl ? (
    <img
      src={profileImageUrl}
      alt="Profile"
      style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
    />
  ) : <>{getInitials()}</>;

  return (
    <nav className={`navbar ${collapsed ? 'sidebar-collapsed' : ''}`}>

      {/* ── Left ── */}
      <div className="navbar-left" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>

        <div className="navbar-brand">
          <KeyShareLogo size={30} />
          <span>CRED 360</span>
        </div>

        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button className="nav-icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            {collapsed ? <RiMenuLine size={18} /> : <RiMenuFoldLine size={18} />}
          </button>
        </Tooltip>

        <div className="navbar-sep" />

        <nav className="navbar-breadcrumb" aria-label="Breadcrumb">
          <span>{breadcrumb.module}</span>
          {breadcrumb.section && (
            <>
              <span style={{ opacity: 0.3, fontSize: '12px' }}>/</span>

              <span>{breadcrumb.section}</span>
            </>
          )}
          <span style={{ opacity: 0.3, fontSize: '12px' }}>/</span>

          <span className="current">{breadcrumb.page}</span>
        </nav>

        {recordCount > 0 && (
          <>
            <div className="navbar-sep" />
            <div className="navbar-ctx-tag">
              <RiTeamLine size={13} />
              {recordCount.toLocaleString()} records
            </div>
          </>
        )}

        {filterCount > 0 && (
          <div className="navbar-ctx-tag">
            <RiFilterLine size={13} />
            {filterCount} {filterCount === 1 ? 'filter' : 'filters'}
          </div>
        )}

      </div>

      {/* ── Right ── */}
      <div className="navbar-right">

        <div
          className="navbar-search-pill"
          role="button"
          tabIndex={0}
          title="Search (Ctrl+K)"
          onClick={() => setSearchOpen(true)}
          onKeyDown={(e) => e.key === 'Enter' && setSearchOpen(true)}
        >
          <RiSearchLine size={14} />
          <span>Search...</span>
          <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.5 }}>⌘K</span>
        </div>

        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <Tooltip label={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          <button className="nav-icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'light' ? <RiMoonLine size={17} /> : <RiSunLine size={17} />}
          </button>
        </Tooltip>

        <div className="notif-btn-wrap" style={{ position: 'relative' }}>
          <Tooltip label="Notifications">
            <button
              className="nav-icon-btn"
              onClick={() => { setNotifOpen(p => !p); setDropdownOpen(false); }}
              aria-label="Notifications"
            >
              <RiNotification3Line size={17} />
              <span className="notif-badge" />
            </button>
          </Tooltip>
          {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
        </div>

        <div className="navbar-sep" />

        <span className="navbar-hi">Hi, {user?.first_name || 'there'}!</span>

        <div className="dropdown-wrapper" ref={dropdownRef}>
          <Tooltip label="Account">
            <div
              className="user-avatar-wrap"
              style={{ position: 'relative', display: 'inline-flex', cursor: 'pointer' }}
              onClick={() => { setDropdownOpen(p => !p); setNotifOpen(false); }}
            >
              <div className="user-avatar"><AvatarContent /></div>
              <span className="user-online-dot" />
            </div>
          </Tooltip>

          {dropdownOpen && (
            <div className="user-dropdown">
              <div className="dropdown-header">
                <div className="dropdown-avatar-row">
                  <div className="dropdown-avatar-sm"><AvatarContent /></div>
                  <div>
                    <div className="dropdown-name">{getDisplayName()}</div>
                    <div className="dropdown-email">{user?.email_id || ''}</div>
                  </div>
                </div>
              </div>

              <button className="dropdown-item" onClick={() => goTo('/settings')}>
                <RiUserLine size={15} /> Profile
              </button>
              <button className="dropdown-item" onClick={() => goTo('/settings')}>
                <RiSettings3Line size={15} /> Settings
              </button>
              <button className="dropdown-item" onClick={() => goTo('/settings')}>
                <RiShieldUserLine size={15} /> Security
              </button>

              <div className="dropdown-divider" />

              <button className="dropdown-item danger" onClick={logout}>
                <RiLogoutBoxLine size={15} /> Logout
              </button>
            </div>
          )}
        </div>

      </div>
    </nav>
  );
};

export default Navbar;