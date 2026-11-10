import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from '../services/api';
import Toast, { useToast } from './Toast';
import {
  RiSendPlaneLine, RiFileLine, RiRefreshLine, RiEmotionLine,
  RiArrowDownSLine, RiCloseLine, RiTeamFill, RiReplyLine, RiChat3Line, RiPushpinFill,
  RiPushpinLine, RiFileCopyLine, RiDeleteBinLine, RiEyeLine, RiBarChart2Line, RiAddCircleLine,
  RiBold, RiItalic, RiStrikethrough, RiCodeLine, RiCodeBoxLine, RiDoubleQuotesL, RiListUnordered,
  RiListOrdered, RiFontSize, RiImageAddLine,
} from 'react-icons/ri';
import MessageBubble from './chat/MessageBubble';
import Markdown from './chat/Markdown';
import EmojiPicker from './chat/EmojiPicker';
import PollModal from './chat/PollModal';
import { QUICK_REACTIONS } from './chat/emojiData';
import { buildChatState, previewOf, isContent } from './chat/chatModel';
import { subscribe, onLiveChange, isLive } from '../services/realtime';
import {
  API, STREAM_API, cmpMsg, stampOf, rewind, utcNow, sortMessages, mergeMessages, groupByDay,
  formatFileSize, wrapSelection, prefixLines,
} from './chat/chatUtils';

const PAGE_SIZE        = 80;
const FOCUS_REFETCH_MS = 60000; // re-check at most once a minute when returning to the tab
const MAX_FILE_BYTES   = 10 * 1024 * 1024;
const MAX_ONCE_BYTES   = 5 * 1024 * 1024;

