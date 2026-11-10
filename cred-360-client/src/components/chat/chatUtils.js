// Small, framework-free helpers shared by the chat components.

export const API = '/server/cred_360_function';
// Node 22 function that owns the Data Streams channel (socket tokens + pings)
export const STREAM_API = '/server/cred_360_stream_function';

export const toDate = (t) => (t ? new Date(String(t).replace(' ', 'T') + 'Z') : null);

export const formatTime = (t) => {
  const d = toDate(t);
  return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

export const dayKey = (t) => {
  const d = toDate(t);
  return d && !isNaN(d) ? d.toDateString() : 'unknown';
};

// WhatsApp-style day pill: Today / Yesterday / weekday (this week) / full date.
export const dayLabel = (t) => {
  const d = toDate(t);
  if (!d || isNaN(d)) return 'Unknown';
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
};

// Consecutive messages from one sender within this window form a cluster.
export const CLUSTER_MS = 5 * 60 * 1000;

// Stable per-person accent colour (sender name + avatar), like WhatsApp groups.
const NAME_COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae', '#e5ca77'];
export const colorFor = (id) => {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
};

// 1–6 emoji and nothing else → render big, no bubble clutter.
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|️|‍|\s)+$/u;
export const isEmojiOnly = (t) => {
  const s = String(t || '').trim();
  return !!s && EMOJI_ONLY_RE.test(s) && Array.from(s.replace(/\s/g, '')).length <= 6;
};

export const formatFileSize = (bytes) => {
  const b = parseInt(bytes, 10);
  if (!b) return '';
  if (b < 1024)        return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

// ROWIDs are ~17-digit numbers (beyond Number precision) — compare as strings.
export const cmpId = (a, b) => {
  a = String(a); b = String(b);
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
};

// Catalyst ROWIDs are NOT monotonic in insertion time, so order/sync by created_time and use
// the millisecond CREATEDTIME (then ROWID) only to break ties within the same second.
export const cmpMsg = (a, b) => {
  const ta = String(a.created_time || ''), tb = String(b.created_time || '');
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ca = String(a.CREATEDTIME || ''), cb = String(b.CREATEDTIME || '');
  return ca !== cb ? (ca < cb ? -1 : 1) : cmpId(a.ROWID, b.ROWID);
};

export const stampOf = (m) => `${m.created_time || ''}|${String(m.ROWID).padStart(20, '0')}`;

// Rewind the sync cursor a little: a row's timestamp is set before its insert commits, so a
// slightly earlier-stamped row can land after a later one. Duplicates are dropped by ROWID.
const CURSOR_OVERLAP_S = 5;
export const rewind = (t) => {
  const d = toDate(t);
  return d && !isNaN(d) ? new Date(d.getTime() - CURSOR_OVERLAP_S * 1000).toISOString().slice(0, 19).replace('T', ' ') : t;
};

export const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Confirmed messages in time order first, then still-pending optimistic ones.
export const sortMessages = (list) => {
  const real = list.filter(m => !m._tmp).sort(cmpMsg);
  const tmp  = list.filter(m => m._tmp);
  return [...real, ...tmp];
};

// Merge server rows into the list without duplicates; settle matching optimistic text sends.
export const mergeMessages = (prev, incoming, myId) => {
  const have = new Set(prev.filter(m => !m._tmp).map(m => String(m.ROWID)));
  const fresh = incoming.filter(m => !have.has(String(m.ROWID)));
  if (!fresh.length) return prev;
  const mineText = fresh.filter(m => String(m.sender_id) === myId && m.message_type === 'text');
  const base = mineText.length
    ? prev.filter(t => !(t._tmp && !t._failed && t.message_type === 'text' && mineText.some(m => m.message === t.message)))
    : prev;
  return sortMessages([...base, ...fresh]);
};

// Day-group a list of decorated items and mark clusters (same sender, close in time):
// the first bubble of a cluster shows the name + tail, the last one shows the avatar.
export function groupByDay(items) {
  const out = [];
  let cur = null;
  items.forEach(it => {
    const key = dayKey(it.msg.created_time);
    if (!cur || cur.key !== key) { cur = { key, label: dayLabel(it.msg.created_time), items: [] }; out.push(cur); }
    cur.items.push(it);
  });
  const close = (a, b) => {
    const ta = toDate(a.msg.created_time), tb = toDate(b.msg.created_time);
    return String(a.msg.sender_id) === String(b.msg.sender_id) && ta && tb && Math.abs(tb - ta) < CLUSTER_MS;
  };
  out.forEach(g => {
    g.items = g.items.map((it, i) => ({
      it,
      isFirst: i === 0 || !close(g.items[i - 1], it),
      isLast:  i === g.items.length - 1 || !close(it, g.items[i + 1]),
    }));
  });
  return out;
}

// ── composer formatting (markdown toolbar / shortcuts) ────────────────────────
// Each returns { value, start, end } so the caller can restore the selection.
export function wrapSelection(value, start, end, open, close = open) {
  const sel = value.slice(start, end);
  // already wrapped → unwrap
  if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  const next = value.slice(0, start) + open + sel + close + value.slice(end);
  return sel
    ? { value: next, start, end: end + open.length + close.length }
    : { value: next, start: start + open.length, end: start + open.length }; // caret between the markers
}

export function prefixLines(value, start, end, prefixFor) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const lines = value.slice(lineStart, lineEnd).split('\n').map((l, i) => prefixFor(i) + l);
  const block = lines.join('\n');
  return { value: value.slice(0, lineStart) + block + value.slice(lineEnd), start: lineStart, end: lineStart + block.length };
}
