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
const { CHAT_FOLDER_ID: CONFIG_FOLDER_ID } = require('./chat-config');
const streams = require('./streams');

// Attachment folder: an explicit id (env CHAT_FOLDER_ID or chat-config.js) wins; otherwise a
// File Store folder with this name is found — or created once — and the id is cached per instance.
const FOLDER_NAME = process.env.CHAT_FOLDER_NAME || 'team_chat_attachments';
let folderIdPromise = null;
const resolveChatFolderId = (catalystApp) => {
  const explicit = process.env.CHAT_FOLDER_ID || CONFIG_FOLDER_ID;
  if (explicit) return Promise.resolve(String(explicit));
  if (!folderIdPromise) {
    folderIdPromise = (async () => {
      const fs_ = catalystApp.filestore();
      const idOf = (f) => String((f && (f._folderDetails || f)).id);
      const nameOf = (f) => (f && (f._folderDetails || f)).folder_name;
      const existing = (await fs_.getAllFolders()).find(f => nameOf(f) === FOLDER_NAME);
      return idOf(existing || await fs_.createFolder(FOLDER_NAME));
    })().catch((e) => { folderIdPromise = null; throw e; }); // retry next request on failure
  }
  return folderIdPromise;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 100;
const MAX_TEXT      = 4000;
const MAX_FILE      = 10 * 1024 * 1024;
const MAX_ONCE_IMAGE = 5 * 1024 * 1024; // view-once images travel as base64 in one JSON response
const TAIL_SIZE     = 20;
const MEMBER_TTL_MS = 30 * 1000;

const ID_RE = /^\d{1,20}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const unwrap = (r) => r.TeamMessages || r;

// ── message kinds ─────────────────────────────────────────────────────────────
// The TeamMessages schema is fixed (created in the console), so richer features are stored in
// the existing columns using these `message_type` values. State changes (react / pin / vote /
// delete-for-me / "viewed") are small `evt` rows that clients fold into message state; they
// ride the same incremental sync and socket ping as ordinary messages.
//   text        plain text                         message = text
//   rich        reply and/or thread message        message = {"x":text,"r":replyToId,"th":threadRootId}
//   poll        poll                               message = {"q":question,"o":[options],"m":0|1}
//   once        view-once text                     message = {"x":text}   (redacted for everyone but the sender)
//   once_image  view-once image                    message = caption, file_* columns (redacted likewise)
//   deleted     tombstone after "delete for everyone" (content + file purged)
//   evt         action event                       message = {"o":op,"t":targetId,...}
const T_EVENT = 'evt', T_RICH = 'rich', T_POLL = 'poll', T_ONCE = 'once', T_ONCE_IMG = 'once_image', T_DELETED = 'deleted';
const MAX_POLL_OPTIONS = 10, MAX_POLL_Q = 200, MAX_POLL_OPT = 100, MAX_EMOJI_LEN = 16;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

const parseJson = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };

// What a given viewer may see of a stored row: view-once content is only ever sent to its sender.
function redactFor(row, me) {
  if ((row.message_type === T_ONCE || row.message_type === T_ONCE_IMG) && String(row.sender_id) !== me) {
    const { file_id, file_name, file_size, ...rest } = row; // eslint-disable-line no-unused-vars
    return { ...rest, message: '' };
  }
  return row;
}

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

// File Store calls run with the app's own (admin) scope: lower-privilege roles (e.g. App User) have no
// File Store permission of their own, and every route here already authorises team membership first.
const fileApp = (req) => catalyst.initialize(req, { scope: 'admin' });

const senderName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id || 'User';

async function getTarget(catalystApp, teamId, mid) {
  if (!ID_RE.test(String(mid))) return null;
  const rows = await catalystApp.zcql().executeZCQLQuery(
    `SELECT * FROM TeamMessages WHERE ROWID = ${mid} AND team_id = '${teamId}' LIMIT 1`);
  return rows.length ? unwrap(rows[0]) : null;
}

const insertEvent = (catalystApp, user, teamId, payload) => insertMessage(catalystApp, {
  team_id: String(teamId),
  sender_id: String(user.user_id),
  sender_name: senderName(user),
  message: JSON.stringify(payload),
  message_type: T_EVENT,
  read_by: String(user.user_id),
  created_time: now(),
});

