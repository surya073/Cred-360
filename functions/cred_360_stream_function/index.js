'use strict';

// Data Streams gateway for team chat. Runs on Node 22 because @zcatalyst/datastreams requires it;
// the main API function stays on Node 18.
//
// SECURITY: the channel is shared by every subscriber, so only content-free pings go through it
// ({t, team_id, id|uid}). Message bodies are always fetched via the authenticated REST API.

const express  = require('express');
const catalyst = require('zcatalyst-sdk-node');
const { CHANNEL } = require('./stream-config');

let DataStreamsAdmin = null, ZCAuth = null, loadError = null;
try {
  ({ DataStreams: DataStreamsAdmin } = require('@zcatalyst/datastreams')); // Node build: 'DataStreams' is the admin class (publishData, getAllChannels)
  ({ ZCAuth } = require('@zcatalyst/auth-admin'));
} catch (e) {
  loadError = e.message;
}

const app = express();
app.use(express.json({ limit: '4kb' }));

const ID_RE = /^\d{1,20}$/;
const ADMIN_ROLE = 'App Administrator';

// Admin scope: Data Streams (token pairs + publish) is not allowed with an end-user token
// ("invalid oauth scope"). The caller is authenticated and authorised separately below.
const streamsFor = (req) => new DataStreamsAdmin(new ZCAuth().init(req, { type: 'advancedio', scope: 'admin' }));

async function currentUser(req, catalystApp) {
  try { return await catalystApp.userManagement().getCurrentUser(); } catch { return null; }
}

async function isTeamMember(catalystApp, user, teamId) {
  if (user?.role_details?.role_name === ADMIN_ROLE) return true;
  const rows = await catalystApp.zcql().executeZCQLQuery(
    `SELECT ROWID FROM TeamMembers WHERE team_id = '${teamId}' AND user_id = '${user.user_id}' LIMIT 1`
  ).catch(() => []);
  return rows.length > 0;
}

// tiny per-instance limiter: 60 pings / minute / user
const hits = new Map();
const limited = (userId) => {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(userId, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 60;
};

// Connection details for the browser WebSocket client.
app.get('/api/chat/stream', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await currentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!DataStreamsAdmin) return res.json({ success: true, enabled: false, reason: loadError || 'sdk unavailable' });

    try {
      const tokens = await streamsFor(req).getTokenPair(CHANNEL, { userId: String(user.user_id) });
      return res.json({ success: true, enabled: true, tokens });
    } catch (e) {
      console.log('getTokenPair failed:', e.message);
      // Help diagnose a wrong channel name: list what exists.
      let channels;
      try { channels = (await streamsFor(req).getAllChannels()).map(c => ({ id: c.id, name: c.name })); } catch { /* ignore */ }
      return res.json({ success: true, enabled: false, reason: e.message, configured: CHANNEL, channels });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Notify subscribers that something changed in a team. Caller must belong to that team.
app.post('/api/ping', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await currentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!DataStreamsAdmin) return res.json({ success: false, reason: loadError || 'sdk unavailable' });

    const teamId = String(req.body?.team_id ?? '');
    const t = req.body?.t === 'read' ? 'read' : 'msg';
    const id = String(req.body?.id ?? '');
    if (!ID_RE.test(teamId) || (id && !ID_RE.test(id))) {
      return res.status(400).json({ success: false, error: 'Invalid ping' });
    }
    if (limited(String(user.user_id))) return res.status(429).json({ success: false, error: 'Slow down' });
    if (!(await isTeamMember(catalystApp, user, teamId))) {
      return res.status(403).json({ success: false, error: 'Not a member of this team' });
    }

    const payload = { t, team_id: teamId, uid: String(user.user_id) };
    if (id) payload.id = id;
    await streamsFor(req).publishData(CHANNEL, JSON.stringify(payload));
    res.json({ success: true });
  } catch (e) {
    console.log('ping failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = app;
