// One shared Data Streams socket for the whole app (team chat, notifications, ...).
//
// The channel only ever carries content-free pings ({ t, team_id | to, uid }); anything the
// user may read is fetched afterwards through the authenticated REST API. Consumers subscribe
// with subscribe(handler); nothing here polls.
//
// One connection per BROWSER, not per tab: every tab asks for a lock (Web Locks API); the tab that
// holds it owns the socket and relays pings to the other tabs over a BroadcastChannel. A stream
// token identifies the user, so several tabs each opening their own socket would displace one
// another. If the lock holder closes, the lock passes to another tab automatically.
//
// Plain axios on purpose (not services/api): token requests must never be cached.
import axios from 'axios';

const STREAM_API = '/server/cred_360_stream_function';
const LOCK_NAME = 'keyshare-realtime';
const RETRY_MIN_MS = 15000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const DOWN_REBUILD_MS = 45000; // stay-down time after which a brand-new socket is built

let socket = null;
let live = false;
let myId = null;
let starting = false;
let retryTimer = null;
let retryMs = RETRY_MIN_MS;
let watchdog = null;
let wanted = false;       // connect() was called and disconnect() hasn't been
let isLeader = false;     // this tab owns the socket
let releaseLock = null;

const handlers = new Set();
const liveHandlers = new Set();

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LOCK_NAME) : null;

export const isLive = () => live;

const setLive = (v) => {
  if (live === v) return;
  live = v;
  liveHandlers.forEach(fn => { try { fn(v); } catch (e) { /* a bad listener must not break the others */ } });
  if (isLeader && channel) channel.postMessage({ type: 'live', v });
};

const deliver = (p) => handlers.forEach(fn => { try { fn(p); } catch (e) { /* ignore */ } });

if (channel) {
  channel.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'hello' && isLeader) channel.postMessage({ type: 'live', v: live });
    else if (m.type === 'ping' && !isLeader) deliver(m.p);
    else if (m.type === 'live' && !isLeader) setLive(!!m.v);
  };
}

// Receive every ping from other people (your own are filtered out). Returns an unsubscribe fn.
export const subscribe = (fn) => { handlers.add(fn); return () => handlers.delete(fn); };

// Know when the socket goes up/down. Returns an unsubscribe fn.
export const onLiveChange = (fn) => { liveHandlers.add(fn); return () => liveHandlers.delete(fn); };

function scheduleRetry() {
  if (!wanted || !isLeader || retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; open(); }, retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS); // back off hard while the stream is unavailable
}

async function open() {
  if (!wanted || !isLeader || socket || starting) return;
  starting = true;
  try {
    const res = await axios.get(`${STREAM_API}/api/chat/stream`);
    if (!wanted) return;
    if (!res.data?.enabled || !res.data.tokens) return; // not available here; stay quiet
    const t = res.data.tokens;
    const { DataStreamsWebSocket } = await import('@zcatalyst/datastreams');
    if (!wanted) return;

    const s = new DataStreamsWebSocket({ url: t.url, zuid: t['wss-id'], key: t.key });
    socket = s;

    // The Data Streams client reconnects on its own (its first attempt often closes with 1006 and
    // the next one opens). So close/error only flip the status; a fresh socket (new token) is
    // built only if it stays down for a long time.
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (socket !== s || live) return;
        socket = null;
        try { s.close(); } catch (e) { /* ignore */ }
        scheduleRetry();
      }, DOWN_REBUILD_MS);
    };

    s.on('open', () => {
      clearTimeout(watchdog);
      s.subscribe('0');
      retryMs = RETRY_MIN_MS;
      setLive(true);
    });
    s.on('message', (evt) => {
      try { s.sendAck(); } catch (e) { /* ignore */ }
      let p = null;
      try { p = typeof evt?.data === 'string' ? JSON.parse(evt.data) : evt?.data; } catch (e) { /* ignore */ }
      if (p && String(p.uid) === myId) return; // my own action echoing back
      deliver(p);
      if (channel) channel.postMessage({ type: 'ping', p });
    });
    const down = () => { if (socket === s) { setLive(false); armWatchdog(); } };
    s.on('error', down);
    s.on('close', down);
    armWatchdog(); // also covers a socket that never opens at all
  } catch (e) {
    setLive(false);
    scheduleRetry();
  } finally {
    starting = false;
  }
}

function becomeLeader() {
  isLeader = true;
  retryMs = RETRY_MIN_MS;
  open();
}

export function connect(userId) {
  myId = String(userId);
  wanted = true;
  if (channel) channel.postMessage({ type: 'hello' }); // ask a leader tab (if any) for the current state

  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    // Queues until this tab is the leader; held until disconnect() or the tab closes.
    navigator.locks.request(LOCK_NAME, () => new Promise((resolve) => {
      if (!wanted) { resolve(); return; }
      releaseLock = resolve;
      becomeLeader();
    })).catch(() => {});
  } else {
    becomeLeader(); // no Web Locks: behave as before, one socket for this tab
  }
}

export function disconnect() {
  clearTimeout(watchdog); watchdog = null;
  wanted = false;
  clearTimeout(retryTimer); retryTimer = null;
  retryMs = RETRY_MIN_MS;
  const s = socket;
  socket = null;
  try { s?.close(); } catch (e) { /* ignore */ }
  if (releaseLock) { releaseLock(); releaseLock = null; }
  const wasLeader = isLeader;
  isLeader = false;
  if (wasLeader) { live = false; if (channel) channel.postMessage({ type: 'live', v: false }); }
  liveHandlers.forEach(fn => { try { fn(false); } catch (e) { /* ignore */ } });
}

// Tell these people (user ids) they have something new. Only when the shared socket is live, so
// no request is spent while the stream is unavailable.
export function pingNotify(userIds) {
  const to = [...new Set((userIds || []).map(String))].slice(0, 50);
  if (!live || !to.length) return;
  axios.post(`${STREAM_API}/api/ping/notify`, { to }).catch(() => {});
}
