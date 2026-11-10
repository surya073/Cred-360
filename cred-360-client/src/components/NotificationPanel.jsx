import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../services/api';
import {
  RiCloseLine, RiCheckDoubleLine, RiRefreshLine, RiDeleteBinLine, RiCheckLine,
  RiTimeLine, RiTeamLine, RiAlertLine, RiBuilding2Line, RiUser3Line,
} from 'react-icons/ri';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { formatRelative, dateKey, todayKey } from '../utils/dateHelper';
import {
  CATEGORIES, getMeta, getPriority, getTargetRoute, initialsOf, avatarColor,
} from '../utils/notificationMeta';

const API = '/server/cred_360_people_function';
const PAGE_SIZE = 12;
const GROUP_ORDER = ['Today', 'Yesterday', 'This week', 'Earlier'];

const getGroupLabel = (dateStr, now) => {
  const k = dateStr ? dateKey(dateStr) : null;
  if (!k) return 'Earlier';
  if (k === todayKey()) return 'Today';
  if (k === dateKey(new Date(now.getTime() - 86400000))) return 'Yesterday';
  if (k >= dateKey(new Date(now.getTime() - 7 * 86400000))) return 'This week';
  return 'Earlier';
};

const EmptyState = ({ title, sub }) => (
  <div className="notif-empty">
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <circle cx="36" cy="36" r="34" fill="var(--bg-secondary)" />
      <path d="M36 20c-7.2 0-13 5.8-13 13v8l-4 6h34l-4-6v-8c0-7.2-5.8-13-13-13z" stroke="var(--text-muted)" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <path d="M31 51a5 5 0 0 0 10 0" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="52" cy="22" r="8" fill="var(--success-bg)" />
      <path d="M48.5 22l2.3 2.3 4.7-4.7" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <p className="notif-empty-title">{title}</p>
    <p className="notif-empty-sub">{sub}</p>
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
  const { user } = useAuth();
  const isAdmin = /admin/i.test(user?.role_details?.role_name || '');
  const {
    items, loading, refreshing, isRead, unreadCount, refresh, markRead, markAllRead, dismiss, dismissAll,
  } = useNotifications();

  const [scope, setScope]     = useState('mine');      // mine | org (admins)
  const [cat, setCat]         = useState('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [org, setOrg]         = useState({ items: [], loading: false, loaded: false });

  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Make sure the feed is reasonably fresh whenever the panel opens (the socket keeps it live otherwise).
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
  }, [onClose]);

  const loadOrg = useCallback(async () => {
    setOrg(o => ({ ...o, loading: true }));
    try {
      const res = await axios.get(`${API}/api/notifications`, { params: { scope: 'org' }, fresh: true });
      setOrg({ items: res.data?.data || [], loading: false, loaded: true });
    } catch (e) {
      setOrg({ items: [], loading: false, loaded: true });
    }
  }, []);

  useEffect(() => { if (scope === 'org' && !org.loaded) loadOrg(); }, [scope, org.loaded, loadOrg]);

  const source = scope === 'org' ? org.items : items;
  const isLoading = scope === 'org' ? org.loading : loading;

  // unread per category, for the little count chips
  const unreadBy = useMemo(() => {
    const acc = { all: 0 };
    items.forEach(n => {
      if (isRead(n)) return;
      acc.all++;
      const c = getMeta(n).category;
      acc[c] = (acc[c] || 0) + 1;
    });
    return acc;
  }, [items, isRead]);

  const filtered = useMemo(() => source.filter(n => {
    if (scope === 'mine' && cat !== 'all' && getMeta(n).category !== cat) return false;
    if (scope === 'mine' && onlyUnread && isRead(n)) return false;
    return true;
  }), [source, scope, cat, onlyUnread, isRead]);

  const paged = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const grouped = useMemo(() => {
    const now = new Date();
    const acc = {};
    paged.forEach(n => { (acc[getGroupLabel(n.created_time, now)] = acc[getGroupLabel(n.created_time, now)] || []).push(n); });
    return acc;
  }, [paged]);

  const open = (n) => {
    if (scope === 'mine') markRead(n.id);
    const target = getTargetRoute(n);
    if (target) { navigate(target); onClose(); }
  };

  const hasMore = visibleCount < filtered.length;
  const idsOf = (list) => list.map(n => n.id);

  return (
    <div className="notif-panel" ref={panelRef} role="dialog" aria-label="Notifications">
      {/* ── Header ── */}
      <div className="notif-header">
        <div className="notif-header-title">
          <h3 className="notif-title">Notifications</h3>
          {unreadCount > 0 && <span className="notif-unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </div>
        <div className="notif-header-actions">
          <button
            className={`notif-icon-btn ${refreshing || org.loading ? 'is-spinning' : ''}`}
            onClick={() => (scope === 'org' ? loadOrg() : refresh({ manual: true }))}
            title="Refresh" aria-label="Refresh notifications"
          ><RiRefreshLine size={14} /></button>
          <button className="notif-icon-btn" onClick={onClose} title="Close" aria-label="Close notifications"><RiCloseLine size={14} /></button>
        </div>
      </div>

      {/* ── Scope (admins) ── */}
      {isAdmin && (
        <div className="notif-scope">
          <button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}><RiUser3Line size={13} /> For you</button>
          <button className={scope === 'org' ? 'active' : ''} onClick={() => setScope('org')}><RiBuilding2Line size={13} /> Organisation</button>
        </div>
      )}

      {/* ── Category chips + unread toggle ── */}
      {scope === 'mine' ? (
        <div className="notif-cats">
          <div className="notif-cat-row">
            {CATEGORIES.map(c => (
              <button key={c.key} className={`notif-cat ${cat === c.key ? 'active' : ''}`} onClick={() => { setCat(c.key); setVisibleCount(PAGE_SIZE); }}>
                {c.label}{unreadBy[c.key] > 0 && <span className="notif-cat-count">{unreadBy[c.key]}</span>}
              </button>
            ))}
          </div>
          <label className="notif-unread-toggle" title="Show only unread">
            <input type="checkbox" checked={onlyUnread} onChange={e => { setOnlyUnread(e.target.checked); setVisibleCount(PAGE_SIZE); }} />
            Unread only
          </label>
        </div>
      ) : (
        <p className="notif-org-note">Everything that happened across the workspace — who did what, and to whom.</p>
      )}

      {/* ── Body ── */}
      <div className="notif-body">
        {isLoading ? <SkeletonList /> : filtered.length === 0 ? (
          scope === 'org'
            ? <EmptyState title="No activity yet" sub="Actions taken by anyone in the workspace will appear here." />
            : <EmptyState title={onlyUnread ? 'No unread notifications' : 'No notifications yet'} sub={onlyUnread ? "You're all caught up." : 'Shares, team changes and alerts will show up here.'} />
        ) : (
          <>
            {GROUP_ORDER.filter(l => grouped[l]?.length).map(label => (
              <div key={label} className="notif-group">
                <div className="notif-group-label">{label}</div>
                {grouped[label].map(n => {
                  const meta = getMeta(n);
                  const priority = getPriority(n);
                  const Icon = meta.icon;
                  const unread = scope === 'mine' && !isRead(n);
                  const clickable = !!getTargetRoute(n);
                  return (
                    <div
                      key={n.id}
                      className={`notif-item priority-${priority} ${unread ? 'unread' : ''}`}
                      onClick={() => open(n)} tabIndex={0} role="button"
                      onKeyDown={(e) => { if (e.key === 'Enter') open(n); }}
                      style={{ cursor: clickable ? 'pointer' : 'default' }}
                    >
                      <div className="notif-lead">
                        {n.by_name && n.type !== 'audit'
                          ? <span className="notif-avatar" style={{ background: avatarColor(n.by_name) }}>{initialsOf(n.by_name)}</span>
                          : <span className={`notif-icon notif-icon-${priority}`}><Icon size={15} /></span>}
                        {n.by_name && n.type !== 'audit' && <span className={`notif-lead-badge notif-icon-${priority}`}><Icon size={10} /></span>}
                      </div>

                      <div className="notif-content">
                        <div className="notif-content-top">
                          <span className={`notif-action ${unread ? 'unread' : ''}`}>{n.action}</span>
                        </div>
                        {n.details && <p className="notif-details">{n.details}</p>}
                        <div className="notif-meta-row">
                          <span className="notif-module-badge">{meta.module}</span>
                          {n.scope === 'team' && <span className="notif-scope-chip"><RiTeamLine size={11} /> Team</span>}
                          {n.type === 'audit' && n.by_name && <span className="notif-by-line">{n.by_name}</span>}
                          <span className="notif-time"><RiTimeLine size={11} /> {formatRelative(n.created_time, '')}</span>
                        </div>
                        {n.urgent && <p className="notif-urgent-line"><RiAlertLine size={12} /> Needs attention</p>}
                      </div>

                      {unread && <div className="notif-unread-dot" />}

                      {scope === 'mine' && (
                        <div className="notif-row-actions">
                          {unread && (
                            <button className="notif-row-action-btn" onClick={(e) => { e.stopPropagation(); markRead(n.id); }} title="Mark as read" aria-label="Mark as read">
                              <RiCheckLine size={13} />
                            </button>
                          )}
                          <button className="notif-row-action-btn notif-row-action-danger" onClick={(e) => { e.stopPropagation(); dismiss(n.id); }} title="Dismiss" aria-label="Dismiss notification">
                            <RiCloseLine size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {hasMore && <button className="notif-load-more" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Load older notifications</button>}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="notif-footer notif-footer-multi">
        {scope === 'mine' && unreadCount > 0 && (
          <button className="notif-footer-action-btn" onClick={() => markAllRead(idsOf(items))} title="Mark all as read">
            <RiCheckDoubleLine size={13} /> Mark all read
          </button>
        )}
        {scope === 'mine' && filtered.length > 0 && (
          <button className="notif-footer-action-btn" onClick={() => dismissAll(idsOf(filtered))} title="Clear shown notifications">
            <RiDeleteBinLine size={13} /> Clear {cat === 'all' && !onlyUnread ? 'all' : 'shown'}
          </button>
        )}
        <button className="notif-footer-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default NotificationPanel;
