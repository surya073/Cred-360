'use strict';
const express  = require('express');
const catalyst = require('zcatalyst-sdk-node');
// App handle for a request. `__admin` is the same app with the platform's own (admin) scope, created
// only when used. System-written data (notifications, audit log) goes through it, because ordinary
// roles (Team Lead, Employee...) have no insert permission on those tables.
const initApp = (req) => {
  const app = catalyst.initialize(req);
  let admin;
  Object.defineProperty(app, '__admin', { get: () => (admin = admin || catalyst.initialize(req, { scope: 'admin' })) });
  return app;
};

const { encrypt, decrypt } = require('shared-utils/encryption');

const app = express();
app.use(express.json());

const { ROLE_MAP, ROLE_ID_MAP, INVITE_ROLE_ID_MAP, APP_URL } = require('shared-utils/constants');
const { getCurrentUser, now, logActivity, mapBy, pushNotification, notify, displayName, escapeLike, appRole, isAdmin: isAdminUser, getAllUsersCached, getProfileImageRowsCached, invalidateDirectory, selectAll } = require('shared-utils/helpers');
const { permList, shareIsActive } = require('shared-utils/permissions');
const { ROLES, ROLE_INFO, PERMISSIONS, ROLE_PERMISSIONS, ASSIGNABLE_ROLES, roleOf, can, canAssignRole } = require('shared-utils/roles');

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

