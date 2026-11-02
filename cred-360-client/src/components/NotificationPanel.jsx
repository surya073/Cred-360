import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  RiBellLine, RiKeyLine, RiShareLine,
  RiUserAddLine, RiDeleteBinLine, RiEditLine,
  RiTimeLine, RiCloseLine, RiCheckDoubleLine,
  RiRefreshLine, RiFolderLine, RiTeamLine,
  RiShieldUserLine, RiHistoryLine, RiUserFollowLine,
  RiUserUnfollowLine, RiShieldCheckLine, RiLockUnlockLine,
  RiFolderSharedLine, RiFolderForbidLine, RiEditBoxLine,
  RiDeleteBin6Line, RiNotificationOffLine, RiCheckLine,
  RiErrorWarningLine, RiInformationLine, RiAlertLine
} from 'react-icons/ri';
import { useNavigate } from 'react-router-dom';

// const API = '/server/cred_360_function';
const API = '/server/cred_360_people_function';
const NOTIF_READ_IDS_KEY  = 'cred360_notif_read_ids';
const NOTIF_DISMISSED_KEY = 'cred360_notif_dismissed_ids';
const PAGE_SIZE           = 10;

// ── Type → visual metadata ──────────────────────────────────────────────────
// Extensible map: covers today's backend types plus the fuller enterprise
// vocabulary (team/user/folder/password lifecycle events) so the panel keeps
// working unchanged if/when the API starts emitting more event types.
const TYPE_META = {
  // Password Management
  password_shared:        { icon: RiShareLine,        label: 'Password Shared',      module: 'Password Management', priority: 'info' },
  password_expiring:      { icon: RiTimeLine,          label: 'Password Expiring',    module: 'Password Management', priority: 'warning' },
  password_created:       { icon: RiKeyLine,           label: 'Password Added',       module: 'Password Management', priority: 'success' },
  password_updated:       { icon: RiEditBoxLine,       label: 'Password Updated',     module: 'Password Management', priority: 'info' },
  password_deleted:       { icon: RiDeleteBin6Line,    label: 'Password Deleted',     module: 'Password Management', priority: 'error' },
  password_access_revoked:{ icon: RiFolderForbidLine,  label: 'Access Revoked',       module: 'Password Management', priority: 'error' },

  // Folder Management
  folder_shared:          { icon: RiFolderSharedLine,  label: 'Folder Shared',        module: 'Folder Management',   priority: 'info' },
  folder_renamed:         { icon: RiEditBoxLine,       label: 'Folder Renamed',       module: 'Folder Management',   priority: 'info' },
  folder_deleted:         { icon: RiDeleteBin6Line,    label: 'Folder Deleted',       module: 'Folder Management',   priority: 'error' },
  folder_access_revoked:  { icon: RiFolderForbidLine,  label: 'Folder Access Revoked',module: 'Folder Management',   priority: 'error' },

  // Team Management
  team_added:             { icon: RiTeamLine,          label: 'Added to Team',        module: 'Team Management',     priority: 'success' },
  member_added:           { icon: RiUserFollowLine,    label: 'Member Added',         module: 'Team Management',     priority: 'success' },
  member_removed:         { icon: RiUserUnfollowLine,  label: 'Member Removed',       module: 'Team Management',     priority: 'error' },

  // User Management
  role_changed:           { icon: RiShieldUserLine,    label: 'Role Changed',         module: 'User Management',     priority: 'warning' },
  permissions_updated:    { icon: RiShieldCheckLine,   label: 'Permissions Updated',  module: 'User Management',     priority: 'warning' },
};

const DEFAULT_META = { icon: RiBellLine, label: 'Activity', module: 'Activity', priority: 'info' };

const getMeta = (log) => TYPE_META[log.type] || DEFAULT_META;

const getPriority = (log) => {
  if (log.type === 'password_expiring') return log.urgent ? 'error' : 'warning';
  return getMeta(log).priority;
};

const PRIORITY_LABEL = { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' };

const getTargetRoute = (log) => {
  switch (log.type) {
    case 'password_shared':
    case 'password_expiring':
    case 'password_created':
    case 'password_updated':
    case 'password_deleted':
    case 'password_access_revoked':
      return log.ref_id ? `/passwords?highlight=${log.ref_id}` : '/passwords';
    case 'folder_shared':
    case 'folder_renamed':
    case 'folder_deleted':
    case 'folder_access_revoked':
      return log.ref_id ? `/folders?highlight=${log.ref_id}` : '/folders';
    case 'team_added':
    case 'member_added':
    case 'member_removed':
      return log.ref_id ? `/teams?highlight=${log.ref_id}` : '/teams';
    case 'role_changed':
    case 'permissions_updated':
      return log.ref_id ? `/users?highlight=${log.ref_id}` : '/users';
    default:
      return null;
  }
};

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff  = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z');
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(dateStr.replace(' ', 'T') + 'Z').toLocaleDateString();
};

const cleanDetails = (details) => {
  if (!details) return null;
  return details.replace(/\d{17}/g, 'a team');
};

