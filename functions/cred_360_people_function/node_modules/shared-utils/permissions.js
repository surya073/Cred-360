function permList(share) {
  return (share.permissions || '').split(',').map(p => p.trim()).filter(Boolean);
}

function shareIsActive(share) {
  if (!share.expiry) return true;
  return new Date(share.expiry.replace(' ', 'T') + 'Z') > new Date();
}

async function getUserTeamIds(catalystApp, userId) {
  const rows = await catalystApp.zcql().executeZCQLQuery(
    `SELECT team_id FROM TeamMembers WHERE user_id = '${userId}'`
  ).catch(() => []);
  return rows.map(r => String((r.TeamMembers || r).team_id));
}

// All folder IDs covered by a folder share (root + every nested sub-folder)
async function getDescendantFolderIds(catalystApp, rootFolderId) {
  const zcql = catalystApp.zcql();
  const all = new Set([String(rootFolderId)]);
  let frontier = [String(rootFolderId)];
  while (frontier.length) {
    const rows = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM Folders WHERE parent_folder_id IN (${frontier.join(',')})`
    ).catch(() => []);
    const next = [];
    rows.forEach(r => {
      const id = String((r.Folders || r).ROWID);
      if (!all.has(id)) { all.add(id); next.push(id); }
    });
    frontier = next;
  }
  return all;
}

// Can this user do `permission` ('edit' | 'delete') on this password?
async function userCanOnPassword(catalystApp, user, passwordRow, permission) {
  if (String(passwordRow.owner_id) === String(user.user_id)) return true;
  if (passwordRow.is_active === false || passwordRow.is_active === 'false') return false;

  const zcql        = catalystApp.zcql();
  const teamIds      = await getUserTeamIds(catalystApp, user.user_id);
  const teamFilter    = teamIds.length ? ` OR shared_with IN (${teamIds.map(t => `'${t}'`).join(',')})` : '';

  // Direct password shares — scoped to this password AND this user/team only
  const directShares = await zcql.executeZCQLQuery(
    `SELECT * FROM PasswordShares WHERE password_id = '${passwordRow.ROWID}' AND share_type IN ('user','team') AND (shared_with = '${user.email_id}'${teamFilter})`
  ).catch(() => []);
  for (const r of directShares) {
    const s = r.PasswordShares || r;
    if (shareIsActive(s) && permList(s).includes(permission)) return true;
  }

  // Folder shares — scoped to this user/team only, not the whole table
  if (passwordRow.folder_id) {
    const folderShares = await zcql.executeZCQLQuery(
      `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND (shared_with = '${user.email_id}'${teamFilter})`
    ).catch(() => []);
    for (const r of folderShares) {
      const s = r.PasswordShares || r;
      if (!shareIsActive(s) || !permList(s).includes(permission)) continue;
      const rootFolderRows = await zcql.executeZCQLQuery(
        `SELECT is_active FROM Folders WHERE ROWID = '${s.password_id}'`
      ).catch(() => []);
      const rootFolder = rootFolderRows[0] ? (rootFolderRows[0].Folders || rootFolderRows[0]) : null;
      if (rootFolder && (rootFolder.is_active === false || rootFolder.is_active === 'false')) continue;
      const descendants = await getDescendantFolderIds(catalystApp, s.password_id);
      if (descendants.has(String(passwordRow.folder_id))) return true;
    }
  }
  return false;
}

async function userCanOnFolder(catalystApp, user, folderRow, permission) {
  if (String(folderRow.owner_id) === String(user.user_id)) return true;
  if (folderRow.is_active === false || folderRow.is_active === 'false') return false;

  const zcql       = catalystApp.zcql();
  const teamIds     = await getUserTeamIds(catalystApp, user.user_id);
  const teamFilter  = teamIds.length ? ` OR shared_with IN (${teamIds.map(t => `'${t}'`).join(',')})` : '';

  const folderShares = await zcql.executeZCQLQuery(
    `SELECT * FROM PasswordShares WHERE share_type = 'folder' AND (shared_with = '${user.email_id}'${teamFilter})`
  ).catch(() => []);
  for (const r of folderShares) {
    const s = r.PasswordShares || r;
    if (!shareIsActive(s) || !permList(s).includes(permission)) continue;
    const descendants = await getDescendantFolderIds(catalystApp, s.password_id);
    if (descendants.has(String(folderRow.ROWID))) return true;
  }
  return false;
}


async function validateExternalShare(catalystApp, token, passphrase) {
  const rows = await catalystApp.zcql().executeZCQLQuery(
    `SELECT * FROM PasswordShares WHERE token = '${token}'`
  );
  if (!rows?.length) return { error: 'Invalid link', status: 404 };
  const share = rows[0].PasswordShares || rows[0];
  if (!shareIsActive(share)) return { error: 'This link has expired', status: 410 };
  if (share.passphrase !== passphrase) return { error: 'Incorrect passphrase', status: 401 };
  return { share };
}


// external user helper
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
        name:             '',
        email,
        domain:           extractDomain(email),
        company:          '',
        status:           'active',
        first_shared_time: now(),
        last_shared_time:  now(),
        created_by:       String(sharedByUserId),
        notes:            '',
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


// ── Simple in-memory rate limiter ─────────────────────────────────────────
// Tracks failed passphrase attempts per token
// Resets on success; blocks after 5 failures for 15 minutes
const passphraseAttempts = new Map();

function checkRateLimit(token) {
  const now  = Date.now();
  const entry = passphraseAttempts.get(token);

  if (!entry) return { allowed: true };

  // If blocked and window not expired yet
  if (entry.blocked && now < entry.blockedUntil) {
    const remainingMs  = entry.blockedUntil - now;
    const remainingMin = Math.ceil(remainingMs / 60000);
    return { allowed: false, remainingMin };
  }

  // Block window expired — reset
  if (entry.blocked && now >= entry.blockedUntil) {
    passphraseAttempts.delete(token);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedAttempt(token) {
  const now   = Date.now();
  const entry = passphraseAttempts.get(token) || { count: 0, blocked: false };

  entry.count++;

  if (entry.count >= 5) {
    entry.blocked      = true;
    entry.blockedUntil = now + 15 * 60 * 1000;
    console.log(`Rate limit triggered for token: ${token.slice(0, 8)}...`);
  }

  passphraseAttempts.set(token, entry);
  return Math.max(0, 5 - entry.count);   // ← add this line
}
function clearAttempts(token) {
  passphraseAttempts.delete(token);
}

// Cleanup stale entries every 30 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of passphraseAttempts.entries()) {
    if (entry.blocked && now >= entry.blockedUntil) {
      passphraseAttempts.delete(token);
    }
  }
}, 30 * 60 * 1000);


// (paste them here, unchanged)

module.exports = {
  permList, shareIsActive, getUserTeamIds, getDescendantFolderIds,
  userCanOnPassword, userCanOnFolder, validateExternalShare,
  checkRateLimit, recordFailedAttempt, clearAttempts,
};