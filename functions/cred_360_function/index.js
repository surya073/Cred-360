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
const { getCurrentUser, now, logActivity, checkStrength, mapBy, escapeLike, extractDomain, upsertExternalUser, isExternalUserBlocked } = require('shared-utils/helpers');
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

    // Fetch existing row + upload new image in parallel
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

    // Delete old image + save new fileId in parallel
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
// Optimization: all 5 queries run in parallel via Promise.allSettled (unchanged),
// but monthly grouping uses a Map for O(n) instead of repeated .filter() calls,
// and strength tallying is done in a single pass.

app.get('/api/dashboard', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql     = catalystApp.zcql();
    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    const isAdmin  = userRole === 'Admin';

    const [pwRows, shareRows, teamRows, folderRows, allUsers] = await Promise.allSettled([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE owner_id = '${user.user_id}'`),
      // Admin sees all shares; others see only their own created shares
      isAdmin
        ? zcql.executeZCQLQuery(`SELECT * FROM PasswordShares`)
        : zcql.executeZCQLQuery(`SELECT * FROM PasswordShares WHERE created_by = '${user.user_id}'`),
      zcql.executeZCQLQuery(`SELECT * FROM Teams`),
      // Admin sees all folders; others see only their own
      isAdmin
        ? zcql.executeZCQLQuery(`SELECT * FROM Folders`)
        : zcql.executeZCQLQuery(`SELECT * FROM Folders WHERE owner_id = '${user.user_id}'`),
      catalystApp.userManagement().getAllUsers(),
    ]);

    const allPasswords = pwRows.status     === 'fulfilled' ? pwRows.value.map(r => r.Passwords || r)        : [];
    const shares       = shareRows.status  === 'fulfilled' ? shareRows.value.map(r => r.PasswordShares || r) : [];
    const allTeams     = teamRows.status   === 'fulfilled' ? teamRows.value.map(r => r.Teams || r)           : [];
    const totalFolders = folderRows.status === 'fulfilled' ? folderRows.value.length                         : 0;
    const totalUsers   = allUsers.status   === 'fulfilled' ? allUsers.value.length                           : 0;

    const now2            = new Date();
    const sharedPasswords = shares.length;
    const expiredShares   = shares.filter(s => s.expiry && new Date(s.expiry) < now2).length;

    // ── Monthly data ──
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

    // ── Share type breakdown ──
    const shareCounts     = { team: 0, user: 0, external: 0 };
    const teamShareCounts = {};
    shares.forEach(s => {
      if (s.share_type in shareCounts) shareCounts[s.share_type]++;
      if (s.share_type === 'team') {
        teamShareCounts[s.shared_with] = (teamShareCounts[s.shared_with] || 0) + 1;
      }
    });
    const shareTypeData = [
      { name: 'Team shares',     value: shareCounts.team     },
      { name: 'User shares',     value: shareCounts.user     },
      { name: 'External shares', value: shareCounts.external },
    ];

    // ── Password health ──
    let strong = 0, moderate = 0, weak = 0;
    const recentPasswords = [...allPasswords]
      .sort((a, b) => {
        const da = new Date((a.created_time || '').replace(' ', 'T') + 'Z');
        const db = new Date((b.created_time || '').replace(' ', 'T') + 'Z');
        return db - da;
      })
      .slice(0, 6);

    allPasswords.forEach(p => {
      const s = checkStrength(decrypt(p.password));
      if (s === 'strong') strong++;
      else if (s === 'moderate') moderate++;
      else weak++;
    });
    const total      = allPasswords.length || 1;
    const healthScore = Math.min(Math.round(((strong * 100) + (moderate * 50)) / total), 100);

    // ── Team activity ──
    // Admin: show all teams; others: show only teams they're in
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

    res.json({
      success: true,
      isAdmin,
      stats: {
        totalPasswords: allPasswords.length,
        sharedPasswords,
        expiredShares,
        totalTeams: visibleTeams.length,
        totalFolders,
        totalUsers
      },
      recentPasswords: recentPasswords.map(p => ({ ...p, password: decrypt(p.password), strength: checkStrength(decrypt(p.password)) })),
      monthlyData,
      shareTypeData,
      healthData: { score: healthScore, strong, moderate, weak },
      teamData,
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
      catalystApp.userManagement().getAllUsers(),
    ]);

    const userMap = {};
    allUsers.forEach(u => {
      userMap[String(u.user_id)] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id;
    });

    let categories = rows.map(r => r.Categories || r);

    // Non-admins only see their own
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

    // Run duplicate check + insert as a try — let DB unique constraint handle it
    // instead of a separate SELECT round-trip before every insert
    try {
      const row = await catalystApp.datastore().table('Categories').insertRow({
        name:         name.trim(),
        color:        color || '#7c3aed',
        icon:         icon  || 'tag',
        created_by:   user.user_id,
        created_time: now(),
      });
      // Fire-and-forget — doesn't block response
      logActivity(catalystApp, {
        action: 'Category created', user_id: user.user_id, user_email: user.email_id,
        password_id: '', details: `Created category: ${name.trim()}`,
      });
      return res.json({ success: true, data: row });
    } catch (insertErr) {
      // Catalyst throws on duplicate if you set a unique constraint on `name`
      // If not using DB constraint, fall back to a name check
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

    // Check if in use + delete in parallel — saves one round-trip wait
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
      // password:     req.body.password,
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
      // password:    req.body.password,
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

    // Only the owner can toggle active/inactive — this is a kill switch, not a regular edit
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

    const rows = await catalystApp.zcql().executeZCQLQuery(
      // Only fetch rows that actually have an expiry_date — avoids filtering in JS
      `SELECT * FROM Passwords WHERE owner_id = '${user.user_id}' AND expiry_date != '' ORDER BY ROWID DESC`
    );
    const now2 = new Date();
    const expiring = rows
      .map(r => r.Passwords || r)
      .map(p => {
        const expiryDate = new Date(p.expiry_date.replace(' ', 'T') + 'Z');
        return { ...p, password: decrypt(p.password), diffDays: Math.ceil((expiryDate - now2) / 86_400_000), expiryDate: p.expiry_date };
      })
      .filter(p => p.diffDays <= 30)
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

    // 2 queries in parallel instead of 2 sequential round trips
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

    const row = await catalystApp.datastore().table('Folders').updateRow({
      ROWID:            req.params.id,
      name:             req.body.name,
      parent_folder_id: req.body.parent_folder_id || '',
    });

    logActivity(catalystApp, {
      action: 'Folder updated', user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id, details: `Renamed folder to: ${req.body.name}`,
    });

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

    // ── Collect ALL descendant folder IDs (BFS) ──────────────────────────────
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

    // ── Delete all passwords inside ALL these folders ─────────────────────────
    const pwRows = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM Passwords WHERE folder_id IN (${idList.join(',')})`
    ).catch(() => []);

    const pwTable     = catalystApp.datastore().table('Passwords');
    const folderTable = catalystApp.datastore().table('Folders');

    await Promise.all(
      pwRows.map(r => pwTable.deleteRow(String((r.Passwords || r).ROWID)))
    );

    // ── Delete all folders (children first, then root) ────────────────────────
    // Reverse BFS order so children are deleted before parents
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

    // Resolve names for the log in parallel
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

    // Resolve passwords, folders, ALL teams, and users in parallel
    const [allPwRows, allFolderRows, allTeamRows, allUsers] = await Promise.all([
      pwIds.length     ? zcql.executeZCQLQuery(`SELECT ROWID, name, is_active FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => [])   : Promise.resolve([]),
      folderIds.length ? zcql.executeZCQLQuery(`SELECT ROWID, name, is_active FROM Folders WHERE ROWID IN (${folderIds.join(',')})`).catch(() => []) : Promise.resolve([]),
      hasTeamShares    ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Teams`).catch(() => [])                                                       : Promise.resolve([]),
      catalystApp.userManagement().getAllUsers().catch(() => []),
    ]);

    const pwMap     = mapBy(allPwRows.map(r => r.Passwords || r),   p => p.ROWID);
    const folderMap = mapBy(allFolderRows.map(r => r.Folders || r), f => f.ROWID);
    const teamMap   = mapBy(allTeamRows.map(r => r.Teams || r),     t => t.ROWID);

    // Build email → display name map for user shares
    const userNameMap = {};
    allUsers.forEach(u => {
      userNameMap[u.email_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id;
    });

    const result = shares.map(share => {
      const expiryDate    = share.expiry ? new Date(share.expiry.replace(' ', 'T') + 'Z') : null;
      const isFolderShare = share.share_type === 'folder' || share.share_type === 'external_folder';
      const isTeamShare   = share.share_type === 'team';

      // Resolve "Shared With" to a human-readable label
      const looksLikeId = !String(share.shared_with).includes('@');
      let sharedWithLabel = share.shared_with;

      if (isTeamShare || (isFolderShare && looksLikeId)) {
        // team share OR folder-shared-with-a-team — both use a team ROWID
        sharedWithLabel = teamMap[String(share.shared_with)]?.name || `Team #${share.shared_with}`;
      } else if (share.share_type === 'user' || (isFolderShare && !looksLikeId)) {
        // user share OR folder-shared-with-a-user — both use an email
        sharedWithLabel = userNameMap[share.shared_with] || share.shared_with;
      }
      // external / external_folder: shared_with is already a plain email, use as-is

      // Surface active/inactive state of the underlying item
      const pwRow     = !isFolderShare ? pwMap[String(share.password_id)]     : null;
      const folderRow = isFolderShare  ? folderMap[String(share.password_id)] : null;
      const itemActive = isFolderShare
        ? !(folderRow?.is_active === false || folderRow?.is_active === 'false')
        : !(pwRow?.is_active === false || pwRow?.is_active === 'false');

      return {
        ROWID:              share.ROWID,
        password_id:        share.password_id,
        shared_with:        share.shared_with,
        shared_with_label:  sharedWithLabel,       // ← new: resolved display name
        share_type:         share.share_type,
        expiry:             share.expiry,
        is_viewed:          share.is_viewed,
        description:        share.description,
        created_time:       share.created_time,
        is_expired:         expiryDate ? expiryDate < now2 : false,
        permissions:        permList(share),
        item_is_active:     itemActive,             // ← new: owner toggled it inactive
        password_name:      !isFolderShare ? (pwRow?.name || '') : '',
        folder_name:        isFolderShare  ? (folderRow?.name || '') : '',
      };
    });

    res.json({ success: true, data: result });
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

    // Delete the share immediately; resolve the item name in parallel
    const isFolderShare = shareDetails?.share_type === 'folder' || shareDetails?.share_type === 'external_folder';
    const [, nameRows] = await Promise.all([
      catalystApp.datastore().table('PasswordShares').deleteRow(req.params.id),
      shareDetails
        ? isFolderShare
          ? zcql.executeZCQLQuery(`SELECT name FROM Folders WHERE ROWID = ${shareDetails.password_id}`).catch(() => [])
          : zcql.executeZCQLQuery(`SELECT name FROM Passwords WHERE ROWID = ${shareDetails.password_id}`).catch(() => [])
        : Promise.resolve([]),
    ]);

    const itemName   = nameRows.length > 0 ? ((isFolderShare ? nameRows[0].Folders : nameRows[0].Passwords) || nameRows[0]).name : '';
    const logDetails = shareDetails
      ? `Revoked ${shareDetails.share_type} share of "${itemName}" with ${shareDetails.shared_with}`
      : 'Share revoked';

    logActivity(catalystApp, {
      action: 'Share revoked', user_id: user.user_id, user_email: user.email_id,
      password_id: shareDetails?.password_id || '', details: logDetails,
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

    // ── 1. Get shares for this user ──────────────────────────────────────────
    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND shared_with = '${user.email_id}' ORDER BY ROWID DESC`
    ).catch(() => []);

    const relevantShares = shareRows
      .map(r => r.PasswordShares || r)
      .filter(s => !s.expiry || new Date(s.expiry.replace(' ', 'T') + 'Z') >= now2);

    if (relevantShares.length === 0) return res.json({ success: true, data: [] });

    // Deduplicate by folder_id upfront (no need to track `seen` later)
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

    // ── 2. Single pass: walk ALL child folders iteratively ───────────────────
    // Builds a map: rootFolderId → Set of all its descendant folder IDs
    // Uses breadth-first expansion with one DB query per level (not per folder)
    const rootToDescendants = {};
    rootFolderIds.forEach(id => { rootToDescendants[id] = new Set([id]); });

    // fetch root folder names in the same pass
    const rootFolderRows = await zcql.executeZCQLQuery(
      `SELECT ROWID, name FROM Folders WHERE ROWID IN (${rootFolderIds.join(',')})`
    ).catch(() => []);
    const folderNameMap = {};
    rootFolderRows.forEach(r => {
      const f = r.Folders || r;
      folderNameMap[String(f.ROWID)] = f.name;
    });

    // BFS — one query per depth level across ALL roots at once
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

        // Attach this child to whichever root owns its parent
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

    // ── 3. Fetch ALL passwords in one query ──────────────────────────────────
    const allDescendantIds = [...new Set(Object.values(rootToDescendants).flatMap(s => [...s]))];
    const allPwRows = await zcql.executeZCQLQuery(
      `SELECT * FROM Passwords WHERE folder_id IN (${allDescendantIds.join(',')})`
    ).catch(() => []);
    const allPasswords = allPwRows.map(r => r.Passwords || r).map(p => {
      const pwInactive = p.is_active === false || p.is_active === 'false';
      return { ...p, password: pwInactive ? null : decrypt(p.password), notes: pwInactive ? null : p.notes };
    });

    // ── 4. Assign passwords to their root folder ─────────────────────────────
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

// ── 5. Build response — no extra async calls ─────────────────────────────
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

    // Resolve names in parallel
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

    // Fetch password name + send email in parallel
    const zcql = catalystApp.zcql();
    const [pwRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT name FROM Passwords WHERE ROWID = ${req.body.password_id}`).catch(() => []),
      catalystApp.email().sendMail({
        from_email: FROM_EMAIL, to_email: req.body.client_email,
        subject: 'CRED-360 — Secure Password Shared With You', html_mode: true,
        content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:2px;">CRED-360</h1>
            <p style="color:#ddd6fe;margin:6px 0 0;font-size:13px;">Secure Password Management</p></div>
          <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin:0 0 12px;">A password has been shared with you</h2>
            <p style="color:#6b7280;margin:0 0 16px;"><strong style="color:#111827;">${user.first_name || user.email_id}</strong> has securely shared a password with you via CRED-360.</p>
            ${req.body.description ? `<p style="color:#6b7280;margin:0 0 16px;"><strong style="color:#111827;">Description:</strong> ${req.body.description}</p>` : ''}
            <div style="background:#f5f3ff;border:2px solid #7c3aed;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
              <p style="color:#6b7280;margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Your Access Passphrase</p>
              <div style="font-size:24px;font-weight:700;color:#7c3aed;letter-spacing:3px;font-family:monospace;">${autoPassphrase}</div>
              <p style="color:#9ca3af;margin:8px 0 0;font-size:12px;">You will need this passphrase to view the shared password</p></div>
            <div style="text-align:center;margin:28px 0;">
              <a href="${shareLink}" style="background:#7c3aed;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">View Shared Password</a></div>
            <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:16px 0;">
              <p style="color:#92400e;margin:0;font-size:13px;"><strong>Security Notice:</strong> This link expires on
                <strong>${new Date(req.body.expiry.replace(' ', 'T') + 'Z').toLocaleString()}</strong>. Do not forward this email.</p></div></div></div>`,
      }).catch(e => console.log('Email send error:', e.message)),
    ]);

    const passwordName = pwRows.length > 0 ? (pwRows[0].Passwords || pwRows[0]).name : '';
    logActivity(catalystApp, {
      action: 'External share created', user_id: user.user_id, user_email: user.email_id,
      password_id: String(req.body.password_id),
      details: `"${passwordName}" shared externally with ${req.body.client_email}`,
    });
    upsertExternalUser(catalystApp, req.body.client_email, user.user_id);

    res.json({ success: true, token, passphrase: autoPassphrase });
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
    const expiryStr = req.body.expiry
      ? new Date(req.body.expiry.replace(' ', 'T') + 'Z').toLocaleString()
      : 'Never';

    await catalystApp.email().sendMail({
      from_email: FROM_EMAIL, to_email: req.body.client_email,
      subject: `CRED-360 — Folder "${req.body.folder_name}" Shared With You`, html_mode: true,
      content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:2px;">CRED-360</h1>
          <p style="color:#ddd6fe;margin:6px 0 0;font-size:13px;">Secure Password Management</p></div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
          <h2 style="color:#111827;margin:0 0 12px;">A folder has been shared with you</h2>
          <p style="color:#6b7280;margin:0 0 16px;"><strong style="color:#111827;">${user.first_name || user.email_id}</strong>
            has securely shared the folder <strong style="color:#7c3aed;">"${req.body.folder_name}"</strong> with you via CRED-360.</p>
          ${req.body.description ? `<p style="color:#6b7280;margin:0 0 16px;"><strong style="color:#111827;">Description:</strong> ${req.body.description}</p>` : ''}
          <p style="color:#6b7280;margin:0 0 20px;">This folder contains <strong style="color:#111827;">${req.body.password_count} password${req.body.password_count > 1 ? 's' : ''}</strong>.</p>
          <div style="background:#f5f3ff;border:2px solid #7c3aed;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
            <p style="color:#6b7280;margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Your Access Passphrase</p>
            <div style="font-size:24px;font-weight:700;color:#7c3aed;letter-spacing:3px;font-family:monospace;">${autoPassphrase}</div></div>
          <div style="text-align:center;margin:28px 0;">
            <a href="${shareLink}" style="background:#7c3aed;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">View Shared Folder</a></div>
          <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:16px 0;">
            <p style="color:#92400e;margin:0;font-size:13px;"><strong>Security Notice:</strong> This link expires on <strong>${expiryStr}</strong>. Do not forward this email.</p></div></div></div>`,
    }).catch(e => console.log('Email send error:', e.message));

    logActivity(catalystApp, {
      action: 'External folder share created', user_id: user.user_id, user_email: user.email_id,
      password_id: String(req.body.folder_id),
      details: `Folder "${req.body.folder_name}" shared with ${req.body.client_email}`,
    });
    upsertExternalUser(catalystApp, req.body.client_email, user.user_id);

    res.json({ success: true, token, passphrase: autoPassphrase });
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

    // For folder shares, make sure this password actually belongs to the shared folder tree
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

    // Fire-and-forget: mark newly-viewed shares as viewed, don't block the response
    const shareTable = catalystApp.datastore().table('PasswordShares');
    const toMark = relevant.filter(s => s.is_viewed === false || s.is_viewed === 'false');
    if (toMark.length > 0) {
      Promise.all(toMark.map(s => shareTable.updateRow({ ROWID: s.ROWID, is_viewed: true })))
        .catch(e => console.log('mark-viewed error:', e.message));
    }

    const pwIds  = [...new Set(relevant.map(s => s.password_id))];

    // Resolve sharer names + profile images alongside the password fetch
    const [pwRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => []),
      catalystApp.userManagement().getAllUsers().catch(() => []),
      zcql.executeZCQLQuery(`SELECT user_id,profile_image FROM Users`).catch(() => []),
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

    // ── Rate limit check ──────────────────────────────────────────────────
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

    // ── Passphrase check ──────────────────────────────────────────────────
    
    if (share.passphrase !== passphrase) {
          const attemptsLeft = recordFailedAttempt(token);
          return res.status(401).json({
            success: false,
            error: `Incorrect passphrase. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          });
        }

    // ── Success — clear attempts ───────────────────────────────────────────
    clearAttempts(token);

    // Mark as viewed + fetch password/folder in parallel
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

// ── UNREAD COUNTS & MARK VIEWED ───────────────────────────────────────────────

// app.get('/api/shares/unread-counts', async (req, res) => {
//   try {
//     const catalystApp = catalyst.initialize(req);
//     const user = await getCurrentUser(req, catalystApp);
//     if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

//     const zcql = catalystApp.zcql();
//     const now2 = new Date();

//     const [teamRows, shareRows] = await Promise.all([
//       zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`).catch(() => []),
//       zcql.executeZCQLQuery(`SELECT * FROM PasswordShares WHERE is_viewed = 'false'`).catch(() => []),
//     ]);

//     const userTeamIds = teamRows.map(r => String((r.TeamMembers || r).team_id));
//     const allShares   = shareRows.map(r => r.PasswordShares || r);

//     let passwords = 0, folders = 0;
//     for (const s of allShares) {
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

//   app.post('/api/shares/mark-viewed', async (req, res) => {
//     try {
//       const catalystApp = catalyst.initialize(req);
//       const user = await getCurrentUser(req, catalystApp);
//       if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

//       const zcql = catalystApp.zcql();

//       const [teamRows, shareRows] = await Promise.all([
//         zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`).catch(() => []),
//         zcql.executeZCQLQuery(`SELECT ROWID,share_type,shared_with FROM PasswordShares WHERE is_viewed = 'false'`),
//       ]);

//       const userTeamIds = teamRows.map(r => String((r.TeamMembers || r).team_id));
//       const type        = req.body.type;
//       const allShares   = shareRows.map(r => r.PasswordShares || r);

//       const toMark = allShares.filter(s => {
//         const isForMe     = s.shared_with === user.email_id;
//         const isForMyTeam = userTeamIds.includes(String(s.shared_with));
//         if (!isForMe && !isForMyTeam) return false;
//         if (type === 'folders')   return s.share_type === 'folder';
//         if (type === 'passwords') return s.share_type === 'user' || s.share_type === 'team';
//         return false;
//       });

//       const table = catalystApp.datastore().table('PasswordShares');
//       await Promise.all(toMark.map(s => table.updateRow({ ROWID: s.ROWID, is_viewed: true })));

//       res.json({ success: true, marked: toMark.length });
//     } catch(e) {
//       res.status(500).json({ success: false, error: e.message });
//     }
//   });






module.exports = app;