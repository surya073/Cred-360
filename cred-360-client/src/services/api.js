// Thin wrapper around axios that removes redundant GET traffic:
//  1. In-flight de-duplication – identical concurrent GETs share one request.
//  2. Short TTL cache – repeat GETs (e.g. /categories, /users, /profile/info that
//     several pages/modals all load) are served from memory.
//  3. Automatic invalidation – any successful write (POST/PUT/PATCH/DELETE) clears
//     the cache so the next read is fresh.
//
// Usage is identical to axios:  api.get(url, config), api.post(url, body) ...
// Pass `{ fresh: true }` in the GET config to force a network call (e.g. refresh buttons).
import axios from 'axios';
import { pingNotify } from './realtime';

const DEFAULT_TTL = 30 * 1000;

// Endpoints that change without the current user acting on them
// (other users' activity) – de-dupe in-flight only, never cache.
const NO_CACHE = [
  /\/messages(\?|$)/,
  /\/chat\/stream/,
  /\/notifications/,
  /\/unread-counts/,
  /\/shares\/validate\//,
  /\/activity-logs/,
  /\/shares\/received/,
  /\/shares\/folders\/received/,
];

const cache    = new Map(); // key -> { expires, data, status, headers }
const inflight = new Map(); // key -> Promise

const keyOf = (url, config = {}) =>
  url + (config.params ? '?' + JSON.stringify(config.params) : '');

// Each consumer gets its own copy so in-place mutation (sort, push…) can't leak.
const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const toResponse = (entry) => ({
  data: clone(entry.data),
  status: entry.status,
  headers: entry.headers,
});

export const clearApiCache = () => cache.clear();

// Local UI preview only (REACT_APP_PREVIEW=1): no backend, so serve demo data.
const PREVIEW = process.env.REACT_APP_PREVIEW === '1';
const previewData = (url) => {
  if (/\/api\/dashboard(\?|$)/.test(url)) {
    return {
      success: true,
      stats: { totalPasswords: 48, sharedPasswords: 17, expiredShares: 3, totalTeams: 4, totalFolders: 9, totalUsers: 22, passwordDelta: 12 },
      recentPasswords: [
        { name: 'Figma', category: 'Design', username: 'alex', url: 'figma.com', strength: 'strong', created_time: '2026-10-28' },
        { name: 'Grammarly', category: 'Tools', username: 'alex', url: 'grammarly.com', strength: 'moderate', created_time: '2026-10-25' },
        { name: 'Blender', category: 'Design', username: 'alex', url: 'blender.org', strength: 'weak', created_time: '2026-10-20' },
        { name: 'GitHub', category: 'Dev', username: 'alex', url: 'github.com', strength: 'strong', created_time: '2026-10-18' },
        { name: 'Slack', category: 'Chat', username: 'alex', url: 'slack.com', strength: 'moderate', created_time: '2026-10-12' },
        { name: 'AWS Console', category: 'Cloud', username: 'alex', url: 'aws.amazon.com', strength: 'strong', created_time: '2026-10-05' },
      ],
      monthlyData: [
        { name: 'Jun', Passwords: 5 }, { name: 'Jul', Passwords: 9 }, { name: 'Aug', Passwords: 4 },
        { name: 'Sep', Passwords: 8 }, { name: 'Oct', Passwords: 14 }, { name: 'Nov', Passwords: 8 },
      ],
      shareTypeData: [{ name: 'User', value: 9 }, { name: 'Team', value: 5 }, { name: 'External', value: 3 }],
      healthData: { score: 82, strong: 30, moderate: 12, weak: 6 },
      teamData: [{ name: 'Engineering', count: 18 }, { name: 'Design', count: 11 }, { name: 'Ops', count: 7 }],
      recommendations: [],
    };
  }
  return null;
};

const get = (url, config = {}) => {
  if (PREVIEW) {
    const mock = previewData(url);
    if (mock) return Promise.resolve({ data: mock, status: 200, headers: {} });
  }
  const { fresh, ttl, ...axiosConfig } = config;
  const key = keyOf(url, axiosConfig);
  const cacheable = !NO_CACHE.some((re) => re.test(url));

  if (!fresh && cacheable) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(toResponse(hit));
  }

  if (inflight.has(key)) return inflight.get(key).then(toResponse);

  const p = axios.get(url, axiosConfig).then((res) => {
    const entry = { data: res.data, status: res.status, headers: res.headers };
    if (cacheable) cache.set(key, { ...entry, expires: Date.now() + (ttl ?? DEFAULT_TTL) });
    return entry;
  });
  inflight.set(key, p);
  const done = () => inflight.delete(key);
  p.then(done, done);
  return p.then(toResponse);
};

// Writes that cannot change anything other pages display (chat traffic, socket pings, read
// receipts). Without this exemption every chat message wiped the whole GET cache and made
// unrelated pages refetch.
const KEEP_CACHE = [/\/teams\/[^/]+\/messages(\/|$)/, /\/api\/ping$/];

const write = (method) => (...args) =>
  axios[method](...args).then((res) => {
    if (!KEEP_CACHE.some((re) => re.test(String(args[0])))) clearApiCache();
    // Actions that notify other people return their user ids; relay a content-free live ping.
    if (Array.isArray(res.data?.notify_to) && res.data.notify_to.length) pingNotify(res.data.notify_to);
    return res;
  });

const api = {
  get,
  post:   write('post'),
  put:    write('put'),
  patch:  write('patch'),
  delete: write('delete'),
};

export default api;