const ping = (catalystApp, teamId, row) =>
  streams.publishPing(catalystApp, { t: 'msg', team_id: String(teamId), id: String(row.ROWID) });

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
  //   ?before_time=<t>  older page (infinite scroll up)
  //   ?after_time=<t>   rows at/after t (stream ping / focus); also returns `tail`
  app.get('/api/teams/:id/messages', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      // Cursors are timestamps, NOT ROWIDs: Catalyst ROWIDs are not monotonic in insertion time,
      // so a ROWID cursor can skip messages. Both are inclusive; clients de-dupe by ROWID.
      const afterTime  = req.query.after_time  !== undefined ? String(req.query.after_time)  : null;
      const beforeTime = req.query.before_time !== undefined ? String(req.query.before_time) : null;
      if ((afterTime && !TIME_RE.test(afterTime)) || (beforeTime && !TIME_RE.test(beforeTime))) {
        return res.status(400).json({ success: false, error: 'Invalid cursor' });
      }

      const zcql = catalystApp.zcql();
      let rowsP, tailP = Promise.resolve([]);

      if (afterTime) {
        rowsP = zcql.executeZCQLQuery(
          `SELECT * FROM TeamMessages WHERE team_id = '${teamId}' AND created_time >= '${afterTime}' ORDER BY created_time ASC, CREATEDTIME ASC, ROWID ASC LIMIT ${limit}`);
        // Lets senders see read-ticks update without refetching history.
        tailP = zcql.executeZCQLQuery(
          `SELECT ROWID, read_by FROM TeamMessages WHERE team_id = '${teamId}' AND sender_id = '${user.user_id}' AND message_type != '${T_EVENT}' ORDER BY created_time DESC, CREATEDTIME DESC, ROWID DESC LIMIT ${TAIL_SIZE}`
        ).catch(() => []);
      } else {
        const cursor = beforeTime ? ` AND created_time <= '${beforeTime}'` : '';
        rowsP = zcql.executeZCQLQuery(
          `SELECT * FROM TeamMessages WHERE team_id = '${teamId}'${cursor} ORDER BY created_time DESC, CREATEDTIME DESC, ROWID DESC LIMIT ${limit + 1}`);
      }

      const [rawRows, rawTail] = await Promise.all([rowsP, tailP]);
      let data = rawRows.map(unwrap);
      let hasMore = false;

      if (!afterTime) {
        hasMore = data.length > limit;
        if (hasMore) data = data.slice(0, limit);
        data.reverse(); // oldest -> newest
      }

      // Per-viewer view: other people's "delete for me" events are private, and view-once
      // content never leaves the server for anyone but its sender.
      const me = String(user.user_id);
      data = data
        .filter(r => !(r.message_type === T_EVENT && String(r.sender_id) !== me && parseJson(r.message)?.o === 'delme'))
        .map(r => redactFor(r, me));

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

      // Optional: quote-reply (reply_to), thread reply (thread_id) or view-once (once).
      const replyTo  = req.body?.reply_to  ? String(req.body.reply_to)  : null;
      const threadId = req.body?.thread_id ? String(req.body.thread_id) : null;
      const once     = req.body?.once === true;
      for (const ref of [replyTo, threadId].filter(Boolean)) {
        const t = await getTarget(catalystApp, teamId, ref);
        if (!t || t.message_type === T_EVENT || t.message_type === T_DELETED) {
          return res.status(400).json({ success: false, error: 'The message you are replying to no longer exists' });
        }
      }
      if (once && (replyTo || threadId)) {
        return res.status(400).json({ success: false, error: 'View-once messages cannot be replies' });
      }

      let type = 'text', body = text;
      if (once) { type = T_ONCE; body = JSON.stringify({ x: text }); }
      else if (replyTo || threadId) {
        type = T_RICH;
        body = JSON.stringify({ x: text, ...(replyTo ? { r: replyTo } : {}), ...(threadId ? { th: threadId } : {}) });
      }

      const row = await insertMessage(catalystApp, {
        team_id: String(teamId),
        sender_id: String(user.user_id),
        sender_name: senderName(user),
        message: body,
        message_type: type,
        // file_* columns are omitted for text (an empty string is rejected by non-text column types)
        read_by: String(user.user_id),
        created_time: now(),
      });

      ping(catalystApp, teamId, row);
      res.json({ success: true, data: row });
    } catch (e) {
      console.log('chat send error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Create a poll.
  app.post('/api/teams/:id/polls', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const q = String(req.body?.question ?? '').trim().slice(0, MAX_POLL_Q);
      const options = (Array.isArray(req.body?.options) ? req.body.options : [])
        .map(o => String(o ?? '').trim().slice(0, MAX_POLL_OPT)).filter(Boolean);
      if (!q) return res.status(400).json({ success: false, error: 'A poll needs a question' });
      if (options.length < 2) return res.status(400).json({ success: false, error: 'A poll needs at least 2 options' });
      if (options.length > MAX_POLL_OPTIONS) {
        return res.status(400).json({ success: false, error: `A poll can have at most ${MAX_POLL_OPTIONS} options` });
      }

      const row = await insertMessage(catalystApp, {
        team_id: String(teamId),
        sender_id: String(user.user_id),
        sender_name: senderName(user),
        message: JSON.stringify({ q, o: options, m: req.body?.multi ? 1 : 0 }),
        message_type: T_POLL,
        read_by: String(user.user_id),
        created_time: now(),
      });
      ping(catalystApp, teamId, row);
      res.json({ success: true, data: row });
    } catch (e) {
      console.log('chat poll error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // React / pin / unpin / vote / delete-for-me / delete-for-everyone on one message.
  app.post('/api/teams/:id/messages/:mid/events', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const op = String(req.body?.op ?? '');
      const target = await getTarget(catalystApp, teamId, req.params.mid);
      if (!target || target.message_type === T_EVENT) {
        return res.status(404).json({ success: false, error: 'Message not found' });
      }
      const isDeleted = target.message_type === T_DELETED;
      const mine = String(target.sender_id) === String(user.user_id);
      const tid = String(target.ROWID);
      let payload;

      switch (op) {
        case 'react': {
          const e = String(req.body?.e ?? '');
          if (e && (e.length > MAX_EMOJI_LEN || !EMOJI_RE.test(e))) {
            return res.status(400).json({ success: false, error: 'Invalid reaction' });
          }
          if (isDeleted) return res.status(400).json({ success: false, error: 'Message was deleted' });
          payload = { o: 'react', t: tid, e }; // e === '' removes my reaction
          break;
        }
        case 'pin':
        case 'unpin':
          if (isDeleted) return res.status(400).json({ success: false, error: 'Message was deleted' });
          payload = { o: op, t: tid };
          break;
        case 'vote': {
          const poll = target.message_type === T_POLL ? parseJson(target.message) : null;
          if (!poll) return res.status(400).json({ success: false, error: 'Not a poll' });
          const picks = [...new Set((Array.isArray(req.body?.i) ? req.body.i : []).map(Number))];
          if (picks.some(n => !Number.isInteger(n) || n < 0 || n >= poll.o.length)) {
            return res.status(400).json({ success: false, error: 'Invalid option' });
          }
          if (!poll.m && picks.length > 1) {
            return res.status(400).json({ success: false, error: 'This poll allows a single choice' });
          }
          payload = { o: 'vote', t: tid, i: picks.sort((a, b) => a - b) }; // [] clears my vote
          break;
        }
        case 'delme':
          payload = { o: 'delme', t: tid };
          break;
        case 'del': {
          if (!mine && !isAdmin(user)) {
            return res.status(403).json({ success: false, error: 'You can only delete your own messages for everyone' });
          }
          if (!isDeleted) {
            const fileId = target.file_id ? String(target.file_id) : '';
            // Purge the content first so nothing readable remains, then tell the other clients.
            try {
              await catalystApp.datastore().table('TeamMessages').updateRow({ ROWID: target.ROWID, message: '', message_type: T_DELETED });
            } catch (err) {
              await catalystApp.datastore().table('TeamMessages').updateRow({ ROWID: target.ROWID, message: '​', message_type: T_DELETED });
            }
            if (fileId) {
              const fsApp = fileApp(req);
              resolveChatFolderId(fsApp)
                .then(fid => fsApp.filestore().folder(fid).deleteFile(fileId))
                .catch(() => {}); // best effort; the file route also refuses deleted rows
            }
          }
          payload = { o: 'del', t: tid };
          break;
        }
        default:
          return res.status(400).json({ success: false, error: 'Unknown action' });
      }

      const row = await insertEvent(catalystApp, user, teamId, payload);
      if (op !== 'delme') ping(catalystApp, teamId, row); // delete-for-me is private to me
      res.json({ success: true, data: row });
    } catch (e) {
      console.log('chat event error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Open a view-once message. The content is released at most once per person.
  app.post('/api/teams/:id/messages/:mid/reveal', async (req, res) => {
    try {
      const catalystApp = catalyst.initialize(req);
      const teamId = req.params.id;
      const user = await authorize(req, res, catalystApp, teamId);
      if (!user) return;

      const target = await getTarget(catalystApp, teamId, req.params.mid);
      if (!target || (target.message_type !== T_ONCE && target.message_type !== T_ONCE_IMG)) {
        return res.status(404).json({ success: false, error: 'This message is no longer available' });
      }
      const me = String(user.user_id);
      const isSender = String(target.sender_id) === me;
      const tid = String(target.ROWID);

      let event = null;
      if (!isSender) {
        // Exact JSON written by this route, so a LIKE on the full string is a precise match.
        const seen = await catalystApp.zcql().executeZCQLQuery(
          `SELECT ROWID FROM TeamMessages WHERE team_id = '${teamId}' AND message_type = '${T_EVENT}' AND message LIKE '${JSON.stringify({ o: 'viewed', t: tid, u: me })}' LIMIT 1`
        ).catch(() => []);
        if (seen.length) return res.status(410).json({ success: false, error: 'You have already viewed this message' });
        // Record first, then release, so a replayed request can never get a second copy.
        event = await insertEvent(catalystApp, user, teamId, { o: 'viewed', t: tid, u: me });
        ping(catalystApp, teamId, event);
      }

      try {
        if (target.message_type === T_ONCE) {
          return res.json({ success: true, kind: 'text', text: parseJson(target.message)?.x || '', event });
        }
        const fsApp = fileApp(req);
        const data = await fsApp.filestore().folder(await resolveChatFolderId(fsApp)).downloadFile(String(target.file_id));
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.data || data);
        const kind = FILE_TYPES[extOf(target.file_name)];
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          success: true, kind: 'image', caption: target.message || '', event,
          dataUrl: `data:${kind ? kind[1] : 'application/octet-stream'};base64,${buffer.toString('base64')}`,
        });
      } catch (releaseErr) {
        // The content never reached the viewer, so don't burn their single view.
        if (event) await catalystApp.datastore().table('TeamMessages').deleteRow(event.ROWID).catch(() => {});
        throw releaseErr;
      }
    } catch (e) {
      console.log('chat reveal error:', e.message);
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

      if (!file) return res.status(400).json({ success: false, error: 'No file uploaded' });
      if (file.size > MAX_FILE) return res.status(413).json({ success: false, error: 'File must be under 10MB' });

      const ext = extOf(file.name);
      const kind = FILE_TYPES[ext];
      if (!kind) return res.status(400).json({ success: false, error: `File type ".${ext || '?'}" is not allowed` });
      const once = String(req.body?.once) === 'true';
      if (once && kind[0] !== 'image') return res.status(400).json({ success: false, error: 'Only images can be sent as view-once' });
      if (once && file.size > MAX_ONCE_IMAGE) return res.status(413).json({ success: false, error: 'View-once images must be under 5MB' });

      const storedName = `chat_${teamId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const fsApp = fileApp(req);
      const folderId = await resolveChatFolderId(fsApp);
      const uploaded = await fsApp.filestore().folder(folderId).uploadFile({
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
        message_type: once ? T_ONCE_IMG : kind[0],
        file_id: fileId,
        file_name: String(file.name).replace(/[\r\n"\\/]/g, '_').slice(0, 200),
        file_size: String(file.size),
        read_by: String(user.user_id),
        created_time: now(),
      });

      ping(catalystApp, teamId, row);
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
        `SELECT ROWID, read_by FROM TeamMessages WHERE team_id = '${teamId}' AND sender_id != '${me}' ORDER BY created_time DESC, CREATEDTIME DESC, ROWID DESC LIMIT ${MAX_LIMIT}`
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
      const user = await getCurrentUser(req, catalystApp);
      if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

      const rows = await catalystApp.zcql().executeZCQLQuery(
        `SELECT team_id, sender_id, file_name, message_type FROM TeamMessages WHERE file_id = '${fileId}' LIMIT 1`);
      if (!rows.length) return res.status(404).json({ success: false, error: 'File not found' });
      const msg = unwrap(rows[0]);
      if (msg.message_type === T_DELETED) return res.status(404).json({ success: false, error: 'This message was deleted' });
      // View-once images are only released through /reveal (once per person), never by direct URL.
      if (msg.message_type === T_ONCE_IMG && String(msg.sender_id) !== String(user.user_id)) {
        return res.status(403).json({ success: false, error: 'View-once media can only be opened from the chat' });
      }
      if (!(await canAccessTeam(catalystApp, user, String(msg.team_id)))) {
        return res.status(403).json({ success: false, error: 'Not a member of this team' });
      }

      const fsApp = fileApp(req);
      const data = await fsApp.filestore().folder(await resolveChatFolderId(fsApp)).downloadFile(fileId);
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
