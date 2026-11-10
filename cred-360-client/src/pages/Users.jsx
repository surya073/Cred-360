import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from '../services/api';
import { useAuth } from '../context/AuthContext';
import Toast, { useToast } from '../components/Toast';
import DataTable from '../components/DataTable';
import { formatDate } from '../utils/dateHelper';
import {
  RiUserLine, RiAddLine, RiRefreshLine,
  RiShieldUserLine, RiMailLine, RiUserStarLine, RiDeleteBinLine,
  RiKeyLine, RiFolderLine, RiTeamLine, RiGlobalLine,
  RiShareLine, RiTimeLine, RiBarChartBoxLine,
  RiEditLine, RiCheckLine, RiCloseLine, RiUserForbidLine, RiUserFollowLine, RiLockLine,
} from 'react-icons/ri';

const API_CORE   = '/server/cred_360_function';
const API_PEOPLE = '/server/cred_360_people_function';
const API_EXTRAS = '/server/cred_360_extras_function';

// Fallback until /api/roles answers (the server is the source of truth for permissions).
const ROLES = ['Admin', 'Team Lead', 'Employee', 'Intern'];

const ROLE_COLORS = {
  admin:       { bg: '#eff6ff', color: '#1d4ed8' },
  'team lead': { bg: '#f0fdf4', color: '#15803d' },
  employee:    { bg: '#fefce8', color: '#a16207' },
  intern:      { bg: '#fdf4ff', color: '#7e22ce' },
  user:        { bg: '#f8fafc', color: '#475569' },
};

const getRoleStyle = (role) => {
  const key = (role || 'user').toLowerCase();
  return ROLE_COLORS[key] || ROLE_COLORS.user;
};

const getInitials = (name, email) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return 'U';
};

