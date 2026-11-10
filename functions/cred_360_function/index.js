'use strict';

const express    = require('express');
const catalyst   = require('zcatalyst-sdk-node');
const crypto     = require('crypto');
const fs         = require('fs');
const fileUpload = require('express-fileupload');
const { encrypt, decrypt } = require('shared-utils/encryption');

console.log('ENV CHECK — key present:', !!process.env.ENCRYPTION_KEY, 'length:', process.env.ENCRYPTION_KEY?.length);

const app = express();
app.use(express.json());
app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/', createParentPath: true }));

const { APP_URL, PROFILE_FOLDER_ID, FROM_EMAIL, ROLE_MAP, ROLE_ID_MAP, INVITE_ROLE_ID_MAP } = require('shared-utils/constants');
const emailTpl = require('shared-utils/emailTemplates');
const { sendTemplated } = emailTpl;

// Share tokens are always 64 hex chars (crypto.randomBytes(32)). Reject anything else
// before it reaches a ZCQL string.
const TOKEN_RE = /^[a-f0-9]{64}$/;

// Constant-time string compare (passphrases).
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Tell a password's owner (when someone else acted) and every team it is shared with.
const notifyPasswordStakeholders = async (catalystApp, actor, pwRow, event_type, title, details) => {
  try {
    const actorName = `${actor.first_name || ''} ${actor.last_name || ''}`.trim() || actor.email_id;
    const base = { event_type, ref_id: pwRow.ROWID, ref_name: pwRow.name, actor_id: actor.user_id, actor_name: actorName, title, details };
    if (pwRow.owner_id && String(pwRow.owner_id) !== String(actor.user_id)) {
      pushNotification(catalystApp, { ...base, recipient_type: 'user', recipient_id: pwRow.owner_id }).catch(() => {});
    }
    const teamShares = await catalystApp.zcql().executeZCQLQuery(
      `SELECT shared_with FROM PasswordShares WHERE password_id = '${pwRow.ROWID}' AND share_type = 'team'`
    ).catch(() => []);
    [...new Set(teamShares.map(r => String((r.PasswordShares || r).shared_with)))].forEach(teamId =>
      pushNotification(catalystApp, { ...base, recipient_type: 'team', recipient_id: teamId }).catch(() => {}));
  } catch (e) { console.log('notifyPasswordStakeholders:', e.message); }
};

// getAllUsers() is a full directory fetch — memoise it per request so loops don't repeat it.
const makeUserLookup = (catalystApp) => {
  let p;
  return () => (p = p || getAllUsersCached(catalystApp).catch(() => []));
};

