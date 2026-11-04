import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import axios from '../services/api';
import Toast, { useToast } from './Toast';
import {
  RiSendPlaneLine, RiAttachmentLine, RiImageLine,
  RiFileLine, RiMusicLine, RiVideoLine, RiFilePdfLine,
  RiDownloadLine, RiCheckDoubleLine, RiCheckLine,
  RiRefreshLine, RiTimeLine, RiErrorWarningLine
} from 'react-icons/ri';

const API = '/server/cred_360_function';
// Node 22 function that owns the Data Streams channel (socket tokens + pings)
const STREAM_API = '/server/cred_360_stream_function';

const PAGE_SIZE      = 50;
const FOCUS_REFETCH_MS = 60000; // re-check at most once a minute when returning to the tab
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ── helpers ───────────────────────────────────────────────────────────────────
const toDate = (t) => (t ? new Date(String(t).replace(' ', 'T') + 'Z') : null);

const formatTime = (t) => {
  const d = toDate(t);
  return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

const dayLabel = (t) => {
  const d = toDate(t);
  return d && !isNaN(d) ? d.toLocaleDateString() : 'Unknown';
};

const formatFileSize = (bytes) => {
  const b = parseInt(bytes, 10);
  if (!b) return '';
  if (b < 1024)        return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

// ROWIDs are ~17-digit numbers (beyond Number precision) — compare as strings.
const cmpId = (a, b) => {
  a = String(a); b = String(b);
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
};
const maxId = (a, b) => (!a ? b : !b ? a : cmpId(a, b) >= 0 ? a : b);

const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Confirmed messages (ordered by ROWID) first, then still-pending optimistic ones.
const sortMessages = (list) => {
  const real = list.filter(m => !m._tmp).sort((a, b) => cmpId(a.ROWID, b.ROWID));
  const tmp  = list.filter(m => m._tmp);
  return [...real, ...tmp];
};

// Merge server rows into the list without duplicates; settle matching optimistic sends.
const mergeMessages = (prev, incoming, myId) => {
  const have = new Set(prev.filter(m => !m._tmp).map(m => String(m.ROWID)));
  const fresh = incoming.filter(m => !have.has(String(m.ROWID)));
  if (!fresh.length) return prev;
  const mineText = fresh.filter(m => String(m.sender_id) === myId && m.message_type === 'text');
  const base = mineText.length
    ? prev.filter(t => !(t._tmp && !t._failed && mineText.some(m => m.message === t.message)))
    : prev;
  return sortMessages([...base, ...fresh]);
};

const FileIcon = ({ type }) => {
  if (type === 'image') return <RiImageLine size={20} />;
  if (type === 'video') return <RiVideoLine size={20} />;
  if (type === 'audio') return <RiMusicLine size={20} />;
  if (type === 'pdf')   return <RiFilePdfLine size={20} />;
  return <RiFileLine size={20} />;
};

// ── message bubble (memoised: only re-renders when its own message changes) ──
const MessageBubble = memo(({ msg, isMe, currentUserId, onRetry }) => {
  const fileUrl = msg.file_id ? `${API}/api/teams/files/${msg.file_id}` : null;
  const readByList = msg.read_by ? msg.read_by.split(',').map(s => s.trim()) : [];
  const isRead = readByList.some(id => id && id !== String(currentUserId));

  return (
    <div className={`chat-bubble-row ${isMe ? 'me' : 'them'}`}>
      {!isMe && (
        <div className="chat-avatar">
          {(msg.sender_name || 'U').charAt(0).toUpperCase()}
        </div>
      )}
      <div className={`chat-bubble ${isMe ? 'bubble-me' : 'bubble-them'}`}>
        {!isMe && <div className="chat-sender-name">{msg.sender_name}</div>}

        {msg.message_type === 'text' && <div className="chat-text">{msg.message}</div>}

        {msg.message_type === 'image' && (
          <div>
            <img
              src={fileUrl} alt={msg.file_name} className="chat-image" loading="lazy"
              onClick={() => window.open(fileUrl, '_blank')}
            />
            {msg.message && <div className="chat-text" style={{ marginTop: 4 }}>{msg.message}</div>}
          </div>
        )}

        {msg.message_type === 'video' && <video controls preload="metadata" className="chat-video" src={fileUrl} />}

        {msg.message_type === 'audio' && (
          <audio controls preload="none" src={fileUrl} style={{ width: '100%', marginTop: 4 }} />
        )}

        {(msg.message_type === 'pdf' || msg.message_type === 'file') && (
          <a href={fileUrl} target="_blank" rel="noreferrer" className="chat-file-card">
            <FileIcon type={msg.message_type} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {msg.file_name}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{formatFileSize(msg.file_size)}</div>
            </div>
            <RiDownloadLine size={16} />
          </a>
        )}

        <div className="chat-meta">
          <span className="chat-time">{formatTime(msg.created_time)}</span>
          {isMe && (
            msg._failed ? (
              <button
                type="button" onClick={() => onRetry(msg)} title="Tap to retry"
                style={{ background: 'none', border: 0, padding: 0, color: '#ff6b6b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11 }}
              >
                <RiErrorWarningLine size={13} /> Failed · retry
              </button>
            ) : msg._tmp ? (
              <span style={{ color: 'rgba(255,255,255,0.6)' }}><RiTimeLine size={13} /></span>
            ) : (
              <span style={{ color: isRead ? '#34b7f1' : 'rgba(255,255,255,0.6)' }}>
                {isRead ? <RiCheckDoubleLine size={13} /> : <RiCheckLine size={13} />}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
});

// ── chat ──────────────────────────────────────────────────────────────────────
const TeamChat = ({ team, currentUser, members }) => {
  const teamId = String(team.ROWID);
  const myId   = String(currentUser.user_id);

  const [messages, setMessages]       = useState([]);
  const [text, setText]               = useState('');
  const [uploading, setUploading]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState(false);
  const [hasMore, setHasMore]         = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive]               = useState(false);
  const { toasts, removeToast, toast } = useToast();

  const scrollRef    = useRef(null);
  const bottomRef    = useRef(null);
  const fileRef      = useRef(null);
  const lastFetchRef = useRef(0);      // when we last hit the server for messages
  const readTimerRef = useRef(null);
  const lastIdRef    = useRef(null);   // newest confirmed ROWID we have
  const fetchingRef  = useRef(false);
  const pendingRef   = useRef(false);  // a sync was requested while one was running
  const idleRef      = useRef(0);      // consecutive polls with nothing new
  const errRef       = useRef(0);      // consecutive failed polls
  const liveRef      = useRef(false);
  const stickRef     = useRef(true);   // is the user reading the bottom?
  const tmpSeq       = useRef(0);
  const teamIdRef    = useRef(teamId);
  const syncRef      = useRef(null);
  teamIdRef.current = teamId;

  const url = `${API}/api/teams/${teamId}/messages`;

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Tell other members' sockets something changed. Only when MY socket is live, so no
  // requests are wasted while the stream is unavailable. Carries no message content.
  const pingStream = useCallback((t, id) => {
    if (!liveRef.current) return;
    axios.post(`${STREAM_API}/api/ping`, { team_id: teamId, t, id: id ? String(id) : undefined }).catch(() => {});
  }, [teamId]);

  // Tell the server I've read others' messages (debounced, only while visible).
  const markRead = useCallback(() => {
    clearTimeout(readTimerRef.current);
    readTimerRef.current = setTimeout(() => {
      if (document.hidden) return;
      axios.patch(`${url}/read`)
        .then(r => { if (r.data?.marked) pingStream('read'); })
        .catch(() => {});
    }, 1500);
  }, [url, pingStream]);

  const applyTail = useCallback((tail) => {
    if (!tail?.length) return;
    const byId = new Map(tail.map(t => [String(t.ROWID), t.read_by]));
    setMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        const rb = byId.get(String(m.ROWID));
        if (rb !== undefined && rb !== (m.read_by || '')) { changed = true; return { ...m, read_by: rb }; }
        return m;
      });
      return changed ? next : prev;
    });
  }, []);

  // First page (latest messages).
  const loadInitial = useCallback(async () => {
    setLoading(true); setLoadError(false);
    lastFetchRef.current = Date.now();
    try {
      const res = await axios.get(url, { params: { limit: PAGE_SIZE }, fresh: true });
      if (teamIdRef.current !== teamId) return;
      const rows = res.data.data || [];
      lastIdRef.current = rows.length ? rows[rows.length - 1].ROWID : null;
      setMessages(sortMessages(rows));
      setHasMore(!!res.data.has_more);
      stickRef.current = true;
      if (rows.some(m => String(m.sender_id) !== myId)) markRead();
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [url, teamId, myId, markRead]);

  // Incremental fetch: only rows newer than what we already have.
  const sync = useCallback(async () => {
    if (!lastIdRef.current && !fetchingRef.current) {
      // nothing loaded yet (empty chat or initial failure) — fetch the first page instead
      fetchingRef.current = true;
      lastFetchRef.current = Date.now();
      try {
        const res = await axios.get(url, { params: { limit: PAGE_SIZE }, fresh: true });
        const rows = res.data.data || [];
        if (rows.length) {
          lastIdRef.current = rows[rows.length - 1].ROWID;
          setMessages(prev => mergeMessages(prev, rows, myId));
          setHasMore(!!res.data.has_more);
          idleRef.current = 0;
          if (rows.some(m => String(m.sender_id) !== myId)) markRead();
        } else idleRef.current++;
        errRef.current = 0;
      } catch (e) { errRef.current = Math.min(errRef.current + 1, 5); }
      finally { fetchingRef.current = false; }
      return;
    }
    if (fetchingRef.current) { pendingRef.current = true; return; }
    fetchingRef.current = true;
    lastFetchRef.current = Date.now();
    try {
      // Drain in a loop so a long absence catches up in a few quick calls.
      for (let guard = 0; guard < 10; guard++) {
        const res = await axios.get(url, { params: { after: lastIdRef.current, limit: PAGE_SIZE }, fresh: true });
        const rows = res.data.data || [];
        if (rows.length) {
          lastIdRef.current = maxId(lastIdRef.current, rows[rows.length - 1].ROWID);
          setMessages(prev => mergeMessages(prev, rows, myId));
          idleRef.current = 0;
          if (rows.some(m => String(m.sender_id) !== myId)) markRead();
        } else if (guard === 0) idleRef.current++;
        applyTail(res.data.tail);
        if (rows.length < PAGE_SIZE) break;
      }
      errRef.current = 0;
    } catch (e) {
      errRef.current = Math.min(errRef.current + 1, 5);
    } finally {
      fetchingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; syncRef.current?.(); }
    }
  }, [url, myId, markRead, applyTail]);
  syncRef.current = sync;

  // Load the selected team's chat. No background polling (requests are limited):
  // updates arrive via the stream ping, on send, on tab focus, or manual refresh.
  useEffect(() => {
    lastIdRef.current = null;
    idleRef.current = 0; errRef.current = 0;
    fetchingRef.current = false; pendingRef.current = false;
    setMessages([]); setHasMore(false);
    loadInitial();

    const onVisibility = () => {
      if (document.hidden) return;
      if (!liveRef.current && Date.now() - lastFetchRef.current > FOCUS_REFETCH_MS) syncRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(readTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadInitial]);

  // Optional Data Streams connection. The stream only carries a content-free "something
  // new in team X" ping; the messages themselves still come from the authenticated API.
  // Any failure here is silent — polling keeps chat working.
  useEffect(() => {
    let socket = null;
    let cancelled = false;

    const setLiveState = (v) => { liveRef.current = v; if (!cancelled) setLive(v); };

    (async () => {
      try {
        const res = await axios.get(`${STREAM_API}/api/chat/stream`, { fresh: true });
        if (cancelled || !res.data?.enabled || !res.data.tokens) return;
        const t = res.data.tokens;
        const { DataStreamsWebSocket } = await import('@zcatalyst/datastreams');
        if (cancelled) return;

        socket = new DataStreamsWebSocket({ url: t.url, zuid: t['wss-id'], key: t.key });
        socket.on('open', () => { socket.subscribe('0'); setLiveState(true); if (Date.now() - lastFetchRef.current > 10000) syncRef.current?.(); /* catch up after a reconnect */ });
        socket.on('message', (evt) => {
          try { socket.sendAck(); } catch (e) { /* ignore */ }
          let ping = null;
          try { ping = typeof evt?.data === 'string' ? JSON.parse(evt.data) : evt?.data; } catch (e) { /* ignore */ }
          if (ping && String(ping.uid) === myId) return; // my own action echoing back
          if (ping?.t === 'read') {
            // someone read the chat: tick my messages locally, zero requests
            if (ping.team_id === undefined || String(ping.team_id) === teamIdRef.current) {
              const uid = String(ping.uid);
              setMessages(prev => prev.map(m => {
                if (String(m.sender_id) !== myId) return m;
                const have = (m.read_by || '').split(',').map(x => x.trim());
                return have.includes(uid) ? m : { ...m, read_by: [m.read_by, uid].filter(Boolean).join(',') };
              }));
            }
            return;
          }
          // new message (or unparsable ping): fetch only what's newer than what we have
          if (!ping || String(ping.team_id) === teamIdRef.current) syncRef.current?.();
        });
        socket.on('error', () => setLiveState(false));
        socket.on('close', () => setLiveState(false));
      } catch (e) {
        setLiveState(false);
      }
    })();

    return () => {
      cancelled = true;
      liveRef.current = false;
      try { socket?.close(); } catch (e) { /* ignore */ }
    };
  }, [myId]);

  // Scroll: stick to the bottom for new messages only if the user is already there (or sent it).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (messages.length && stickRef.current) scrollToBottom(messages.length > 1);
  }, [messages.length, scrollToBottom]);

  const loadOlder = async () => {
    if (loadingOlder || !hasMore) return;
    const firstReal = messages.find(m => !m._tmp);
    if (!firstReal) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el ? el.scrollHeight : 0;
    try {
      const res = await axios.get(url, { params: { before: firstReal.ROWID, limit: PAGE_SIZE }, fresh: true });
      const rows = res.data.data || [];
      stickRef.current = false;
      setMessages(prev => mergeMessages(prev, rows, myId));
      setHasMore(!!res.data.has_more);
      // keep the viewport anchored on the message the user was reading
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } catch (e) {
      toast.error('Could not load older messages');
    } finally {
      setLoadingOlder(false);
    }
  };

  // ── sending (optimistic) ────────────────────────────────────────────────────
  const settleTemp = (tempId, row) => {
    setMessages(prev => {
      const without = prev.filter(m => m.ROWID !== tempId);
      return row ? mergeMessages(without, [row], myId) : without;
    });
  };

  const postText = async (tempId, msg) => {
    try {
      const res = await axios.post(url, { message: msg });
      settleTemp(tempId, res.data?.data);
      pingStream('msg', res.data?.data?.ROWID);
    } catch (e) {
      setMessages(prev => prev.map(m => (m.ROWID === tempId ? { ...m, _failed: true } : m)));
    }
  };

  const sendText = () => {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    const tempId = `tmp-${Date.now()}-${tmpSeq.current++}`;
    stickRef.current = true;
    setMessages(prev => [...prev, {
      ROWID: tempId, _tmp: true, sender_id: myId, sender_name: 'You',
      message: msg, message_type: 'text', created_time: utcNow(), read_by: myId,
    }]);
    postText(tempId, msg);
  };

  const retrySend = (m) => {
    setMessages(prev => prev.map(x => (x.ROWID === m.ROWID ? { ...x, _failed: false } : x)));
    postText(m.ROWID, m.message);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast.warning('File must be under 10MB'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', '');
      const res = await axios.post(`${url}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      stickRef.current = true;
      if (res.data?.data) setMessages(prev => mergeMessages(prev, [res.data.data], myId));
      pingStream('msg', res.data?.data?.ROWID);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  };

  const manualRefresh = () => { idleRef.current = 0; errRef.current = 0; loadInitial(); };

  // Group by day once per change, not on every keystroke.
  const grouped = useMemo(() => {
    const out = [];
    let cur = null;
    messages.forEach(msg => {
      const label = dayLabel(msg.created_time);
      if (!cur || cur.label !== label) { cur = { label, msgs: [] }; out.push(cur); }
      cur.msgs.push(msg);
    });
    return out;
  }, [messages]);

  return (
    <div className="team-chat">
      <Toast toasts={toasts} removeToast={removeToast} />
      <div className="chat-header">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            {team.name} — Group Chat
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {members.length} members · {live ? '● Live' : 'Live updates off — use refresh'}
          </div>
        </div>
        <button className="nav-icon-btn" onClick={manualRefresh} title="Refresh" style={{ flexShrink: 0 }}>
          <RiRefreshLine size={16} />
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <div className="chat-empty">
            <div className="chat-spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
            <p>Loading messages...</p>
          </div>
        ) : loadError ? (
          <div className="chat-empty">
            <p>Couldn't load messages.</p>
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={manualRefresh}>Try again</button>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div style={{ fontSize: 36, marginBottom: 10 }}><RiSendPlaneLine size={36} /></div>
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <button className="btn btn-secondary" onClick={loadOlder} disabled={loadingOlder}>
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {grouped.map(g => (
              <div key={g.label + g.msgs[0].ROWID}>
                <div className="chat-date-divider"><span>{g.label}</span></div>
                {g.msgs.map(msg => (
                  <MessageBubble
                    key={msg.ROWID}
                    msg={msg}
                    isMe={String(msg.sender_id) === myId}
                    currentUserId={myId}
                    onRetry={retrySend}
                  />
                ))}
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <button
          className="chat-attach-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach file (max 10MB)"
        >
          {uploading ? <div className="chat-spinner" style={{ width: 18, height: 18 }} /> : <RiAttachmentLine size={20} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
          onChange={handleFileSelect}
        />
        <textarea
          className="chat-input"
          placeholder="Type a message... (Enter to send)"
          value={text}
          maxLength={4000}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className="chat-send-btn" onClick={sendText} disabled={!text.trim()}>
          <RiSendPlaneLine size={18} />
        </button>
      </div>
    </div>
  );
};

export default TeamChat;
