'use strict';

const { ROLE_MAP } = require('./constants');

async function getCurrentUser(req, catalystApp) {
  try { return await catalystApp.userManagement().getCurrentUser(); }
  catch { return null; }
}

// App-level role ('Admin' | 'Team Lead' | 'Employee' | 'Intern') for a Catalyst user.
// Catalyst names the admin role "App Administrator"; never compare against 'Admin' directly.
function appRole(user) {
  return ROLE_MAP[user?.role_details?.role_name] || 'Employee';
}

function isAdmin(user) {
  return appRole(user) === 'Admin';
}

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function logActivity(catalystApp, fields) {
  catalystApp.datastore().table('ActivityLogs')
    .insertRow({ ...fields, created_time: now() })
    .catch(e => console.log('ActivityLog error:', e.message));
}

function checkStrength(password) {
  if (!password) return 'weak';
  let score = 0;
  if (password.length >= 8)          score++;
  if (password.length >= 12)         score++;
  if (/[A-Z]/.test(password))        score++;
  if (/[a-z]/.test(password))        score++;
  if (/[0-9]/.test(password))        score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 2) return 'weak';
  if (score <= 4) return 'moderate';
  return 'strong';
}

function mapBy(arr, keyFn) {
  const m = {};
  arr.forEach(item => { m[String(keyFn(item))] = item; });
  return m;
}

function escapeLike(str) {
  return (str || '').replace(/'/g, "''");
}

function extractDomain(email) {
  const parts = (email || '').split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : '';
}

function upsertExternalUser(catalystApp, rawEmail, sharedByUserId) {
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email) return;

  const zcql  = catalystApp.zcql();
  const table = catalystApp.datastore().table('ExternalUsers');

  zcql.executeZCQLQuery(`SELECT ROWID FROM ExternalUsers WHERE email = '${email}'`)
    .catch(() => [])
    .then(async existing => {
      if (existing.length > 0) {
        const row = existing[0].ExternalUsers || existing[0];
        return table.updateRow({ ROWID: row.ROWID, last_shared_time: now() });
      }
      return table.insertRow({
        name: '', email, domain: extractDomain(email), company: '',
        status: 'active', first_shared_time: now(), last_shared_time: now(),
        created_by: String(sharedByUserId), notes: '',
      });
    })
    .catch(e => {
      if (e.message?.toLowerCase().includes('duplicate') ||
          e.message?.toLowerCase().includes('unique')) {
        zcql.executeZCQLQuery(`SELECT ROWID FROM ExternalUsers WHERE email = '${email}'`)
          .then(rows => {
            if (rows.length) {
              const row = rows[0].ExternalUsers || rows[0];
              table.updateRow({ ROWID: row.ROWID, last_shared_time: now() }).catch(() => {});
            }
          }).catch(() => {});
      } else {
        console.log('ExternalUsers upsert error:', e.message);
      }
    });
}

async function isExternalUserBlocked(catalystApp, rawEmail) {
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email) return false;
  const rows = await catalystApp.zcql().executeZCQLQuery(
    `SELECT status FROM ExternalUsers WHERE email = '${email}'`
  ).catch(() => []);
  if (!rows.length) return false;
  return (rows[0].ExternalUsers || rows[0]).status === 'blocked';
}

async function pushNotification(catalystApp, {
  event_type, recipient_type, recipient_id, ref_id = '',
  ref_name = '', actor_id = '', actor_name = '', details = '', title = ''
}) {
  try {
    await catalystApp.datastore().table('NotificationEvents').insertRow({
      event_type, recipient_type, recipient_id: String(recipient_id),
      ref_id: String(ref_id), ref_name, actor_id: String(actor_id),
      actor_name, details, title, created_time: now(),
    });
  } catch (e) {
    console.log('pushNotification error:', e.message);
  }
}

// ── Short-lived user-directory cache ─────────────────────────────────────────
// getAllUsers() and the Users profile-image scan are full-table reads that nearly every
// list endpoint repeats. Cache per function instance for a few seconds and coalesce
// concurrent callers into a single request. Writes that change users call
// invalidateDirectory(). Use the uncached call for admin user lists that must be exact.
const DIR_TTL_MS = 20 * 1000;
let _users = null, _usersExp = 0, _usersP = null;
let _imgs  = null, _imgsExp  = 0, _imgsP  = null;

function getAllUsersCached(catalystApp) {
  if (_users && _usersExp > Date.now()) return Promise.resolve(_users);
  if (_usersP) return _usersP;
  _usersP = catalystApp.userManagement().getAllUsers()
    .then(u => { _users = u; _usersExp = Date.now() + DIR_TTL_MS; return u; })
    .finally(() => { _usersP = null; });
  return _usersP;
}

// { [user_id]: profile_image } — only users that have an image.
function getProfileImagesCached(catalystApp) {
  if (_imgs && _imgsExp > Date.now()) return Promise.resolve(_imgs);
  if (_imgsP) return _imgsP;
  _imgsP = catalystApp.zcql().executeZCQLQuery(`SELECT user_id,profile_image FROM Users`)
    .then(rows => {
      const map = {};
      rows.forEach(r => {
        const u = r.Users || r;
        if (u.user_id && u.profile_image) map[String(u.user_id)] = u.profile_image;
      });
      _imgs = map; _imgsExp = Date.now() + DIR_TTL_MS;
      return map;
    })
    .catch(() => ({}))               // never cache a failure
    .finally(() => { _imgsP = null; });
  return _imgsP;
}

// Same data as getProfileImagesCached, shaped like the raw ZCQL rows existing handlers iterate.
async function getProfileImageRowsCached(catalystApp) {
  const map = await getProfileImagesCached(catalystApp);
  return Object.entries(map).map(([user_id, profile_image]) => ({ user_id, profile_image }));
}

function invalidateDirectory() {
  _users = null; _usersExp = 0;
  _imgs = null;  _imgsExp = 0;
}

// Read every row of a query past ZCQL's 300-row page cap. `baseQuery` must not have LIMIT.
async function selectAll(zcql, baseQuery, pageSize = 300, maxPages = 20) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await zcql.executeZCQLQuery(`${baseQuery} LIMIT ${page * pageSize}, ${pageSize}`);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

module.exports = {
  getCurrentUser,
  appRole,
  isAdmin,
  now,
  logActivity,
  checkStrength,
  mapBy,
  escapeLike,
  extractDomain,
  upsertExternalUser,
  isExternalUserBlocked,
  pushNotification,
  getAllUsersCached,
  getProfileImagesCached,
  getProfileImageRowsCached,
  invalidateDirectory,
  selectAll,
};