'use strict';
const express  = require('express');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

const { encrypt, decrypt } = require('shared-utils/encryption');

const { ROLE_MAP, FROM_EMAIL, APP_URL } = require('shared-utils/constants');
const emailTpl = require('shared-utils/emailTemplates');
const { sendTemplated } = emailTpl;
const { getCurrentUser, now, logActivity, checkStrength, mapBy, escapeLike, extractDomain } = require('shared-utils/helpers');
const { permList } = require('shared-utils/permissions');

// ── EXTERNAL USERS ────────────────────────────────────────────────────────────
app.get('/api/external-users', async (req, res) => {
  try {
	const catalystApp = catalyst.initialize(req);
	const user = await getCurrentUser(req, catalystApp);
	if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

	const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
	const isAdmin  = userRole === 'Admin';
	const zcql     = catalystApp.zcql();

	const [euRows, shareRows, allUsers] = await Promise.all([
	  zcql.executeZCQLQuery(`SELECT * FROM ExternalUsers ORDER BY ROWID DESC`).catch(() => []),
	  zcql.executeZCQLQuery(
		`SELECT shared_with, created_by FROM PasswordShares WHERE share_type IN ('external','external_folder')`
	  ).catch(() => []),
	  isAdmin ? catalystApp.userManagement().getAllUsers() : Promise.resolve([]),
	]);

	const userNameMap = {};
	allUsers.forEach(u => {
	  userNameMap[String(u.user_id)] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id;
	});

	// Build email stats — count + sharer IDs
	const emailStats = {};
	shareRows.forEach(r => {
	  const s     = r.PasswordShares || r;
	  const email = (s.shared_with || '').trim().toLowerCase();
	  if (!email) return;
	  if (!emailStats[email]) emailStats[email] = { count: 0, sharerIds: new Set() };
	  emailStats[email].count++;
	  if (s.created_by) emailStats[email].sharerIds.add(String(s.created_by));
	});

	// For non-admin: only show emails THEY have shared with
  const orgView = req.query.view === 'org' && isAdmin; // only admins can request org view

// For admin: if orgView show all, else show only their own (same logic as non-admin)
const mySharedEmails = new Set();
if (!isAdmin || !orgView) {
  shareRows.forEach(r => {
	const s = r.PasswordShares || r;
	if (String(s.created_by) === String(user.user_id)) {
	  mySharedEmails.add((s.shared_with || '').trim().toLowerCase());
	}
  });
}

const myManualEmails = new Set();
if (!isAdmin || !orgView) {
  euRows.forEach(r => {
	const u = r.ExternalUsers || r;
	if (String(u.CREATORID) === String(user.user_id)) {
	  myManualEmails.add((u.email || '').trim().toLowerCase());
	}
  });
}

const allExtUsers = euRows.map(r => r.ExternalUsers || r);

const filtered = (isAdmin && orgView)
  ? allExtUsers
  : allExtUsers.filter(u => {
	  const emailKey = (u.email || '').trim().toLowerCase();
	  return mySharedEmails.has(emailKey) || myManualEmails.has(emailKey);
	});

	

const result = filtered.map(u => {
  const emailKey = (u.email || '').trim().toLowerCase();
  const stat     = emailStats[emailKey] || { count: 0, sharerIds: new Set() };
  const isMine   = mySharedEmails.has(emailKey) || myManualEmails.has(emailKey);

  const base = {
	...u,
	share_count: stat.count,
	can_edit: isAdmin || isMine,
  };

  if (isAdmin) {
	base.shared_by = [...stat.sharerIds].map(id => ({
	  user_id: id, name: userNameMap[id] || 'Unknown user',
	}));
  }

  return base;
});

	res.json({ success: true, data: result, is_admin: isAdmin });
  } catch(e) {
	res.status(500).json({ success: false, error: e.message });
  }
});