// "Shared by X" / "Added by X" line — returns null if no name available
const byLine = (log) => {
  if (!log.by_name) return null;
  if (log.type === 'team_added' || log.type === 'member_added') return `Added by ${log.by_name}`;
  if (log.type === 'member_removed') return `Removed by ${log.by_name}`;
  if (log.type === 'password_shared' || log.type === 'folder_shared') return `Shared by ${log.by_name}`;
  if (log.type === 'role_changed' || log.type === 'permissions_updated') return `Changed by ${log.by_name}`;
  return `By ${log.by_name}`;
};

// Group label bucketing — Today / Yesterday / This Week / Earlier
const getGroupLabel = (dateStr, now) => {
  if (!dateStr) return 'Earlier';
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (d >= startOfToday) return 'Today';
  if (d >= startOfYesterday) return 'Yesterday';
  if (d >= startOfWeek) return 'This Week';
  return 'Earlier';
};

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Earlier'];

const persistIds = (key, idSet) => {
  const arr = [...idSet].slice(-500); // cap stored IDs to avoid unbounded growth
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* storage full/unavailable — ignore */ }
};

const loadIds = (key) => {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
};

// ── Small presentational pieces ─────────────────────────────────────────────

const PriorityDot = ({ priority }) => (
  <span className={`notif-priority-dot notif-priority-${priority}`} title={PRIORITY_LABEL[priority]} />
);

const EmptyState = () => (
  <div className="notif-empty">
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="36" cy="36" r="34" fill="var(--bg-secondary)" />
      <path d="M36 20c-7.2 0-13 5.8-13 13v8l-4 6h34l-4-6v-8c0-7.2-5.8-13-13-13z"
            stroke="var(--text-muted)" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <path d="M31 51a5 5 0 0 0 10 0" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="52" cy="22" r="8" fill="var(--success-bg)" />
      <path d="M48.5 22l2.3 2.3 4.7-4.7" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <p className="notif-empty-title">No notifications yet</p>
    <p className="notif-empty-sub">You're all caught up — new activity will show up here.</p>
  </div>
);

const SkeletonList = () => (
  <div className="notif-loading">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="notif-skeleton-row">
        <div className="notif-skeleton notif-skeleton-avatar" />
        <div className="notif-skeleton-lines">
          <div className="notif-skeleton notif-skeleton-line" style={{ width: '70%' }} />
          <div className="notif-skeleton notif-skeleton-line" style={{ width: '90%' }} />
          <div className="notif-skeleton notif-skeleton-line" style={{ width: '40%' }} />
        </div>
      </div>
    ))}
  </div>
);

