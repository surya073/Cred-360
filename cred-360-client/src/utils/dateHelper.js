// Single place for every date/time the UI shows.
//  - Server timestamps are UTC strings ("YYYY-MM-DD HH:mm:ss[:SSS]").
//  - Everything is displayed in the user's chosen time zone (Settings → Region),
//    defaulting to Indian Standard Time (Asia/Kolkata).
//  - Date-range filters use "YYYY-MM-DD" strings interpreted in that same zone.

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const STORAGE_KEY = 'ks_timezone';
const LOCALE = 'en-IN';

let currentTz = DEFAULT_TIMEZONE;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && isValidTimeZone(saved)) currentTz = saved;
} catch (e) { /* storage unavailable – keep default */ }

function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat(LOCALE, { timeZone: tz }); return true; }
  catch (e) { return false; }
}

export const getTimeZone = () => currentTz;

export const setTimeZone = (tz) => {
  if (!isValidTimeZone(tz)) return false;
  currentTz = tz;
  try { localStorage.setItem(STORAGE_KEY, tz); } catch (e) { /* ignore */ }
  return true;
};

// ── Parsing ────────────────────────────────────────────────────────────────
export const parseServerDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value === 'number') return new Date(value);
  const s = String(value).trim();
  // "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm:ss:SSS" → UTC
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:[:.](\d{1,3}))?$/);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), +(m[7] || 0)));
  }
  const d = new Date(s); // ISO with offset / Z, or date-only
  return isNaN(d) ? null : d;
};

// ── Formatting (all in the active time zone) ───────────────────────────────
const fmt = (opts, d) => new Intl.DateTimeFormat(LOCALE, { timeZone: currentTz, ...opts }).format(d);

export const formatDate = (value, fallback = '—') => {
  const d = parseServerDate(value);
  return d ? fmt({ day: '2-digit', month: 'short', year: 'numeric' }, d) : fallback;
};

export const formatTime = (value, fallback = '—') => {
  const d = parseServerDate(value);
  return d ? fmt({ hour: '2-digit', minute: '2-digit', hour12: true }, d).toUpperCase() : fallback;
};

export const formatDateTime = (value, fallback = '—') => {
  const d = parseServerDate(value);
  if (!d) return fallback;
  return `${formatDate(d)}, ${formatTime(d)}`;
};

export const formatRelative = (value, fallback = '—') => {
  const d = parseServerDate(value);
  if (!d) return fallback;
  const diff = Date.now() - d.getTime();
  if (diff < 0) return formatDate(d);
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
};

// "YYYY-MM-DD" of the instant, as seen in the active time zone.
export const dateKey = (value) => {
  const d = parseServerDate(value);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: currentTz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return parts; // en-CA → YYYY-MM-DD
};

export const todayKey = () => dateKey(new Date());

// from/to are "YYYY-MM-DD" (either may be empty). Inclusive on both ends.
export const inDateRange = (value, from, to) => {
  if (!from && !to) return true;
  const k = dateKey(value);
  if (!k) return false;
  if (from && k < from) return false;
  if (to && k > to) return false;
  return true;
};

// ── Time-zone list for Settings ────────────────────────────────────────────
const FALLBACK_ZONES = [
  'Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Africa/Johannesburg', 'Pacific/Auckland',
];

export const offsetLabel = (tz, at = new Date()) => {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at).find(x => x.type === 'timeZoneName');
    const v = (p?.value || 'GMT').replace('GMT', '') || '+00:00';
    return v === '' ? 'GMT+00:00' : `GMT${v}`;
  } catch (e) { return 'GMT'; }
};

export const listTimeZones = () => {
  let zones = FALLBACK_ZONES;
  try {
    if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone');
  } catch (e) { /* use fallback */ }
  if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  const now = new Date();
  return zones.map(tz => ({
    value: tz,
    region: tz.includes('/') ? tz.split('/')[0] : 'Other',
    label: `${tz.replace(/_/g, ' ')} (${offsetLabel(tz, now)})`,
  }));
};

// ── Local day range → UTC bounds (for server-side date filters) ────────────
const tzOffsetMs = (utcMs, tz) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
};

// UTC instant of "YYYY-MM-DD hh:mm:ss" wall-clock time in the active zone.
const zonedToUtcMs = (key, h, m, s) => {
  const [y, mo, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m, s);
  let ms = guess - tzOffsetMs(guess, currentTz);
  ms = guess - tzOffsetMs(ms, currentTz); // second pass settles DST edges
  return ms;
};

const toServerString = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// { from, to } as "YYYY-MM-DD HH:mm:ss" UTC strings; empty string when unset.
export const dayRangeUtc = (fromKey, toKey) => ({
  from: fromKey ? toServerString(zonedToUtcMs(fromKey, 0, 0, 0))   : '',
  to:   toKey   ? toServerString(zonedToUtcMs(toKey, 23, 59, 59))  : '',
});
