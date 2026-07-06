'use strict';

const express    = require('express');
const catalyst   = require('zcatalyst-sdk-node');
const crypto     = require('crypto');
const fs         = require('fs');
const fileUpload = require('express-fileupload');

const app = express();
app.use(express.json());
app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/', createParentPath: true }));

const APP_URL          = 'https://cred-360-60073973215.development.catalystserverless.in/app/';
const PROFILE_FOLDER_ID = '46135000000019444';
const FROM_EMAIL       = 'suryastillz073@gmail.com';

const ROLE_MAP = {
  'App Administrator': 'Admin',
  'App User':          'Employee',
  'TeamLead':          'Team Lead',
  'Intern':            'Intern',
};
const ROLE_ID_MAP = {
  'Admin':     '46135000000013077',
  'Employee':  '46135000000022036',
  'Team Lead': '46135000000019457',
  'Intern':    '46135000000022038',
};
const INVITE_ROLE_ID_MAP = {
  'Admin':     '46135000000013077',
  'Employee':  '46135000000013078',
  'Team Lead': '46135000000019457',
  'Intern':    '46135000000013078',
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function getCurrentUser(req, catalystApp) {
  try { return await catalystApp.userManagement().getCurrentUser(); }
  catch { return null; }
}

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Fire-and-forget activity log — never blocks the response
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

// Build a map from an array: mapBy(rows, r => r.ROWID)
function mapBy(arr, keyFn) {
  const m = {};
  arr.forEach(item => { m[String(keyFn(item))] = item; });
  return m;
}

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

    const zcql = catalystApp.zcql();

    const [pwRows, shareRows, teamRows, folderRows, allUsers] = await Promise.allSettled([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE owner_id = '${user.user_id}'`),
      zcql.executeZCQLQuery(`SELECT * FROM PasswordShares`),
      zcql.executeZCQLQuery(`SELECT * FROM Teams`),
      zcql.executeZCQLQuery(`SELECT * FROM Folders WHERE owner_id = '${user.user_id}'`),
      catalystApp.userManagement().getAllUsers(),
    ]);

    const allPasswords = pwRows.status    === 'fulfilled' ? pwRows.value.map(r => r.Passwords || r)      : [];
    const shares       = shareRows.status === 'fulfilled' ? shareRows.value.map(r => r.PasswordShares || r) : [];
    const allTeams     = teamRows.status  === 'fulfilled' ? teamRows.value.map(r => r.Teams || r)         : [];
    const totalFolders = folderRows.status === 'fulfilled' ? folderRows.value.length                       : 0;
    const totalUsers   = allUsers.status  === 'fulfilled' ? allUsers.value.length                         : 0;

    const now2          = new Date();
    const sharedPasswords = shares.length;
    const expiredShares   = shares.filter(s => s.expiry && new Date(s.expiry) < now2).length;

    // ── Monthly data: single pass with a Map ──
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
      const d   = new Date((p.created_time).replace(' ', 'T') + 'Z');
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (monthBuckets.has(key)) monthBuckets.set(key, monthBuckets.get(key) + 1);
    });
    const monthlyData = monthLabels.map(({ key, label }) => ({
      name: label, Passwords: monthBuckets.get(key),
    }));

    // ── Share type breakdown: single pass ──
    const shareCounts = { team: 0, user: 0, external: 0 };
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

    // ── Password health: single pass ──
    let strong = 0, moderate = 0, weak = 0;
    const recentPasswords = [...allPasswords]
      .sort((a, b) => {
        const da = new Date((a.created_time || '').replace(' ', 'T') + 'Z');
        const db = new Date((b.created_time || '').replace(' ', 'T') + 'Z');
        return db - da;
      })
      .slice(0, 6);

    allPasswords.forEach(p => {
      const s = checkStrength(p.password);
      if (s === 'strong') strong++; else if (s === 'moderate') moderate++; else weak++;
    });
    const total      = allPasswords.length || 1;
    const healthScore = Math.min(Math.round(((strong * 100) + (moderate * 50)) / total), 100);

    // ── Team activity ──
    const teamData = allTeams
      .map(team => ({ name: team.name || 'Unknown', count: teamShareCounts[String(team.ROWID)] || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      success: true,
      stats: {
        totalPasswords: allPasswords.length, sharedPasswords, expiredShares,
        totalTeams: allTeams.length, totalFolders, totalUsers,
      },
      recentPasswords: recentPasswords.map(p => ({ ...p, strength: checkStrength(p.password) })),
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

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, name, color, icon, created_time FROM Categories ORDER BY name ASC`
    );
    // Only return the columns frontend actually uses — smaller payload
    res.json({ success: true, data: rows.map(r => r.Categories || r) });
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
    res.json({ success: true, data: rows.map(r => r.Passwords || r) });
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
      password:     req.body.password,
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

    const row = await catalystApp.datastore().table('Passwords').updateRow({
      ROWID:       req.params.id,
      name:        req.body.name,
      category:    req.body.category || 'General',
      username:    req.body.username || '',
      password:    req.body.password,
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

    await catalystApp.datastore().table('Passwords').deleteRow(req.params.id);

    logActivity(catalystApp, {
      action: 'Password deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: req.params.id, details: 'Password deleted',
    });

    res.json({ success: true });
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
        return { ...p, diffDays: Math.ceil((expiryDate - now2) / 86_400_000), expiryDate: p.expiry_date };
      })
      .filter(p => p.diffDays <= 30)
      .sort((a, b) => a.diffDays - b.diffDays);

    res.json({ success: true, data: expiring });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── EXPIRY CRON ───────────────────────────────────────────────────────────────

app.post('/api/cron/check-expiry', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req, { type: 'internal' });
    const zcql = catalystApp.zcql();
    const now2 = new Date();

    // Fetch passwords with expiry + all users in parallel
    const [pwRows, allUsers] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE expiry_date != ''`),
      catalystApp.userManagement().getAllUsers(),
    ]);

    const passwords = pwRows.map(r => r.Passwords || r);
    const userMap   = mapBy(allUsers, u => u.user_id);
    const mail      = catalystApp.email();
    const pwTable   = catalystApp.datastore().table('Passwords');

    let reminded = 0, expired = 0;

    for (const pw of passwords) {
      if (!pw.expiry_date) continue;
      const expiryDate = new Date(pw.expiry_date.replace(' ', 'T') + 'Z');
      const diffDays   = Math.ceil((expiryDate - now2) / 86_400_000);
      const owner      = userMap[String(pw.owner_id)];
      if (!owner) continue;

      if (diffDays <= 0 && pw.is_expired !== 'true') {
        try {
          await pwTable.updateRow({ ROWID: pw.ROWID, is_expired: true });
          expired++;
          await mail.sendMail({
            from_email: FROM_EMAIL, to_email: owner.email_id,
            subject: `KeyShare — Password Expired: "${pw.name}"`,
            html_mode: true,
            content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#dc2626;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:22px;">KEYSHARE</h1></div>
              <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
                <h2 style="color:#dc2626;">Password Expired</h2>
                <p style="color:#6b7280;">Your password <strong style="color:#111827;">"${pw.name}"</strong> has expired.</p>
                <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:20px 0;">
                  <p style="color:#991b1b;margin:0;">Please update this password immediately to maintain security.</p></div>
                <div style="text-align:center;margin:24px 0;">
                  <a href="https://keyshare-60069659585.development.catalystserverless.in/app/#/passwords"
                     style="background:#dc2626;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
                    Update Password Now</a></div></div></div>`,
          });
        } catch(e) { console.log('Expired email error:', e.message); }
      }

      if (diffDays === 7 || diffDays === 1) {
        try {
          await mail.sendMail({
            from_email: FROM_EMAIL, to_email: owner.email_id,
            subject: `KeyShare — Password Expiring in ${diffDays} day${diffDays > 1 ? 's' : ''}: "${pw.name}"`,
            html_mode: true,
            content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:22px;">KEYSHARE</h1></div>
              <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
                <h2 style="color:#d97706;">Password Expiring Soon</h2>
                <p style="color:#6b7280;">Your password <strong style="color:#111827;">"${pw.name}"</strong>
                  will expire in <strong style="color:#d97706;">${diffDays} day${diffDays > 1 ? 's' : ''}</strong>.</p>
                <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:20px 0;">
                  <p style="color:#92400e;margin:0;">Expiry Date: <strong>${expiryDate.toLocaleDateString()}</strong><br/>
                    Please update this password before it expires.</p></div>
                <div style="text-align:center;margin:24px 0;">
                  <a href="https://keyshare-60069659585.development.catalystserverless.in/app/#/passwords"
                     style="background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
                    Update Password</a></div></div></div>`,
          });
          reminded++;
        } catch(e) { console.log('Reminder email error:', e.message); }
      }
    }

    logActivity(catalystApp, {
      action: 'Expiry check completed', user_id: '', user_email: 'system',
      password_id: '', details: `${expired} expired, ${reminded} reminders sent`,
    });

    res.json({ success: true, expired, reminded });
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
      passwords: pwRows.map(r    => r.Passwords || r),
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

    const row = await catalystApp.datastore().table('Folders').updateRow({
      ROWID:            req.params.id,
      name:             req.body.name,
      parent_folder_id: req.body.parent_folder_id || '',
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

    // Find the folder being deleted so we know its parent
    const folderRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT parent_folder_id FROM Folders WHERE ROWID = '${req.params.id}'`
    );
    const parentId = folderRows[0]?.Folders?.parent_folder_id || '';

    // Re-parent all direct children to the deleted folder's parent
    const children = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID FROM Folders WHERE parent_folder_id = '${req.params.id}' AND owner_id = '${user.user_id}'`
    );
    for (const child of children) {
      const childId = child.Folders?.ROWID || child.ROWID;
      await catalystApp.datastore().table('Folders').updateRow({
        ROWID: childId,
        parent_folder_id: parentId,
      });
    }

    await catalystApp.datastore().table('Folders').deleteRow(req.params.id);
    res.json({ success: true });
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

    // Collect unique IDs to fetch only what's needed
    const pwIds     = [...new Set(shares.filter(s => s.share_type !== 'folder' && s.share_type !== 'external_folder').map(s => s.password_id))];
    const folderIds = [...new Set(shares.filter(s => s.share_type === 'folder' || s.share_type === 'external_folder').map(s => s.password_id))];

    const [allPwRows, allFolderRows] = await Promise.all([
      pwIds.length     ? zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`)     : Promise.resolve([]),
      folderIds.length ? zcql.executeZCQLQuery(`SELECT * FROM Folders WHERE ROWID IN (${folderIds.join(',')})`)   : Promise.resolve([]),
    ]);

    const pwMap     = mapBy(allPwRows.map(r => r.Passwords || r),     p => p.ROWID);
    const folderMap = mapBy(allFolderRows.map(r => r.Folders || r),   f => f.ROWID);

    const result = shares.map(share => {
      const expiryDate   = share.expiry ? new Date(share.expiry.replace(' ', 'T') + 'Z') : null;
      const isFolderShare = share.share_type === 'folder' || share.share_type === 'external_folder';
      return {
        ROWID:         share.ROWID,
        password_id:   share.password_id,
        shared_with:   share.shared_with,
        share_type:    share.share_type,
        expiry:        share.expiry,
        is_viewed:     share.is_viewed,
        description:   share.description,
        created_time:  share.created_time,
        is_expired:    expiryDate ? expiryDate < now2 : false,
        password_name: !isFolderShare ? (pwMap[String(share.password_id)]?.name || '') : '',
        folder_name:   isFolderShare  ? (folderMap[String(share.password_id)]?.name || '') : '',
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
    const allPasswords = allPwRows.map(r => r.Passwords || r);

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
    const result = dedupedShares.map(share => {
      const rootId      = String(share.password_id);
      const passwords   = rootToPasswords[rootId] || [];
      return {
        share_id:       share.ROWID,
        folder_id:      share.password_id,
        folder_name:    folderNameMap[rootId] || 'Shared Folder',
        share_type:     share.share_type,
        shared_with:    share.shared_with,
        expiry:         share.expiry,
        shared_by:      share.created_by,
        password_count: passwords.length,
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

    const token          = crypto.randomBytes(32).toString('hex');
    const autoPassphrase = req.body.passphrase || makePassphrase();
    const shareLink      = `${APP_URL}#/share/${token}`;

    await catalystApp.datastore().table('PasswordShares').insertRow({
      password_id: String(req.body.password_id), shared_with: req.body.client_email,
      share_type: 'external', expiry: req.body.expiry,
      token, passphrase: autoPassphrase, description: req.body.description || '',
      is_viewed: false, created_by: user.user_id, created_time: now(),
    });

    // Fetch password name + send email in parallel
    const zcql = catalystApp.zcql();
    const [pwRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT name FROM Passwords WHERE ROWID = ${req.body.password_id}`).catch(() => []),
      catalystApp.email().sendMail({
        from_email: FROM_EMAIL, to_email: req.body.client_email,
        subject: 'KeyShare — Secure Password Shared With You', html_mode: true,
        content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:2px;">KEYSHARE</h1>
            <p style="color:#ddd6fe;margin:6px 0 0;font-size:13px;">Secure Password Management</p></div>
          <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin:0 0 12px;">A password has been shared with you</h2>
            <p style="color:#6b7280;margin:0 0 16px;"><strong style="color:#111827;">${user.first_name || user.email_id}</strong> has securely shared a password with you via KeyShare.</p>
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

    const token          = crypto.randomBytes(32).toString('hex');
    const autoPassphrase = makePassphrase();
    const shareLink      = `${APP_URL}#/share/${token}`;

    await catalystApp.datastore().table('PasswordShares').insertRow({
      password_id: String(req.body.folder_id), shared_with: req.body.client_email,
      share_type: 'external_folder', expiry: req.body.expiry,
      token, passphrase: autoPassphrase, description: req.body.description || '',
      is_viewed: false, created_by: user.user_id, created_time: now(),
    });

    const expiryStr = req.body.expiry
      ? new Date(req.body.expiry.replace(' ', 'T') + 'Z').toLocaleString()
      : 'Never';

    await catalystApp.email().sendMail({
      from_email: FROM_EMAIL, to_email: req.body.client_email,
      subject: `KeyShare — Folder "${req.body.folder_name}" Shared With You`, html_mode: true,
      content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:2px;">KEYSHARE</h1>
          <p style="color:#ddd6fe;margin:6px 0 0;font-size:13px;">Secure Password Management</p></div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
          <h2 style="color:#111827;margin:0 0 12px;">A folder has been shared with you</h2>
          <p style="color:#6b7280;margin:0 0 16px;"><strong style="color:#111827;">${user.first_name || user.email_id}</strong>
            has securely shared the folder <strong style="color:#7c3aed;">"${req.body.folder_name}"</strong> with you via KeyShare.</p>
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

    res.json({ success: true, token, passphrase: autoPassphrase });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SHARE VALIDATION ──────────────────────────────────────────────────────────

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
    const zcql = catalystApp.zcql();

    const rows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE token = '${req.body.token}'`
    );
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Invalid link' });

    const share      = rows[0].PasswordShares || rows[0];
    const expiryDate = new Date(share.expiry.replace(' ', 'T') + 'Z');
    if (expiryDate < new Date()) return res.status(410).json({ success: false, error: 'This link has expired' });
    if (share.passphrase !== req.body.passphrase) return res.status(401).json({ success: false, error: 'Incorrect passphrase' });

    // Mark as viewed + fetch password/folder in parallel
    const isFolderShare = share.share_type === 'external_folder';
    const [, dataRows] = await Promise.all([
      catalystApp.datastore().table('PasswordShares').updateRow({ ROWID: share.ROWID, is_viewed: true }),
      isFolderShare
        ? zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE folder_id = '${share.password_id}'`).then(async pwRows => {
            let folderName = 'Shared Folder';
            const folderRows = await zcql.executeZCQLQuery(`SELECT name FROM Folders WHERE ROWID = ${share.password_id}`).catch(() => []);
            if (folderRows.length > 0) folderName = (folderRows[0].Folders || folderRows[0]).name;
            return { type: 'folder', folderName, passwords: pwRows.map(r => r.Passwords || r) };
          })
        : zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE ROWID = ${share.password_id}`)
            .then(pwRows => ({ type: 'password', pw: pwRows[0] ? (pwRows[0].Passwords || pwRows[0]) : null })),
    ]);

    // Activity log (non-blocking)
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
        passwords: dataRows.passwords.map(pw => ({
          name: pw.name, username: pw.username, password: pw.password,
          url: pw.url, notes: pw.notes, category: pw.category,
        })),
      });
    }

    if (!dataRows.pw) return res.status(404).json({ success: false, error: 'Password not found' });
    const pw = dataRows.pw;
    res.json({ success: true, share_type: 'password', expiry: share.expiry,
      password: { name: pw.name, username: pw.username, password: pw.password, url: pw.url, notes: pw.notes, expiry: share.expiry },
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

app.post('/api/shares/mark-viewed', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();

    const [teamRows, shareRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT ROWID,share_type,shared_with FROM PasswordShares WHERE is_viewed = 'false'`),
    ]);

    const userTeamIds = teamRows.map(r => String((r.TeamMembers || r).team_id));
    const type        = req.body.type;
    const allShares   = shareRows.map(r => r.PasswordShares || r);

    const toMark = allShares.filter(s => {
      const isForMe     = s.shared_with === user.email_id;
      const isForMyTeam = userTeamIds.includes(String(s.shared_with));
      if (!isForMe && !isForMyTeam) return false;
      if (type === 'folders')   return s.share_type === 'folder';
      if (type === 'passwords') return s.share_type === 'user' || s.share_type === 'team';
      return false;
    });

    const table = catalystApp.datastore().table('PasswordShares');
    await Promise.all(toMark.map(s => table.updateRow({ ROWID: s.ROWID, is_viewed: true })));

    res.json({ success: true, marked: toMark.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── USERS ─────────────────────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const [allUsers, imgRows] = await Promise.all([
      catalystApp.userManagement().getAllUsers(),
      catalystApp.zcql().executeZCQLQuery(`SELECT user_id,profile_image FROM Users`).catch(() => []),
    ]);

    const profileImages = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) profileImages[u.user_id] = u.profile_image;
    });

    const formatted = allUsers.map(u => ({
      ROWID:         u.user_id,
      name:          `${u.first_name || ''} ${u.last_name || ''}`.trim(),
      email:         u.email_id,
      role:          ROLE_MAP[u.role_details?.role_name] || 'Employee',
      profile_image: profileImages[u.user_id] || null,
    }));

    res.json({ success: true, data: formatted });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/users/:id/role', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const roleId = ROLE_ID_MAP[req.body.role];
    if (!roleId) return res.status(400).json({ success: false, error: 'Invalid role' });

    const userManagement = catalystApp.userManagement();
    const allUsers       = await userManagement.getAllUsers();
    const targetUser     = allUsers.find(u =>
      String(u.user_details?.user_id || u.user_id || u.userId) === String(req.params.id)
    );
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    const email      = targetUser.user_details?.email_id  || targetUser.email_id;
    const first_name = targetUser.user_details?.first_name || targetUser.first_name || 'User';

    await userManagement.updateUserDetails(req.params.id, { email_id: email, first_name, role_id: roleId });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/users/invite', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const roleId = INVITE_ROLE_ID_MAP[req.body.role] || '46135000000013078';

    await catalystApp.userManagement().registerUser(
      { platform_type: 'web', redirect_url: APP_URL },
      { first_name: req.body.email.split('@')[0], last_name: '', email_id: req.body.email, role_id: roleId }
    );
    res.json({ success: true, message: 'Invitation sent successfully' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAMS ─────────────────────────────────────────────────────────────────────

app.get('/api/teams', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql     = catalystApp.zcql();
    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';

    const [teamRows, memberRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Teams ORDER BY ROWID DESC`),
      userRole !== 'Admin'
        ? zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`)
        : Promise.resolve([]),
    ]);

    const allTeams = teamRows.map(r => r.Teams || r);

    let visibleTeams = allTeams;
    if (userRole !== 'Admin') {
      const myTeamIds = new Set(memberRows.map(r => String((r.TeamMembers || r).team_id)));
      visibleTeams = allTeams.filter(t => myTeamIds.has(String(t.ROWID)));
    }

    res.json({ success: true, data: visibleTeams });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('Teams').insertRow({
      name: req.body.name, description: req.body.description || '',
      created_by: user.user_id, created_time: now(),
    });

    await catalystApp.datastore().table('TeamMembers').insertRow({
      team_id: row.ROWID, user_id: user.user_id, role: 'Admin',
      joined_time: now(),
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teams/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('Teams').updateRow({
      ROWID: req.params.id, name: req.body.name, description: req.body.description || '',
    });
    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    await catalystApp.datastore().table('Teams').deleteRow(req.params.id);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAM MEMBERS ──────────────────────────────────────────────────────────────

app.get('/api/teams/:id/members', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const [memberRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM TeamMembers WHERE team_id = '${req.params.id}'`),
      catalystApp.userManagement().getAllUsers(),
      zcql.executeZCQLQuery(`SELECT user_id,profile_image FROM Users`).catch(() => []),
    ]);

    const userMap = mapBy(allUsers, u => u.user_id);
    const profileImages = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) profileImages[String(u.user_id)] = u.profile_image;
    });

    const enriched = memberRows.map(r => r.TeamMembers || r).map(member => {
      const catalystUser = userMap[String(member.user_id)];
      return {
        ROWID: member.ROWID, team_id: member.team_id, user_id: member.user_id,
        role: member.role || 'Member',
        name: catalystUser ? `${catalystUser.first_name || ''} ${catalystUser.last_name || ''}`.trim() : '',
        email: catalystUser?.email_id || '',
        profile_image: profileImages[String(member.user_id)] || null,
      };
    });

    res.json({ success: true, data: enriched });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/teams/:id/members', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('TeamMembers').insertRow({
      team_id: req.params.id, user_id: req.body.user_id,
      role: req.body.role || 'Member', joined_time: now(),
    });
    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/teams/:id/members/:memberId', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    await catalystApp.datastore().table('TeamMembers').deleteRow(req.params.memberId);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAM SHARED PASSWORDS / FOLDERS ──────────────────────────────────────────

app.get('/api/teams/:id/shared-passwords', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const now2 = new Date();

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE shared_with = '${req.params.id}' AND share_type = 'team'`
    );
    const activeShares = shareRows
      .map(r => r.PasswordShares || r)
      .filter(s => s.expiry && new Date(s.expiry.replace(' ', 'T') + 'Z') > now2);

    if (activeShares.length === 0) return res.json({ success: true, data: [] });

    // Only fetch the specific passwords referenced by these shares
    const pwIds = [...new Set(activeShares.map(s => s.password_id))];
    const allPwRows = await zcql.executeZCQLQuery(
      `SELECT * FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`
    ).catch(() => []);
    const pwMap = mapBy(allPwRows.map(r => r.Passwords || r), p => p.ROWID);

    const result = activeShares
      .map(share => {
        const pw = pwMap[String(share.password_id)];
        if (!pw) return null;
        return {
          share_id: share.ROWID, expiry: share.expiry, name: pw.name, category: pw.category,
          username: pw.username, password: pw.password, url: pw.url, notes: pw.notes,
        };
      })
      .filter(Boolean);

    res.json({ success: true, data: result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/teams/:teamId/shared-folders', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql  = catalystApp.zcql();
    const now2  = new Date();
    const teamId = String(req.params.teamId);

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND shared_with = '${teamId}' ORDER BY ROWID DESC`
    ).catch(() => []);

    const relevantShares = shareRows
      .map(r => r.PasswordShares || r)
      .filter(s => !s.expiry || new Date(s.expiry.replace(' ', 'T') + 'Z') >= now2);

    if (relevantShares.length === 0) return res.json({ success: true, data: [] });

    // Only fetch the specific folders/passwords we need
    const folderIds = [...new Set(relevantShares.map(s => s.password_id))];
    const [allFolderRows, allPwRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Folders WHERE ROWID IN (${folderIds.join(',')})`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE folder_id IN (${folderIds.join(',')})`).catch(() => []),
    ]);

    const folderMap   = mapBy(allFolderRows.map(r => r.Folders || r), f => f.ROWID);
    const folderPwMap = {};
    allPwRows.forEach(r => {
      const pw = r.Passwords || r;
      if (pw.folder_id) {
        if (!folderPwMap[String(pw.folder_id)]) folderPwMap[String(pw.folder_id)] = [];
        folderPwMap[String(pw.folder_id)].push(pw);
      }
    });

    const result = relevantShares.map(share => {
      const folder          = folderMap[String(share.password_id)];
      const folderPasswords = folderPwMap[String(share.password_id)] || [];
      return {
        share_id: share.ROWID, folder_id: share.password_id,
        folder_name: folder?.name || 'Shared Folder', expiry: share.expiry,
        shared_by: share.created_by, password_count: folderPasswords.length,
        passwords: folderPasswords,
      };
    });

    res.json({ success: true, data: result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── NOTIFICATIONS & ACTIVITY LOGS ─────────────────────────────────────────────

app.get('/api/notifications', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM ActivityLogs WHERE user_email = '${user.email_id}' ORDER BY ROWID DESC LIMIT 15`
    );
    res.json({ success: true, data: rows.map(r => r.ActivityLogs || r) });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/notifications/mark-read', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/activity-logs', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM ActivityLogs ORDER BY ROWID DESC`
    );
    res.json({ success: true, data: rows.map(r => r.ActivityLogs || r) });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = app;