import {
  RiBellLine, RiKeyLine, RiShareLine, RiTimeLine, RiTeamLine, RiEditBoxLine,
  RiDeleteBin6Line, RiFolderSharedLine, RiFolderForbidLine, RiUserFollowLine,
  RiUserUnfollowLine, RiPlayCircleLine, RiEyeLine, RiLockLine, RiShieldUserLine,
  RiShieldCheckLine, RiMailSendLine, RiUserForbidLine, RiUserSettingsLine,
  RiHistoryLine, RiTeamFill, RiAlarmWarningLine,
} from 'react-icons/ri';

// Tabs in the notification panel.
export const CATEGORIES = [
  { key: 'all',     label: 'All' },
  { key: 'sharing', label: 'Sharing' },
  { key: 'teams',   label: 'Teams' },
  { key: 'people',  label: 'People' },
  { key: 'alerts',  label: 'Alerts' },
];

// type -> icon, label, module (shown as a badge), category (tab) and priority (colour)
export const TYPE_META = {
  // Sharing
  password_shared:         { icon: RiShareLine,         label: 'Password shared',       module: 'Sharing',  category: 'sharing', priority: 'info' },
  folder_shared:           { icon: RiFolderSharedLine,  label: 'Folder shared',         module: 'Sharing',  category: 'sharing', priority: 'info' },
  password_updated:        { icon: RiEditBoxLine,       label: 'Password updated',      module: 'Passwords', category: 'sharing', priority: 'info' },
  password_deleted:        { icon: RiDeleteBin6Line,    label: 'Password deleted',      module: 'Passwords', category: 'sharing', priority: 'error' },
  password_created:        { icon: RiKeyLine,           label: 'Password added',        module: 'Passwords', category: 'sharing', priority: 'success' },
  folder_renamed:          { icon: RiEditBoxLine,       label: 'Folder renamed',        module: 'Folders',  category: 'sharing', priority: 'info' },
  folder_deleted:          { icon: RiDeleteBin6Line,    label: 'Folder deleted',        module: 'Folders',  category: 'sharing', priority: 'error' },
  password_access_revoked: { icon: RiFolderForbidLine,  label: 'Access revoked',        module: 'Sharing',  category: 'sharing', priority: 'error' },
  folder_access_revoked:   { icon: RiFolderForbidLine,  label: 'Access revoked',        module: 'Sharing',  category: 'sharing', priority: 'error' },
  external_share_viewed:   { icon: RiEyeLine,           label: 'Link opened',           module: 'Sharing',  category: 'sharing', priority: 'success' },

  // Teams
  team_created:            { icon: RiTeamFill,          label: 'Team created',          module: 'Teams',    category: 'teams',   priority: 'success' },
  team_added:              { icon: RiTeamLine,          label: 'Added to team',         module: 'Teams',    category: 'teams',   priority: 'success' },
  member_added:            { icon: RiUserFollowLine,    label: 'Added to team',         module: 'Teams',    category: 'teams',   priority: 'success' },
  team_member_joined:      { icon: RiUserFollowLine,    label: 'New team member',       module: 'Teams',    category: 'teams',   priority: 'success' },
  member_removed:          { icon: RiUserUnfollowLine,  label: 'Removed from team',     module: 'Teams',    category: 'teams',   priority: 'error' },
  team_member_left:        { icon: RiUserUnfollowLine,  label: 'Member removed',        module: 'Teams',    category: 'teams',   priority: 'warning' },
  team_updated:            { icon: RiEditBoxLine,       label: 'Team updated',          module: 'Teams',    category: 'teams',   priority: 'info' },
  team_deleted:            { icon: RiDeleteBin6Line,    label: 'Team deleted',          module: 'Teams',    category: 'teams',   priority: 'error' },
  team_status_changed:     { icon: RiPlayCircleLine,    label: 'Team status',           module: 'Teams',    category: 'teams',   priority: 'warning' },
  permissions_updated:     { icon: RiShieldCheckLine,   label: 'Permissions updated',   module: 'Teams',    category: 'teams',   priority: 'warning' },

  // People
  user_invited:            { icon: RiMailSendLine,      label: 'User invited',          module: 'Users',    category: 'people',  priority: 'success' },
  user_deleted:            { icon: RiUserForbidLine,    label: 'User removed',          module: 'Users',    category: 'people',  priority: 'error' },
  user_status_changed:     { icon: RiUserForbidLine,    label: 'Account status',        module: 'Users',    category: 'people',  priority: 'warning' },
  role_changed:            { icon: RiShieldUserLine,    label: 'Role changed',          module: 'Users',    category: 'people',  priority: 'warning' },
  profile_updated:         { icon: RiUserSettingsLine,  label: 'Profile updated',       module: 'Users',    category: 'people',  priority: 'info' },

  // Alerts
  password_expiring:       { icon: RiTimeLine,          label: 'Password expiring',     module: 'Alerts',   category: 'alerts',  priority: 'warning' },
  share_expiring:          { icon: RiAlarmWarningLine,  label: 'Access expiring',       module: 'Alerts',   category: 'alerts',  priority: 'warning' },
  external_share_locked:   { icon: RiLockLine,          label: 'Link locked',           module: 'Alerts',   category: 'alerts',  priority: 'error' },

  // Organisation audit feed (admins)
  audit:                   { icon: RiHistoryLine,       label: 'Activity',              module: 'Audit',    category: 'all',     priority: 'info' },
};

export const DEFAULT_META = { icon: RiBellLine, label: 'Activity', module: 'Activity', category: 'all', priority: 'info' };

export const getMeta = (n) => TYPE_META[n.type] || DEFAULT_META;

export const getPriority = (n) => {
  if (n.type === 'password_expiring' || n.type === 'share_expiring') return n.urgent ? 'error' : 'warning';
  return getMeta(n).priority;
};

// Where clicking a notification should take you.
export const getTargetRoute = (n) => {
  switch (n.type) {
    case 'password_shared': case 'password_updated': case 'password_deleted': case 'password_created':
    case 'password_expiring': case 'password_access_revoked': case 'share_expiring':
      return n.ref_id ? `/passwords?highlight=${n.ref_id}` : '/passwords';
    case 'folder_shared': case 'folder_renamed': case 'folder_deleted': case 'folder_access_revoked':
      return n.ref_id ? `/folders?highlight=${n.ref_id}` : '/folders';
    case 'team_created': case 'team_added': case 'member_added': case 'team_member_joined': case 'member_removed':
    case 'team_member_left': case 'team_updated': case 'team_status_changed': case 'permissions_updated':
      return n.ref_id ? `/teams?highlight=${n.ref_id}` : '/teams';
    case 'team_deleted':
      return '/teams';
    case 'external_share_viewed': case 'external_share_locked':
      return '/shares';
    case 'user_invited': case 'user_deleted': case 'user_status_changed': case 'role_changed': case 'profile_updated':
      return '/users';
    case 'audit':
      return '/activity';
    default:
      return null;
  }
};

export const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

// Stable avatar colour per person.
const AVATAR_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#d97706', '#db2777', '#dc2626', '#4f46e5'];
export const avatarColor = (seed) => {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