// People's names: letters (any script), spaces, apostrophes, dots and hyphens.
const NAME_RE = /^[\p{L}][\p{L}\p{M}'.\- ]*$/u;
const cleanName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const formatUser = (u, profileImages = {}) => ({
  ROWID:         u.user_id,
  first_name:    u.first_name || '',
  last_name:     u.last_name || '',
  name:          `${u.first_name || ''} ${u.last_name || ''}`.trim(),
  email:         u.email_id,
  role:          ROLE_MAP[u.role_details?.role_name] || 'Employee',
  profile_image: profileImages[u.user_id] || null,
  joined:        u.created_time || '',
  status:        String(u.status || 'ACTIVE').toUpperCase(),
  confirmed:     u.is_confirmed !== false,
});

// Admins (except the actor) — who hears about user-management changes.
async function adminRecipients(catalystApp, exceptId) {
  const users = await getAllUsersCached(catalystApp).catch(() => []);
  return users
    .filter(u => ROLE_MAP[u.role_details?.role_name] === 'Admin' && String(u.user_id) !== String(exceptId))
    .map(u => ({ type: 'user', id: String(u.user_id) }));
}

app.get('/api/users', async (req, res) => {
  try {
    const catalystApp = initApp(req);
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

    res.json({ success: true, data: allUsers.map(u => formatUser(u, profileImages)) });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Roles, what each may do, and what *I* may do — the UI renders this, the server enforces it.
app.get('/api/roles', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const users = await getAllUsersCached(catalystApp).catch(() => []);
    const counts = {};
    users.forEach(u => { const r = ROLE_MAP[u.role_details?.role_name] || 'Employee'; counts[r] = (counts[r] || 0) + 1; });

    res.json({
      success: true,
      roles: ROLES.map(name => ({ name, description: ROLE_INFO[name].description, permissions: ROLE_PERMISSIONS[name], users: counts[name] || 0 })),
      permissions: PERMISSIONS,
      me: { role: roleOf(user), permissions: ROLE_PERMISSIONS[roleOf(user)] || [], assignable: ASSIGNABLE_ROLES[roleOf(user)] || [] },
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update another user's name and/or role. Existing fields are always re-sent, otherwise
// Catalyst would blank anything left out (that used to wipe last names on role changes).
async function applyUserUpdate(catalystApp, actor, targetId, patch) {
  const um = catalystApp.userManagement();
  const target = await um.getUserDetails(targetId).catch(() => null);
  if (!target) return { status: 404, error: 'User not found' };

  const next = {
    email_id:   target.email_id,
    first_name: patch.first_name !== undefined ? patch.first_name : (target.first_name || ''),
    last_name:  patch.last_name  !== undefined ? patch.last_name  : (target.last_name  || ''),
  };
  const oldRole = ROLE_MAP[target.role_details?.role_name] || 'Employee';
  if (patch.role && patch.role !== oldRole) next.role_id = ROLE_ID_MAP[patch.role];
  await um.updateUserDetails(String(targetId), next);
  return { target, oldRole, next };
}

const handleUserUpdate = async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'users.edit')) return res.status(403).json({ success: false, error: 'You do not have permission to edit users' });

    const patch = {};
    if (req.body.first_name !== undefined) {
      patch.first_name = cleanName(req.body.first_name);
      if (!patch.first_name || patch.first_name.length > 50 || !NAME_RE.test(patch.first_name)) {
        return res.status(400).json({ success: false, error: 'Enter a valid first name' });
      }
    }
    if (req.body.last_name !== undefined) {
      patch.last_name = cleanName(req.body.last_name);
      if (patch.last_name && (patch.last_name.length > 50 || !NAME_RE.test(patch.last_name))) {
        return res.status(400).json({ success: false, error: 'Enter a valid last name' });
      }
    }
    if (req.body.role !== undefined) {
      if (!can(user, 'users.roles')) return res.status(403).json({ success: false, error: 'You do not have permission to change roles' });
      if (String(req.params.id) === String(user.user_id)) return res.status(400).json({ success: false, error: 'You cannot change your own role' });
      if (!ROLE_ID_MAP[req.body.role]) return res.status(400).json({ success: false, error: 'Invalid role' });
      patch.role = req.body.role;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: 'Nothing to update' });

    const out = await applyUserUpdate(catalystApp, user, req.params.id, patch);
    if (out.error) return res.status(out.status).json({ success: false, error: out.error });

    const actor = displayName(user);
    const who = `${out.next.first_name} ${out.next.last_name}`.trim() || out.next.email_id;
    const notify_to = [];
    if (patch.role && patch.role !== out.oldRole) {
      notify_to.push(...await notify(catalystApp, {
        event_type: 'role_changed', ref_id: req.params.id, ref_name: who, actor_id: user.user_id, actor_name: actor,
        title: 'Your role changed', details: `${actor} changed your role from ${out.oldRole} to ${patch.role}`,
      }, [{ type: 'user', id: req.params.id }]));
      logActivity(catalystApp, {
        action: 'Role changed', user_id: user.user_id, user_email: user.email_id, password_id: '',
        details: `Changed role of ${out.next.email_id} from ${out.oldRole} to ${patch.role}`,
      });
    }
    if (patch.first_name !== undefined || patch.last_name !== undefined) {
      notify_to.push(...await notify(catalystApp, {
        event_type: 'profile_updated', ref_id: req.params.id, ref_name: who, actor_id: user.user_id, actor_name: actor,
        title: 'Your profile was updated', details: `${actor} updated your name to ${who}`,
      }, [{ type: 'user', id: req.params.id }]));
      logActivity(catalystApp, {
        action: 'User updated', user_id: user.user_id, user_email: user.email_id, password_id: '',
        details: `Updated name of ${out.next.email_id} to ${who}`,
      });
    }

    invalidateDirectory();
    res.json({ success: true, notify_to: [...new Set(notify_to)] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

app.put('/api/users/:id', handleUserUpdate);
// Kept for existing callers: { role } only.
app.put('/api/users/:id/role', (req, res) => { req.body = { role: req.body.role }; return handleUserUpdate(req, res); });

app.put('/api/users/:id/status', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'users.disable')) return res.status(403).json({ success: false, error: 'You do not have permission to enable or disable users' });
    if (String(req.params.id) === String(user.user_id)) return res.status(400).json({ success: false, error: 'You cannot disable your own account' });

    const enable = String(req.body.status || '').toUpperCase() !== 'DISABLE';
    const target = await catalystApp.userManagement().getUserDetails(req.params.id).catch(() => null);
    if (!target) return res.status(404).json({ success: false, error: 'User not found' });

    await catalystApp.userManagement().updateUserStatus(String(req.params.id), enable ? 'enable' : 'disable');

    const actor = displayName(user), who = displayName(target);
    logActivity(catalystApp, {
      action: enable ? 'User enabled' : 'User disabled', user_id: user.user_id, user_email: user.email_id, password_id: '',
      details: `${enable ? 'Re-enabled' : 'Disabled'} ${target.email_id}`,
    });
    const notify_to = await notify(catalystApp, {
      event_type: 'user_status_changed', ref_id: req.params.id, ref_name: who, actor_id: user.user_id, actor_name: actor,
      title: enable ? 'User re-enabled' : 'User disabled',
      details: `${actor} ${enable ? 're-enabled' : 'disabled'} ${who}'s account`,
    }, await adminRecipients(catalystApp, user.user_id));

    invalidateDirectory();
    res.json({ success: true, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/users/invite', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'users.invite')) return res.status(403).json({ success: false, error: 'You do not have permission to invite users' });

    const wantedRole = INVITE_ROLE_ID_MAP[req.body.role] ? req.body.role : 'Employee';
    if (!canAssignRole(user, wantedRole)) {
      return res.status(403).json({ success: false, error: `Your role cannot invite ${wantedRole}s` });
    }

    const first = cleanName(req.body.first_name);
    const last  = cleanName(req.body.last_name);
    if (!first || first.length > 50 || !NAME_RE.test(first)) return res.status(400).json({ success: false, error: 'Enter a valid first name' });
    if (last && (last.length > 50 || !NAME_RE.test(last))) return res.status(400).json({ success: false, error: 'Enter a valid last name' });

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    if (email.includes('+')) return res.status(400).json({ success: false, error: "Catalyst doesn't accept '+' in email addresses. Use the person's plain address." });

    const existing = (await getAllUsersCached(catalystApp).catch(() => [])).find(u => String(u.email_id || '').toLowerCase() === email);
    if (existing) return res.status(409).json({ success: false, error: 'This person is already in the workspace' });

    // Optional: teams to drop the new person into (only where the inviter may add members).
    const teamIds = [...new Set((Array.isArray(req.body.team_ids) ? req.body.team_ids : []).map(String).filter(id => /^\d{1,20}$/.test(id)))].slice(0, 10);
    for (const tid of teamIds) {
      if (!(await canManageTeam(catalystApp, user, tid, 'addMember'))) {
        return res.status(403).json({ success: false, error: 'You cannot add people to one of the selected teams' });
      }
    }

    const registered = await catalystApp.userManagement().registerUser(
      { platform_type: 'web', redirect_url: APP_URL },
      { first_name: first, last_name: last, email_id: email, role_id: INVITE_ROLE_ID_MAP[wantedRole] }
    );
    const newUserId = String(registered?.user_details?.user_id || registered?.user_id || '');

    // The invite role ids can collide (Employee and Intern share one), so make sure the person really
    // got the role that was asked for.
    let roleNote = null;
    const assigned = ROLE_MAP[registered?.user_details?.role_details?.role_name];
    if (newUserId && assigned !== wantedRole) {
      try {
        await catalystApp.userManagement().updateUserDetails(newUserId, { email_id: email, first_name: first, last_name: last, role_id: ROLE_ID_MAP[wantedRole] });
      } catch (e) {
        roleNote = `Invited as ${assigned || 'a default role'}; set the role to ${wantedRole} from Edit user (${e.message})`;
      }
    }

    const addedTo = [];
    if (newUserId) {
      const table = catalystApp.datastore().table('TeamMembers');
      for (const tid of teamIds) {
        await table.insertRow({
          team_id: tid, user_id: newUserId, added_by: user.user_id, joined_time: now(),
          permissions: JSON.stringify({ edit: false, delete: false, toggleActive: false, addMember: false }),
        }).then(() => addedTo.push(tid)).catch(() => {});
      }
    }

    const actor = displayName(user), who = `${first} ${last}`.trim();
    logActivity(catalystApp, {
      action: 'User invited', user_id: user.user_id, user_email: user.email_id, password_id: '',
      details: `Invited ${who} (${email}) as ${wantedRole}${addedTo.length ? ` and added to ${addedTo.length} team(s)` : ''}`,
    });
    const notify_to = await notify(catalystApp, {
      event_type: 'user_invited', ref_id: newUserId, ref_name: who, actor_id: user.user_id, actor_name: actor,
      title: 'User invited', details: `${actor} invited ${who} (${email}) as ${wantedRole}`,
    }, await adminRecipients(catalystApp, user.user_id));

    invalidateDirectory(); // user list changed — drop the cached directory
    res.json({ success: true, message: 'Invitation sent successfully', data: { user_id: newUserId, name: who, email, role: roleNote ? assigned : wantedRole }, role_note: roleNote, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'users.delete')) return res.status(403).json({ success: false, error: 'Admin access required' });
    if (String(req.params.id) === String(user.user_id)) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
    }

    const target = await catalystApp.userManagement().getUserDetails(req.params.id).catch(() => null);
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
      details: `Deleted user ${target ? `${displayName(target)} (${target.email_id})` : `ID ${req.params.id}`} (removed from ${memberRows.length} team(s))`,
    });
    const notify_to = await notify(catalystApp, {
      event_type: 'user_deleted', ref_id: req.params.id, ref_name: target ? displayName(target) : '', actor_id: user.user_id, actor_name: displayName(user),
      title: 'User removed', details: `${displayName(user)} removed ${target ? displayName(target) : 'a user'} from the workspace`,
    }, await adminRecipients(catalystApp, user.user_id));

    invalidateDirectory(); // user list changed — drop the cached directory
    res.json({ success: true, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAMS ─────────────────────────────────────────────────────────────────────

// Shape raw TeamMembers rows for the client (shared by /teams?include=members and /teams/:id/members).
const enrichMembers = (memberRows, userMap, profileImages) =>
  memberRows.map(r => r.TeamMembers || r)
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

app.get('/api/teams', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql     = catalystApp.zcql();
    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';

    const [teamRows, memberRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM Teams ORDER BY ROWID DESC`),
      userRole !== 'Admin'
        ? zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${user.user_id}'`)
        : Promise.resolve([]),
      getAllUsersCached(catalystApp),
      getProfileImageRowsCached(catalystApp),
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

    // ?include=members  -> every visible team's members in this one response, instead of the
    // client issuing a /teams/:id/members request (and a directory fetch) per team.
    if (req.query.include === 'members' && visibleTeams.length) {
      const ids = visibleTeams.map(t => String(t.ROWID)).filter(id => /^\d{1,20}$/.test(id));
      const memberRowsAll = await selectAll(zcql,
        `SELECT * FROM TeamMembers WHERE team_id IN (${ids.map(id => `'${id}'`).join(',')}) ORDER BY ROWID`);
      const byTeam = {};
      ids.forEach(id => { byTeam[id] = []; });
      enrichMembers(memberRowsAll, userMap, profileImages).forEach(m => {
        // hard guard: only ever emit members of teams this user is allowed to see
        if (byTeam[String(m.team_id)]) byTeam[String(m.team_id)].push(m);
      });
      return res.json({ success: true, data: visibleTeams, members: byTeam });
    }

    res.json({ success: true, data: visibleTeams });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const PERM_DEFS_SERVER = ['edit', 'delete', 'toggleActive', 'addMember'];
const TEAM_PERM_LABEL = { edit: 'Edit team', delete: 'Delete team', toggleActive: 'Activate/deactivate', addMember: 'Add members' };
// Team-level permissions (edit / delete / toggleActive / addMember) live on the membership;
// Admins (teams.manage_all) bypass them.
async function canManageTeam(catalystApp, user, teamId, perm) {
  if (can(user, 'teams.manage_all')) return true;
  const perms = await getMemberPermissions(catalystApp, teamId, user.user_id);
  return !!perms[perm];
}

async function teamNameOf(catalystApp, teamId) {
  const rows = await catalystApp.zcql().executeZCQLQuery(`SELECT name FROM Teams WHERE ROWID = '${teamId}'`).catch(() => []);
  return rows[0] ? (rows[0].Teams || rows[0]).name : null;
}

async function teamMemberIds(catalystApp, teamId) {
  const rows = await catalystApp.zcql().executeZCQLQuery(`SELECT user_id FROM TeamMembers WHERE team_id = '${teamId}'`).catch(() => []);
  return rows.map(r => String((r.TeamMembers || r).user_id));
}

const FULL_TEAM_PERMS = { edit: true, delete: true, toggleActive: true, addMember: true };
const cleanTeamText = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

app.post('/api/teams', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'teams.create')) return res.status(403).json({ success: false, error: 'Your role cannot create teams' });

    const name = cleanTeamText(req.body.name, 80);
    if (!name) return res.status(400).json({ success: false, error: 'Give the team a name' });

    const row = await catalystApp.datastore().table('Teams').insertRow({
      name, description: cleanTeamText(req.body.description, 300),
      created_by: user.user_id, created_time: now(),
    });

    // The creator runs the team they created, so they get every team permission.
    await catalystApp.datastore().table('TeamMembers').insertRow({
      team_id: row.ROWID, user_id: user.user_id, role: 'Admin', permissions: JSON.stringify(FULL_TEAM_PERMS),
      added_by: user.user_id, joined_time: now(),
    });

    logActivity(catalystApp, {
      action: 'Team created', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Created team: ${name}`,
    });
    const notify_to = await notify(catalystApp, {
      event_type: 'team_created', ref_id: row.ROWID, ref_name: name, actor_id: user.user_id, actor_name: displayName(user),
      title: 'Team created', details: `${displayName(user)} created the team "${name}"`,
    }, await adminRecipients(catalystApp, user.user_id));

    res.json({ success: true, data: row, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teams/:id', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!(await canManageTeam(catalystApp, user, req.params.id, 'edit'))) {
      return res.status(403).json({ success: false, error: 'You do not have permission to edit this team' });
    }

    const name = cleanTeamText(req.body.name, 80);
    if (!name) return res.status(400).json({ success: false, error: 'Give the team a name' });
    const oldName = await teamNameOf(catalystApp, req.params.id);
    if (oldName === null) return res.status(404).json({ success: false, error: 'Team not found' });

    const row = await catalystApp.datastore().table('Teams').updateRow({
      ROWID: req.params.id, name, description: cleanTeamText(req.body.description, 300),
    });

    logActivity(catalystApp, {
      action: 'Team updated', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Updated team: ${name}`,
    });
    const actor = displayName(user);
    const notify_to = await notify(catalystApp, {
      event_type: 'team_updated', ref_id: req.params.id, ref_name: name, actor_id: user.user_id, actor_name: actor,
      title: 'Team updated',
      details: oldName !== name ? `${actor} renamed the team "${oldName}" to "${name}"` : `${actor} updated the details of "${name}"`,
    }, [{ type: 'team', id: req.params.id }]);
    res.json({ success: true, data: row, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!(await canManageTeam(catalystApp, user, req.params.id, 'delete'))) {
      return res.status(403).json({ success: false, error: 'You do not have permission to delete this team' });
    }

    const name = (await teamNameOf(catalystApp, req.params.id)) || req.params.id;
    const members = await teamMemberIds(catalystApp, req.params.id);

    await catalystApp.datastore().table('Teams').deleteRow(req.params.id);

    const actor = displayName(user);
    const notify_to = await notify(catalystApp, {
      event_type: 'team_deleted', ref_id: req.params.id, ref_name: name, actor_id: user.user_id, actor_name: actor,
      title: 'Team deleted', details: `${actor} deleted the team "${name}"`,
    }, members.map(id => ({ type: 'user', id })));

    logActivity(catalystApp, {
      action: 'Team deleted', user_id: user.user_id, user_email: user.email_id,
      password_id: '', details: `Deleted team: ${name}`,
    });

    res.json({ success: true, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAM MEMBERS ──────────────────────────────────────────────────────────────

app.post('/api/admin/cleanup-orphaned-members', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userRole = ROLE_MAP[user.role_details?.role_name] || 'Employee';
    if (userRole !== 'Admin') return res.status(403).json({ success: false, error: 'Admin access required' });

    const zcql = catalystApp.zcql();
    const [memberRows, allUsers] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM TeamMembers`),
      getAllUsersCached(catalystApp),
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
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const [memberRows, allUsers, imgRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM TeamMembers WHERE team_id = '${req.params.id}'`),
      getAllUsersCached(catalystApp),
      getProfileImageRowsCached(catalystApp),
    ]);

    const userMap = mapBy(allUsers, u => u.user_id);
    const profileImages = {};
    imgRows.forEach(r => {
      const u = r.Users || r;
      if (u.user_id && u.profile_image) profileImages[String(u.user_id)] = u.profile_image;
    });

    const enriched = enrichMembers(memberRows, userMap, profileImages);

    res.json({ success: true, data: enriched });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/teams/:id/members', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!(await canManageTeam(catalystApp, user, req.params.id, 'addMember'))) {
      return res.status(403).json({ success: false, error: 'You do not have permission to add members to this team' });
    }

    const teamName = await teamNameOf(catalystApp, req.params.id);
    if (teamName === null) return res.status(404).json({ success: false, error: 'Team not found' });

    const wanted = [...new Set((Array.isArray(req.body.user_ids) ? req.body.user_ids : [req.body.user_id]).filter(Boolean).map(String))];
    const directory = await getAllUsersCached(catalystApp).catch(() => []);
    const byId = mapBy(directory, u => u.user_id);
    const already = new Set(await teamMemberIds(catalystApp, req.params.id));
    const toAdd = wanted.filter(id => byId[id] && !already.has(id));
    if (!toAdd.length) return res.status(400).json({ success: false, error: 'Those people are already in this team' });

    const permissions = JSON.stringify(req.body.permissions || { edit: false, delete: false, toggleActive: false, addMember: false });
    const table = catalystApp.datastore().table('TeamMembers');
    const rows = await Promise.all(toAdd.map(uid =>
      table.insertRow({ team_id: req.params.id, user_id: uid, permissions, added_by: user.user_id, joined_time: now() })
    ));

    const actor = displayName(user);
    const addedNames = toAdd.map(id => displayName(byId[id]));
    const listText = addedNames.length > 2 ? `${addedNames.slice(0, 2).join(', ')} and ${addedNames.length - 2} more` : addedNames.join(' and ');

    // The newcomers hear "you were added"; everyone already in the team hears who joined.
    const toNew = await notify(catalystApp, {
      event_type: 'member_added', ref_id: req.params.id, ref_name: teamName, actor_id: user.user_id, actor_name: actor,
      title: 'Added to team', details: `${actor} added you to the team "${teamName}"`,
    }, toAdd.map(id => ({ type: 'user', id })));
    const toExisting = await notify(catalystApp, {
      event_type: 'team_member_joined', ref_id: req.params.id, ref_name: teamName, actor_id: user.user_id, actor_name: actor,
      title: 'New team member', details: `${actor} added ${listText} to "${teamName}"`,
    }, [...already].filter(id => id !== String(user.user_id)).map(id => ({ type: 'user', id })));

    logActivity(catalystApp, {
      action: 'Member added', user_id: user.user_id, user_email: user.email_id, password_id: '',
      details: `Added ${addedNames.join(', ')} to team "${teamName}"`,
    });

    res.json({ success: true, data: rows, notify_to: [...new Set([...toNew, ...toExisting])] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/teams/:id/members/:memberId', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'teams.manage_all')) {
      return res.status(403).json({ success: false, error: 'Admin access required to remove members' });
    }

    const memberRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT user_id FROM TeamMembers WHERE ROWID = '${req.params.memberId}' AND team_id = '${req.params.id}'`
    ).catch(() => []);
    const removedUserId = memberRows[0] ? String((memberRows[0].TeamMembers || memberRows[0]).user_id) : null;
    if (!removedUserId) return res.status(404).json({ success: false, error: 'Member not found in this team' });

    await catalystApp.datastore().table('TeamMembers').deleteRow(req.params.memberId);

    const teamName = (await teamNameOf(catalystApp, req.params.id)) || 'a team';
    const directory = await getAllUsersCached(catalystApp).catch(() => []);
    const removed = directory.find(u => String(u.user_id) === removedUserId);
    const actor = displayName(user), who = removed ? displayName(removed) : 'A member';

    const toRemoved = await notify(catalystApp, {
      event_type: 'member_removed', ref_id: req.params.id, ref_name: teamName, actor_id: user.user_id, actor_name: actor,
      title: 'Removed from team', details: `${actor} removed you from the team "${teamName}"`,
    }, [{ type: 'user', id: removedUserId }]);
    const rest = (await teamMemberIds(catalystApp, req.params.id)).filter(id => id !== String(user.user_id));
    const toRest = await notify(catalystApp, {
      event_type: 'team_member_left', ref_id: req.params.id, ref_name: teamName, actor_id: user.user_id, actor_name: actor,
      title: 'Team member removed', details: `${actor} removed ${who} from "${teamName}"`,
    }, rest.map(id => ({ type: 'user', id })));

    logActivity(catalystApp, {
      action: 'Member removed', user_id: user.user_id, user_email: user.email_id, password_id: '',
      details: `Removed ${who} from team "${teamName}"`,
    });

    res.json({ success: true, notify_to: [...new Set([...toRemoved, ...toRest])] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teams/:teamId/members/:memberId/permissions', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!can(user, 'teams.manage_all')) {
      return res.status(403).json({ success: false, error: 'Admin access required to update permissions' });
    }

    const memberRows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT user_id FROM TeamMembers WHERE ROWID = '${req.params.memberId}' AND team_id = '${req.params.teamId}'`
    ).catch(() => []);
    const targetUserId = memberRows[0] ? String((memberRows[0].TeamMembers || memberRows[0]).user_id) : null;
    if (!targetUserId) return res.status(404).json({ success: false, error: 'Member not found in this team' });

    // Only the four known flags, only booleans.
    const incoming = req.body.permissions || {};
    const clean = {};
    PERM_DEFS_SERVER.forEach(k => { clean[k] = incoming[k] === true; });

    const row = await catalystApp.datastore().table('TeamMembers').updateRow({
      ROWID: req.params.memberId, permissions: JSON.stringify(clean),
    });

    const teamName = (await teamNameOf(catalystApp, req.params.teamId)) || 'a team';
    const granted = PERM_DEFS_SERVER.filter(k => clean[k]).map(k => TEAM_PERM_LABEL[k]);
    const actor = displayName(user);
    const notify_to = await notify(catalystApp, {
      event_type: 'permissions_updated', ref_id: req.params.teamId, ref_name: teamName, actor_id: user.user_id, actor_name: actor,
      title: 'Team permissions updated',
      details: `${actor} updated your permissions in "${teamName}": ${granted.length ? granted.join(', ') : 'view only'}`,
    }, [{ type: 'user', id: targetUserId }]);

    res.json({ success: true, data: row, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/teams/:id/toggle-active', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!(await canManageTeam(catalystApp, user, req.params.id, 'toggleActive'))) {
      return res.status(403).json({ success: false, error: 'You do not have permission to activate/deactivate this team' });
    }

    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT name, is_active FROM Teams WHERE ROWID = '${req.params.id}'`
    );
    const t = rows[0] ? (rows[0].Teams || rows[0]) : null;
    if (!t) return res.status(404).json({ success: false, error: 'Team not found' });
    const currentActive = !(t.is_active === false || t.is_active === 'false');
    const newActive = !currentActive;

    await catalystApp.datastore().table('Teams').updateRow({ ROWID: req.params.id, is_active: newActive });

    const actor = displayName(user);
    const notify_to = await notify(catalystApp, {
      event_type: 'team_status_changed', ref_id: req.params.id, ref_name: t.name, actor_id: user.user_id, actor_name: actor,
      title: newActive ? 'Team activated' : 'Team deactivated',
      details: newActive
        ? `${actor} activated "${t.name}" — shared items are accessible again`
        : `${actor} deactivated "${t.name}" — shared items are paused`,
    }, [{ type: 'team', id: req.params.id }]);
    res.json({ success: true, data: { is_active: newActive }, notify_to });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEAM SHARED PASSWORDS / FOLDERS ──────────────────────────────────────────

app.get('/api/teams/:id/shared-passwords', async (req, res) => {
  try {
    const catalystApp = initApp(req);
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
      getAllUsersCached(catalystApp),
      getProfileImageRowsCached(catalystApp),
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
    const catalystApp = initApp(req);
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
      getAllUsersCached(catalystApp),
      getProfileImageRowsCached(catalystApp),
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
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const zcql = catalystApp.zcql();
    const me = String(user.user_id);

    // Admins can switch to the organisation-wide audit feed: who did what to whom, across everyone.
    if (req.query.scope === 'org') {
      if (!can(user, 'logs.org')) return res.status(403).json({ success: false, error: 'Admin access required' });
      const rows = await zcql.executeZCQLQuery(
        `SELECT ROWID, action, user_email, details, created_time FROM ActivityLogs ORDER BY created_time DESC LIMIT 80`
      ).catch(() => []);
      return res.json({
        success: true,
        data: rows.map(r => r.ActivityLogs || r).map(l => ({
          id: `audit:${l.ROWID}`, type: 'audit', action: l.action || 'Activity', details: l.details || '',
          by_name: l.user_email || '', created_time: l.created_time,
        })),
      });
    }

    const nowStr = now();
    const iso = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
    const DAY = 86_400_000;

    const teamRows = await zcql.executeZCQLQuery(`SELECT team_id FROM TeamMembers WHERE user_id = '${me}'`).catch(() => []);
    const teamIds = teamRows.map(r => String((r.TeamMembers || r).team_id));
    const teamIn = teamIds.length ? `, ${teamIds.map(id => `'${id}'`).join(',')}` : '';

    const soft = (label) => (e) => { console.log('notifications query failed [' + label + ']:', e.message); return []; };
    const [eventRows, pwRows, shareRows] = await Promise.all([
      // my notifications (one row per recipient, so read state is mine alone)
      zcql.executeZCQLQuery(
        `SELECT ROWID, type, message, is_read, created_time FROM Notification WHERE user_id = '${me}' ORDER BY created_time DESC LIMIT 150`
      ).catch(soft('events')),
      // my passwords that expire within a week (or lapsed in the last month)
      zcql.executeZCQLQuery(
        `SELECT ROWID, name, expiry_date FROM Passwords WHERE owner_id = '${me}' AND expiry_date >= '${iso(-30 * DAY)}' AND expiry_date < '${iso(7 * DAY)}'`
      ).catch(soft('passwords')),
      // shares I received (directly or via a team) or created that run out within 3 days
      zcql.executeZCQLQuery(
        `SELECT ROWID, password_id, share_type, shared_with, expiry, created_by FROM PasswordShares WHERE expiry >= '${nowStr}' AND expiry < '${iso(3 * DAY)}' AND (shared_with IN ('${String(user.email_id).replace(/'/g, "''")}'${teamIn}) OR created_by = '${me}')`
      ).catch(soft('shares')),
    ]);

    const notifications = [];

    // ── Events: who did what, to whom ───────────────────────────────────────
    eventRows.map(r => r.Notification || r).forEach(row => {
      let ev = {};
      try { ev = JSON.parse(row.message || '{}'); } catch (e) { ev = { details: row.message }; }
      notifications.push({
        id:           `ev:${row.ROWID}`,
        type:         row.type,
        action:       ev.title || ev.details || 'Activity update',
        details:      ev.details,
        by_name:      ev.actor_name,
        actor_id:     ev.actor_id || '',
        ref_name:     ev.ref_name || '',
        scope:        ev.scope || 'you',
        read:         row.is_read === true || row.is_read === 'true',
        created_time: row.created_time,
        ref_id:       ev.ref_id,
      });
    });

    // ── Expiring passwords ───────────────────────────────────────────────────
    pwRows.map(r => r.Passwords || r).forEach(pw => {
      if (!pw.expiry_date) return;
      const expiryDate = new Date(String(pw.expiry_date).replace(' ', 'T') + 'Z');
      const diffDays   = Math.ceil((expiryDate - Date.now()) / DAY);
      const expired    = diffDays < 0;
      notifications.push({
        id:           `pwexp:${pw.ROWID}:${String(pw.expiry_date).slice(0, 10)}`,
        type:         'password_expiring',
        action:       expired ? 'Password expired' : diffDays === 0 ? 'Password expires today' : `Password expiring in ${diffDays} day${diffDays > 1 ? 's' : ''}`,
        details:      `"${pw.name}" ${expired ? 'expired' : 'expires'} on ${expiryDate.toISOString().slice(0, 10)}`,
        created_time: pw.expiry_date,
        ref_id:       pw.ROWID,
        urgent:       expired || diffDays <= 1,
      });
    });

    // ── Shares about to expire ───────────────────────────────────────────────
    const shares = shareRows.map(r => r.PasswordShares || r);
    if (shares.length) {
      const pwIds     = [...new Set(shares.filter(s => s.share_type !== 'folder').map(s => String(s.password_id)))];
      const folderIds = [...new Set(shares.filter(s => s.share_type === 'folder').map(s => String(s.password_id)))];
      const [pwNames, folderNames] = await Promise.all([
        pwIds.length     ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Passwords WHERE ROWID IN (${pwIds.join(',')})`).catch(() => []) : [],
        folderIds.length ? zcql.executeZCQLQuery(`SELECT ROWID, name FROM Folders WHERE ROWID IN (${folderIds.join(',')})`).catch(() => []) : [],
      ]);
      const nameMap = {};
      pwNames.forEach(r => { const p = r.Passwords || r; nameMap['p' + p.ROWID] = p.name; });
      folderNames.forEach(r => { const f = r.Folders || r; nameMap['f' + f.ROWID] = f.name; });
      shares.forEach(s => {
        const isFolder = s.share_type === 'folder';
        const item = nameMap[(isFolder ? 'f' : 'p') + s.password_id] || (isFolder ? 'a folder' : 'a password');
        const hours = Math.max(1, Math.round((new Date(String(s.expiry).replace(' ', 'T') + 'Z') - Date.now()) / 3_600_000));
        const left = hours >= 24 ? `${Math.round(hours / 24)} day${Math.round(hours / 24) > 1 ? 's' : ''}` : `${hours} hour${hours > 1 ? 's' : ''}`;
        const mine = String(s.created_by) === me;
        notifications.push({
          id:           `shexp:${s.ROWID}`,
          type:         'share_expiring',
          action:       mine ? 'A share you created is expiring' : 'Shared access is expiring',
          details:      `Access to ${isFolder ? 'the folder ' : ''}"${item}" ends in ${left}`,
          created_time: nowStr,
          ref_id:       s.password_id,
          urgent:       hours <= 24,
        });
      });
    }

    notifications.sort((a, b) => {
      const ta = a.created_time ? new Date(String(a.created_time).replace(' ', 'T') + 'Z') : 0;
      const tb = b.created_time ? new Date(String(b.created_time).replace(' ', 'T') + 'Z') : 0;
      return tb - ta;
    });

    res.json({ success: true, data: notifications });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Rows I own: "ev:<ROWID>" ids from the feed, or every unread one with { all: true }.
async function myNotificationRows(catalystApp, me, body, onlyUnread) {
  const zcql = catalystApp.zcql();
  if (body.all === true) {
    return (await zcql.executeZCQLQuery(
      `SELECT ROWID FROM Notification WHERE user_id = '${me}'${onlyUnread ? ' AND is_read = false' : ''} LIMIT 300`
    ).catch(() => [])).map(r => String((r.Notification || r).ROWID));
  }
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [])
    .map(x => /^ev:(\d{1,20})$/.exec(String(x))).filter(Boolean).map(m => m[1]))].slice(0, 300);
  if (!ids.length) return [];
  // only rows that really belong to me
  return (await zcql.executeZCQLQuery(
    `SELECT ROWID FROM Notification WHERE user_id = '${me}' AND ROWID IN (${ids.join(',')})`
  ).catch(() => [])).map(r => String((r.Notification || r).ROWID));
}

app.post('/api/notifications/mark-read', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await myNotificationRows(catalystApp, String(user.user_id), req.body || {}, true);
    if (rows.length) await catalystApp.datastore().table('Notification').updateRows(rows.map(ROWID => ({ ROWID, is_read: true })));
    res.json({ success: true, updated: rows.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Dismiss = really delete my copy of the notification.
app.delete('/api/notifications', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const rows = await myNotificationRows(catalystApp, String(user.user_id), req.body || {}, false);
    if (rows.length) await catalystApp.datastore().table('Notification').deleteRows(rows);
    res.json({ success: true, removed: rows.length });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/activity-logs?scope=mine|org
//   Optional server-side paging/filtering (used by the table):
//   &page=1&limit=15&search=text&action=created&from=YYYY-MM-DD HH:mm:ss&to=YYYY-MM-DD HH:mm:ss
//   from/to are UTC bounds (the client converts the user's local day range).
//   Without `page` the old behaviour is kept (latest 200 rows).
const UTC_DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
app.get('/api/activity-logs', async (req, res) => {
  try {
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const isAdmin = isAdminUser(user);
    const scope = req.query.scope === 'org' ? 'org' : 'mine';
    const zcql  = catalystApp.zcql();

    const where = [];
    // Non-admins are always locked to their own logs, regardless of what scope is requested
    if (scope === 'mine' || !isAdmin) where.push(`user_email = '${escapeLike(user.email_id)}'`);

    const paged = req.query.page !== undefined;
    if (paged) {
      const q = escapeLike(String(req.query.search || '').trim()).replace(/[\\%_]/g, '').slice(0, 80);
      if (q) where.push(`(action LIKE '%${q}%' OR user_email LIKE '%${q}%' OR details LIKE '%${q}%')`);

      const action = String(req.query.action || '').trim().toLowerCase();
      if (action && action !== 'all' && /^[a-z ]{1,20}$/.test(action)) where.push(`action LIKE '%${action}%'`);

      const from = String(req.query.from || '');
      const to   = String(req.query.to || '');
      if (UTC_DT.test(from)) where.push(`created_time >= '${from}'`);
      if (UTC_DT.test(to))   where.push(`created_time <= '${to}'`);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    if (!paged) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM ActivityLogs${whereSql} ORDER BY ROWID DESC LIMIT 200`);
      return res.json({
        success: true,
        data: rows.map(r => r.ActivityLogs || r),
        currentUserEmail: user.email_id,
        isAdmin,
      });
    }

    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset   = (page - 1) * pageSize;

    const [rows, countRows] = await Promise.all([
      zcql.executeZCQLQuery(`SELECT * FROM ActivityLogs${whereSql} ORDER BY ROWID DESC LIMIT ${offset}, ${pageSize}`),
      zcql.executeZCQLQuery(`SELECT COUNT(ROWID) FROM ActivityLogs${whereSql}`).catch(() => []),
    ]);
    const countRow = countRows[0] ? (countRows[0].ActivityLogs || countRows[0]) : null;
    const total = countRow ? Number(Object.values(countRow)[0]) || 0 : rows.length;

    res.json({
      success: true,
      data: rows.map(r => r.ActivityLogs || r),
      total, page, pageSize,
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
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No ids provided' });
    }

    const isAdmin = isAdminUser(user);
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
    const catalystApp = initApp(req);
    const user = await getCurrentUser(req, catalystApp);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const isAdmin = isAdminUser(user);

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