// Tell the person who created an external share what happened to it (fire-and-forget).
const notifyShareOwner = (catalystApp, share, event_type, title, details, refName = '') => {
  if (!share || !share.created_by) return;
  pushNotification(catalystApp, {
    event_type, recipient_type: 'user', recipient_id: share.created_by,
    ref_id: share.ROWID, ref_name: refName || share.description || '',
    actor_name: share.shared_with || 'External user', title, details,
  }).catch(() => {});
};
const { getCurrentUser, now, logActivity, checkStrength, mapBy, escapeLike, extractDomain, upsertExternalUser, isExternalUserBlocked, pushNotification, getAllUsersCached, getProfileImageRowsCached, invalidateDirectory, selectAll } = require('shared-utils/helpers');
const { permList, shareIsActive, getUserTeamIds, getDescendantFolderIds, userCanOnPassword, userCanOnFolder, validateExternalShare, checkRateLimit, recordFailedAttempt, clearAttempts } = require('shared-utils/permissions');

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    await catalystApp.userManagement().resetPassword(user.email_id, {
      platform_type: 'web',
      redirect_url:  APP_URL,
    });
    res.json({ success: true, message: 'Password reset email sent' });
  } catch(e) {
    console.log('Reset password error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── USER INFO ─────────────────────────────────────────────────────────────────

app.get('/api/userinfo', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    user.role_details = {
      ...user.role_details,
      role_name: ROLE_MAP[user.role_details?.role_name] || 'Employee',
    };
    return res.json({ success: true, user });
  } catch(e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── PROFILE ───────────────────────────────────────────────────────────────────

app.put('/api/profile/update', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });

    await catalystApp.userManagement().updateUserDetails(user.user_id, {
      email_id:   user.email_id,
      first_name: name.trim(),
      last_name:  user.last_name || '',
      zaaid:      user.zaaid,
      role_id:    user.role_details?.role_id,
    });
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch(e) {
    console.log('Profile update error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PROFILE IMAGE ─────────────────────────────────────────────────────────────

app.post('/api/profile/upload', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!req.files?.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const zcql = catalystApp.zcql();

    const [existingResult, uploadResult] = await Promise.allSettled([
      zcql.executeZCQLQuery(`SELECT * FROM Users WHERE user_id = '${user.user_id}'`),
      catalystApp.filestore().folder(PROFILE_FOLDER_ID).uploadFile({
        code: fs.createReadStream(req.files.file.tempFilePath),
        name: `profile_${user.user_id}_${Date.now()}.${req.files.file.name.split('.').pop()}`,
      }),
    ]);

    const existingRow = existingResult.status === 'fulfilled' && existingResult.value?.length > 0
      ? (existingResult.value[0].Users || existingResult.value[0])
      : null;

    if (uploadResult.status === 'rejected') throw uploadResult.reason;
    const uploaded  = uploadResult.value;
    const newFileId = String(
      uploaded.id || uploaded.file_id ||
      uploaded.file_details?.id || uploaded.file_details?.file_id
    );

    const oldFileId = existingRow?.profile_image;
    const folder    = catalystApp.filestore().folder(PROFILE_FOLDER_ID);
    const table     = catalystApp.datastore().table('Users');

    await Promise.allSettled([
      oldFileId && oldFileId !== newFileId
        ? folder.deleteFile(oldFileId).catch(e => console.log('Old file delete failed:', e.message))
        : Promise.resolve(),
      existingRow
        ? table.updateRow({ ROWID: existingRow.ROWID, profile_image: newFileId })
        : table.insertRow({
            user_id:       user.user_id,
            email:         user.email_id,
            profile_image: newFileId,
            role:          user.role_details?.role_name || 'Employee',
            created_time:  now(),
          }),
    ]);

    invalidateDirectory(); // profile image changed
    res.json({ success: true, fileId: newFileId });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/profile/image/:fileId', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const fileData    = await catalystApp.filestore().folder(PROFILE_FOLDER_ID).downloadFile(req.params.fileId);
    const buffer      = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData.data || fileData);

    let contentType = 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = 'image/png';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) contentType = 'image/gif';
    else if (buffer[0] === 0x52 && buffer[1] === 0x49) contentType = 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/profile/info', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const result = await catalystApp.zcql().executeZCQLQuery(
      `SELECT profile_image FROM Users WHERE user_id = '${user.user_id}'`
    );
    const profileImage = result?.length > 0
      ? ((result[0].Users || result[0]).profile_image || null)
      : null;

    res.json({ success: true, profileImage });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql     = catalystApp.zcql();
    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    const isAdmin  = userRole === 'Admin';

    const [pwRows, shareRows, teamRows, folderRows, allUsers] = await Promise.allSettled([
      selectAll(zcql, `SELECT * FROM Passwords WHERE owner_id = '${user.user_id}' ORDER BY ROWID`),
      // Only the columns the dashboard aggregates on; paged so >300 rows are never silently dropped.
      selectAll(zcql, isAdmin
        ? `SELECT ROWID, share_type, shared_with, expiry FROM PasswordShares ORDER BY ROWID`
        : `SELECT ROWID, share_type, shared_with, expiry FROM PasswordShares WHERE created_by = '${user.user_id}' ORDER BY ROWID`),
      selectAll(zcql, `SELECT ROWID, name FROM Teams ORDER BY ROWID`),
      selectAll(zcql, isAdmin
        ? `SELECT ROWID FROM Folders ORDER BY ROWID`
        : `SELECT ROWID FROM Folders WHERE owner_id = '${user.user_id}' ORDER BY ROWID`),
      getAllUsersCached(catalystApp),
    ]);

    const allPasswords = pwRows.status     === 'fulfilled' ? pwRows.value.map(r => r.Passwords || r)        : [];
    const shares       = shareRows.status  === 'fulfilled' ? shareRows.value.map(r => r.PasswordShares || r) : [];
    const allTeams     = teamRows.status   === 'fulfilled' ? teamRows.value.map(r => r.Teams || r)           : [];
    const totalFolders = folderRows.status === 'fulfilled' ? folderRows.value.length                         : 0;
    const totalUsers   = allUsers.status   === 'fulfilled' ? allUsers.value.length                           : 0;

    const now2            = new Date();
    const sharedPasswords = shares.length;
    const expiredShares   = shares.filter(s => s.expiry && new Date(s.expiry) < now2).length;

    const monthBuckets = new Map();
    const monthLabels  = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key   = `${d.getFullYear()}-${d.getMonth()}`;
      const label = d.toLocaleString('default', { month: 'short' });
      monthLabels.push({ key, label });
      monthBuckets.set(key, 0);
    }
    allPasswords.forEach(p => {
      if (!p.created_time) return;
      const d   = new Date(p.created_time.replace(' ', 'T') + 'Z');
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (monthBuckets.has(key)) monthBuckets.set(key, monthBuckets.get(key) + 1);
    });
    const monthlyData = monthLabels.map(({ key, label }) => ({
      name: label, Passwords: monthBuckets.get(key),
    }));

    const shareCounts     = { team: 0, user: 0, external: 0, folder: 0, other: 0 };
    const teamShareCounts = {};
    shares.forEach(s => {
      // external_folder shares go to external recipients, so they count as External.
      const type = s.share_type === 'external_folder' ? 'external' : s.share_type;
      if (type in shareCounts) shareCounts[type]++;
      else shareCounts.other++;
      if (s.share_type === 'team') {
        teamShareCounts[s.shared_with] = (teamShareCounts[s.shared_with] || 0) + 1;
      }
    });
    const shareTypeData = [
      { name: 'Team shares',     value: shareCounts.team     },
      { name: 'User shares',     value: shareCounts.user     },
      { name: 'External shares', value: shareCounts.external },
      { name: 'Folder shares',   value: shareCounts.folder   },
      ...(shareCounts.other ? [{ name: 'Other shares', value: shareCounts.other }] : []),
    ];

    let strong = 0, moderate = 0, weak = 0;
    const recentPasswords = [...allPasswords]
      .sort((a, b) => {
        const da = new Date((a.created_time || '').replace(' ', 'T') + 'Z');
        const db = new Date((b.created_time || '').replace(' ', 'T') + 'Z');
        return db - da;
      })
      .slice(0, 6);

    // Decrypt each password exactly once; reused for the recent-passwords payload below.
    const strengthById = new Map();
    const plainById    = new Map();
    allPasswords.forEach(p => {
      const plain = decrypt(p.password);
      const s     = checkStrength(plain);
      plainById.set(p.ROWID, plain);
      strengthById.set(p.ROWID, s);
      if (s === 'strong') strong++;
      else if (s === 'moderate') moderate++;
      else weak++;
    });
    const total       = allPasswords.length || 1;
    const healthScore = Math.min(Math.round(((strong * 100) + (moderate * 50)) / total), 100);

    let visibleTeams = allTeams;
    if (!isAdmin) {
      const memberRows = await zcql.executeZCQLQuery(
        `SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`
      ).catch(() => []);
      const myTeamIds = new Set(memberRows.map(r => String((r.TeamMembers || r).team_id)));
      visibleTeams = allTeams.filter(t => myTeamIds.has(String(t.ROWID)));
    }

    const teamData = visibleTeams
      .map(team => ({ name: team.name || 'Unknown', count: teamShareCounts[String(team.ROWID)] || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ── Security posture recommendations ──
    const recommendations = [];
    if (weak > 0) {
      recommendations.push({
        id: 'weak-passwords', severity: 'high',
        text: `${weak} weak password${weak > 1 ? 's' : ''} detected`,
        action: 'Review weak passwords', link: '/passwords?filter=weak',
      });
    }
    if (expiredShares > 0) {
      recommendations.push({
        id: 'expired-shares', severity: 'medium',
        text: `${expiredShares} expired share${expiredShares > 1 ? 's' : ''} still active`,
        action: 'Revoke expired shares', link: '/shares?filter=expired',
      });
    }
    if (moderate > 0 && total > 3) {
      recommendations.push({
        id: 'moderate-passwords', severity: 'low',
        text: `${moderate} password${moderate > 1 ? 's' : ''} could be stronger`,
        action: 'Strengthen passwords', link: '/passwords?filter=moderate',
      });
    }
    const SEV_ORDER = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

    // ── Month-over-month password delta ──
    const thisMonth = monthlyData[monthlyData.length - 1]?.Passwords || 0;
    const lastMonth  = monthlyData[monthlyData.length - 2]?.Passwords || 0;
    const passwordDelta = lastMonth === 0
      ? (thisMonth > 0 ? 100 : 0)
      : Math.round(((thisMonth - lastMonth) / lastMonth) * 100);

    res.json({
      success: true,
      isAdmin,
      stats: {
        totalPasswords: allPasswords.length,
        sharedPasswords,
        expiredShares,
        totalTeams: visibleTeams.length,
        totalFolders,
        totalUsers,
        passwordDelta,
      },
      recentPasswords: recentPasswords.map(p => ({ ...p, password: plainById.get(p.ROWID), strength: strengthById.get(p.ROWID) })),
      monthlyData,
      shareTypeData,
      healthData: { score: healthScore, strong, moderate, weak },
      teamData,
      recommendations,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────

app.get('/api/categories', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';

    const [rows, allUsers] = await Promise.all([
      catalystApp.zcql().executeZCQLQuery(
        `SELECT ROWID, name, color, icon, created_time, created_by FROM Categories ORDER BY name ASC`
      ),
      getAllUsersCached(catalystApp),
    ]);

    const userMap = {};
    allUsers.forEach(u => {
      userMap[String(u.user_id)] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id;
    });

    let categories = rows.map(r => r.Categories || r);

    if (userRole !== 'Admin') {
      categories = categories.filter(c => String(c.created_by) === String(user.user_id));
    }

    const data = categories.map(c => ({
      ...c,
      created_by_name: userMap[String(c.created_by)] || 'Unknown',
    }));

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { name, color, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

    try {
      const row = await catalystApp.datastore().table('Categories').insertRow({
        name:         name.trim(),
        color:        color || '#7c3aed',
        icon:         icon  || 'tag',
        created_by:   user.user_id,
        created_time: now(),
      });
      logActivity(catalystApp, {
        action: 'Category created', user_id: user.user_id, user_email: user.email_id,
        password_id: '', details: `Created category: ${name.trim()}`,
      });
      return res.json({ success: true, data: row });
    } catch (insertErr) {
      if (insertErr.message?.toLowerCase().includes('duplicate') ||
          insertErr.message?.toLowerCase().includes('unique')) {
        return res.status(409).json({ success: false, error: 'Category already exists' });
      }
      throw insertErr;
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { name, color, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

    const row = await catalystApp.datastore().table('Categories').updateRow({
      ROWID: req.params.id,
      name:  name.trim(),
      color: color || '#7c3aed',
      icon:  icon  || 'tag',
    });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const inUse = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM Passwords WHERE category = '${req.params.id}' LIMIT 1`
    ).catch(() => []);

    if (inUse.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Category is in use by passwords. Reassign them first.',
      });
    }

    await catalystApp.datastore().table('Categories').deleteRow(req.params.id);

    logActivity(catalystApp, {
      action: 'Category deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Deleted category ID: ${req.params.id}`,
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PASSWORDS ─────────────────────────────────────────────────────────────────

app.get('/api/passwords', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Passwords WHERE owner_id = '${user.user_id}' ORDER BY ROWID DESC`
    );
    const data = rows.map(r => r.Passwords || r).map(p => ({ ...p, password: decrypt(p.password) }));
    res.json({ success: true, data });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/passwords', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('Passwords').insertRow({
      name:         req.body.name,
      category:     req.body.category || 'General',
      username:     req.body.username || '',
      password:     encrypt(req.body.password),
      url:          req.body.url || '',
      notes:        req.body.notes || '',
      folder_id:    req.body.folder_id || '',
      web_account:  req.body.web_account || '',
      owner_id:     user.user_id,
      created_time: now(),
      expiry_date:  req.body.expiry_date || null,
    });

    logActivity(catalystApp, {
      action: 'Password created', user_id: user.user_id, user_email: user.email_id,
      password_id: String(row.ROWID), details: `Created password: ${req.body.name}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/passwords/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const existing = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Passwords WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const pwRow = existing[0] ? (existing[0].Passwords || existing[0]) : null;
    if (!pwRow) return res.status(404).json({ success: false, error: 'Password not found' });

    if (!(await userCanOnPassword(catalystApp, user, pwRow, 'edit'))) {
      return res.status(403).json({ success: false, error: 'You do not have edit access to this password' });
    }

    const row = await catalystApp.datastore().table('Passwords').updateRow({
      ROWID:       req.params.id,
      name:        req.body.name,
      category:    req.body.category || 'General',
      username:    req.body.username || '',
      password:    encrypt(req.body.password),
      url:         req.body.url || '',
      notes:       req.body.notes || '',
      folder_id:   req.body.folder_id || '',
      web_account: req.body.web_account || '',
      expiry_date: req.body.expiry_date || null,
    });

    logActivity(catalystApp, {
      action: 'Password updated', user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id, details: `Updated password: ${req.body.name}`,
    });
    notifyPasswordStakeholders(catalystApp, user, pwRow, 'password_updated', 'Password updated', `"${req.body.name}" was updated`);

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/passwords/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Passwords WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const pwRow = rows[0] ? (rows[0].Passwords || rows[0]) : null;
    if (!pwRow) return res.status(404).json({ success: false, error: 'Password not found' });

    if (!(await userCanOnPassword(catalystApp, user, pwRow, 'delete'))) {
      return res.status(403).json({ success: false, error: 'You do not have delete access to this password' });
    }

    await notifyPasswordStakeholders(catalystApp, user, pwRow, 'password_deleted', 'Password deleted', `"${pwRow.name}" was deleted`);
    await catalystApp.datastore().table('Passwords').deleteRow(req.params.id);

    logActivity(catalystApp, {
      action: 'Password deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id, details: `Deleted password: ${pwRow.name}`,
    });

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/passwords/:id/toggle-active', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const existing = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Passwords WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const pwRow = existing[0] ? (existing[0].Passwords || existing[0]) : null;
    if (!pwRow) return res.status(404).json({ success: false, error: 'Password not found' });

    if (String(pwRow.owner_id) !== String(user.user_id)) {
      return res.status(403).json({ success: false, error: 'Only the owner can change active status' });
    }

    const nextActive = !(pwRow.is_active === true || pwRow.is_active === 'true');

    const row = await catalystApp.datastore().table('Passwords').updateRow({
      ROWID: req.params.id, is_active: nextActive,
    });

    logActivity(catalystApp, {
      action: nextActive ? 'Password activated' : 'Password deactivated',
      user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id,
      details: `${pwRow.name} marked as ${nextActive ? 'active' : 'inactive'}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── EXPIRING PASSWORDS ────────────────────────────────────────────────────────

app.get('/api/passwords/expiring', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const now2 = new Date();
    // Only rows expiring within the window (or already expired) are fetched; NULL expiry rows never match.
    const windowDays = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const cutoff = new Date(now2.getTime() + windowDays * 86_400_000)
      .toISOString().slice(0, 19).replace('T', ' ');
    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Passwords WHERE owner_id = '${user.user_id}' AND expiry_date < '${cutoff}' ORDER BY expiry_date ASC`
    );
    const expiring = rows
      .map(r => r.Passwords || r)
      .filter(p => p.expiry_date)
      .map(p => {
        const expiryDate = new Date(p.expiry_date.replace(' ', 'T') + 'Z');
        return { ...p, password: decrypt(p.password), diffDays: Math.ceil((expiryDate - now2) / 86_400_000), expiryDate: p.expiry_date };
      })
      .sort((a, b) => a.diffDays - b.diffDays);

    res.json({ success: true, data: expiring });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── FOLDERS ───────────────────────────────────────────────────────────────────

app.get('/api/folders-with-passwords', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();

    const [folderRows, pwRows] = await Promise.all([
      zcql.executeZCQLQuery(
        `SELECT * FROM Folders WHERE owner_id = '${user.user_id}' ORDER BY ROWID DESC`
      ).catch(() => []),
      zcql.executeZCQLQuery(
        `SELECT * FROM Passwords WHERE owner_id = '${user.user_id}' ORDER BY ROWID DESC`
      ).catch(() => []),
    ]);

    res.json({
      success: true,
      folders:   folderRows.map(r => r.Folders  || r),
      passwords: pwRows.map(r    => r.Passwords || r).map(p => ({ ...p, password: decrypt(p.password) })),
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/folders', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('Folders').insertRow({
      name:             req.body.name,
      parent_folder_id: req.body.parent_folder_id || '',
      owner_id:         user.user_id,
      created_time:     now(),
    });

    logActivity(catalystApp, {
      action: 'Folder created', user_id: user.user_id, user_email: user.email_id,
      password_id: String(row.ROWID), details: `Created folder: ${req.body.name}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/folders/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const folderRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Folders WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const folderRow = folderRows[0] ? (folderRows[0].Folders || folderRows[0]) : null;
    if (!folderRow) return res.status(404).json({ success: false, error: 'Folder not found' });

    if (!(await userCanOnFolder(catalystApp, user, folderRow, 'edit'))) {
      return res.status(403).json({ success: false, error: 'You do not have edit access to this folder' });
    }

    const oldName = folderRow.name;

    const row = await catalystApp.datastore().table('Folders').updateRow({
      ROWID:            req.params.id,
      name:             req.body.name,
      parent_folder_id: req.body.parent_folder_id || '',
    });

    logActivity(catalystApp, {
      action: 'Folder updated', user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id, details: `Renamed folder to: ${req.body.name}`,
    });

    if (req.body.name && req.body.name !== oldName) {
      const zcql = catalystApp.zcql();
      const shareRows = await zcql.executeZCQLQuery(
        `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND password_id = '${req.params.id}'`
      ).catch(() => []);
      const activeShares = shareRows.map(r => r.PasswordShares || r).filter(s => shareIsActive(s));

      const getUsers = makeUserLookup(catalystApp);
      for (const s of activeShares) {
        const looksLikeTeamId = !String(s.shared_with).includes('@');
        let recipientId = s.shared_with;
        if (!looksLikeTeamId) {
          const allUsers = await getUsers();
          const match = allUsers.find(u => u.email_id === s.shared_with);
          recipientId = match ? match.user_id : s.shared_with;
        }
        await pushNotification(catalystApp, {
          event_type: 'folder_renamed',
          recipient_type: looksLikeTeamId ? 'team' : 'user',
          recipient_id: recipientId,
          ref_id: req.params.id, ref_name: req.body.name,
          actor_id: user.user_id,
          actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
          title: 'Folder renamed',
          details: `"${oldName}" was renamed to "${req.body.name}"`,
        });
      }
    }

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/folders/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const ownCheckRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Folders WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const ownFolder = ownCheckRows[0] ? (ownCheckRows[0].Folders || ownCheckRows[0]) : null;
    if (!ownFolder) return res.status(404).json({ success: false, error: 'Folder not found' });

    if (!(await userCanOnFolder(catalystApp, user, ownFolder, 'delete'))) {
      return res.status(403).json({ success: false, error: 'You do not have delete access to this folder' });
    }

    const zcql      = catalystApp.zcql();
    const allIds    = new Set([String(req.params.id)]);
    let frontier    = [String(req.params.id)];

    while (frontier.length > 0) {
      const childRows = await zcql.executeZCQLQuery(
        `SELECT ROWID FROM Folders WHERE parent_folder_id IN (${frontier.join(',')})`
      ).catch(() => []);
      frontier = [];
      childRows.forEach(r => {
        const id = String((r.Folders || r).ROWID);
        if (!allIds.has(id)) { allIds.add(id); frontier.push(id); }
      });
    }

    const idList = [...allIds];

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND password_id = '${req.params.id}'`
    ).catch(() => []);
    const activeShares = shareRows.map(r => r.PasswordShares || r).filter(s => shareIsActive(s));
    const getUsers = makeUserLookup(catalystApp);
    for (const s of activeShares) {
      const looksLikeTeamId = !String(s.shared_with).includes('@');
      let recipientId = s.shared_with;
      if (!looksLikeTeamId) {
        const allUsers = await getUsers();
        const match = allUsers.find(u => u.email_id === s.shared_with);
        recipientId = match ? match.user_id : s.shared_with;
      }
      await pushNotification(catalystApp, {
        event_type: 'folder_deleted',
        recipient_type: looksLikeTeamId ? 'team' : 'user',
        recipient_id: recipientId,
        ref_id: req.params.id, ref_name: ownFolder.name,
        actor_id: user.user_id,
        actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
        title: 'Folder deleted',
        details: `"${ownFolder.name}" was deleted`,
      });
    }

    const pwRows = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM Passwords WHERE folder_id IN (${idList.join(',')})`
    ).catch(() => []);

    const pwTable     = catalystApp.datastore().table('Passwords');
    const folderTable = catalystApp.datastore().table('Folders');

    await Promise.all(
      pwRows.map(r => pwTable.deleteRow(String((r.Passwords || r).ROWID)))
    );

    const orderedIds = idList.reverse();
    for (const fid of orderedIds) {
      await folderTable.deleteRow(fid);
    }

    logActivity(catalystApp, {
      action: 'Folder deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id,
      details: `Deleted folder "${ownFolder.name}" and ${idList.length - 1} sub-folder(s) with all passwords`,
    });

    res.json({ success: true, deleted_folders: idList.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/folders/:id/toggle-active', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const existing = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM Folders WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const folderRow = existing[0] ? (existing[0].Folders || existing[0]) : null;
    if (!folderRow) return res.status(404).json({ success: false, error: 'Folder not found' });

    if (String(folderRow.owner_id) !== String(user.user_id)) {
      return res.status(403).json({ success: false, error: 'Only the owner can change active status' });
    }

    const nextActive = !(folderRow.is_active === true || folderRow.is_active === 'true');

    const row = await catalystApp.datastore().table('Folders').updateRow({
      ROWID: req.params.id, is_active: nextActive,
    });

    logActivity(catalystApp, {
      action: nextActive ? 'Folder activated' : 'Folder deactivated',
      user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id,
      details: `${folderRow.name} marked as ${nextActive ? 'active' : 'inactive'}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SHARES ────────────────────────────────────────────────────────────────────

app.post('/api/shares', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('PasswordShares').insertRow({
      password_id:  String(req.body.password_id),
      shared_with:  req.body.shared_with,
      share_type:   req.body.share_type,
      expiry:       req.body.expiry || null,
      token:        '',
      passphrase:   '',
      description:  req.body.description || '',
      is_viewed:    false,
      created_by:   user.user_id,
      created_time: now(),
      permissions: Array.isArray(req.body.permissions) ? req.body.permissions.join(',') : (req.body.permissions || ''),
    });

    const zcql = catalystApp.zcql();
    const [pwRows, teamRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT name FROM Passwords WHERE ROWID = ${req.body.password_id}`).catch(() => []),
      req.body.share_type === 'team'
        ? zcql.executeZCQLQuery(`SELECT name FROM Teams WHERE ROWID = ${req.body.shared_with}`).catch(() => [])
        : Promise.resolve([]),
    ]);
    const passwordName   = pwRows.length   > 0 ? (pwRows[0].Passwords   || pwRows[0]).name   : req.body.password_id;
    const sharedWithName = teamRows.length > 0 ? (teamRows[0].Teams      || teamRows[0]).name : req.body.shared_with;

    logActivity(catalystApp, {
      action: 'Password shared', user_id: user.user_id, user_email: user.email_id,
      password_id: String(req.body.password_id),
      details: `"${passwordName}" shared with ${sharedWithName}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/shares/my', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const now2 = new Date();

    const rows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE created_by = '${user.user_id}' ORDER BY ROWID DESC`
    );
    const shares = rows.map(r => r.PasswordShares || r);
    if (shares.length === 0) return res.json({ success: true, data: [] });

    const pwIds     = [...new Set(shares.filter(s => s.share_type !== 'folder' && s.share_type !== 'external_folder').map(s => s.password_id))];
    const folderIds = [...new Set(shares.filter(s => s.share_type === 'folder' || s.share_type === 'external_folder').map(s => s.password_id))];
    const hasTeamShares = shares.some(s =>
      s.share_type === 'team' ||
      ((s.share_type === 'folder' || s.share_type === 'external_folder') && !String(s.shared_with).includes('@'))
    );

    const [allPwRows, allFolderRows, allTeamRows, allUsers] = await Promise.all([
      pwIds.length     ? zcql.executeZCQLQuery(`SELECT ROWID, name, is_active FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => [])   : Promise.resolve([]),
      folderIds.length ? zcql.executeZCQLQuery(`SELECT ROWID, name, is_active FROM Folders WHERE ROWID IN (${folderIds.join(',')})`).catch(() => []) : Promise.resolve([]),
      hasTeamShares    ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Teams`).catch(() => [])                                                       : Promise.resolve([]),
      getAllUsersCached(catalystApp).catch(() => []),
    ]);

    const pwMap     = mapBy(allPwRows.map(r => r.Passwords || r),   p => p.ROWID);
    const folderMap = mapBy(allFolderRows.map(r => r.Folders || r), f => f.ROWID);
    const teamMap   = mapBy(allTeamRows.map(r => r.Teams || r),     t => t.ROWID);

    const userNameMap = {};
    allUsers.forEach(u => {
      userNameMap[u.email_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id;
    });

    const result = shares.map(share => {
      const expiryDate    = share.expiry ? new Date(share.expiry.replace(' ', 'T') + 'Z') : null;
      const isFolderShare = share.share_type === 'folder' || share.share_type === 'external_folder';
      const isTeamShare   = share.share_type === 'team';

      const looksLikeId = !String(share.shared_with).includes('@');
      let sharedWithLabel = share.shared_with;

      if (isTeamShare || (isFolderShare && looksLikeId)) {
        sharedWithLabel = teamMap[String(share.shared_with)]?.name || `Team #${share.shared_with}`;
      } else if (share.share_type === 'user' || (isFolderShare && !looksLikeId)) {
        sharedWithLabel = userNameMap[share.shared_with] || share.shared_with;
      }

      const pwRow     = !isFolderShare ? pwMap[String(share.password_id)]     : null;
      const folderRow = isFolderShare  ? folderMap[String(share.password_id)] : null;
      const itemActive = isFolderShare
        ? !(folderRow?.is_active === false || folderRow?.is_active === 'false')
        : !(pwRow?.is_active === false || pwRow?.is_active === 'false');

      return {
        ROWID:              share.ROWID,
        password_id:        share.password_id,
        shared_with:        share.shared_with,
        shared_with_label:  sharedWithLabel,
        share_type:         share.share_type,
        expiry:             share.expiry,
        is_viewed:          share.is_viewed,
        description:        share.description,
        created_time:       share.created_time,
        is_expired:         expiryDate ? expiryDate < now2 : false,
        permissions:        permList(share),
        item_is_active:     itemActive,
        password_name:      !isFolderShare ? (pwRow?.name || '') : '',
        folder_name:        isFolderShare  ? (folderRow?.name || '') : '',
      };
    });

    res.json({ success: true, data: result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Bulk-clear the caller's OWN expired shares (never other users'). Expired shares already grant
// no access, so this is housekeeping; one audit entry records how many were removed.
app.delete('/api/shares/expired/mine', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const rows = await selectAll(
      zcql,
      `SELECT ROWID FROM PasswordShares WHERE created_by = '${user.user_id}' AND expiry < '${now()}' ORDER BY ROWID`
    );
    const ids = rows.map(r => (r.PasswordShares || r).ROWID);

    const table = catalystApp.datastore().table('PasswordShares');
    const CHUNK = 200; // Data Store bulk-delete limit per call
    for (let i = 0; i < ids.length; i += CHUNK) {
      await table.deleteRows(ids.slice(i, i + CHUNK));
    }

    if (ids.length) {
      logActivity(catalystApp, {
        action: 'Expired shares cleared', user_id: user.user_id, user_email: user.email_id,
        password_id: '', details: `Removed ${ids.length} expired share${ids.length > 1 ? 's' : ''}`,
      });
    }
    res.json({ success: true, removed: ids.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/shares/:id/revoke', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();

    const rows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE ROWID = ${req.params.id}`
    ).catch(() => []);
    const shareDetails = rows.length > 0 ? (rows[0].PasswordShares || rows[0]) : null;
    if (!shareDetails) return res.status(404).json({ success: false, error: 'Share not found' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (String(shareDetails.created_by) !== String(user.user_id) && userRole !== 'Admin') {
      return res.status(403).json({ success: false, error: 'You do not have permission to revoke this share' });
    }

    const isFolderShare = shareDetails.share_type === 'folder' || shareDetails.share_type === 'external_folder';
    const [, nameRows] = await Promise.all([
      catalystApp.datastore().table('PasswordShares').deleteRow(req.params.id),
      isFolderShare
        ? zcql.executeZCQLQuery(`SELECT name FROM Folders WHERE ROWID = ${shareDetails.password_id}`).catch(() => [])
        : zcql.executeZCQLQuery(`SELECT name FROM Passwords WHERE ROWID = ${shareDetails.password_id}`).catch(() => []),
    ]);

    const itemName   = nameRows.length > 0 ? ((isFolderShare ? nameRows[0].Folders : nameRows[0].Passwords) || nameRows[0]).name : '';
    const logDetails = `Revoked ${shareDetails.share_type} share of "${itemName}" with ${shareDetails.shared_with}`;

    logActivity(catalystApp, {
      action: 'Share revoked', user_id: user.user_id, user_email: user.email_id,
      password_id: shareDetails.password_id || '', details: logDetails,
    });

    const looksLikeTeamId = !String(shareDetails.shared_with).includes('@');
    const isTeam = shareDetails.share_type === 'team' || (isFolderShare && looksLikeTeamId);

    let recipientId = shareDetails.shared_with;
    if (!isTeam) {
      const allUsers = await getAllUsersCached(catalystApp).catch(() => []);
      const match = allUsers.find(u => u.email_id === shareDetails.shared_with);
      recipientId = match ? match.user_id : shareDetails.shared_with;
    }

    await pushNotification(catalystApp, {
      event_type: isFolderShare ? 'folder_access_revoked' : 'password_access_revoked',
      recipient_type: isTeam ? 'team' : 'user',
      recipient_id: recipientId,
      ref_id: shareDetails.password_id, ref_name: itemName,
      actor_id: user.user_id,
      actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
      title: isFolderShare ? 'Folder access revoked' : 'Password access revoked',
      details: `Your access to "${itemName}" was revoked`,
    });

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/shares/folders/received', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const now2 = new Date();

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND shared_with = '${user.email_id}' ORDER BY ROWID DESC`
    ).catch(() => []);

    const relevantShares = shareRows
      .map(r => r.PasswordShares || r)
      .filter(s => !s.expiry || new Date(s.expiry.replace(' ', 'T') + 'Z') >= now2);

    if (relevantShares.length === 0) return res.json({ success: true, data: [] });

    const seenFolderIds = new Set();
    const dedupedShares = relevantShares.filter(s => {
      if (seenFolderIds.has(s.password_id)) return false;
      seenFolderIds.add(s.password_id);
      return true;
    });

    const shareTable = catalystApp.datastore().table('PasswordShares');
    const toMark = dedupedShares.filter(s => s.is_viewed === false || s.is_viewed === 'false');
    if (toMark.length > 0) {
      Promise.all(toMark.map(s => shareTable.updateRow({ ROWID: s.ROWID, is_viewed: true })))
        .catch(e => console.log('mark-viewed error:', e.message));
    }

    const rootFolderIds = dedupedShares.map(s => String(s.password_id));

    const rootToDescendants = {};
    rootFolderIds.forEach(id => { rootToDescendants[id] = new Set([id]); });

    const rootFolderRows = await zcql.executeZCQLQuery(
      `SELECT ROWID, name FROM Folders WHERE ROWID IN (${rootFolderIds.join(',')})`
    ).catch(() => []);
    const folderNameMap = {};
    rootFolderRows.forEach(r => {
      const f = r.Folders || r;
      folderNameMap[String(f.ROWID)] = f.name;
    });

    let frontier = [...rootFolderIds];
    while (frontier.length > 0) {
      const childRows = await zcql.executeZCQLQuery(
        `SELECT ROWID, parent_folder_id FROM Folders WHERE parent_folder_id IN (${frontier.join(',')})`
      ).catch(() => []);

      if (childRows.length === 0) break;

      const nextFrontier = [];
      childRows.forEach(r => {
        const child = r.Folders || r;
        const childId  = String(child.ROWID);
        const parentId = String(child.parent_folder_id);

        for (const rootId of rootFolderIds) {
          if (rootToDescendants[rootId].has(parentId)) {
            rootToDescendants[rootId].add(childId);
            nextFrontier.push(childId);
            break;
          }
        }
      });

      frontier = nextFrontier;
    }

    const allDescendantIds = [...new Set(Object.values(rootToDescendants).flatMap(s => [...s]))];
    const allPwRows = await zcql.executeZCQLQuery(
      `SELECT * FROM Passwords WHERE folder_id IN (${allDescendantIds.join(',')})`
    ).catch(() => []);
    const allPasswords = allPwRows.map(r => r.Passwords || r).map(p => {
      const pwInactive = p.is_active === false || p.is_active === 'false';
      return { ...p, password: pwInactive ? null : decrypt(p.password), notes: pwInactive ? null : p.notes };
    });

    const rootToPasswords = {};
    rootFolderIds.forEach(id => { rootToPasswords[id] = []; });
    allPasswords.forEach(pw => {
      const folderId = String(pw.folder_id);
      for (const rootId of rootFolderIds) {
        if (rootToDescendants[rootId].has(folderId)) {
          rootToPasswords[rootId].push(pw);
          break;
        }
      }
    });

    const rootStatusRows = await zcql.executeZCQLQuery(
      `SELECT ROWID, is_active FROM Folders WHERE ROWID IN (${rootFolderIds.join(',')})`
    ).catch(() => []);
    const rootActiveMap = {};
    rootStatusRows.forEach(r => {
      const f = r.Folders || r;
      rootActiveMap[String(f.ROWID)] = !(f.is_active === false || f.is_active === 'false');
    });

    const result = dedupedShares.map(share => {
      const rootId      = String(share.password_id);
      const isActive    = rootActiveMap[rootId] !== false;
      const passwords   = isActive ? (rootToPasswords[rootId] || []) : [];
      return {
        share_id:       share.ROWID,
        folder_id:      share.password_id,
        folder_name:    folderNameMap[rootId] || 'Shared Folder',
        share_type:     share.share_type,
        shared_with:    share.shared_with,
        expiry:         share.expiry,
        permissions: isActive ? permList(share) : [],
        shared_by:      share.created_by,
        password_count: passwords.length,
        is_active:      isActive,
        passwords,
      };
    });

    res.json({ success: true, data: result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/shares/folder', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('PasswordShares').insertRow({
      password_id:  String(req.body.folder_id),
      shared_with:  req.body.shared_with,
      share_type:   'folder',
      expiry:       req.body.expiry,
      token:        '', passphrase:  '',
      description:  req.body.description || '',
      is_viewed:    false,
      created_by:   user.user_id,
      created_time: now(),
      permissions: Array.isArray(req.body.permissions) ? req.body.permissions.join(',') : (req.body.permissions || ''),
    });

    const zcql = catalystApp.zcql();
    const [folderRows, teamRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT name FROM Folders WHERE ROWID = ${req.body.folder_id}`).catch(() => []),
      req.body.share_type === 'team'
        ? zcql.executeZCQLQuery(`SELECT name FROM Teams WHERE ROWID = ${req.body.shared_with}`).catch(() => [])
        : Promise.resolve([]),
    ]);
    const folderName    = folderRows.length > 0 ? (folderRows[0].Folders || folderRows[0]).name : req.body.folder_id;
    const sharedWithName = teamRows.length  > 0 ? (teamRows[0].Teams    || teamRows[0]).name  : req.body.shared_with;

    logActivity(catalystApp, {
      action: 'Folder shared', user_id: user.user_id, user_email: user.email_id,
      password_id: String(req.body.folder_id),
      details: `Folder "${folderName}" shared with ${sharedWithName}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── EXTERNAL SHARES ───────────────────────────────────────────────────────────

function makePassphrase() {
  return crypto.randomBytes(4).toString('hex').toUpperCase() + '-' +
         crypto.randomBytes(4).toString('hex').toUpperCase();
}

app.post('/api/shares/external', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    if (await isExternalUserBlocked(catalystApp, req.body.client_email)) {
      return res.status(403).json({ success: false, error: 'This recipient is blocked from receiving external shares' });
    }

    const token          = crypto.randomBytes(32).toString('hex');
    const autoPassphrase = req.body.passphrase || makePassphrase();
    const shareLink      = `${APP_URL}#/share/${token}`;

    await catalystApp.datastore().table('PasswordShares').insertRow({
      password_id: String(req.body.password_id), shared_with: req.body.client_email,
      share_type: 'external', expiry: req.body.expiry,
      token, passphrase: autoPassphrase, description: req.body.description || '',
      is_viewed: false, created_by: user.user_id, created_time: now(),
      permissions: Array.isArray(req.body.permissions) ? req.body.permissions.join(',') : (req.body.permissions || ''),
    });

    const zcql = catalystApp.zcql();
    let emailError = null;

    const [pwRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT name FROM Passwords WHERE ROWID = ${req.body.password_id}`).catch(() => []),
      sendTemplated(catalystApp, req.body.client_email, emailTpl.externalPasswordShare({
        sharedBy: user.first_name || user.email_id,
        description: req.body.description,
        passphrase: autoPassphrase,
        link: shareLink,
        expiry: req.body.expiry,
      })).catch(e => {
        console.log('Email send error:', e.message);
        emailError = e.message;
      }),
    ]);

    const passwordName = pwRows.length > 0 ? (pwRows[0].Passwords || pwRows[0]).name : '';
    logActivity(catalystApp, {
      action: emailError ? 'External share created (email failed)' : 'External share created',
      user_id: user.user_id, user_email: user.email_id,
      password_id: String(req.body.password_id),
      details: emailError
        ? `"${passwordName}" shared externally with ${req.body.client_email} — EMAIL FAILED: ${emailError}`
        : `"${passwordName}" shared externally with ${req.body.client_email}`,
    });
    upsertExternalUser(catalystApp, req.body.client_email, user.user_id);

    res.json({
      success: true, token, passphrase: autoPassphrase,
      email_sent: !emailError,
      email_error: emailError || undefined,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/shares/external/folder', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    if (await isExternalUserBlocked(catalystApp, req.body.client_email)) {
      return res.status(403).json({ success: false, error: 'This recipient is blocked from receiving external shares' });
    }

    const token          = crypto.randomBytes(32).toString('hex');
    const autoPassphrase = makePassphrase();
    const shareLink      = `${APP_URL}#/share/${token}`;

    await catalystApp.datastore().table('PasswordShares').insertRow({
      password_id: String(req.body.folder_id), shared_with: req.body.client_email,
      share_type: 'external_folder', expiry: req.body.expiry,
      token, passphrase: autoPassphrase, description: req.body.description || '',
      is_viewed: false, created_by: user.user_id, created_time: now(),
      permissions: Array.isArray(req.body.permissions) ? req.body.permissions.join(',') : (req.body.permissions || ''),
    });
    let emailError = null;
    await sendTemplated(catalystApp, req.body.client_email, emailTpl.externalFolderShare({
      sharedBy: user.first_name || user.email_id,
      folderName: req.body.folder_name,
      count: req.body.password_count,
      description: req.body.description,
      passphrase: autoPassphrase,
      link: shareLink,
      expiry: req.body.expiry,
    })).catch(e => {
      console.log('Email send error:', e.message);
      emailError = e.message;
    });

    logActivity(catalystApp, {
      action: emailError ? 'External folder share created (email failed)' : 'External folder share created',
      user_id: user.user_id, user_email: user.email_id,
      password_id: String(req.body.folder_id),
      details: emailError
        ? `Folder "${req.body.folder_name}" shared with ${req.body.client_email} — EMAIL FAILED: ${emailError}`
        : `Folder "${req.body.folder_name}" shared with ${req.body.client_email}`,
    });
    upsertExternalUser(catalystApp, req.body.client_email, user.user_id);

    res.json({
      success: true, token, passphrase: autoPassphrase,
      email_sent: !emailError,
      email_error: emailError || undefined,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/external/password/:token', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const { passphrase, password_id, name, username, password, url, notes, category } = req.body;

    const { share, error, status } = await validateExternalShare(catalystApp, req.params.token, passphrase);
    if (error) return res.status(status).json({ success: false, error });

    if (!['external', 'external_folder'].includes(share.share_type)) {
      return res.status(400).json({ success: false, error: 'Invalid share type' });
    }
    if (!permList(share).includes('edit')) {
      return res.status(403).json({ success: false, error: 'This share does not allow editing' });
    }

    const isFolderShare = share.share_type === 'external_folder';
    const targetId = isFolderShare ? password_id : share.password_id;
    if (!targetId) return res.status(400).json({ success: false, error: 'password_id is required' });

    if (isFolderShare) {
      const descendants = await getDescendantFolderIds(catalystApp, share.password_id);
      const pwRows = await catalystApp.zcql().executeZCQLQuery(
        `SELECT folder_id FROM Passwords WHERE ROWID = '${targetId}'`
      ).catch(() => []);
      const pw = pwRows[0] ? (pwRows[0].Passwords || pwRows[0]) : null;
      if (!pw || !descendants.has(String(pw.folder_id))) {
        return res.status(403).json({ success: false, error: 'Password not part of this shared folder' });
      }
    }

    const row = await catalystApp.datastore().table('Passwords').updateRow({
      ROWID: targetId, name, username: username || '', password: encrypt(password),
      url: url || '', notes: notes || '', category: category || 'General',
    });

    logActivity(catalystApp, {
      action: 'Password edited externally', user_id: '', user_email: share.shared_with || '',
      password_id: String(targetId), details: `"${name}" edited by external user (${share.shared_with})`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/external/password/:token/delete', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const { passphrase, password_id } = req.body;

    const { share, error, status } = await validateExternalShare(catalystApp, req.params.token, passphrase);
    if (error) return res.status(status).json({ success: false, error });

    if (!permList(share).includes('delete')) {
      return res.status(403).json({ success: false, error: 'This share does not allow deletion' });
    }

    const isFolderShare = share.share_type === 'external_folder';
    const targetId = isFolderShare ? password_id : share.password_id;
    if (!targetId) return res.status(400).json({ success: false, error: 'password_id is required' });

    let nameForLog = '';
    if (isFolderShare) {
      const descendants = await getDescendantFolderIds(catalystApp, share.password_id);
      const pwRows = await catalystApp.zcql().executeZCQLQuery(
        `SELECT folder_id, name FROM Passwords WHERE ROWID = '${targetId}'`
      ).catch(() => []);
      const pw = pwRows[0] ? (pwRows[0].Passwords || pwRows[0]) : null;
      if (!pw || !descendants.has(String(pw.folder_id))) {
        return res.status(403).json({ success: false, error: 'Password not part of this shared folder' });
      }
      nameForLog = pw.name;
    }

    await catalystApp.datastore().table('Passwords').deleteRow(targetId);

    logActivity(catalystApp, {
      action: 'Password deleted externally', user_id: '', user_email: share.shared_with || '',
      password_id: String(targetId), details: `"${nameForLog}" deleted by external user (${share.shared_with})`,
    });

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SHARE VALIDATION ──────────────────────────────────────────────────────────

app.get('/api/shares/received', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql    = catalystApp.zcql();
    const teamIds = await getUserTeamIds(catalystApp, user.user_id);

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE share_type IN ('user','team')`
    ).catch(() => []);

    const relevant = shareRows
      .map(r => r.PasswordShares || r)
      .filter(s => shareIsActive(s) &&
        (s.share_type === 'user' ? s.shared_with === user.email_id : teamIds.includes(String(s.shared_with))));

    if (relevant.length === 0) return res.json({ success: true, data: [] });

    const shareTable = catalystApp.datastore().table('PasswordShares');
    const toMark = relevant.filter(s => s.is_viewed === false || s.is_viewed === 'false');
    if (toMark.length > 0) {
      Promise.all(toMark.map(s => shareTable.updateRow({ ROWID: s.ROWID, is_viewed: true })))
        .catch(e => console.log('mark-viewed error:', e.message));
    }

    const pwIds  = [...new Set(relevant.map(s => s.password_id))];

    const [pwRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => []),
      getAllUsersCached(catalystApp).catch(() => []),
      getProfileImageRowsCached(catalystApp),
    ]);
    const pwMap = mapBy(pwRows.map(r => r.Passwords || r), p => p.ROWID);

    const userNameMap = {};
    allUsers.forEach(u => {
      userNameMap[String(u.user_id)] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id;
    });
    const userImageMap = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) userImageMap[String(u.user_id)] = u.profile_image;
    });

    const result = relevant.map(s => {
      const pw = pwMap[String(s.password_id)];
      if (!pw) return null;
      const isInactive = pw.is_active === false || pw.is_active === 'false';
      return {
        share_id: s.ROWID, password_id: pw.ROWID, folder_id: pw.folder_id || '',
        name: pw.name, category: pw.category, username: pw.username,
        password: isInactive ? null : decrypt(pw.password), url: pw.url, notes: isInactive ? null : pw.notes,
        expiry: s.expiry, permissions: isInactive ? [] : permList(s),
        is_active: !isInactive,
        shared_by_name:  userNameMap[String(s.created_by)]  || 'Unknown user',
        shared_by_image: userImageMap[String(s.created_by)] || null,
      };
    }).filter(Boolean);

    res.json({ success: true, data: result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/shares/validate/:token', async (req, res) => {
  try {
    if (!TOKEN_RE.test(req.params.token || '')) return res.status(404).json({ success: false, error: 'Invalid or expired link' });
    const catalystApp = catalyst.initialize(req);
    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE token = '${req.params.token}'`
    );
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Invalid or expired link' });

    const share      = rows[0].PasswordShares || rows[0];
    const expiryDate = new Date(share.expiry.replace(' ', 'T') + 'Z');
    if (expiryDate < new Date()) return res.status(410).json({ success: false, error: 'This link has expired' });

    res.json({ success: true, share: {
      ROWID: share.ROWID, password_id: share.password_id, description: share.description,
      expiry: share.expiry, is_viewed: share.is_viewed, share_type: share.share_type,
    }});
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/shares/verify-passphrase', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const zcql        = catalystApp.zcql();
    const { token, passphrase } = req.body;

    if (!token || !passphrase) {
      return res.status(400).json({ success: false, error: 'Token and passphrase are required' });
    }
    if (!TOKEN_RE.test(String(token))) return res.status(404).json({ success: false, error: 'Invalid link' });

    const limit = checkRateLimit(token);
    if (!limit.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many failed attempts. Try again in ${limit.remainingMin} minute${limit.remainingMin > 1 ? 's' : ''}.`,
      });
    }

    const rows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE token = '${token}'`
    );
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Invalid link' });

    const share      = rows[0].PasswordShares || rows[0];
    const expiryDate = new Date(share.expiry.replace(' ', 'T') + 'Z');
    if (expiryDate < new Date()) return res.status(410).json({ success: false, error: 'This link has expired' });

    if (!safeEqual(share.passphrase, passphrase)) {
          const attemptsLeft = recordFailedAttempt(token);
          if (attemptsLeft === 0) notifyShareOwner(catalystApp, share, 'external_share_locked', 'External link locked', 'Too many wrong passphrase attempts — the link is temporarily locked.');
          return res.status(401).json({
            success: false,
            error: `Incorrect passphrase. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          });
        }

    clearAttempts(token);

    const isFolderShare = share.share_type === 'external_folder';
    const [, dataRows] = await Promise.all([
      catalystApp.datastore().table('PasswordShares').updateRow({ ROWID: share.ROWID, is_viewed: true }),
      isFolderShare
        ? zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE folder_id = '${share.password_id}'`).then(async pwRows => {
            let folderName = 'Shared Folder';
            const folderRows = await zcql.executeZCQLQuery(
              `SELECT name FROM Folders WHERE ROWID = ${share.password_id}`
            ).catch(() => []);
            if (folderRows.length > 0) folderName = (folderRows[0].Folders || folderRows[0]).name;
            return { type: 'folder', folderName, passwords: pwRows.map(r => r.Passwords || r) };
          })
        : zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE ROWID = ${share.password_id}`)
            .then(pwRows => ({ type: 'password', pw: pwRows[0] ? (pwRows[0].Passwords || pwRows[0]) : null })),
    ]);

    const itemName = dataRows.type === 'folder' ? dataRows.folderName : dataRows.pw?.name || '';
    logActivity(catalystApp, {
      action: isFolderShare ? 'External folder share viewed' : 'External share viewed',
      user_id: '', user_email: share.shared_with || '',
      password_id: String(share.password_id),
      details: itemName ? `"${itemName}" viewed by external user` : 'Viewed by external user',
    });
    notifyShareOwner(catalystApp, share, 'external_share_viewed', isFolderShare ? 'External folder opened' : 'External share opened',
      `${share.shared_with || 'An external user'} opened ${itemName ? `"${itemName}"` : 'your shared link'}`, itemName);

    if (isFolderShare) {
      return res.json({
        success: true, share_type: 'external_folder',
        folder_name: dataRows.folderName, expiry: share.expiry,
        permissions: permList(share),
        passwords: dataRows.passwords.map(pw => ({
          ROWID: pw.ROWID, name: pw.name, username: pw.username,
          password: decrypt(pw.password), url: pw.url, notes: pw.notes, category: pw.category,
        })),
      });
    }

    if (!dataRows.pw) return res.status(404).json({ success: false, error: 'Password not found' });
    const pw = dataRows.pw;
    res.json({
      success: true, share_type: 'password', expiry: share.expiry,
      permissions: permList(share),
      password: {
        name: pw.name, username: pw.username, password: decrypt(pw.password),
        url: pw.url, notes: pw.notes, expiry: share.expiry,
      },
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// // ── UNREAD COUNTS & MARK VIEWED ───────────────────────────────────────────────

// app.get('/api/shares/unread-counts', async (req, res) => {
//   try {
//     const catalystApp = catalyst.initialize(req);
//     const user = await getCurrentUser(req, catalystApp);
//     if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

//     const zcql = catalystApp.zcql();
//     const now2 = new Date();

//     const [teamRows, shareRows] = await Promise.all([
//       zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`).catch(() => []),
//       zcql.executeZCQLQuery(`SELECT * FROM PasswordShares`).catch(() => []),
//     ]);

//     const userTeamIds = teamRows.map(r => String((r.TeamMembers || r).team_id));
//     const allShares   = shareRows.map(r => r.PasswordShares || r);

//     let passwords = 0, folders = 0;
//     for (const s of allShares) {
//       if (s.is_viewed !== false && s.is_viewed !== 'false') continue;
//       if (s.share_type === 'external' || s.share_type === 'external_folder') continue;
//       if (s.expiry && new Date(s.expiry.replace(' ', 'T') + 'Z') < now2) continue;
//       if (s.shared_with !== user.email_id && !userTeamIds.includes(String(s.shared_with))) continue;
//       if (s.share_type === 'folder') folders++; else passwords++;
//     }

//     res.json({ success: true, data: { passwords, folders } });
//   } catch(e) {
//     res.status(500).json({ success: false, error: e.message });
//   }
// });

// app.post('/api/shares/mark-viewed', async (req, res) => {
//   try {
//     const catalystApp = catalyst.initialize(req);
//     const user = await getCurrentUser(req, catalystApp);
//     if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

//     const zcql = catalystApp.zcql();

//     const [teamRows, shareRows] = await Promise.all([
//       zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`).catch(() => []),
//       zcql.executeZCQLQuery(`SELECT ROWID, share_type, shared_with, is_viewed FROM PasswordShares`).catch(() => []),
//     ]);

//     const userTeamIds = teamRows.map(r => String((r.TeamMembers || r).team_id));
//     const type        = req.body.type;
//     const allShares    = shareRows.map(r => r.PasswordShares || r);

//     const toMark = allShares.filter(s => {
//       if (s.is_viewed !== false && s.is_viewed !== 'false') return false;
//       const isForMe     = s.shared_with === user.email_id;
//       const isForMyTeam = userTeamIds.includes(String(s.shared_with));
//       if (!isForMe && !isForMyTeam) return false;
//       if (type === 'folders')   return s.share_type === 'folder';
//       if (type === 'passwords') return s.share_type === 'user' || s.share_type === 'team';
//       return false;
//     });

//     const table = catalystApp.datastore().table('PasswordShares');
//     await Promise.all(toMark.map(s => table.updateRow({ ROWID: s.ROWID, is_viewed: true })));

//     res.json({ success: true, marked: toMark.length });
//   } catch(e) {
//     res.status(500).json({ success: false, error: e.message });
//   }
// });

// ── TEAM CHAT ─────────────────────────────────────────────────────────────────
require('./chat')(app);

module.exports = app;