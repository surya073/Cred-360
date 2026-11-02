'use strict';
const express  = require('express');
const catalyst = require('zcatalyst-sdk-node');
const { encrypt, decrypt } = require('shared-utils/encryption');

const app = express();
app.use(express.json());

const { ROLE_MAP, ROLE_ID_MAP, INVITE_ROLE_ID_MAP, APP_URL } = require('shared-utils/constants');
const { getCurrentUser, now, logActivity, mapBy, pushNotification } = require('shared-utils/helpers');
const { permList, shareIsActive } = require('shared-utils/permissions');

async function getMemberPermissions(catalystApp, teamId, userId) {
  const zcql = catalystApp.zcql();
  const rows = await zcql.executeZCQLQuery(
    `SELECT permissions FROM TeamMembers WHERE team_id = '${teamId}' AND user_id = '${userId}'`
  ).catch(() => []);
  if (!rows.length) return {};
  const raw = (rows[0].TeamMembers || rows[0]).permissions;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

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

    logActivity(catalystApp, {
      action: 'Role changed', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Changed role of ${email} to ${req.body.role}`,
    });

    await pushNotification(catalystApp, {
      event_type: 'role_changed', recipient_type: 'user', recipient_id: req.params.id,
      ref_id: req.params.id, ref_name: email,
      actor_id: user.user_id,
      actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
      title: 'Role changed',
      details: `Your role was changed to ${req.body.role}`,
    });

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

    logActivity(catalystApp, {
      action: 'User invited', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Invited ${req.body.email} as ${req.body.role || 'Employee'}`,
    });

    res.json({ success: true, message: 'Invitation sent successfully' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    if (String(req.params.id) === String(user.user_id)) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
    }

    const zcql = catalystApp.zcql();
    const memberRows = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM TeamMembers WHERE user_id = '${req.params.id}'`
    ).catch(() => []);

    const teamMemberTable = catalystApp.datastore().table('TeamMembers');
    await Promise.all(
      memberRows.map(r => teamMemberTable.deleteRow(String((r.TeamMembers || r).ROWID)))
    );

    await catalystApp.userManagement().deleteUser(req.params.id);

    logActivity(catalystApp, {
      action: 'User deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: '',
      details: `Deleted user ID: ${req.params.id} (removed from ${memberRows.length} team(s))`,
    });

    res.json({ success: true });
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

    const [teamRows, memberRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Teams ORDER BY ROWID DESC`),
      userRole !== 'Admin'
        ? zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`)
        : Promise.resolve([]),
      catalystApp.userManagement().getAllUsers(),
      zcql.executeZCQLQuery(`SELECT user_id,profile_image FROM Users`).catch(() => []),
    ]);

    const userMap = mapBy(allUsers, u => u.user_id);
    const profileImages = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) profileImages[String(u.user_id)] = u.profile_image;
    });

    const allTeams = teamRows.map(r => r.Teams || r).map(t => {
      const creator = userMap[String(t.created_by)];
      return {
        ...t,
        created_by_name: creator
          ? (`${creator.first_name || ''} ${creator.last_name || ''}`.trim() || creator.email_id)
          : 'Unknown',
        created_by_image: profileImages[String(t.created_by)] || null,
      };
    });

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

    logActivity(catalystApp, {
      action: 'Team created', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Created team: ${req.body.name}`,
    });

    await catalystApp.datastore().table('TeamMembers').insertRow({
      team_id: row.ROWID, user_id: user.user_id, role: 'Admin',
      added_by: user.user_id, joined_time: now(),
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

    logActivity(catalystApp, {
      action: 'Team updated', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Updated team: ${req.body.name}`,
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

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT name FROM Teams WHERE ROWID = '${req.params.id}'`
    ).catch(() => []);
    const name = rows[0] ? (rows[0].Teams || rows[0]).name : req.params.id;

    await catalystApp.datastore().table('Teams').deleteRow(req.params.id);

    logActivity(catalystApp, {
      action: 'Team deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Deleted team: ${name}`,
    });

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAM MEMBERS ──────────────────────────────────────────────────────────────

app.post('/api/admin/cleanup-orphaned-members', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') return res.status(403).json({ success: false, error: 'Admin access required' });

    const zcql = catalystApp.zcql();
    const [memberRows, allUsers] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM TeamMembers`),
      catalystApp.userManagement().getAllUsers(),
    ]);

    const validUserIds = new Set(allUsers.map(u => String(u.user_id)));
    const orphaned = memberRows
      .map(r => r.TeamMembers || r)
      .filter(m => !validUserIds.has(String(m.user_id)));

    const table = catalystApp.datastore().table('TeamMembers');
    await Promise.all(orphaned.map(m => table.deleteRow(String(m.ROWID))));

    res.json({ success: true, removed: orphaned.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

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

    const enriched = memberRows.map(r => r.TeamMembers || r)
      .filter(member => userMap[String(member.user_id)])
      .map(member => {
        const catalystUser = userMap[String(member.user_id)];
        return {
          ROWID: member.ROWID, team_id: member.team_id, user_id: member.user_id,
          role: member.role || 'Member',
		  permissions: (() => { try { return JSON.parse(member.permissions || '{}'); } catch { return {}; } })(),
          name: `${catalystUser.first_name || ''} ${catalystUser.last_name || ''}`.trim(),
          email: catalystUser.email_id || '',
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

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') {
      const myPerms = await getMemberPermissions(catalystApp, req.params.id, user.user_id);
      if (!myPerms.addMember) {
        return res.status(403).json({ success: false, error: 'You do not have permission to add members to this team' });
      }
    }

    const zcql = catalystApp.zcql();

    const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids : [req.body.user_id];
    const permissions = JSON.stringify(req.body.permissions || { edit: false, delete: false, toggleActive: false, addMember: false });

    const table = catalystApp.datastore().table('TeamMembers');
    const rows = await Promise.all(userIds.map(uid =>
      table.insertRow({ team_id: req.params.id, user_id: uid, permissions, added_by: user.user_id, joined_time: now() })
    ));

    const teamRow  = await zcql.executeZCQLQuery(`SELECT name FROM Teams WHERE ROWID = '${req.params.id}'`).catch(() => []);
    const teamName = teamRow[0] ? (teamRow[0].Teams || teamRow[0]).name : 'a team';

    await Promise.all(userIds.map(uid => pushNotification(catalystApp, {
      event_type: 'member_added', recipient_type: 'user', recipient_id: uid,
      ref_id: req.params.id, ref_name: teamName,
      actor_id: user.user_id,
      actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
      title: 'Added to team',
      details: `You were added to "${teamName}"`,
    })));

    res.json({ success: true, data: rows });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/teams/:id/members/:memberId', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Admin access required to remove members' });
    }

    const memberRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT user_id FROM TeamMembers WHERE ROWID = '${req.params.memberId}'`
    ).catch(() => []);
    const removedUserId = memberRows[0] ? (memberRows[0].TeamMembers || memberRows[0]).user_id : null;

    await catalystApp.datastore().table('TeamMembers').deleteRow(req.params.memberId);

    if (removedUserId) {
      const teamRow = await catalystApp.zcql().executeZCQLQuery(
        `SELECT name FROM Teams WHERE ROWID = '${req.params.id}'`
      ).catch(() => []);
      const teamName = teamRow[0] ? (teamRow[0].Teams || teamRow[0]).name : 'a team';

      await pushNotification(catalystApp, {
        event_type: 'member_removed', recipient_type: 'user', recipient_id: removedUserId,
        ref_id: req.params.id, ref_name: teamName,
        actor_id: user.user_id,
        actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
        title: 'Removed from team',
        details: `You were removed from "${teamName}"`,
      });
    }

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teams/:teamId/members/:memberId/permissions', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Admin access required to update permissions' });
    }

    const memberRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT user_id FROM TeamMembers WHERE ROWID = '${req.params.memberId}'`
    ).catch(() => []);
    const targetUserId = memberRows[0] ? (memberRows[0].TeamMembers || memberRows[0]).user_id : null;

    const row = await catalystApp.datastore().table('TeamMembers').updateRow({
      ROWID: req.params.memberId,
      permissions: JSON.stringify(req.body.permissions || {}),
    });

    if (targetUserId) {
      const teamRow = await catalystApp.zcql().executeZCQLQuery(
        `SELECT name FROM Teams WHERE ROWID = '${req.params.teamId}'`
      ).catch(() => []);
      const teamName = teamRow[0] ? (teamRow[0].Teams || teamRow[0]).name : 'a team';

      await pushNotification(catalystApp, {
        event_type: 'permissions_updated', recipient_type: 'user', recipient_id: targetUserId,
        ref_id: req.params.teamId, ref_name: teamName,
        actor_id: user.user_id,
        actor_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email_id,
        title: 'Permissions updated',
        details: `Your permissions in "${teamName}" were updated`,
      });
    }

    res.json({ success: true, data: row });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teams/:id/toggle-active', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') {
      const myPerms = await getMemberPermissions(catalystApp, req.params.id, user.user_id);
      if (!myPerms.toggleActive) {
        return res.status(403).json({ success: false, error: 'You do not have permission to activate/deactivate this team' });
      }
    }

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT is_active FROM Teams WHERE ROWID = '${req.params.id}'`
    );
    const current = rows[0] ? (rows[0].Teams || rows[0]).is_active : true;
    const currentActive = !(current === false || current === 'false');
    const newActive = !currentActive;

    await catalystApp.datastore().table('Teams').updateRow({
      ROWID: req.params.id, is_active: newActive,
    });

    res.json({ success: true, data: { is_active: newActive } });
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

    const shareRows = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE shared_with = '${req.params.id}' AND share_type = 'team'`
    );
    const activeShares = shareRows
      .map(r => r.PasswordShares || r)
      .filter(s => shareIsActive(s));

    if (activeShares.length === 0) return res.json({ success: true, data: [] });

    const pwIds = [...new Set(activeShares.map(s => s.password_id))];
    const [allPwRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => []),
      catalystApp.userManagement().getAllUsers(),
      zcql.executeZCQLQuery(`SELECT user_id,profile_image FROM Users`).catch(() => []),
    ]);
    const pwMap = mapBy(allPwRows.map(r => r.Passwords || r), p => p.ROWID);
    const userMap = mapBy(allUsers, u => u.user_id);
    const profileImages = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) profileImages[String(u.user_id)] = u.profile_image;
    });

    const result = activeShares
		.map(share => {
			const pw = pwMap[String(share.password_id)];
			if (!pw) return null;
			const pwInactive = pw.is_active === false || pw.is_active === 'false';
			const sharer = userMap[String(share.created_by)];
			return {
			share_id: share.ROWID, password_id: pw.ROWID, folder_id: pw.folder_id || '',
			expiry: share.expiry, permissions: pwInactive ? [] : permList(share), name: pw.name, category: pw.category,
			username: pw.username, password: pwInactive ? null : decrypt(pw.password),
			url: pw.url, notes: pwInactive ? null : pw.notes,
			is_active: !pwInactive,
			shared_by_name: sharer ? (`${sharer.first_name || ''} ${sharer.last_name || ''}`.trim() || sharer.email_id) : 'Unknown',
			shared_by_image: profileImages[String(share.created_by)] || null,
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

    const folderIds = [...new Set(relevantShares.map(s => s.password_id))];
    const [allFolderRows, allPwRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Folders WHERE ROWID IN (${folderIds.join(',')})`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT * FROM Passwords WHERE folder_id IN (${folderIds.join(',')})`).catch(() => []),
      catalystApp.userManagement().getAllUsers(),
      zcql.executeZCQLQuery(`SELECT user_id,profile_image FROM Users`).catch(() => []),
    ]);

    const folderMap = mapBy(allFolderRows.map(r => r.Folders || r), f => f.ROWID);
    const userMap = mapBy(allUsers, u => u.user_id);
    const profileImages = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) profileImages[String(u.user_id)] = u.profile_image;
    });
    const folderPwMap = {};
    allPwRows.forEach(r => {
	const pw = r.Passwords || r;
	if (pw.folder_id) {
		if (!folderPwMap[String(pw.folder_id)]) folderPwMap[String(pw.folder_id)] = [];
		const pwInactive = pw.is_active === false || pw.is_active === 'false';
		folderPwMap[String(pw.folder_id)].push({
			...pw,
			password: pwInactive ? null : decrypt(pw.password),
			notes: pwInactive ? null : pw.notes,
		});
	}
	});

    const result = relevantShares.map(share => {
      const folder          = folderMap[String(share.password_id)];
      const isActive        = !(folder?.is_active === false || folder?.is_active === 'false');
      const folderPasswords = isActive ? (folderPwMap[String(share.password_id)] || []) : [];
      const sharer = userMap[String(share.created_by)];
      return {
        share_id: share.ROWID, folder_id: share.password_id,
        folder_name: folder?.name || 'Shared Folder', expiry: share.expiry,
        permissions: isActive ? permList(share) : [],
        shared_by: share.created_by, password_count: folderPasswords.length,
        is_active: isActive,
        passwords: folderPasswords,
        shared_by_name: sharer ? (`${sharer.first_name || ''} ${sharer.last_name || ''}`.trim() || sharer.email_id) : 'Unknown',
        shared_by_image: profileImages[String(share.created_by)] || null,
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

    const zcql = catalystApp.zcql();
    const now2 = new Date();

    function notifId(type, refId, createdTime) {
      return `${type}:${refId}:${createdTime}`;
    }

    const [shareRows, pwRows, teamMemberRows, allTeamRows, allUsers] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM PasswordShares ORDER BY ROWID DESC LIMIT 300`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT ROWID, name, expiry_date FROM Passwords WHERE owner_id = '${user.user_id}' AND expiry_date != ''`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT team_id, added_by FROM TeamMembers WHERE user_id = '${user.user_id}'`).catch(() => []),
      zcql.executeZCQLQuery(`SELECT ROWID, name, created_time FROM Teams`).catch(() => []),
      catalystApp.userManagement().getAllUsers().catch(() => []),
    ]);

    const userMap = mapBy(allUsers, u => u.user_id);
    const nameOf = (uid) => {
      if (!uid) return 'Someone';
      if (String(uid) === String(user.user_id)) return 'You';
      const u = userMap[String(uid)];
      return u ? (`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email_id) : 'Someone';
    };

    const userTeamIds = teamMemberRows.map(r => String((r.TeamMembers || r).team_id));
    const inviterMap = {};
    teamMemberRows.forEach(r => {
      const m = r.TeamMembers || r;
      inviterMap[String(m.team_id)] = m.added_by;
    });

    const allTeams  = allTeamRows.map(r => r.Teams || r);
    const allShares = shareRows.map(r => r.PasswordShares || r);
    const passwords = pwRows.map(r => r.Passwords || r);

    const myShares = allShares.filter(s => {
      if (s.expiry && new Date(s.expiry.replace(' ', 'T') + 'Z') < now2) return false;
      if (s.share_type === 'external' || s.share_type === 'external_folder') return false;
      if (s.share_type === 'user'   && s.shared_with === user.email_id) return true;
      if (s.share_type === 'folder' && s.shared_with === user.email_id) return true;
      if (s.share_type === 'team'   && userTeamIds.includes(String(s.shared_with))) return true;
      return false;
    });

    const pwIds     = [];
    const folderIds = [];
    myShares.forEach(s => {
      if (s.share_type === 'folder') folderIds.push(s.password_id);
      else                           pwIds.push(s.password_id);
    });

    const uniquePwIds     = [...new Set(pwIds)];
    const uniqueFolderIds = [...new Set(folderIds)];

    const [namePwRows, nameFolderRows] = await Promise.all([
      uniquePwIds.length     ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Passwords WHERE ROWID IN (${uniquePwIds.join(',')})`).catch(() => [])   : Promise.resolve([]),
      uniqueFolderIds.length ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Folders WHERE ROWID IN (${uniqueFolderIds.join(',')})`).catch(() => []) : Promise.resolve([]),
    ]);

    const pwNameMap = {};
    namePwRows.forEach(r => { const p = r.Passwords || r; pwNameMap[String(p.ROWID)] = p.name; });
    const folderNameMap = {};
    nameFolderRows.forEach(r => { const f = r.Folders || r; folderNameMap[String(f.ROWID)] = f.name; });

    const teamNameMap = {};
    allTeams.forEach(t => { teamNameMap[String(t.ROWID)] = t.name; });

    const myTeams = allTeams.filter(t => userTeamIds.includes(String(t.ROWID)));

    const notifications = [];

    // ── Password / folder shares ────────────────────────────────────────────
    myShares.forEach(s => {
      const isFolder = s.share_type === 'folder';
      const isTeam   = s.share_type === 'team';
      const itemName = isFolder
        ? (folderNameMap[String(s.password_id)] || 'a folder')
        : (pwNameMap[String(s.password_id)]     || 'a password');
      const teamName   = isTeam ? (teamNameMap[String(s.shared_with)] || 'a team') : null;
      const sharerName = nameOf(s.created_by);

      notifications.push({
        id:           notifId(isFolder ? 'folder_shared' : 'password_shared', s.password_id, s.created_time),
        type:         isFolder ? 'folder_shared' : 'password_shared',
        action:       isFolder ? 'Folder shared with you' : 'Password shared with you',
        details:      isTeam
          ? `"${itemName}" shared via team ${teamName}`
          : `"${itemName}" was shared with you`,
        by_name:      sharerName,
        expiry:       s.expiry,
        created_time: s.created_time,
        ref_id:       s.password_id,
      });
    });

    // ── Team membership (current state) ─────────────────────────────────────
    myTeams.forEach(team => {
      notifications.push({
        id:           notifId('team_added', team.ROWID, team.created_time),
        type:         'team_added',
        action:       'Added to a team',
        details:      `You are a member of "${team.name}"`,
        by_name:      nameOf(inviterMap[String(team.ROWID)]),
        created_time: team.created_time,
        ref_id:       team.ROWID,
      });
    });

    // ── Expiring passwords ───────────────────────────────────────────────────
    passwords.forEach(pw => {
      if (!pw.expiry_date) return;
      const expiryDate = new Date(pw.expiry_date.replace(' ', 'T') + 'Z');
      const diffDays   = Math.ceil((expiryDate - now2) / 86_400_000);
      if (diffDays <= 7 && diffDays >= 0) {
        notifications.push({
          id:           notifId('password_expiring', pw.ROWID, pw.expiry_date),
          type:         'password_expiring',
          action:       diffDays === 0
            ? 'Password expires today'
            : `Password expiring in ${diffDays} day${diffDays > 1 ? 's' : ''}`,
          details:      `"${pw.name}" will expire on ${expiryDate.toLocaleDateString()}`,
          created_time: pw.expiry_date,
          ref_id:       pw.ROWID,
          urgent:       diffDays <= 1,
        });
      }
    });

    // ── Event-log notifications (member added/removed, access revoked, role/permission changes) ──
    const eventRows = await zcql.executeZCQLQuery(
      `SELECT * FROM NotificationEvents WHERE recipient_id = '${user.user_id}' ${userTeamIds.length ? `OR recipient_id IN (${userTeamIds.map(id => `'${id}'`).join(',')})` : ''} ORDER BY ROWID DESC LIMIT 100`
    ).catch(() => []);

    eventRows.map(r => r.NotificationEvents || r).forEach(ev => {
      notifications.push({
        id:           notifId(ev.event_type, ev.ref_id, ev.created_time),
        type:         ev.event_type,
        action:       ev.title || ev.details || 'Activity update',
        details:      ev.details,
        by_name:      ev.actor_name,
        created_time: ev.created_time,
        ref_id:       ev.ref_id,
      });
    });

    notifications.sort((a, b) => {
      const ta = a.created_time ? new Date(a.created_time.replace(' ', 'T') + 'Z') : 0;
      const tb = b.created_time ? new Date(b.created_time.replace(' ', 'T') + 'Z') : 0;
      return tb - ta;
    });

    res.json({ success: true, data: notifications });
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

// GET /api/activity-logs?scope=mine|org
app.get('/api/activity-logs', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const isAdmin = user.role_details?.role_name === 'Admin'; // ← adjust if your admin role string differs
    const scope = req.query.scope === 'org' ? 'org' : 'mine';

    let query = `SELECT * FROM ActivityLogs`;
    // Non-admins are always locked to their own logs, regardless of what scope is requested
    if (scope === 'mine' || !isAdmin) {
      query += ` WHERE user_email = '${user.email_id}'`;
    }
    query += ` ORDER BY ROWID DESC LIMIT 200`;

    const rows = await catalystApp.zcql().executeZCQLQuery(query);
    res.json({
      success: true,
      data: rows.map(r => r.ActivityLogs || r),
      currentUserEmail: user.email_id,
      isAdmin,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/activity-logs/bulk-delete   body: { ids: ["...", "..."] }
app.post('/api/activity-logs/bulk-delete', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No ids provided' });
    }

    const isAdmin = user.role_details?.role_name === 'Admin'; // ← same string as above
    const table = catalystApp.datastore().table('ActivityLogs');

    if (!isAdmin) {
      // Ownership check — a non-admin can only delete their own log rows
      const rows = await Promise.all(ids.map(id => table.getRow(id).catch(() => null)));
      const unauthorized = rows.some(r => !r || r.user_email !== user.email_id);
      if (unauthorized) {
        return res.status(403).json({ success: false, error: 'Cannot delete logs you do not own' });
      }
    }

    await table.deleteRows(ids);
    res.json({ success: true, deleted: ids.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/activity-logs/analytics
app.get('/api/activity-logs/analytics', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const isAdmin = user.role_details?.role_name === 'Admin'; // ← adjust if your admin role string differs

    let query = `SELECT * FROM ActivityLogs`;
    if (!isAdmin) {
      query += ` WHERE user_email = '${user.email_id}'`;
    }
    query += ` ORDER BY ROWID DESC LIMIT 300`; // ← was 1000, ZCQL max is 300

    const rows = (await catalystApp.zcql().executeZCQLQuery(query)).map(r => r.ActivityLogs || r);

    const byUser = {};
    const byAction = {};
    for (const log of rows) {
      const u = log.user_email || 'External';
      byUser[u] = (byUser[u] || 0) + 1;

      const a = (log.action || 'Unknown').toLowerCase();
      byAction[a] = (byAction[a] || 0) + 1;
    }

    res.json({
      success: true,
      totalLogs: rows.length,
      byUser: Object.entries(byUser).map(([email, count]) => ({ email, count })).sort((a, b) => b.count - a.count),
      byAction: Object.entries(byAction).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
      isAdmin,
      currentUserEmail: user.email_id,
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = app;