const NotificationPanel = ({ onClose }) => {
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readIds, setReadIds]           = useState(() => loadIds(NOTIF_READ_IDS_KEY));
  const [dismissedIds, setDismissedIds] = useState(() => loadIds(NOTIF_DISMISSED_KEY));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState('all'); // all | unread

  const panelRef = useRef(null);
  const bodyRef  = useRef(null);
  const navigate = useNavigate();

  // Sorted, newest-first, with dismissed entries removed.
  const sortedLogs = useMemo(() => {
    return [...logs]
      .filter(log => !log.id || !dismissedIds.has(log.id))
      .sort((a, b) => {
        const ta = a.created_time ? new Date(a.created_time.replace(' ', 'T') + 'Z') : 0;
        const tb = b.created_time ? new Date(b.created_time.replace(' ', 'T') + 'Z') : 0;
        return tb - ta;
      });
  }, [logs, dismissedIds]);

  const filteredLogs = useMemo(() => {
    if (filter !== 'unread') return sortedLogs;
    return sortedLogs.filter(log => log.id && !readIds.has(log.id));
  }, [sortedLogs, filter, readIds]);

  const unreadCount = useMemo(
    () => sortedLogs.filter(log => log.id && !readIds.has(log.id)).length,
    [sortedLogs, readIds]
  );

  // Paginated slice for render performance on large histories.
  const pagedLogs = useMemo(
    () => filteredLogs.slice(0, visibleCount),
    [filteredLogs, visibleCount]
  );

  const grouped = useMemo(() => {
    const now = new Date();
    const acc = {};
    pagedLogs.forEach(log => {
      const label = getGroupLabel(log.created_time, now);
      if (!acc[label]) acc[label] = [];
      acc[label].push(log);
    });
    return acc;
  }, [pagedLogs]);

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await axios.get(`${API}/api/notifications`);
      if (res.data.success) setLogs(res.data.data || []);
    } catch (e) {
      console.log('Notifications error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    const escHandler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  const markAsRead = useCallback((id) => {
    if (!id) return;
    setReadIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      persistIds(NOTIF_READ_IDS_KEY, next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds(prev => {
      const next = new Set(prev);
      filteredLogs.forEach(log => { if (log.id) next.add(log.id); });
      persistIds(NOTIF_READ_IDS_KEY, next);
      return next;
    });
  }, [filteredLogs]);

  const deleteNotification = useCallback((e, log) => {
    e.stopPropagation(); // don't trigger navigation on delete click
    if (!log.id) return;
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(log.id);
      persistIds(NOTIF_DISMISSED_KEY, next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      filteredLogs.forEach(log => { if (log.id) next.add(log.id); });
      persistIds(NOTIF_DISMISSED_KEY, next);
      return next;
    });
  }, [filteredLogs]);

  const handleNotificationClick = useCallback((log) => {
    markAsRead(log.id);
    const target = getTargetRoute(log);
    if (target) {
      navigate(target);
      onClose();
    }
  }, [markAsRead, navigate, onClose]);

  const handleLoadMore = useCallback(() => {
    // Appending items below the fold — no scroll-position correction needed
    // since nothing above the current viewport shifts.
    setVisibleCount(prev => prev + PAGE_SIZE);
  }, []);

  const hasMore = visibleCount < filteredLogs.length;

  return (
    <div className="notif-panel" ref={panelRef} role="dialog" aria-label="Notifications">

      {/* ── Header ── */}
      <div className="notif-header">
        <div className="notif-header-title">
          <h3 className="notif-title">Notifications</h3>
          {unreadCount > 0 && (
            <span className="notif-unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </div>
        <div className="notif-header-actions">
          <button
            className={`notif-icon-btn ${refreshing ? 'is-spinning' : ''}`}
            onClick={() => fetchNotifications(true)}
            title="Refresh"
            aria-label="Refresh notifications"
          >
            <RiRefreshLine size={14} />
          </button>
          <button className="notif-icon-btn" onClick={onClose} title="Close" aria-label="Close notifications">
            <RiCloseLine size={14} />
          </button>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="notif-tabs">
        <button
          className={`notif-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`notif-tab ${filter === 'unread' ? 'active' : ''}`}
          onClick={() => setFilter('unread')}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="notif-body" ref={bodyRef}>
        {loading ? (
          <SkeletonList />
        ) : filteredLogs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {GROUP_ORDER.filter(label => grouped[label]?.length).map(label => (
              <div key={label} className="notif-group">
                <div className="notif-group-label">{label}</div>

                {grouped[label].map((log, i) => {
                  const meta      = getMeta(log);
                  const priority  = getPriority(log);
                  const Icon      = meta.icon;
                  const isUnread  = log.id ? !readIds.has(log.id) : false;
                  const details   = cleanDetails(log.details);
                  const who       = byLine(log);
                  const clickable = !!getTargetRoute(log);

                  return (
                    <div
                      key={log.id || `${label}-${i}`}
                      className={`notif-item priority-${priority} ${isUnread ? 'unread' : ''}`}
                      onClick={() => handleNotificationClick(log)}
                      style={{ cursor: clickable ? 'pointer' : 'default' }}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleNotificationClick(log); }}
                    >
                      {/* Icon */}
                      <div className={`notif-icon notif-icon-${priority}`}>
                        <Icon size={15} />
                      </div>

                      {/* Content */}
                      <div className="notif-content">
                        <div className="notif-content-top">
                          <span className={`notif-action ${isUnread ? 'unread' : ''}`}>
                            {log.action}
                          </span>
                          <PriorityDot priority={priority} />
                        </div>

                        {details && <p className="notif-details">{details}</p>}

                        <div className="notif-meta-row">
                          <span className="notif-module-badge">{meta.module}</span>
                          <span className="notif-time">
                            <RiTimeLine size={11} /> {timeAgo(log.created_time)}
                          </span>
                        </div>

                        {who && <p className="notif-by-line">{who}</p>}

                        {log.urgent && (
                          <p className="notif-urgent-line">
                            <RiAlertLine size={12} /> Expires soon
                          </p>
                        )}
                      </div>

                      {/* Unread dot */}
                      {isUnread && <div className="notif-unread-dot" />}

                      {/* Row actions */}
                      <div className="notif-row-actions">
                        {isUnread && (
                          <button
                            className="notif-row-action-btn"
                            onClick={(e) => { e.stopPropagation(); markAsRead(log.id); }}
                            title="Mark as read"
                            aria-label="Mark as read"
                          >
                            <RiCheckLine size={13} />
                          </button>
                        )}
                        <button
                          className="notif-row-action-btn notif-row-action-danger"
                          onClick={(e) => deleteNotification(e, log)}
                          title="Delete notification"
                          aria-label="Delete notification"
                        >
                          <RiCloseLine size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {hasMore && (
              <button className="notif-load-more" onClick={handleLoadMore}>
                Load older notifications
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="notif-footer notif-footer-multi">
        {unreadCount > 0 && (
          <button className="notif-footer-action-btn" onClick={markAllRead} title="Mark all as read">
            <RiCheckDoubleLine size={13} /> Mark all read
          </button>
        )}
        {filteredLogs.length > 0 && (
          <button className="notif-footer-action-btn" onClick={clearAll} title="Clear all notifications">
            <RiDeleteBinLine size={13} /> Clear all
          </button>
        )}
        <button className="notif-footer-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

export default NotificationPanel;