app.delete('/api/external-users/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM ExternalUsers WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const extUser = rows[0] ? (rows[0].ExternalUsers || rows[0]) : null;
    if (!extUser) return res.status(404).json({ success: false, error: 'External user not found' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    const isOwner  = String(extUser.created_by) === String(user.user_id);
    if (userRole !== 'Admin' && !isOwner) {
      return res.status(403).json({ success: false, error: 'You can only delete external users you added' });
    }

    await catalystApp.datastore().table('ExternalUsers').deleteRow(req.params.id);

    logActivity(catalystApp, {
      action: 'External user deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Deleted external user record: ${extUser.email}`,
    });

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/external-users/manual', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { name, company, notes } = req.body;
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const existing = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ExternalUsers WHERE email = '${email}'`
    ).catch(() => []);
    if (existing.length > 0) return res.status(409).json({ success: false, error: 'User already exists' });

    const row = await catalystApp.datastore().table('ExternalUsers').insertRow({
        name: name || '', email,
        domain: extractDomain(email), company: company || '',
        status: 'active', notes: notes || '',
        first_shared_time: now(), last_shared_time: now(),
        created_by: String(user.user_id),
      });

    logActivity(catalystApp, {
      action: 'External user added manually', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Manually added external user: ${email.trim()}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/external-users/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const existing = await catalystApp.zcql().executeZCQLQuery(
      `SELECT * FROM ExternalUsers WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const extUser = existing[0] ? (existing[0].ExternalUsers || existing[0]) : null;
    if (!extUser) return res.status(404).json({ success: false, error: 'External user not found' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    const isOwner  = String(extUser.created_by) === String(user.user_id);
    if (userRole !== 'Admin' && !isOwner) {
      return res.status(403).json({ success: false, error: 'You can only edit external users you added' });
    }

    const row = await catalystApp.datastore().table('ExternalUsers').updateRow({
      ROWID:   req.params.id,
      name:    req.body.name    !== undefined ? req.body.name    : (extUser.name    || ''),
      company: req.body.company !== undefined ? req.body.company : (extUser.company || ''),
      status:  req.body.status  !== undefined ? req.body.status  : (extUser.status  || 'active'),
      notes:   req.body.notes   !== undefined ? req.body.notes   : (extUser.notes   || ''),
    });

    logActivity(catalystApp, {
      action: 'External user updated', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Updated external user record: ${req.body.name || extUser.email}`,
    });

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/external-users/:id/favorite', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const row = await catalystApp.datastore().table('ExternalUsers').updateRow({
      ROWID: req.params.id, is_favorite: !!req.body.is_favorite,
    });
    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/external-users/:id/analytics', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    const isAdmin  = userRole === 'Admin';
    const zcql = catalystApp.zcql();

    const rows = await zcql.executeZCQLQuery(
      `SELECT * FROM ExternalUsers WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const extUser = rows[0] ? (rows[0].ExternalUsers || rows[0]) : null;
    if (!extUser) return res.status(404).json({ success: false, error: 'External user not found' });

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE shared_with = '${extUser.email}' AND share_type IN ('external','external_folder') ORDER BY ROWID DESC`
    ).catch(() => []);
    let shares = shareRows.map(r => r.PasswordShares || r);

    if (!isAdmin) {
      shares = shares.filter(s => String(s.created_by) === String(user.user_id));
    }

    const now2 = new Date();
    const active  = shares.filter(s => !s.expiry || new Date(s.expiry.replace(' ', 'T') + 'Z') > now2).length;
    const expired = shares.length - active;
    const passwordShares = shares.filter(s => s.share_type === 'external').length;
    const folderShares   = shares.filter(s => s.share_type === 'external_folder').length;

    const pwIds     = shares.filter(s => s.share_type === 'external').map(s => s.password_id);
    const folderIds = shares.filter(s => s.share_type === 'external_folder').map(s => s.password_id);

    const [pwRows, folderRows, allUsers] = await Promise.all([
      pwIds.length     ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => [])     : Promise.resolve([]),
      folderIds.length ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Folders WHERE ROWID IN (${folderIds.join(',')})`).catch(() => [])   : Promise.resolve([]),
      isAdmin ? catalystApp.userManagement().getAllUsers() : Promise.resolve([]),
    ]);
    const pwNameMap     = mapBy(pwRows.map(r => r.Passwords || r), p => p.ROWID);
    const folderNameMap = mapBy(folderRows.map(r => r.Folders || r), f => f.ROWID);
    const userNameMap   = {};
    allUsers.forEach(u => { userNameMap[String(u.user_id)] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id; });

    const timeline = shares.map(s => ({
      ROWID: s.ROWID,
      type: s.share_type === 'external_folder' ? 'folder' : 'password',
      item_name: s.share_type === 'external_folder'
        ? (folderNameMap[String(s.password_id)]?.name || 'Folder')
        : (pwNameMap[String(s.password_id)]?.name || 'Password'),
      expiry: s.expiry,
      is_expired: s.expiry ? new Date(s.expiry.replace(' ', 'T') + 'Z') < now2 : false,
      permissions: permList(s),
      created_time: s.created_time,
      shared_by: isAdmin ? (userNameMap[String(s.created_by)] || 'Unknown') : undefined,
    }));

    res.json({
      success: true,
      analytics: { total: shares.length, active, expired, passwordShares, folderShares, timeline },
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SEARCH ────────────────────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, data: { passwords: [], folders: [], teams: [], users: [], externalUsers: [] } });
    }

    const zcql     = catalystApp.zcql();
    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    const isAdmin  = userRole === 'Admin';

    const [pwRows, folderRows, teamRows, allUsers, extRows] = await Promise.all([
      zcql.executeZCQLQuery(
        `SELECT ROWID, name, username, category, folder_id FROM Passwords WHERE owner_id = '${user.user_id}'`
      ).catch(e => { console.log('Search passwords error:', e.message); return []; }),
      zcql.executeZCQLQuery(
        `SELECT ROWID, name FROM Folders WHERE owner_id = '${user.user_id}'`
      ).catch(e => { console.log('Search folders error:', e.message); return []; }),
      zcql.executeZCQLQuery(
        `SELECT ROWID, name, description FROM Teams`
      ).catch(e => { console.log('Search teams error:', e.message); return []; }),
      catalystApp.userManagement().getAllUsers().catch(() => []),
      zcql.executeZCQLQuery(
        `SELECT ROWID, name, email, company FROM ExternalUsers`
      ).catch(e => { console.log('Search external users error:', e.message); return []; }),
    ]);

    const qLower = q.toLowerCase();
    const matchedUsers = allUsers
      .filter(u => {
        const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
        return name.includes(qLower) || (u.email_id || '').toLowerCase().includes(qLower);
      })
      .slice(0, 5)
      .map(u => ({
        ROWID: u.user_id,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id,
        email: u.email_id,
      }));

    const matchedPasswords = pwRows.map(r => r.Passwords || r)
      .filter(p => (p.name || '').toLowerCase().includes(qLower))
      .slice(0, 5);

    const matchedFolders = folderRows.map(r => r.Folders || r)
      .filter(f => (f.name || '').toLowerCase().includes(qLower))
      .slice(0, 5);

    const matchedTeams = teamRows.map(r => r.Teams || r)
      .filter(t => (t.name || '').toLowerCase().includes(qLower) || (t.description || '').toLowerCase().includes(qLower))
      .slice(0, 5);

    let externalUsers = extRows.map(r => r.ExternalUsers || r).filter(u =>
      (u.email || '').toLowerCase().includes(qLower) ||
      (u.name || '').toLowerCase().includes(qLower) ||
      (u.company || '').toLowerCase().includes(qLower)
    );

    if (!isAdmin) {
      const shareRows = await zcql.executeZCQLQuery(
        `SELECT shared_with FROM PasswordShares WHERE share_type IN ('external','external_folder') AND created_by = '${user.user_id}'`
      ).catch(() => []);
      const mine = new Set(shareRows.map(r => ((r.PasswordShares || r).shared_with || '').trim().toLowerCase()));
      externalUsers = externalUsers.filter(u => mine.has(u.email));
    }

    res.json({
      success: true,
      data: {
        passwords:     matchedPasswords,
        folders:       matchedFolders,
        teams:         matchedTeams,
        users:         matchedUsers,
        externalUsers: externalUsers.slice(0, 5),
      },
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── USER ANALYTICS ────────────────────────────────────────────────────────────

app.get('/api/users/:id/analytics', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') return res.status(403).json({ success: false, error: 'Admin access required' });

    const targetId = req.params.id;
    const zcql = catalystApp.zcql();

    const allUsers  = await catalystApp.userManagement().getAllUsers().catch(() => []);
    const targetUser = allUsers.find(u => String(u.user_id) === String(targetId));
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    const targetEmail = targetUser.email_id;
    const targetName  = `${targetUser.first_name || ''} ${targetUser.last_name || ''}`.trim() || targetEmail;

    const [
      pwRows, folderRows, teamMemberRows, allTeamRows,
      sharesGivenRows, sharesReceivedRows, extUserRows,
    ] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE owner_id = '${targetId}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT * FROM Folders WHERE owner_id = '${targetId}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${targetId}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT ROWID, name, description FROM Teams`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT * FROM PasswordShares WHERE created_by = '${targetId}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT * FROM PasswordShares WHERE share_type IN ('user','folder') AND shared_with = '${targetEmail}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT * FROM ExternalUsers WHERE created_by = '${targetId}'`).catch(() => []),
    ]);

    const passwords = pwRows.map(r => r.Passwords || r);
    const folders    = folderRows.map(r => r.Folders || r);
    const allTeams    = allTeamRows.map(r => r.Teams || r);
    const teamIds     = teamMemberRows.map(r => String((r.TeamMembers || r).team_id));
    const myTeams      = allTeams.filter(t => teamIds.includes(String(t.ROWID)));

    const sharesGiven    = sharesGivenRows.map(r => r.PasswordShares || r);
    const sharesReceived = sharesReceivedRows.map(r => r.PasswordShares || r);
    const externalUsers  = extUserRows.map(r => r.ExternalUsers || r);

    const now2 = new Date();
    const isActive = s => !s.expiry || new Date(s.expiry.replace(' ', 'T') + 'Z') > now2;

    const shareBreakdown = { user: 0, team: 0, folder: 0, external: 0, external_folder: 0 };
    sharesGiven.forEach(s => { if (s.share_type in shareBreakdown) shareBreakdown[s.share_type]++; });

    let strong = 0, moderate = 0, weak = 0;
	passwords.forEach(p => {
	const s = checkStrength(decrypt(p.password));
	if (s === 'strong') strong++; else if (s === 'moderate') moderate++; else weak++;
	});

    const expiringPasswords = passwords
      .filter(p => p.expiry_date)
      .map(p => ({
        ...p,
        diffDays: Math.ceil((new Date(p.expiry_date.replace(' ', 'T') + 'Z') - now2) / 86_400_000),
      }))
      .filter(p => p.diffDays <= 30)
      .sort((a, b) => a.diffDays - b.diffDays);

    res.json({
      success: true,
      analytics: {
        user: { ROWID: targetId, name: targetName, email: targetEmail, role: ROLE_MAP[targetUser.role_details?.role_name] || 'Employee', profile_image: null },
        stats: {
          totalPasswords: passwords.length,
          totalFolders: folders.length,
          totalTeams: myTeams.length,
          sharesGiven: sharesGiven.length,
          sharesReceived: sharesReceived.length,
          externalUsersManaged: externalUsers.length,
          activeShares: sharesGiven.filter(isActive).length,
          expiredShares: sharesGiven.filter(s => !isActive(s)).length,
        },
        passwordHealth: { strong, moderate, weak, total: passwords.length },
        passwords: passwords.slice(0, 50).map(p => ({
          ROWID: p.ROWID, name: p.name, category: p.category, folder_id: p.folder_id,
          created_time: p.created_time, expiry_date: p.expiry_date,
        })),
        folders: folders.map(f => ({ ROWID: f.ROWID, name: f.name, parent_folder_id: f.parent_folder_id })),
        teams: myTeams.map(t => ({ ROWID: t.ROWID, name: t.name, description: t.description })),
        externalUsers: externalUsers.map(u => ({
          ROWID: u.ROWID, name: u.name, email: u.email, company: u.company, status: u.status,
        })),
        shareBreakdown,
        expiringPasswords: expiringPasswords.slice(0, 10),
      },
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── CRON: EXPIRY CHECK ────────────────────────────────────────────────────────

app.post('/api/cron/check-expiry', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req, { type: 'internal' });
    const zcql = catalystApp.zcql();
    const now2 = new Date();

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
          await sendTemplated(catalystApp, owner.email_id, emailTpl.passwordExpired({
            name: pw.name, link: `${APP_URL}#/passwords`,
          }));
        } catch(e) { console.log('Expired email error:', e.message); }
      }

      if (diffDays === 7 || diffDays === 1) {
        try {
          await sendTemplated(catalystApp, owner.email_id, emailTpl.passwordExpiring({
            name: pw.name, days: diffDays, expiryDate: pw.expiry_date, link: `${APP_URL}#/passwords`,
          }));
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

module.exports = app;