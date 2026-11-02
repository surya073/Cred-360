import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useShareNotif } from '../context/ShareNotifContext';

import {
  RiDashboardLine,
  RiFolderLine,
  RiKeyLine,
  RiTeamLine,
  RiUserLine,
  RiSettings3Line,
  RiShareLine,
  RiHistoryLine,
  RiPriceTag3Line,
  RiGlobalLine,
} from 'react-icons/ri';

import logo from '../assets/images/keyShare-logo.png';
import Tooltip from './Tooltip';

const Sidebar = ({
  collapsed,
  mobileOpen,
  onOverlayClick,
  onMenuClick,
}) => {
  const { user } = useAuth();
  const { passwords, folders } = useShareNotif();

  const menuItems = [
    { path: '/', icon: <RiDashboardLine size={18} />, label: 'Dashboard' },
    { path: '/folders', icon: <RiFolderLine size={18} />, label: 'Folders', dot: folders > 0 },
    { path: '/passwords', icon: <RiKeyLine size={18} />, label: 'Passwords', dot: passwords > 0 },
    { path: '/categories', icon: <RiPriceTag3Line size={18} />, label: 'Categories' },
    { path: '/shares', icon: <RiShareLine size={18} />, label: 'Share Manager' },
    { path: '/external-users', icon: <RiGlobalLine size={18} />, label: 'External Users' },
    { path: '/activity', icon: <RiHistoryLine size={18} />, label: 'Activity Logs' },
    { path: '/users', icon: <RiUserLine size={18} />, label: 'Users' },
    { path: '/teams', icon: <RiTeamLine size={18} />, label: 'Teams' },
  ];

  const getRole = () => user?.role_details?.role_name || 'Employee';

  const getInitials = () => {
    if (!user) return 'U';
    return (user.first_name || user.email_id || 'U')
      .charAt(0)
      .toUpperCase();
  };

  const sidebarClass = [
    'sidebar',
    collapsed ? 'collapsed' : '',
    mobileOpen ? 'mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleMenuClick = () => {
    if (mobileOpen) {
      onMenuClick?.();
    }
  };

  const renderItem = (item) => {
    const link = (
      <NavLink
        to={item.path}
        end={item.path === '/'}
        className={({ isActive }) =>
          `sidebar-item ${isActive ? 'active' : ''}`
        }
        onClick={handleMenuClick}
      >
        <span
          className="sidebar-item-icon"
          style={{ position: 'relative' }}
        >
          {item.icon}

          {item.dot && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--danger)',
                border: '1.5px solid var(--bg-primary)',
              }}
            />
          )}
        </span>

        <span className="sidebar-item-label">
          {item.label}
        </span>
      </NavLink>
    );

    return collapsed ? (
      <Tooltip
        key={item.path}
        label={item.label}
        position="right"
      >
        {link}
      </Tooltip>
    ) : (
      <React.Fragment key={item.path}>
        {link}
      </React.Fragment>
    );
  };

  return (
    <>
      <div
        className={`sidebar-overlay ${mobileOpen ? 'visible' : ''}`}
        onClick={onOverlayClick}
      />

      <aside className={sidebarClass}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <img
              src={logo}
              alt="CRED 360"
              className="sidebar-logo-img"
            />
          </div>

          <span className="sidebar-logo-text">
            CRED 360
          </span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">
            Main Menu
          </div>

          {menuItems.map(renderItem)}

          <div
            className="sidebar-section-label"
            style={{ marginTop: 8 }}
          >
            Account
          </div>

          {renderItem({
            path: '/settings',
            icon: <RiSettings3Line size={18} />,
            label: 'Settings',
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <div
              className="user-avatar"
              style={{
                width: 30,
                height: 30,
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              {getInitials()}
            </div>

            <div className="sidebar-user-text">
              <div className="sidebar-user-name">
                {user?.first_name || 'User'}
              </div>

              <div className="sidebar-user-role">
                {getRole()}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;