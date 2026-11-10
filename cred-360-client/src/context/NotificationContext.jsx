import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../services/api';
import { connect, disconnect, subscribe } from '../services/realtime';
import { getMeta, getPriority, getTargetRoute, initialsOf, avatarColor } from '../utils/notificationMeta';

const API = '/server/cred_360_people_function';
const STORE_CAP = 500;       // cap stored ids so localStorage can't grow forever
const TOAST_MS = 7000;
const REFRESH_AFTER_MS = 3 * 60 * 1000; // re-check when the tab regains focus after this long
const QUIET = new Set(['password_expiring', 'share_expiring']); // time-based reminders never toast

const loadIds = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { return new Set(); }
};
const saveIds = (key, set) => {
  try { localStorage.setItem(key, JSON.stringify([...set].slice(-STORE_CAP))); } catch (e) { /* storage unavailable — ignore */ }
};

const NotificationContext = createContext({
  items: [], loading: true, refreshing: false, unreadCount: 0, isRead: () => true,
  refresh: () => {}, markRead: () => {}, markAllRead: () => {}, dismiss: () => {}, dismissAll: () => {},
});

export const useNotifications = () => useContext(NotificationContext);

// Owns the feed for the signed-in user: loads it, keeps it fresh from the shared socket (no
// polling), remembers read/dismissed state per user, and pops a toast for anything new.
export const NotificationProvider = ({ user, children }) => {
  const myId = String(user.user_id);
  const readKey = `keyshare:notif:read:${myId}`;
  const dismissKey = `keyshare:notif:dismissed:${myId}`;
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readIds, setReadIds] = useState(() => loadIds(readKey));
  const [dismissedIds, setDismissedIds] = useState(() => loadIds(dismissKey));
  const [toasts, setToasts] = useState([]);

  const knownRef = useRef(null);      // ids from the previous fetch (null until the first one)
  const lastFetchRef = useRef(0);
  const fetchingRef = useRef(false);
  const debounceRef = useRef(null);
  const readRef = useRef(readIds);
  readRef.current = readIds;

  const pushToast = useCallback((n) => {
    const t = { ...n, toastId: `${n.id}:${Date.now()}` };
    setToasts(prev => [...prev.filter(x => x.id !== n.id), t].slice(-3));
    setTimeout(() => setToasts(prev => prev.filter(x => x.toastId !== t.toastId)), TOAST_MS);
  }, []);

  const refresh = useCallback(async ({ manual = false } = {}) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (manual) setRefreshing(true);
    try {
      const res = await axios.get(`${API}/api/notifications`, { fresh: true });
      const data = res.data?.success ? (res.data.data || []) : [];
      if (knownRef.current) {
        // anything we hadn't seen on the previous fetch is news — toast the freshest few
        data.filter(n => !knownRef.current.has(n.id) && !QUIET.has(n.type) && !n.read && !readRef.current.has(n.id))
          .slice(0, 2).forEach(pushToast);
      }
      knownRef.current = new Set(data.map(n => n.id));
      setItems(data);
    } catch (e) {
      console.log('Notifications error:', e.message);
    } finally {
      fetchingRef.current = false;
      lastFetchRef.current = Date.now();
      setLoading(false);
      setRefreshing(false);
    }
  }, [pushToast]);

  // connect the shared socket for this session, load the feed
  useEffect(() => {
    connect(myId);
    refresh();
    return () => disconnect();
  }, [myId, refresh]);

  // a ping addressed to me → refresh (debounced so a burst of actions is one fetch)
  useEffect(() => subscribe((p) => {
    if (p?.t !== 'notif' || !Array.isArray(p.to) || !p.to.map(String).includes(myId)) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refresh(), 400);
  }), [myId, refresh]);

  // returning to the tab after a while (or a dropped socket) → catch up
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastFetchRef.current > REFRESH_AFTER_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearTimeout(debounceRef.current); };
  }, [refresh]);

  // Event notifications ("ev:<id>") are stored per person on the server, so read/dismiss are real
  // there. Derived reminders (expiring passwords/shares) have no row, so those stay in this browser.
  const isServerSide = (id) => String(id).startsWith('ev:');
  const isRead = useCallback((n) => !!n.read || readIds.has(n.id), [readIds]);
  const visible = useMemo(() => items.filter(n => !dismissedIds.has(n.id)), [items, dismissedIds]);
  const unreadCount = useMemo(() => visible.filter(n => !isRead(n)).length, [visible, isRead]);

  const markReadServer = useCallback((body) => {
    axios.post(`${API}/api/notifications/mark-read`, body).catch(() => {});
  }, []);

  const markAllRead = useCallback((ids) => {
    const serverIds = ids.filter(isServerSide);
    const localIds = ids.filter(id => !isServerSide(id));
    if (serverIds.length) {
      const set = new Set(serverIds);
      setItems(prev => prev.map(n => (set.has(n.id) ? { ...n, read: true } : n)));
      markReadServer(serverIds.length > 40 ? { all: true } : { ids: serverIds });
    }
    if (localIds.length) {
      setReadIds(prev => { const next = new Set(prev); localIds.forEach(id => next.add(id)); saveIds(readKey, next); return next; });
    }
  }, [markReadServer, readKey]);

  const markRead = useCallback((id) => { if (id) markAllRead([id]); }, [markAllRead]);

  const dismissAll = useCallback((ids) => {
    const serverIds = ids.filter(isServerSide);
    const localIds = ids.filter(id => !isServerSide(id));
    setDismissedIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); saveIds(dismissKey, next); return next; });
    if (serverIds.length) axios.delete(`${API}/api/notifications`, { data: serverIds.length > 40 ? { all: true } : { ids: serverIds } }).catch(() => {});
    if (localIds.length) { /* already remembered locally above */ }
  }, [dismissKey]);

  const dismiss = useCallback((id) => dismissAll([id]), [dismissAll]);

  const openToast = (n) => {
    markRead(n.id);
    setToasts(prev => prev.filter(x => x.id !== n.id));
    const target = getTargetRoute(n);
    if (target) navigate(target);
  };

  const value = useMemo(() => ({
    items: visible, loading, refreshing, unreadCount, isRead,
    refresh, markRead, markAllRead, dismiss, dismissAll,
  }), [visible, loading, refreshing, unreadCount, isRead, refresh, markRead, markAllRead, dismiss, dismissAll]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="notif-toasts" aria-live="polite">
        {toasts.map(n => {
          const meta = getMeta(n);
          const Icon = meta.icon;
          const priority = getPriority(n);
          return (
            <div key={n.toastId} className={`notif-toast priority-${priority}`} role="status" onClick={() => openToast(n)}>
              {n.by_name
                ? <span className="notif-toast-avatar" style={{ background: avatarColor(n.by_name) }}>{initialsOf(n.by_name)}</span>
                : <span className={`notif-icon notif-icon-${priority}`}><Icon size={16} /></span>}
              <div className="notif-toast-body">
                <b>{n.action}</b>
                {n.details && <span>{n.details}</span>}
              </div>
              <button
                className="notif-toast-x" aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); setToasts(prev => prev.filter(x => x.toastId !== n.toastId)); }}
              >×</button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
};
