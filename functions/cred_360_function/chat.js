'use strict';

// Team group chat. Registered onto the main Express app (see index.js).
//
// Data Store table `TeamMessages` (see CHAT_SETUP.md):
//   team_id, sender_id, sender_name, message, message_type, file_id, file_name,
//   file_size, read_by, created_time
//
// Scalability notes
//  - Incremental reads: clients ask for `after=<lastRowId>`, so a poll returns only new rows.
//  - Reads are paged (`limit`, `before`) — never the whole history.
//  - Membership checks are cached briefly per instance to avoid a ZCQL hit per request.
//  - Read receipts are written in one bulk update and only for rows that need it.

const fs      = require('fs');
const crypto  = require('crypto');
const catalyst = require('zcatalyst-sdk-node');
const { getCurrentUser, now, isAdmin } = require('shared-utils/helpers');
const { CHAT_FOLDER_ID } = require('./chat-config');
const streams = require('./streams');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 100;
const MAX_TEXT      = 4000;
const MAX_FILE      = 10 * 1024 * 1024;
const TAIL_SIZE     = 20;
const MEMBER_TTL_MS = 30 * 1000;

const ID_RE = /^\d{1,20}$/;
const unwrap = (r) => r.TeamMessages || r;

// Allowed attachment extensions -> { type, mime }. Anything else is rejected, so HTML/SVG/JS
// can never be uploaded and later served from our origin.
const FILE_TYPES = {
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'], webp: ['image', 'image/webp'],
  mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'], mov: ['video', 'video/quicktime'],
  mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], m4a: ['audio', 'audio/mp4'],
  pdf: ['pdf', 'application/pdf'],
  doc: ['file', 'application/msword'],
  docx: ['file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['file', 'application/vnd.ms-excel'],
  xlsx: ['file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  txt: ['file', 'text/plain'], csv: ['file', 'text/csv'], zip: ['file', 'application/zip'],
};
const INLINE_TYPES = new Set(['image', 'video', 'audio', 'pdf']);

const extOf = (name) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

// ── membership (cached) ───────────────────────────────────────────────────────
const memberCache = new Map(); // `${team}:${user}` -> { ok, exp }

async function canAccessTeam(catalystApp, user, teamId) {
  if (isAdmin(user)) return true;
  const key = `${teamId}:${user.user_id}`;
  const hit = memberCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;

  const rows = await catalystApp.zcql().executeZCQLQuery(
    `SELECT ROWID FROM TeamMembers WHERE team_id = '${teamId}' AND user_id = '${user.user_id}' LIMIT 1`
  ).catch(() => []);
  const ok = rows.length > 0;

  if (memberCache.size > 5000) memberCache.clear();
  memberCache.set(key, { ok, exp: Date.now() + MEMBER_TTL_MS });
  return ok;
}

// Resolve user + team access in one place. Sends the error response itself and returns null.
async function authorize(req, res, catalystApp, teamId) {
  const user = await getCurrentUser(req, catalystApp);
  if (!user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return null; }
  if (!ID_RE.test(String(teamId))) { res.status(400).json({ success: false, error: 'Invalid team' }); return null; }
  if (!(await canAccessTeam(catalystApp, user, teamId))) {
    res.status(403).json({ success: false, error: 'Not a member of this team' });
    return null;
  }
  return user;
}

// Turn Catalyst's vague "Invalid input value for column" into something actionable by
// comparing what we insert against the table's real columns.
async function insertMessage(catalystApp, fields) {
  const table = catalystApp.datastore().table('TeamMessages');
  try {
    return await table.insertRow(fields);
  } catch (e) {
    if (/column/i.test(String(e.message))) {
      try {
        const cols = await table.getAllColumns();
        const have = new Set(cols.map(c => c.column_name));
        const missing = Object.keys(fields).filter(k => !have.has(k));
        if (missing.length) {
          throw new Error(`TeamMessages table is missing column(s): ${missing.join(', ')}`);
        }
      } catch (inner) {
        if (/missing column/.test(inner.message)) throw inner;
      }
    }
    throw e;
  }
}

const senderName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id || 'User';

// ── routes ────────────────────────────────────────────────────────────────────
module.exports = function registerChatRoutes(app) {

  // Stream connection info for the browser. { enabled:false } => client polls instead.
  app.get('/api/chat/stream', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const user = await getCurrentUser(req, catalystApp);
      if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
      res.setHeader('Cache-Control', 'no-store');
      if (!streams.enabled()) return res.json({ success: true, enabled: false });
      const tokens = await streams.tokenPairFor(catalystApp, user.user_id);
      if (!tokens) return res.json({ success: true, enabled: false });
      res.json({ success: true, enabled: true, tokens });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // List messages.
  //   (none)         latest page
  //   ?before=<id>   older page (infinite scroll up)
  //   ?after=<id>    only newer rows (polling / stream ping); also returns `tail`
  app.get('/api/teams/:id/messages', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const after  = req.query.after  !== undefined ? String(req.query.after)  : null;
      const before = req.query.before !== undefined ? String(req.query.before) : null;
      if ((after && !ID_RE.test(after)) || (before && !ID_RE.test(before))) {
        return res.status(400).json({ success: false, error: 'Invalid cursor' });
      }

      const zcql = catalystApp.zcql();
      let rowsP, tailP = Promise.resolve([]);

      if (after) {
        rowsP = zcql.executeZCQLQuery(
          `SELECT * FROM TeamMessages WHERE team_id = '${teamId}' AND ROWID > ${after} ORDER BY ROWID ASC LIMIT ${limit}`);
        // Lets senders see read-ticks update without refetching history.
        tailP = zcql.executeZCQLQuery(
          `SELECT ROWID, read_by FROM TeamMessages WHERE team_id = '${teamId}' AND sender_id = '${user.user_id}' ORDER BY ROWID DESC LIMIT ${TAIL_SIZE}`
        ).catch(() => []);
      } else {
        const cursor = before ? ` AND ROWID < ${before}` : '';
        rowsP = zcql.executeZCQLQuery(
          `SELECT * FROM TeamMessages WHERE team_id = '${teamId}'${cursor} ORDER BY ROWID DESC LIMIT ${limit + 1}`);
      }

      const [rawRows, rawTail] = await Promise.all([rowsP, tailP]);
      let data = rawRows.map(unwrap);
      let hasMore = false;

      if (!after) {
        hasMore = data.length > limit;
        if (hasMore) data = data.slice(0, limit);
        data.reverse(); // oldest -> newest
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        data,
        has_more: hasMore,
        tail: rawTail.map(unwrap).map(r => ({ ROWID: String(r.ROWID), read_by: r.read_by || '' })),
        stream: streams.enabled(),
      });
    } catch (e) {
      console.log('chat list error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Send a text message.
  app.post('/api/teams/:id/messages', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const text = String(req.body?.message ?? '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'Message is empty' });
      if (text.length > MAX_TEXT) {
        return res.status(400).json({ success: false, error: `Message too long (max ${MAX_TEXT} characters)` });
      }

      const row = await insertMessage(catalystApp, {
        team_id: String(teamId),
        sender_id: String(user.user_id),
        sender_name: senderName(user),
        message: text,
        message_type: 'text',
        // file_* columns are omitted for text (an empty string is rejected by non-text column types)
        read_by: String(user.user_id),
        created_time: now(),
      });

      streams.publishPing(catalystApp, { t: 'msg', team_id: String(teamId), id: String(row.ROWID) });
      res.json({ success: true, data: row });
    } catch (e) {
      console.log('chat send error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Send an attachment (optional caption).
  app.post('/api/teams/:id/messages/upload', async (req, res) => {
    const file = req.files?.file;
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      if (!CHAT_FOLDER_ID) {
        return res.status(503).json({ success: false, error: 'File uploads are not configured (CHAT_FOLDER_ID)' });
      }
      if (!file) return res.status(400).json({ success: false, error: 'No file uploaded' });
      if (file.size > MAX_FILE) return res.status(413).json({ success: false, error: 'File must be under 10MB' });

      const ext = extOf(file.name);
      const kind = FILE_TYPES[ext];
      if (!kind) return res.status(400).json({ success: false, error: `File type ".${ext || '?'}" is not allowed` });

      const storedName = `chat_${teamId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const uploaded = await catalystApp.filestore().folder(CHAT_FOLDER_ID).uploadFile({
        code: fs.createReadStream(file.tempFilePath),
        name: storedName,
      });
      const fileId = String(uploaded.id || uploaded.file_id || uploaded.file_details?.id || uploaded.file_details?.file_id);

      const caption = String(req.body?.caption ?? '').trim().slice(0, MAX_TEXT);
      const row = await insertMessage(catalystApp, {
        team_id: String(teamId),
        sender_id: String(user.user_id),
        sender_name: senderName(user),
        message: caption,
        message_type: kind[0],
        file_id: fileId,
        file_name: String(file.name).replace(/[\r\n"\\/]/g, '_').slice(0, 200),
        file_size: String(file.size),
        read_by: String(user.user_id),
        created_time: now(),
      });

      streams.publishPing(catalystApp, { t: 'msg', team_id: String(teamId), id: String(row.ROWID) });
      res.json({ success: true, data: row });
    } catch (e) {
      console.log('chat upload error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    } finally {
      if (file?.tempFilePath) fs.unlink(file.tempFilePath, () => {});
    }
  });

  // Mark other people's recent messages as read by me (one bulk update).
  app.patch('/api/teams/:id/messages/read', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const me = String(user.user_id);
      const rows = await catalystApp.zcql().executeZCQLQuery(
        `SELECT ROWID, read_by FROM TeamMessages WHERE team_id = '${teamId}' AND sender_id != '${me}' ORDER BY ROWID DESC LIMIT ${MAX_LIMIT}`
      );
      const updates = rows.map(unwrap)
        .filter(r => !String(r.read_by || '').split(',').map(s => s.trim()).includes(me))
        .map(r => ({ ROWID: r.ROWID, read_by: [r.read_by, me].filter(Boolean).join(',') }));

      if (updates.length) {
        await catalystApp.datastore().table('TeamMessages').updateRows(updates);
        streams.publishPing(catalystApp, { t: 'read', team_id: String(teamId), uid: me });
      }
      res.json({ success: true, marked: updates.length });
    } catch (e) {
      console.log('chat read error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Download / preview an attachment. Authorised against the owning message's team.
  app.get('/api/teams/files/:fileId', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const { fileId } = req.params;
      if (!ID_RE.test(fileId)) return res.status(400).json({ success: false, error: 'Invalid file' });
      if (!CHAT_FOLDER_ID) return res.status(503).json({ success: false, error: 'File storage is not configured' });

      const user = await getCurrentUser(req, catalystApp);
      if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

      const rows = await catalystApp.zcql().executeZCQLQuery(
        `SELECT team_id, file_name, message_type FROM TeamMessages WHERE file_id = '${fileId}' LIMIT 1`);
      if (!rows.length) return res.status(404).json({ success: false, error: 'File not found' });
      const msg = unwrap(rows[0]);
      if (!(await canAccessTeam(catalystApp, user, String(msg.team_id)))) {
        return res.status(403).json({ success: false, error: 'Not a member of this team' });
      }

      const data = await catalystApp.filestore().folder(CHAT_FOLDER_ID).downloadFile(fileId);
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.data || data);

      const kind = FILE_TYPES[extOf(msg.file_name)];
      const inline = kind && INLINE_TYPES.has(kind[0]);
      res.setHeader('Content-Type', kind ? kind[1] : 'application/octet-stream');
      res.setHeader('Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${String(msg.file_name || 'file').replace(/[^\w.\- ]/g, '_')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600'); // file bytes are immutable per id
      res.send(buffer);
    } catch (e) {
      console.log('chat file error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
