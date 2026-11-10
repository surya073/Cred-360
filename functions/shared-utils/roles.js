'use strict';

// Roles & permissions — the single source of truth, used by every function and served to the UI
// (GET /api/roles) so what the screen shows is exactly what the server enforces.
//
// Catalyst owns the actual login roles (App Administrator / TeamLead / App User / Intern, mapped in
// constants.ROLE_MAP). This module defines what each app role is *allowed to do*. Team-level
// permissions (edit / delete / activate / add members) are a separate, per-membership layer stored
// on TeamMembers.permissions.

const { ROLE_MAP } = require('./constants');

const ROLES = ['Admin', 'Team Lead', 'Employee', 'Intern'];

const ROLE_INFO = {
  'Admin':     { description: 'Full control of the workspace: users, roles, teams, sharing and audit logs.' },
  'Team Lead': { description: 'Runs teams: creates teams, invites Employees and Interns, shares internally and externally.' },
  'Employee':  { description: 'Day-to-day user: manages their own vault and shares with colleagues and teams.' },
  'Intern':    { description: 'Limited access: keeps their own vault and receives shares, cannot share onward.' },
};

// key -> { group, label, description }. Order here is the order shown in the UI.
const PERMISSIONS = [
  { key: 'passwords.create',         group: 'Passwords', label: 'Create passwords',          description: 'Store new passwords in their own vault.' },
  { key: 'passwords.share',          group: 'Passwords', label: 'Share with users & teams',  description: 'Share a password they own with colleagues or teams.' },
  { key: 'passwords.share_external', group: 'Passwords', label: 'Share externally',          description: 'Create passphrase-protected links for people outside the workspace.' },
  { key: 'folders.create',           group: 'Folders',   label: 'Create folders',            description: 'Organise passwords into folders.' },
  { key: 'folders.share',            group: 'Folders',   label: 'Share folders',             description: 'Share a folder (and everything inside) with users or teams.' },
  { key: 'teams.create',             group: 'Teams',     label: 'Create teams',              description: 'Create new teams and become their first member.' },
  { key: 'teams.manage_all',         group: 'Teams',     label: 'Manage every team',         description: 'Edit, delete and change members of any team, not just their own.' },
  { key: 'users.invite',             group: 'Users',     label: 'Invite users',              description: 'Send invitations to new people.' },
  { key: 'users.edit',               group: 'Users',     label: 'Edit users',                description: 'Change other people\'s name or details.' },
  { key: 'users.roles',              group: 'Users',     label: 'Change roles',              description: 'Promote or demote other users.' },
  { key: 'users.disable',            group: 'Users',     label: 'Enable / disable users',    description: 'Block a user from signing in, or restore access.' },
  { key: 'users.delete',             group: 'Users',     label: 'Delete users',              description: 'Permanently remove a user and their team memberships.' },
  { key: 'logs.org',                 group: 'Audit',     label: 'View organisation logs',    description: 'See the activity of every user, not just their own.' },
  { key: 'shares.manage_all',        group: 'Audit',     label: 'Revoke anyone\'s shares',   description: 'Revoke shares that other people created.' },
  { key: 'chat.use',                 group: 'Collaboration', label: 'Use team chat',         description: 'Read and write in the chat of teams they belong to.' },
];

const ALL = PERMISSIONS.map(p => p.key);

const ROLE_PERMISSIONS = {
  'Admin':     ALL,
  'Team Lead': ['passwords.create', 'passwords.share', 'passwords.share_external', 'folders.create', 'folders.share',
                'teams.create', 'users.invite', 'chat.use'],
  'Employee':  ['passwords.create', 'passwords.share', 'passwords.share_external', 'folders.create', 'folders.share', 'chat.use'],
  'Intern':    ['passwords.create', 'folders.create', 'chat.use'],
};

// Which roles a person in role X may hand out when inviting / changing roles.
const ASSIGNABLE_ROLES = {
  'Admin':     ['Admin', 'Team Lead', 'Employee', 'Intern'],
  'Team Lead': ['Employee', 'Intern'],
};

const roleOf = (user) => ROLE_MAP[user?.role_details?.role_name] || 'Employee';

const can = (user, key) => (ROLE_PERMISSIONS[roleOf(user)] || []).includes(key);

const canAssignRole = (user, role) => (ASSIGNABLE_ROLES[roleOf(user)] || []).includes(role);

module.exports = { ROLES, ROLE_INFO, PERMISSIONS, ROLE_PERMISSIONS, ASSIGNABLE_ROLES, roleOf, can, canAssignRole };