const NAME_OK = /^[\p{L}][\p{L}\p{M}'.\- ]*$/u;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const Users = () => {
  const { user: currentUser } = useAuth();
  const { toasts, removeToast, toast } = useToast();

  const [tab, setTab]                     = useState('people'); // people | roles
  const [users, setUsers]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [rolesInfo, setRolesInfo]         = useState(null);     // { roles, permissions, me }

  // invite
  const [showInvite, setShowInvite]       = useState(false);
  const [invite, setInvite]               = useState({ first_name: '', last_name: '', email: '', role: 'Employee', team_ids: [] });
  const [inviteErrors, setInviteErrors]   = useState({});
  const [inviting, setInviting]           = useState(false);
  const [teams, setTeams]                 = useState([]);

  // edit
  const [editUser, setEditUser]           = useState(null);
  const [edit, setEdit]                   = useState({ first_name: '', last_name: '', role: '' });
  const [editErrors, setEditErrors]       = useState({});
  const [saving, setSaving]               = useState(false);
  const [statusBusy, setStatusBusy]       = useState(false);

  const [deleteTarget, setDeleteTarget]   = useState(null);
  const [deleting, setDeleting]           = useState(false);
  const [analyticsUser, setAnalyticsUser] = useState(null);
  const [analytics, setAnalytics]         = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const myPerms = useMemo(() => new Set(rolesInfo?.me?.permissions || []), [rolesInfo]);
  const can = (key) => myPerms.has(key);
  const assignable = rolesInfo?.me?.assignable || [];
  const myRole = rolesInfo?.me?.role;
  const isAdmin = ['admin', 'app administrator'].includes((currentUser?.role_details?.role_name || '').toLowerCase());
  const roleNames = rolesInfo?.roles?.map(r => r.name) || ROLES;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_PEOPLE}/api/users`, { fresh: true });
      if (res.data.success) setUsers(res.data.data || []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await axios.get(`${API_PEOPLE}/api/roles`, { fresh: true });
      if (res.data.success) setRolesInfo(res.data);
    } catch { /* the page still works with the fallbacks */ }
  }, []);

  useEffect(() => { fetchUsers(); fetchRoles(); }, [fetchUsers, fetchRoles]);

  // lock body scroll when any modal open
  useEffect(() => {
    const open = showInvite || !!editUser || !!deleteTarget || !!analyticsUser;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showInvite, editUser, deleteTarget, analyticsUser]);

  // ── invite ────────────────────────────────────────────────────────────────
  const openInvite = async () => {
    setInvite({ first_name: '', last_name: '', email: '', role: assignable.includes('Employee') ? 'Employee' : (assignable[0] || 'Employee'), team_ids: [] });
    setInviteErrors({});
    setShowInvite(true);
    try {
      const res = await axios.get(`${API_PEOPLE}/api/teams`);
      setTeams(res.data?.data || []);
    } catch { setTeams([]); }
  };

  const validateInvite = () => {
    const e = {};
    const first = invite.first_name.trim(), last = invite.last_name.trim();
    if (!first) e.first_name = 'First name is required';
    else if (!NAME_OK.test(first)) e.first_name = 'Use letters only';
    if (last && !NAME_OK.test(last)) e.last_name = 'Use letters only';
    if (!EMAIL_OK.test(invite.email.trim())) e.email = 'Enter a valid email address';
    else if (users.some(u => (u.email || '').toLowerCase() === invite.email.trim().toLowerCase())) e.email = 'This person is already in the workspace';
    setInviteErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleInvite = async () => {
    if (!validateInvite()) return;
    setInviting(true);
    try {
      await axios.post(`${API_PEOPLE}/api/users/invite`, {
        first_name: invite.first_name.trim(), last_name: invite.last_name.trim(),
        email: invite.email.trim(), role: invite.role, team_ids: invite.team_ids,
      });
      setShowInvite(false);
      toast.success(`Invitation sent to ${invite.first_name.trim()}`);
      fetchUsers(); fetchRoles();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Invite failed. Try again.');
    } finally {
      setInviting(false);
    }
  };

  // ── edit ──────────────────────────────────────────────────────────────────
  const openEdit = (u) => {
    setEditUser(u);
    setEdit({ first_name: u.first_name || (u.name || '').split(' ')[0] || '', last_name: u.last_name || '', role: u.role || 'Employee' });
    setEditErrors({});
  };

  const handleSaveEdit = async () => {
    const e = {};
    const first = edit.first_name.trim(), last = edit.last_name.trim();
    if (!first) e.first_name = 'First name is required';
    else if (!NAME_OK.test(first)) e.first_name = 'Use letters only';
    if (last && !NAME_OK.test(last)) e.last_name = 'Use letters only';
    setEditErrors(e);
    if (Object.keys(e).length) return;

    const body = {};
    if (first !== (editUser.first_name || '')) body.first_name = first;
    if (last !== (editUser.last_name || '')) body.last_name = last;
    if (edit.role !== editUser.role) body.role = edit.role;
    if (!Object.keys(body).length) { setEditUser(null); return; }

    setSaving(true);
    try {
      await axios.put(`${API_PEOPLE}/api/users/${editUser.ROWID}`, body);
      setEditUser(null);
      toast.success('User updated');
      fetchUsers(); fetchRoles();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (u) => {
    const disabling = String(u.status).toUpperCase() === 'ACTIVE';
    setStatusBusy(true);
    try {
      await axios.put(`${API_PEOPLE}/api/users/${u.ROWID}/status`, { status: disabling ? 'DISABLE' : 'ENABLE' });
      toast.success(disabling ? `${u.name || u.email} can no longer sign in` : `${u.name || u.email} can sign in again`);
      setEditUser(null);
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not change the account status');
    } finally {
      setStatusBusy(false);
    }
  };

  const openAnalytics = async (u) => {
    setAnalyticsUser(u);
    setAnalytics(null);
    setAnalyticsLoading(true);
    try {
      const res = await axios.get(`${API_EXTRAS}/api/users/${u.ROWID}/analytics`);
      if (res.data.success) setAnalytics(res.data.analytics);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to load analytics');
      setAnalyticsUser(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_PEOPLE}/api/users/${deleteTarget.ROWID}`);
      setDeleteTarget(null);
      toast.success('User deleted successfully');
      fetchUsers(); fetchRoles();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const isSelfUser = (u) => u.email === currentUser?.email_id;
  const canManageRow = (u) => !isSelfUser(u) && (can('users.edit') || can('users.roles') || can('users.disable') || can('users.delete'));
  const showActions = can('users.edit') || can('users.roles') || can('users.disable') || can('users.delete') || isAdmin;

  const columns = [
    {
      key: 'name', label: 'User', sortable: true,
      render: (u) => {
        const style = getRoleStyle(u.role);
        const self = isSelfUser(u);
        return (
          <div className="user-cell">
            {u.profile_image ? (
              <img
                src={`${API_CORE}/api/profile/image/${u.profile_image}`}
                alt={u.name}
                style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--border-color)' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="user-avatar-sm" style={{ background: style.bg, color: style.color }}>
                {getInitials(u.name, u.email)}
              </div>
            )}
            <div>
              <div className="td-bold">
                {u.name || 'Unknown'}
                {self && <span className="self-badge">You</span>}
              </div>
              {!u.confirmed && <div className="td-muted" style={{ fontSize: 11.5 }}>Invitation pending</div>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'email', label: 'Email', sortable: true,
      render: (u) => (
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          <RiMailLine size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="td-muted">{u.email}</span>
        </div>
      ),
    },
    {
      key: 'role', label: 'Role', sortable: true,
      render: (u) => {
        const style = getRoleStyle(u.role);
        return <span className="badge" style={{ background: style.bg, color: style.color }}>{u.role || 'User'}</span>;
      },
    },
    {
      key: 'status', label: 'Status',
      render: (u) => {
        const s = String(u.status || 'ACTIVE').toUpperCase();
        if (s === 'ACTIVE') return <span className="badge badge-success">Active</span>;
        if (s === 'DISABLED' || s === 'DISABLE') return <span className="badge badge-danger">Disabled</span>;
        return <span className="badge badge-warning">{s.charAt(0) + s.slice(1).toLowerCase()}</span>;
      },
    },
    {
      key: 'joined', label: 'Joined', sortable: true,
      render: (u) => <span className="td-muted" style={{ fontSize: 12.5 }}>{formatDate(u.joined)}</span>,
    },
    ...(showActions ? [{
      key: 'actions', label: 'Actions',
      render: (u) => (
        <div className="flex gap-8" onClick={e => e.stopPropagation()}>
          {isAdmin && (
            <button className="icon-btn" onClick={() => openAnalytics(u)} title="View analytics">
              <RiBarChartBoxLine size={15} />
            </button>
          )}
          {canManageRow(u) && (can('users.edit') || can('users.roles') || can('users.disable')) && (
            <button className="icon-btn" onClick={() => openEdit(u)} title="Edit user">
              <RiEditLine size={15} />
            </button>
          )}
          {canManageRow(u) && can('users.delete') && (
            <button className="icon-btn danger" onClick={() => setDeleteTarget(u)} title="Delete user">
              <RiDeleteBinLine size={15} />
            </button>
          )}
        </div>
      ),
    }] : []),
  ];

  const toggleTeam = (id) => setInvite(i => ({ ...i, team_ids: i.team_ids.includes(id) ? i.team_ids.filter(t => t !== id) : [...i.team_ids, id] }));

  // permission matrix grouped for the Roles tab
  const matrixGroups = useMemo(() => {
    const groups = [];
    (rolesInfo?.permissions || []).forEach(p => {
      let g = groups.find(x => x.name === p.group);
      if (!g) { g = { name: p.group, items: [] }; groups.push(g); }
      g.items.push(p);
    });
    return groups;
  }, [rolesInfo]);

  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      {/* ── Header ── */}
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{users.length} members in your organization</p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-secondary" onClick={() => { fetchUsers(); fetchRoles(); }} title="Refresh">
            <RiRefreshLine size={16} />
          </button>
          {can('users.invite') && (
            <button className="btn btn-primary" onClick={openInvite}>
              <RiAddLine size={16} /> Invite User
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="pw-tabs" style={{ marginBottom: 16 }}>
        <button className={`pw-tab ${tab === 'people' ? 'active' : ''}`} onClick={() => setTab('people')}>
          <RiUserLine size={15} /> People <span className="pw-tab-count">{users.length}</span>
        </button>
        <button className={`pw-tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>
          <RiShieldUserLine size={15} /> Roles &amp; permissions
        </button>
      </div>

      {tab === 'people' && (
        <>
          {/* ── Stats ── */}
          <div className="users-stats">
            {roleNames.map(role => {
              const count = users.filter(u => u.role?.toLowerCase() === role.toLowerCase()).length;
              const style = getRoleStyle(role.toLowerCase());
              return (
                <div className="user-stat-card" key={role}>
                  <div className="user-stat-icon" style={{ background: style.bg, color: style.color }}>
                    <RiUserStarLine size={20} />
                  </div>
                  <div>
                    <div className="user-stat-value">{count}</div>
                    <div className="user-stat-label">{role}s</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Table ── */}
          <DataTable
            columns={columns}
            rows={users}
            rowKey="ROWID"
            loading={loading}
            dateField="joined"
            searchKeys={['name', 'email', 'role']}
            searchPlaceholder="Search name, email or role…"
            filters={[{ key: 'role', label: 'All roles', options: roleNames.map(r => ({ value: r, label: r })) }]}
            onRowClick={isAdmin ? openAnalytics : undefined}
            onRefresh={fetchUsers}
            emptyIcon={<RiUserLine size={34} />}
            emptyText="No users found"
          />
        </>
      )}

      {tab === 'roles' && (
        <div className="roles-panel">
          <p className="roles-intro">
            What each role is allowed to do. These rules are enforced by the server on every request, not just hidden in the screens.
            {myRole && <> You are signed in as <b>{myRole}</b>.</>}
          </p>

          <div className="role-cards">
            {(rolesInfo?.roles || []).map(r => {
              const style = getRoleStyle(r.name);
              return (
                <div key={r.name} className={`role-card ${myRole === r.name ? 'mine' : ''}`} style={{ borderTopColor: style.color }}>
                  <div className="role-card-head">
                    <span className="badge" style={{ background: style.bg, color: style.color }}>{r.name}</span>
                    {myRole === r.name && <span className="role-you">You</span>}
                  </div>
                  <p>{r.description}</p>
                  <div className="role-card-foot"><RiUserLine size={13} /> {r.users} {r.users === 1 ? 'user' : 'users'} · {r.permissions.length} permissions</div>
                </div>
              );
            })}
          </div>

          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="matrix-perm">Permission</th>
                  {(rolesInfo?.roles || []).map(r => (
                    <th key={r.name} className={myRole === r.name ? 'mine' : ''}>{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixGroups.map(g => (
                  <React.Fragment key={g.name}>
                    <tr className="matrix-group"><td colSpan={1 + (rolesInfo?.roles || []).length}>{g.name}</td></tr>
                    {g.items.map(p => (
                      <tr key={p.key}>
                        <td className="matrix-perm">
                          <div className="matrix-label">{p.label}</div>
                          <div className="matrix-desc">{p.description}</div>
                        </td>
                        {(rolesInfo?.roles || []).map(r => {
                          const has = r.permissions.includes(p.key);
                          return (
                            <td key={r.name} className={`matrix-cell ${myRole === r.name ? 'mine' : ''}`}>
                              {has ? <RiCheckLine size={17} className="yes" /> : <RiCloseLine size={16} className="no" />}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="roles-foot"><RiLockLine size={13} /> Team-level rights (edit, delete, activate, add members) are set per member inside each team.</p>
        </div>
      )}

      {/* ── Invite Modal ── */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Invite a colleague</h2>
              <button className="modal-close" onClick={() => setShowInvite(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label">First name *</label>
                  <input className={`form-input ${inviteErrors.first_name ? 'has-error' : ''}`} placeholder="Priya" maxLength={50}
                    value={invite.first_name} onChange={e => setInvite(i => ({ ...i, first_name: e.target.value }))} autoFocus />
                  {inviteErrors.first_name && <span className="field-error">{inviteErrors.first_name}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Last name</label>
                  <input className={`form-input ${inviteErrors.last_name ? 'has-error' : ''}`} placeholder="Sharma" maxLength={50}
                    value={invite.last_name} onChange={e => setInvite(i => ({ ...i, last_name: e.target.value }))} />
                  {inviteErrors.last_name && <span className="field-error">{inviteErrors.last_name}</span>}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">Work email *</label>
                <input className={`form-input ${inviteErrors.email ? 'has-error' : ''}`} type="email" placeholder="priya@company.com"
                  value={invite.email} onChange={e => setInvite(i => ({ ...i, email: e.target.value }))} />
                {inviteErrors.email && <span className="field-error">{inviteErrors.email}</span>}
              </div>

              <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">Role</label>
                <div className="role-options">
                  {roleNames.filter(r => assignable.length ? assignable.includes(r) : true).map(r => {
                    const style = getRoleStyle(r.toLowerCase());
                    const on = invite.role === r;
                    return (
                      <div key={r} className={`role-option ${on ? 'selected' : ''}`}
                        onClick={() => setInvite(i => ({ ...i, role: r }))}
                        style={on ? { borderColor: style.color, background: style.bg } : {}}>
                        <RiUserStarLine size={16} style={{ color: on ? style.color : 'var(--text-muted)' }} />
                        <span style={{ color: on ? style.color : 'var(--text-primary)' }}>{r}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="role-hint">
                  {rolesInfo?.roles?.find(r => r.name === invite.role)?.description}
                </p>
              </div>

              {teams.length > 0 && (
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label className="form-label">Add to teams <span className="td-muted">(optional)</span></label>
                  <div className="team-pick">
                    {teams.map(t => (
                      <button type="button" key={t.ROWID} className={`team-chip ${invite.team_ids.includes(String(t.ROWID)) ? 'on' : ''}`} onClick={() => toggleTeam(String(t.ROWID))}>
                        <RiTeamLine size={13} /> {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="invite-info">
                <RiMailLine size={14} />
                {invite.first_name.trim() ? `${invite.first_name.trim()} will get` : 'They will get'} an email with a link to set a password and sign in.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowInvite(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleInvite} disabled={inviting}>
                {inviting ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit user</h2>
              <button className="modal-close" onClick={() => setEditUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="user-cell" style={{ marginBottom: 16 }}>
                <div className="user-avatar-sm" style={{ background: getRoleStyle(editUser.role).bg, color: getRoleStyle(editUser.role).color }}>
                  {getInitials(editUser.name, editUser.email)}
                </div>
                <div>
                  <div className="td-bold">{editUser.name || editUser.email}</div>
                  <div className="td-muted" style={{ fontSize: 12 }}>{editUser.email}</div>
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label">First name *</label>
                  <input className={`form-input ${editErrors.first_name ? 'has-error' : ''}`} maxLength={50} disabled={!can('users.edit')}
                    value={edit.first_name} onChange={e => setEdit(v => ({ ...v, first_name: e.target.value }))} />
                  {editErrors.first_name && <span className="field-error">{editErrors.first_name}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Last name</label>
                  <input className={`form-input ${editErrors.last_name ? 'has-error' : ''}`} maxLength={50} disabled={!can('users.edit')}
                    value={edit.last_name} onChange={e => setEdit(v => ({ ...v, last_name: e.target.value }))} />
                  {editErrors.last_name && <span className="field-error">{editErrors.last_name}</span>}
                </div>
              </div>

              {can('users.roles') && (
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label className="form-label">Role</label>
                  <div className="role-options">
                    {roleNames.map(r => {
                      const style = getRoleStyle(r.toLowerCase());
                      const on = edit.role === r;
                      return (
                        <div key={r} className={`role-option ${on ? 'selected' : ''}`} onClick={() => setEdit(v => ({ ...v, role: r }))}
                          style={on ? { borderColor: style.color, background: style.bg } : {}}>
                          <RiUserStarLine size={16} style={{ color: on ? style.color : 'var(--text-muted)' }} />
                          <span style={{ color: on ? style.color : 'var(--text-primary)' }}>{r}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="role-hint">{rolesInfo?.roles?.find(r => r.name === edit.role)?.description}</p>
                </div>
              )}

              {can('users.disable') && (
                <div className="status-row">
                  <div>
                    <b>{String(editUser.status).toUpperCase() === 'ACTIVE' ? 'Account is active' : 'Account is disabled'}</b>
                    <span>{String(editUser.status).toUpperCase() === 'ACTIVE' ? 'Disable to block sign-in without deleting anything.' : 'Re-enable to let them sign in again.'}</span>
                  </div>
                  <button className={`btn ${String(editUser.status).toUpperCase() === 'ACTIVE' ? 'btn-danger' : 'btn-secondary'}`} disabled={statusBusy} onClick={() => toggleStatus(editUser)}>
                    {String(editUser.status).toUpperCase() === 'ACTIVE' ? <><RiUserForbidLine size={15} /> Disable</> : <><RiUserFollowLine size={15} /> Enable</>}
                  </button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── User Analytics Modal (XL) ── */}
      {analyticsUser && (
        <div className="modal-overlay" onClick={() => setAnalyticsUser(null)}>
          <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">
                  <RiBarChartBoxLine size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  User Analytics
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {analyticsUser.name || analyticsUser.email}
                </p>
              </div>
              <button className="modal-close" onClick={() => setAnalyticsUser(null)}>✕</button>
            </div>

            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {analyticsLoading || !analytics ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading analytics…
                </div>
              ) : (
                <>
                  {/* Stat cards */}
                  <div className="users-stats" style={{ marginBottom: 20 }}>
                    <div className="user-stat-card">
                      <div className="user-stat-icon" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                        <RiKeyLine size={20} />
                      </div>
                      <div>
                        <div className="user-stat-value">{analytics.stats.totalPasswords}</div>
                        <div className="user-stat-label">Passwords</div>
                      </div>
                    </div>
                    <div className="user-stat-card">
                      <div className="user-stat-icon" style={{ background: '#f0fdf4', color: '#15803d' }}>
                        <RiFolderLine size={20} />
                      </div>
                      <div>
                        <div className="user-stat-value">{analytics.stats.totalFolders}</div>
                        <div className="user-stat-label">Folders</div>
                      </div>
                    </div>
                    <div className="user-stat-card">
                      <div className="user-stat-icon" style={{ background: '#fefce8', color: '#a16207' }}>
                        <RiTeamLine size={20} />
                      </div>
                      <div>
                        <div className="user-stat-value">{analytics.stats.totalTeams}</div>
                        <div className="user-stat-label">Teams</div>
                      </div>
                    </div>
                    <div className="user-stat-card">
                      <div className="user-stat-icon" style={{ background: '#fdf4ff', color: '#7e22ce' }}>
                        <RiGlobalLine size={20} />
                      </div>
                      <div>
                        <div className="user-stat-value">{analytics.stats.externalUsersManaged}</div>
                        <div className="user-stat-label">External Contacts</div>
                      </div>
                    </div>
                    <div className="user-stat-card">
                      <div className="user-stat-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
                        <RiShareLine size={20} />
                      </div>
                      <div>
                        <div className="user-stat-value">{analytics.stats.sharesGiven}</div>
                        <div className="user-stat-label">Shares Given</div>
                      </div>
                    </div>
                  </div>

                  {/* Password health */}
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                      Password Health
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span className="badge badge-success">{analytics.passwordHealth.strong} Strong</span>
                      <span className="badge badge-warning">{analytics.passwordHealth.moderate} Moderate</span>
                      <span className="badge badge-danger">{analytics.passwordHealth.weak} Weak</span>
                    </div>
                  </div>

                  {/* Two-column: Folders / Teams */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                        <RiFolderLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Folders ({analytics.folders.length})
                      </p>
                      {analytics.folders.length === 0 ? (
                        <p className="td-muted" style={{ fontSize: 12 }}>No folders</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                          {analytics.folders.map(f => (
                            <div key={f.ROWID} style={{ fontSize: 12, padding: '5px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                              {f.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                        <RiTeamLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Teams ({analytics.teams.length})
                      </p>
                      {analytics.teams.length === 0 ? (
                        <p className="td-muted" style={{ fontSize: 12 }}>Not in any team</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                          {analytics.teams.map(t => (
                            <div key={t.ROWID} style={{ fontSize: 12, padding: '5px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                              {t.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Passwords table */}
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                    <RiKeyLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Passwords ({analytics.stats.totalPasswords})
                  </p>
                  {analytics.passwords.length === 0 ? (
                    <p className="td-muted" style={{ fontSize: 12, marginBottom: 20 }}>No passwords</p>
                  ) : (
                    <div className="table-wrap" style={{ marginBottom: 20 }}>
                      <table className="data-table">
                        <thead><tr><th>Name</th><th>Category</th><th>Created</th><th>Expiry</th></tr></thead>
                        <tbody>
                          {analytics.passwords.map(p => (
                            <tr key={p.ROWID}>
                              <td className="td-bold">{p.name}</td>
                              <td><span className="badge badge-info">{p.category || 'General'}</span></td>
                              <td className="td-muted">{p.created_time ? new Date(p.created_time).toLocaleDateString() : '—'}</td>
                              <td className="td-muted">{p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* External users */}
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                    <RiGlobalLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    External Users ({analytics.externalUsers.length})
                  </p>
                  {analytics.externalUsers.length === 0 ? (
                    <p className="td-muted" style={{ fontSize: 12, marginBottom: 20 }}>No external contacts</p>
                  ) : (
                    <div className="table-wrap" style={{ marginBottom: 20 }}>
                      <table className="data-table">
                        <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th></tr></thead>
                        <tbody>
                          {analytics.externalUsers.map(u => (
                            <tr key={u.ROWID}>
                              <td className="td-bold">{u.name || '—'}</td>
                              <td className="td-muted">{u.email}</td>
                              <td className="td-muted">{u.company || '—'}</td>
                              <td>
                                <span className={`badge ${u.status === 'blocked' ? 'badge-danger' : 'badge-success'}`}>
                                  {u.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Expiring passwords */}
                  {analytics.expiringPasswords.length > 0 && (
                    <>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                        <RiTimeLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Expiring Soon
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {analytics.expiringPasswords.map(p => (
                          <div key={p.ROWID} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                            <span>{p.name}</span>
                            <span className={p.diffDays <= 7 ? 'badge badge-danger' : 'badge badge-warning'} style={{ fontSize: 10 }}>
                              {p.diffDays <= 0 ? 'Expired' : `${p.diffDays}d left`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAnalyticsUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete User</h2>
              <button className="modal-close" onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="user-cell" style={{ marginBottom: 16 }}>
                <div className="user-avatar-sm" style={{
                  background: getRoleStyle(deleteTarget.role).bg,
                  color:      getRoleStyle(deleteTarget.role).color,
                }}>
                  {getInitials(deleteTarget.name, deleteTarget.email)}
                </div>
                <div>
                  <div className="td-bold">{deleteTarget.name}</div>
                  <div className="td-muted" style={{ fontSize: 12 }}>{deleteTarget.email}</div>
                </div>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
                Are you sure you want to delete this user? This action cannot be undone.
                All their passwords and shares will remain but they will lose access.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