const TeamChat = ({ team, currentUser, members }) => {
  const teamId = String(team.ROWID);
  const myId   = String(currentUser.user_id);
  const isAdminUser = /admin/i.test(currentUser?.role_details?.role_name || '');

  const [messages, setMessages]         = useState([]);
  const [text, setText]                 = useState('');
  const [uploading, setUploading]       = useState(false);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive]                 = useState(false);
  const [showEmoji, setShowEmoji]       = useState(false);
  const [staged, setStaged]             = useState(null);   // { file, preview, caption, once } awaiting send
  const [dragOver, setDragOver]         = useState(false);
  const [atBottom, setAtBottom]         = useState(true);
  const [seenId, setSeenId]             = useState(null);   // newest message the user has actually seen
  const [viewer, setViewer]             = useState(null);   // { src, name } image lightbox
  const [menu, setMenu]                 = useState(null);   // { id, x, y, mode, more }
  const [delTarget, setDelTarget]       = useState(null);   // item awaiting delete confirmation
  const [pollOpen, setPollOpen]         = useState(false);
  const [replyToId, setReplyToId]       = useState(null);
  const [onceMode, setOnceMode]         = useState(false);
  const [showFormat, setShowFormat]     = useState(false);
  const [attachOpen, setAttachOpen]     = useState(false);
  const [threadId, setThreadId]         = useState(null);
  const [threadText, setThreadText]     = useState('');
  const [threadEmoji, setThreadEmoji]   = useState(false);
  const [flashId, setFlashId]           = useState(null);
  const [pinIdx, setPinIdx]             = useState(0);
  const [revealView, setRevealView]     = useState(null);   // opened view-once content
  const { toasts, removeToast, toast } = useToast();

  const containerRef  = useRef(null);
  const inputRef      = useRef(null);
  const threadInputRef = useRef(null);
  const threadBodyRef = useRef(null);
  const dragDepth     = useRef(0);
  const scrollRef     = useRef(null);
  const bottomRef     = useRef(null);
  const fileRef       = useRef(null);
  const lastFetchRef  = useRef(0);      // when we last hit the server for messages
  const readTimerRef  = useRef(null);
  const lastTimeRef   = useRef(null);   // created_time of the newest confirmed message we have
  const messagesRef   = useRef([]);     // latest messages, for de-duping inside async sync
  const fetchingRef   = useRef(false);
  const pendingRef    = useRef(false);  // a sync was requested while one was running
  const idleRef       = useRef(0);      // consecutive polls with nothing new
  const errRef        = useRef(0);      // consecutive failed polls
  const liveRef       = useRef(false);
  const stickRef      = useRef(true);   // is the user reading the bottom?
  const tmpSeq        = useRef(0);
  const teamIdRef     = useRef(teamId);
  const syncRef       = useRef(null);
  const flashTimer    = useRef(null);
  messagesRef.current = messages;
  teamIdRef.current   = teamId;

  const url = `${API}/api/teams/${teamId}/messages`;

  // ── members ────────────────────────────────────────────────────────────────
  // id -> display name for "seen by"; otherCount = everyone in the group except me.
  const memberNames = useMemo(() => {
    const map = {};
    (members || []).forEach(m => {
      const id = String(m.user_id);
      if (id !== myId) map[id] = m.name || m.email || 'Member';
    });
    return map;
  }, [members, myId]);
  const otherCount = Object.keys(memberNames).length;
  const mentionNames = useMemo(
    () => (members || []).map(m => m.name).filter(Boolean),
    [members]
  );

  const headerNames = useMemo(() => {
    const others = Object.values(memberNames).sort((a, b) => a.localeCompare(b));
    return others.length ? [...others, 'You'].join(', ') : 'Only you';
  }, [memberNames]);

  // ── derived chat state (messages + folded action events) ───────────────────
  const chat = useMemo(() => buildChatState(messages, myId), [messages, myId]);
  const groups = useMemo(() => groupByDay(chat.items), [chat.items]);
  const threadRoot = threadId ? chat.byId.get(threadId) : null;
  const threadReplies = useMemo(
    () => (threadId ? chat.threads.get(threadId) || [] : []),
    [chat.threads, threadId]
  );
  const replyTo = replyToId ? chat.byId.get(replyToId) : null;

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

  const hasOthersContent = (rows) => rows.some(m => isContent(m) && String(m.sender_id) !== myId);

  // First page (latest messages).
  const loadInitial = useCallback(async () => {
    setLoading(true); setLoadError(false);
    lastFetchRef.current = Date.now();
    try {
      const res = await axios.get(url, { params: { limit: PAGE_SIZE }, fresh: true });
      if (teamIdRef.current !== teamId) return;
      const rows = res.data.data || [];
      lastTimeRef.current = rows.length ? rows[rows.length - 1].created_time : null;
      setMessages(sortMessages(rows));
      setHasMore(!!res.data.has_more);
      stickRef.current = true;
      if (hasOthersContent(rows)) markRead();
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, teamId, myId, markRead]);

  // Incremental fetch: only rows newer than what we already have.
  const sync = useCallback(async () => {
    if (!lastTimeRef.current && !fetchingRef.current) {
      // nothing loaded yet (empty chat or initial failure) — fetch the first page instead
      fetchingRef.current = true;
      lastFetchRef.current = Date.now();
      try {
        const res = await axios.get(url, { params: { limit: PAGE_SIZE }, fresh: true });
        const rows = res.data.data || [];
        if (rows.length) {
          lastTimeRef.current = rows[rows.length - 1].created_time;
          setMessages(prev => mergeMessages(prev, rows, myId));
          setHasMore(!!res.data.has_more);
          idleRef.current = 0;
          if (hasOthersContent(rows)) markRead();
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
      const known = new Set(messagesRef.current.filter(m => !m._tmp).map(m => String(m.ROWID)));
      for (let guard = 0; guard < 10; guard++) {
        const res = await axios.get(url, { params: { after_time: rewind(lastTimeRef.current), limit: PAGE_SIZE }, fresh: true });
        const rows = res.data.data || [];
        // the cursor overlaps on purpose, so only act on rows we haven't seen
        const fresh = rows.filter(m => !known.has(String(m.ROWID)));
        if (fresh.length) {
          fresh.forEach(m => known.add(String(m.ROWID)));
          const newest = fresh.reduce((a, b) => (cmpMsg(a, b) >= 0 ? a : b));
          if (!lastTimeRef.current || String(newest.created_time) > String(lastTimeRef.current)) lastTimeRef.current = newest.created_time;
          setMessages(prev => mergeMessages(prev, fresh, myId));
          idleRef.current = 0;
          if (hasOthersContent(fresh)) markRead();
        } else if (guard === 0) idleRef.current++;
        applyTail(res.data.tail);
        if (rows.length < PAGE_SIZE || !fresh.length) break;
      }
      errRef.current = 0;
    } catch (e) {
      errRef.current = Math.min(errRef.current + 1, 5);
    } finally {
      fetchingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; syncRef.current?.(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, myId, markRead, applyTail]);
  syncRef.current = sync;

  // Load the selected team's chat. No background polling (requests are limited):
  // updates arrive via the stream ping, on send, on tab focus, or manual refresh.
  useEffect(() => {
    lastTimeRef.current = null;
    idleRef.current = 0; errRef.current = 0;
    fetchingRef.current = false; pendingRef.current = false;
    setMessages([]); setHasMore(false);
    setSeenId(null); setAtBottom(true); setShowEmoji(false); setStaged(null);
    setMenu(null); setReplyToId(null); setThreadId(null); setOnceMode(false); setPinIdx(0);
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

  // Live updates come from the app-wide shared socket (services/realtime). The channel only
  // carries content-free pings; messages themselves are fetched through the authenticated API.
  useEffect(() => {
    const setLiveState = (v) => { liveRef.current = v; setLive(v); };
    setLiveState(isLive());
    const offLive = onLiveChange((v) => {
      setLiveState(v);
      if (v && Date.now() - lastFetchRef.current > 10000) syncRef.current?.(); // catch up after a reconnect
    });
    const offPing = subscribe((p) => {
      if (p?.t === 'notif') return; // addressed to the notification bell, not the chat
      if (p?.t === 'read') {
        // someone read the chat: tick my messages locally, zero requests
        if (p.team_id === undefined || String(p.team_id) === teamIdRef.current) {
          const uid = String(p.uid);
          setMessages(prev => prev.map(m => {
            if (String(m.sender_id) !== myId) return m;
            const have = (m.read_by || '').split(',').map(x => x.trim());
            return have.includes(uid) ? m : { ...m, read_by: [m.read_by, uid].filter(Boolean).join(',') };
          }));
        }
        return;
      }
      // new message / reaction / vote / pin (or unparsable ping): fetch only what's newer
      if (!p || String(p.team_id) === teamIdRef.current) syncRef.current?.();
    });
    return () => { offLive(); offPing(); liveRef.current = false; };
  }, [myId]);

  // ── scrolling ───────────────────────────────────────────────────────────────
  const newestId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (!messages[i]._tmp && isContent(messages[i])) return stampOf(messages[i]);
    return null;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = near;
    setAtBottom(near);
    if (near && newestId) setSeenId(newestId);
  };

  useEffect(() => {
    if (messages.length && stickRef.current) {
      scrollToBottom(messages.length > 1);
      if (newestId && !document.hidden) setSeenId(newestId);
    }
  }, [messages.length, newestId, scrollToBottom]);

  // New messages from others that arrived while the user was scrolled up.
  const unseen = useMemo(() => {
    if (!seenId || atBottom) return 0;
    return messages.filter(m => !m._tmp && isContent(m) && String(m.sender_id) !== myId && stampOf(m) > seenId).length;
  }, [messages, seenId, atBottom, myId]);

  // keep the thread panel pinned to its newest reply
  useEffect(() => {
    if (threadBodyRef.current) threadBodyRef.current.scrollTop = threadBodyRef.current.scrollHeight;
  }, [threadId, threadReplies.length]);

  const loadOlder = async () => {
    if (loadingOlder || !hasMore) return;
    const firstReal = messages.find(m => !m._tmp);
    if (!firstReal) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el ? el.scrollHeight : 0;
    try {
      const res = await axios.get(url, { params: { before_time: firstReal.created_time, limit: PAGE_SIZE }, fresh: true });
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

  // Scroll to (and briefly highlight) a message; opens its thread if it lives in one.
  const jumpTo = useCallback((id) => {
    const it = chat.byId.get(String(id));
    if (it?.threadOf) { setThreadId(it.threadOf); return; }
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`);
    if (!el) { toast.info('Scroll up and load older messages to see it'); return; }
    stickRef.current = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    clearTimeout(flashTimer.current);
    setFlashId(String(id));
    flashTimer.current = setTimeout(() => setFlashId(null), 1600);
  }, [chat.byId, toast]);

  // ── sending (optimistic) ────────────────────────────────────────────────────
  const settleTemp = (tempId, row) => {
    setMessages(prev => {
      const without = prev.filter(m => m.ROWID !== tempId);
      return row ? mergeMessages(without, [row], myId) : without;
    });
  };

  // payload: { message, reply_to?, thread_id?, once? }
  const postMessage = async (tempId, payload) => {
    try {
      const res = await axios.post(url, payload);
      settleTemp(tempId, res.data?.data);
      pingStream('msg', res.data?.data?.ROWID);
    } catch (e) {
      const reason = e?.response?.data?.error;
      if (e?.response?.status === 400 && reason) {
        // a hard rejection (e.g. the quoted message was deleted) — retrying would never work
        settleTemp(tempId, null);
        toast.error(reason);
      } else {
        setMessages(prev => prev.map(m => (m.ROWID === tempId ? { ...m, _failed: true } : m)));
      }
    }
  };

  const submitMessage = (payload) => {
    const tempId = `tmp-${Date.now()}-${tmpSeq.current++}`;
    const kind = payload.once ? 'once' : (payload.reply_to || payload.thread_id) ? 'rich' : 'text';
    let body = payload.message;
    if (kind === 'once') body = JSON.stringify({ x: payload.message });
    if (kind === 'rich') {
      body = JSON.stringify({
        x: payload.message,
        ...(payload.reply_to ? { r: String(payload.reply_to) } : {}),
        ...(payload.thread_id ? { th: String(payload.thread_id) } : {}),
      });
    }
    if (!payload.thread_id) stickRef.current = true;
    setMessages(prev => [...prev, {
      ROWID: tempId, _tmp: true, _payload: payload, sender_id: myId, sender_name: 'You',
      message: body, message_type: kind, created_time: utcNow(), read_by: myId,
    }]);
    postMessage(tempId, payload);
  };

  const sendText = () => {
    const msg = text.trim();
    if (!msg) return;
    submitMessage({
      message: msg,
      ...(onceMode ? { once: true } : {}),
      ...(!onceMode && replyToId ? { reply_to: replyToId } : {}),
    });
    setText(''); setReplyToId(null); setOnceMode(false); setShowEmoji(false); setShowFormat(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const sendThreadText = () => {
    const msg = threadText.trim();
    if (!msg || !threadId) return;
    submitMessage({ message: msg, thread_id: threadId });
    setThreadText(''); setThreadEmoji(false);
    if (threadInputRef.current) threadInputRef.current.style.height = 'auto';
  };

  const retrySend = (m) => {
    setMessages(prev => prev.map(x => (x.ROWID === m.ROWID ? { ...x, _failed: false } : x)));
    postMessage(m.ROWID, m._payload || { message: m.message });
  };

  // React / pin / vote / delete: add a pending event locally, confirm with the server.
  const sendEvent = useCallback(async (item, payload) => {
    const tmpId = `tmp-evt-${Date.now()}-${tmpSeq.current++}`;
    const t = String(item.id);
    const body = { o: payload.op, t, ...(payload.e !== undefined ? { e: payload.e } : {}), ...(payload.i ? { i: payload.i } : {}) };
    setMessages(prev => [...prev, {
      ROWID: tmpId, _tmp: true, message_type: 'evt', sender_id: myId, sender_name: 'You',
      message: JSON.stringify(body), created_time: utcNow(), read_by: myId,
    }]);
    try {
      const res = await axios.post(`${url}/${t}/events`, payload);
      setMessages(prev => mergeMessages(prev.filter(m => m.ROWID !== tmpId), res.data?.data ? [res.data.data] : [], myId));
      if (payload.op !== 'delme') pingStream('msg', res.data?.data?.ROWID); // delete-for-me is private
      return true;
    } catch (e) {
      setMessages(prev => prev.filter(m => m.ROWID !== tmpId));
      toast.error(e?.response?.data?.error || 'That did not work. Please try again.');
      return false;
    }
  }, [url, myId, pingStream, toast]);

  const react  = useCallback((item, emoji) => sendEvent(item, { op: 'react', e: emoji }), [sendEvent]);
  const vote   = useCallback((item, picks) => sendEvent(item, { op: 'vote', i: picks }), [sendEvent]);
  const togglePin = (item) => sendEvent(item, { op: item.pinned ? 'unpin' : 'pin' });

  const createPoll = async ({ question, options, multi }) => {
    try {
      const res = await axios.post(`${API}/api/teams/${teamId}/polls`, { question, options, multi });
      stickRef.current = true;
      if (res.data?.data) setMessages(prev => mergeMessages(prev, [res.data.data], myId));
      pingStream('msg', res.data?.data?.ROWID);
      setPollOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not create the poll');
    }
  };

  const reveal = useCallback(async (item) => {
    try {
      const res = await axios.post(`${url}/${item.id}/reveal`, {});
      if (res.data?.event) {
        setMessages(prev => mergeMessages(prev, [res.data.event], myId));
        pingStream('msg', res.data.event.ROWID); // so the sender sees "Opened by …" live
      }
      setRevealView(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not open this message');
      syncRef.current?.(); // pick up the "viewed" event if it was opened elsewhere
    }
  }, [url, myId, toast, pingStream]);

  // ── attachments ─────────────────────────────────────────────────────────────
  // Stage a file (picked, dropped or pasted) so the user can add a caption before sending.
  const stageFile = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast.warning('File must be under 10MB'); return; }
    setStaged(prev => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return {
        file, caption: '', once: false,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      };
    });
  };

  const clearStaged = () => {
    setStaged(prev => { if (prev?.preview) URL.revokeObjectURL(prev.preview); return null; });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    setAttachOpen(false);
    stageFile(file);
  };

  const sendStaged = async () => {
    if (!staged || uploading) return;
    if (staged.once && staged.file.size > MAX_ONCE_BYTES) { toast.warning('View-once photos must be under 5MB'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', staged.file);
      formData.append('caption', staged.caption.trim());
      if (staged.once) formData.append('once', 'true');
      const res = await axios.post(`${url}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      stickRef.current = true;
      if (res.data?.data) setMessages(prev => mergeMessages(prev, [res.data.data], myId));
      pingStream('msg', res.data?.data?.ROWID);
      clearStaged();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (e) => {
    const file = Array.from(e.clipboardData?.files || [])[0];
    if (file) { e.preventDefault(); stageFile(file); }
  };

  // Drag & drop a file anywhere on the chat.
  const onDragEnter = (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth.current++; setDragOver(true); } };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); };
  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0; setDragOver(false);
    stageFile(e.dataTransfer?.files?.[0]);
  };

  // Release the preview blob when the chat unmounts.
  const stagedPreviewRef = useRef(null);
  stagedPreviewRef.current = staged?.preview || null;
  useEffect(() => () => { if (stagedPreviewRef.current) URL.revokeObjectURL(stagedPreviewRef.current); }, []);

  // ── composer helpers ────────────────────────────────────────────────────────
  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const applyEdit = (el, value, setValue, edit) => {
    if (!el) return;
    const r = edit(value, el.selectionStart, el.selectionEnd);
    setValue(r.value.slice(0, 4000));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); autoGrow(el); });
  };

  const FORMATS = {
    bold:   (v, s, e) => wrapSelection(v, s, e, '*'),
    italic: (v, s, e) => wrapSelection(v, s, e, '_'),
    strike: (v, s, e) => wrapSelection(v, s, e, '~'),
    code:   (v, s, e) => wrapSelection(v, s, e, '`'),
    block:  (v, s, e) => wrapSelection(v, s, e, '```\n', '\n```'),
    quote:  (v, s, e) => prefixLines(v, s, e, () => '> '),
    ul:     (v, s, e) => prefixLines(v, s, e, () => '- '),
    ol:     (v, s, e) => prefixLines(v, s, e, (i) => `${i + 1}. `),
  };
  const format = (kind) => applyEdit(inputRef.current, text, setText, FORMATS[kind]);

  const handleKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); format('bold'); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); format('italic'); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); format('code'); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); format('strike'); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
    else if (e.key === 'Escape') { setShowEmoji(false); setAttachOpen(false); if (replyToId) setReplyToId(null); }
  };

  const handleThreadKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendThreadText(); }
    else if (e.key === 'Escape') setThreadEmoji(false);
  };

  const insertEmoji = (emoji) => {
    applyEdit(inputRef.current, text, setText, (v, s, e) => ({ value: v.slice(0, s) + emoji + v.slice(e), start: s + emoji.length, end: s + emoji.length }));
  };
  const insertThreadEmoji = (emoji) => {
    applyEdit(threadInputRef.current, threadText, setThreadText, (v, s, e) => ({ value: v.slice(0, s) + emoji + v.slice(e), start: s + emoji.length, end: s + emoji.length }));
  };

  const manualRefresh = () => { idleRef.current = 0; errRef.current = 0; loadInitial(); };

  // ── message menu ────────────────────────────────────────────────────────────
  const openMenu = useCallback((e, item, mode) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const W = 244, H = 330;
    const x = Math.max(8, Math.min(e.clientX - box.left, box.width - W - 8));
    const y = Math.max(56, Math.min(e.clientY - box.top, box.height - H - 8));
    setMenu({ id: item.id, x, y, mode, more: false });
  }, []);
  const closeMenu = () => setMenu(null);
  const menuItem = menu ? chat.byId.get(menu.id) : null;

  const copyText = async (item) => {
    const value = item.kind === 'poll' ? item.meta?.q || '' : item.text || '';
    try { await navigator.clipboard.writeText(value); toast.success('Copied'); } catch (e) { toast.error('Could not copy'); }
  };

  const confirmDelete = async (everyone) => {
    const item = delTarget;
    setDelTarget(null);
    if (!item) return;
    if (threadId && item.id === threadId && !everyone) setThreadId(null);
    await sendEvent(item, { op: everyone ? 'del' : 'delme' });
  };

  const openImage = useCallback((src, name) => setViewer({ src, name }), []);
  const openThread = useCallback((item) => { setThreadId(item.id); setThreadEmoji(false); }, []);

  // Esc closes whichever overlay is on top.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (revealView) setRevealView(null);
      else if (viewer) setViewer(null);
      else if (menu) setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, menu, revealView]);

  // shared props for every bubble
  const bubbleProps = {
    myId, memberNames, mentionNames, otherCount, byId: chat.byId,
    onOpenImage: openImage, onMenu: openMenu, onReact: react, onVote: vote, onReveal: reveal,
    onOpenThread: openThread, onJump: jumpTo, onRetry: retrySend,
  };

  const pinnedId = chat.pinned.length ? chat.pinned[pinIdx % chat.pinned.length] : null;
  const pinnedItem = pinnedId ? chat.byId.get(pinnedId) : null;
  const myReaction = menuItem?.reactions?.get(myId)?.e || '';

  return (
    <div
      ref={containerRef}
      className={`team-chat wa ${dragOver ? 'drag-over' : ''} ${threadId ? 'has-thread' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Toast toasts={toasts} removeToast={removeToast} />

      <div className="chat-main">
        <div className="chat-header">
          <div className="chat-group-avatar"><RiTeamFill size={20} /></div>
          <div className="chat-header-text">
            <div className="chat-header-title">{team.name}</div>
            <div className="chat-header-sub" title={headerNames}>{headerNames}</div>
          </div>
          <span className={`chat-live ${live ? 'on' : ''}`} title={live ? 'Receiving messages instantly' : 'Live updates are off — use refresh'}>
            <i /> {live ? 'Live' : 'Offline'}
          </span>
          <button className="chat-icon-btn" onClick={manualRefresh} title="Refresh">
            <RiRefreshLine size={18} />
          </button>
        </div>

        {pinnedItem && (
          <div className="chat-pinbar" role="button" tabIndex={0}
            onClick={() => { jumpTo(pinnedItem.id); setPinIdx(i => i + 1); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { jumpTo(pinnedItem.id); setPinIdx(i => i + 1); } }}
          >
            <RiPushpinFill size={16} />
            <div className="chat-pinbar-text">
              <b>Pinned message{chat.pinned.length > 1 ? ` · ${(pinIdx % chat.pinned.length) + 1} of ${chat.pinned.length}` : ''}</b>
              <span>{previewOf(pinnedItem)}</span>
            </div>
            <button className="chat-icon-btn" title="Unpin" onClick={(e) => { e.stopPropagation(); togglePin(pinnedItem); }}>
              <RiCloseLine size={18} />
            </button>
          </div>
        )}

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
          ) : groups.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon"><RiSendPlaneLine size={30} /></div>
              <p>No messages yet. Say hello to {team.name}!</p>
            </div>
          ) : (
            <div className="chat-col">
              {hasMore && (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <button className="chat-older-btn" onClick={loadOlder} disabled={loadingOlder}>
                    {loadingOlder ? 'Loading…' : 'Load older messages'}
                  </button>
                </div>
              )}
              {groups.map(g => (
                <div key={g.key + g.items[0].it.id}>
                  <div className="chat-date-divider"><span>{g.label}</span></div>
                  {g.items.map(({ it, isFirst, isLast }) => (
                    <MessageBubble
                      key={it.msg.ROWID} item={it}
                      isMe={String(it.msg.sender_id) === myId}
                      isFirst={isFirst} isLast={isLast} mode="main"
                      threadCount={(chat.threads.get(it.id) || []).length}
                      flash={flashId === it.id}
                      {...bubbleProps}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {!atBottom && groups.length > 0 && (
          <button
            className="chat-scroll-btn"
            onClick={() => { stickRef.current = true; scrollToBottom(true); if (newestId) setSeenId(newestId); }}
            title="Jump to latest"
          >
            {unseen > 0 && <span className="chat-unseen">{unseen > 99 ? '99+' : unseen}</span>}
            <RiArrowDownSLine size={22} />
          </button>
        )}

        {dragOver && <div className="chat-drop-hint">Drop a file to send</div>}

        <div className="chat-composer">
        {staged && (
          <div className="chat-staged">
            <button className="chat-staged-close" onClick={clearStaged} disabled={uploading} title="Cancel"><RiCloseLine size={18} /></button>
            {staged.preview
              ? <img src={staged.preview} alt="preview" className="chat-staged-img" />
              : <div className="chat-staged-file"><RiFileLine size={34} /><span>{staged.file.name}</span><em>{formatFileSize(staged.file.size)}</em></div>}
            <div className="chat-staged-fields">
              <input
                className="chat-staged-caption" placeholder="Add a caption…" maxLength={500}
                value={staged.caption}
                onChange={e => setStaged(prev => (prev ? { ...prev, caption: e.target.value } : prev))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendStaged(); } }}
                autoFocus
              />
              {staged.preview && (
                <label className="chat-check small" title="The photo disappears for each person after they open it once">
                  <input type="checkbox" checked={staged.once} onChange={e => setStaged(prev => (prev ? { ...prev, once: e.target.checked } : prev))} />
                  <RiEyeLine size={14} /> View once
                </label>
              )}
            </div>
            <button className="chat-send-btn" onClick={sendStaged} disabled={uploading} title="Send">
              {uploading ? <div className="chat-spinner" style={{ width: 18, height: 18 }} /> : <RiSendPlaneLine size={18} />}
            </button>
          </div>
        )}

        {showEmoji && (
          <>
            <div className="chat-popover-backdrop" onMouseDown={() => setShowEmoji(false)} />
            <div className="chat-popover emoji-pop"><EmojiPicker onPick={insertEmoji} /></div>
          </>
        )}

        {attachOpen && (
          <>
            <div className="chat-popover-backdrop" onMouseDown={() => setAttachOpen(false)} />
            <div className="chat-popover attach-pop">
              <button onClick={() => fileRef.current?.click()}><RiImageAddLine size={18} /> Photo, video or file</button>
              <button onClick={() => { setAttachOpen(false); setPollOpen(true); }}><RiBarChart2Line size={18} /> Poll</button>
              <button onClick={() => { setAttachOpen(false); setOnceMode(true); setReplyToId(null); inputRef.current?.focus(); }}>
                <RiEyeLine size={18} /> View-once message
              </button>
            </div>
          </>
        )}

        {(replyTo || onceMode) && (
          <div className={`chat-compose-ctx ${onceMode ? 'once' : ''}`}>
            {onceMode ? (
              <div className="chat-compose-ctx-text"><b><RiEyeLine size={14} /> View-once message</b><span>Each person can open it a single time.</span></div>
            ) : (
              <div className="chat-compose-ctx-text">
                <b><RiReplyLine size={14} /> Replying to {String(replyTo.msg.sender_id) === myId ? 'yourself' : replyTo.msg.sender_name}</b>
                <span>{previewOf(replyTo)}</span>
              </div>
            )}
            <button className="chat-icon-btn" onClick={() => { setReplyToId(null); setOnceMode(false); }} title="Cancel"><RiCloseLine size={18} /></button>
          </div>
        )}

        {showFormat && (
          <div className="chat-format-bar" role="toolbar" aria-label="Formatting">
            <button title="Bold (Ctrl+B)" onClick={() => format('bold')}><RiBold size={16} /></button>
            <button title="Italic (Ctrl+I)" onClick={() => format('italic')}><RiItalic size={16} /></button>
            <button title="Strikethrough (Ctrl+Shift+X)" onClick={() => format('strike')}><RiStrikethrough size={16} /></button>
            <button title="Inline code (Ctrl+E)" onClick={() => format('code')}><RiCodeLine size={16} /></button>
            <button title="Code block" onClick={() => format('block')}><RiCodeBoxLine size={16} /></button>
            <span className="sep" />
            <button title="Quote" onClick={() => format('quote')}><RiDoubleQuotesL size={16} /></button>
            <button title="Bulleted list" onClick={() => format('ul')}><RiListUnordered size={16} /></button>
            <button title="Numbered list" onClick={() => format('ol')}><RiListOrdered size={16} /></button>
          </div>
        )}

        <div className="chat-input-bar">
          <button className="chat-attach-btn" onClick={() => { setShowEmoji(v => !v); setAttachOpen(false); }} title="Emoji">
            <RiEmotionLine size={22} />
          </button>
          <button className="chat-attach-btn" onClick={() => { setAttachOpen(v => !v); setShowEmoji(false); }} disabled={uploading} title="Attach, poll or view-once">
            <RiAddCircleLine size={22} />
          </button>
          <button className={`chat-attach-btn ${showFormat ? 'active' : ''}`} onClick={() => setShowFormat(v => !v)} title="Formatting">
            <RiFontSize size={20} />
          </button>
          <input
            ref={fileRef} type="file" style={{ display: 'none' }}
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
            onChange={handleFileSelect}
          />
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={onceMode ? 'Type a view-once message' : 'Type a message'}
            value={text}
            maxLength={4000}
            onChange={e => { setText(e.target.value); autoGrow(e.target); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
          />
          <button className="chat-send-btn" onClick={sendText} disabled={!text.trim()} title="Send">
            <RiSendPlaneLine size={20} />
          </button>
        </div>
        </div>
      </div>

      {threadId && (
        <aside className="chat-thread" aria-label="Thread">
          <div className="chat-thread-head">
            <div className="chat-thread-title">
              <b><RiChat3Line size={16} /> Thread</b>
              <span>{threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}</span>
            </div>
            <button className="chat-icon-btn" onClick={() => setThreadId(null)} title="Close thread"><RiCloseLine size={20} /></button>
          </div>

          <div className="chat-thread-body" ref={threadBodyRef}>
            {threadRoot ? (
              <MessageBubble
                key={`root-${threadRoot.msg.ROWID}`} item={threadRoot}
                isMe={String(threadRoot.msg.sender_id) === myId} isFirst isLast mode="thread"
                threadCount={0} flash={false} {...bubbleProps}
              />
            ) : <div className="chat-thread-gone">The original message isn't available.</div>}
            {threadReplies.length > 0 && <div className="chat-thread-div"><span>{threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}</span></div>}
            {groupByDay(threadReplies).flatMap(g => g.items).map(({ it, isFirst, isLast }) => (
              <MessageBubble
                key={it.msg.ROWID} item={it} isMe={String(it.msg.sender_id) === myId}
                isFirst={isFirst} isLast={isLast} mode="thread" threadCount={0} flash={flashId === it.id}
                {...bubbleProps}
              />
            ))}
          </div>

          {threadEmoji && (
            <>
              <div className="chat-popover-backdrop" onMouseDown={() => setThreadEmoji(false)} />
              <div className="chat-popover emoji-pop thread-emoji"><EmojiPicker onPick={insertThreadEmoji} /></div>
            </>
          )}
          <div className="chat-input-bar thread-input">
            <button className="chat-attach-btn" onClick={() => setThreadEmoji(v => !v)} title="Emoji"><RiEmotionLine size={21} /></button>
            <textarea
              ref={threadInputRef} className="chat-input" rows={1} maxLength={4000}
              placeholder="Reply in thread" value={threadText}
              onChange={e => { setThreadText(e.target.value); autoGrow(e.target); }}
              onKeyDown={handleThreadKeyDown}
            />
            <button className="chat-send-btn" onClick={sendThreadText} disabled={!threadText.trim()} title="Send reply"><RiSendPlaneLine size={19} /></button>
          </div>
        </aside>
      )}

      {menu && menuItem && (
        <>
          <div className="chat-popover-backdrop" onMouseDown={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div className="chat-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            <div className="chat-menu-reacts">
              {QUICK_REACTIONS.map(e => (
                <button key={e} className={myReaction === e ? 'on' : ''} onClick={() => { react(menuItem, myReaction === e ? '' : e); closeMenu(); }}>{e}</button>
              ))}
              <button className="more" title="More reactions" onClick={() => setMenu(m => ({ ...m, more: !m.more }))}>＋</button>
            </div>
            {menu.more ? (
              <EmojiPicker onPick={(e) => { react(menuItem, e); closeMenu(); }} />
            ) : (
              <>
                {menu.mode === 'main' && !menuItem.kind.startsWith('once') && (
                  <button role="menuitem" onClick={() => { setReplyToId(menuItem.id); setOnceMode(false); closeMenu(); inputRef.current?.focus(); }}>
                    <RiReplyLine size={17} /> Reply
                  </button>
                )}
                {menu.mode === 'main' && !menuItem.kind.startsWith('once') && (
                  <button role="menuitem" onClick={() => { openThread(menuItem); closeMenu(); }}>
                    <RiChat3Line size={17} /> Reply in thread
                  </button>
                )}
                <button role="menuitem" onClick={() => { togglePin(menuItem); closeMenu(); }}>
                  {menuItem.pinned ? <><RiPushpinLine size={17} /> Unpin</> : <><RiPushpinFill size={17} /> Pin message</>}
                </button>
                {(menuItem.text || menuItem.kind === 'poll') && !menuItem.kind.startsWith('once') && (
                  <button role="menuitem" onClick={() => { copyText(menuItem); closeMenu(); }}>
                    <RiFileCopyLine size={17} /> Copy
                  </button>
                )}
                <button role="menuitem" className="danger" onClick={() => { setDelTarget(menuItem); closeMenu(); }}>
                  <RiDeleteBinLine size={17} /> Delete
                </button>
              </>
            )}
          </div>
        </>
      )}

      {delTarget && (
        <div className="chat-modal-overlay" onMouseDown={() => setDelTarget(null)}>
          <div className="chat-modal small" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Delete message">
            <div className="chat-modal-head"><h3>Delete message?</h3></div>
            <p className="chat-modal-note">{previewOf(delTarget)}</p>
            <div className="chat-del-actions">
              {(String(delTarget.msg.sender_id) === myId || isAdminUser) && (
                <button className="danger" onClick={() => confirmDelete(true)}>Delete for everyone</button>
              )}
              <button onClick={() => confirmDelete(false)}>Delete for me</button>
              <button className="ghost" onClick={() => setDelTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {pollOpen && <PollModal onClose={() => setPollOpen(false)} onCreate={createPoll} />}

      {revealView && (
        <div className="chat-lightbox once" onClick={() => setRevealView(null)}>
          <button className="chat-lightbox-close" onClick={() => setRevealView(null)} title="Close"><RiCloseLine size={26} /></button>
          {revealView.kind === 'image'
            ? <img src={revealView.dataUrl} alt="view once" onClick={(e) => e.stopPropagation()} />
            : <div className="once-text" onClick={(e) => e.stopPropagation()}><Markdown text={revealView.text || ''} /></div>}
          {revealView.caption && <div className="chat-lightbox-name">{revealView.caption}</div>}
          <div className="once-note"><RiEyeLine size={14} /> View-once — it can't be opened again once you close this.</div>
        </div>
      )}

      {viewer && (
        <div className="chat-lightbox" onClick={() => setViewer(null)}>
          <button className="chat-lightbox-close" onClick={() => setViewer(null)} title="Close"><RiCloseLine size={26} /></button>
          <img src={viewer.src} alt={viewer.name || 'image'} onClick={e => e.stopPropagation()} />
          {viewer.name && <div className="chat-lightbox-name">{viewer.name}</div>}
        </div>
      )}
    </div>
  );
};

export default TeamChat;
