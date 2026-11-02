import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import Toast, { useToast } from '../components/Toast';
import {
  RiUserLine, RiAddLine, RiRefreshLine,
  RiSearchLine, RiShieldUserLine, RiMailLine,
  RiUserStarLine, RiDeleteBinLine,
  RiArrowLeftLine, RiArrowRightLine,
  RiKeyLine, RiFolderLine, RiTeamLine, RiGlobalLine,
  RiShareLine, RiTimeLine, RiBarChartBoxLine,
} from 'react-icons/ri';

const API_CORE   = '/server/cred_360_function';
const API_PEOPLE = '/server/cred_360_people_function';
const API_EXTRAS = '/server/cred_360_extras_function';


const ROLES    = ['Admin', 'Team Lead', 'Employee', 'Intern'];
const PER_PAGE = 10;

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
  if (name) return name.charAt(0).toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return 'U';
};

const Users = () => {
  const { user: currentUser } = useAuth();
  const { toasts, removeToast, toast } = useToast();

  const [users, setUsers]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [page, setPage]                   = useState(1);
  const [showInvite, setShowInvite]       = useState(false);
  const [inviteEmail, setInviteEmail]     = useState('');
  const [inviteRole, setInviteRole]       = useState('Employee');
  const [inviting, setInviting]           = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedUser, setSelectedUser]   = useState(null);
  const [newRole, setNewRole]             = useState('');
  const [savingRole, setSavingRole]       = useState(false);
  const [deleteTarget, setDeleteTarget]   = useState(null);
  const [deleting, setDeleting]           = useState(false);
  const [analyticsUser, setAnalyticsUser] = useState(null);
  const [analytics, setAnalytics]         = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const isAdmin = ['admin', 'app administrator'].includes(
    (currentUser?.role_details?.role_name || '').toLowerCase()
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_PEOPLE}/api/users`);
      if (res.data.success) setUsers(res.data.data || []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

// lock body scroll when any modal open
  useEffect(() => {
    const open = showInvite || showRoleModal || !!deleteTarget || !!analyticsUser;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showInvite, showRoleModal, deleteTarget, analyticsUser]);

  // reset page on search
  useEffect(() => { setPage(1); }, [search]);

  const filtered = users.filter(u =>
    (u.name  || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.role  || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function getPageNums() {
    const nums = [];
    let start = Math.max(1, page - 2);
    let end   = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }

  const handleInvite = async () => {
    if (!inviteEmail) return toast.error('Please enter an email address.');
    setInviting(true);
    try {
      await axios.post(`${API_PEOPLE}/api/users/invite`, { email: inviteEmail, role: inviteRole });
      setShowInvite(false);
      setInviteEmail('');
      toast.success('Invitation sent successfully!');
      fetchUsers();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Invite failed. Try again.');
    } finally {
      setInviting(false);
    }
  };

  const openRoleChange = (u) => {
    setSelectedUser(u);
    setNewRole(u.role || 'Employee');
    setShowRoleModal(true);
  };

  const handleRoleChange = async () => {
    setSavingRole(true);
    try {
      await axios.put(`${API_PEOPLE}/api/users/${selectedUser.ROWID}/role`, { role: newRole });
      setShowRoleModal(false);
      toast.success('Role updated successfully!');
      fetchUsers();
    } catch {
      toast.error('Role update failed. Try again.');
    } finally {
      setSavingRole(false);
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
      fetchUsers();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

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
          <button className="btn btn-secondary" onClick={fetchUsers}>
            <RiRefreshLine size={16} />
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
              <RiAddLine size={16} /> Invite User
            </button>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="users-stats">
        {ROLES.map(role => {
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

      {/* ── Table card ── */}
      <div className="card">
        <div className="table-toolbar">
          <div className="search-box">
            <RiSearchLine size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="search-input"
            />
          </div>
          <span className="result-count">{filtered.length} users</span>
        </div>

        {loading ? (
          <div className="table-loading">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton-row" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <RiUserLine size={40} />
            <p>{search ? 'No users match your search' : 'No users found'}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((u, i) => {
                    const style = getRoleStyle(u.role);
                    const isSelf = u.email === currentUser?.email_id;
                    return (
                      <tr key={u.ROWID || i}
                        className={isAdmin ? 'user-row-clickable' : ''}
                        onClick={() => isAdmin && openAnalytics(u)}
                        style={isAdmin ? { cursor: 'pointer' } : {}}>
                        <td>
                          <div className="user-cell">
                            {/* Profile image or initials avatar */}
                            {u.profile_image ? (
                              <img
                                src={`${API_CORE}/api/profile/image/${u.profile_image}`}
                                alt={u.name}
                                style={{
                                  width: 34, height: 34, borderRadius: '50%',
                                  objectFit: 'cover', flexShrink: 0,
                                  border: '2px solid var(--border-color)',
                                }}
                                onError={e => { e.target.style.display = 'none'; }}
                              />
                            ) : (
                              <div className="user-avatar-sm"
                                style={{ background: style.bg, color: style.color }}>
                                {getInitials(u.name, u.email)}
                              </div>
                            )}
                            <div>
                              <div className="td-bold">
                                {u.name || 'Unknown'}
                                {isSelf && <span className="self-badge">You</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex gap-8" style={{ alignItems: 'center' }}>
                            <RiMailLine size={14} style={{ color: 'var(--text-muted)' }} />
                            <span className="td-muted">{u.email}</span>
                          </div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: style.bg, color: style.color }}>
                            {u.role || 'User'}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-success">Active</span>
                        </td>
                        {isAdmin && (
                          <td onClick={e => e.stopPropagation()}>
                            <div className="flex gap-8">
                              <button className="icon-btn" onClick={() => openAnalytics(u)} title="View analytics">
                                <RiBarChartBoxLine size={15} />
                              </button>
                              {!isSelf && (
                                <>
                                  <button className="icon-btn" onClick={() => openRoleChange(u)} title="Change role">
                                    <RiShieldUserLine size={15} />
                                  </button>
                                  <button className="icon-btn danger" onClick={() => setDeleteTarget(u)} title="Delete user">
                                    <RiDeleteBinLine size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="pagination">
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <RiArrowLeftLine size={14} />
                  </button>
                  {getPageNums().map(n => (
                    <button key={n} className={`page-btn ${page === n ? 'active' : ''}`} onClick={() => setPage(n)}>
                      {n}
                    </button>
                  ))}
                  <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <RiArrowRightLine size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Invite Modal ── */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Invite User</h2>
              <button className="modal-close" onClick={() => setShowInvite(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Email Address *</label>
                <input
                  className="form-input" type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Assign Role</label>
                <select className="form-input" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="invite-info">
                <RiMailLine size={14} />
                An invitation email will be sent to this address.
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

      {/* ── Role Modal ── */}
      {showRoleModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowRoleModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Change Role</h2>
              <button className="modal-close" onClick={() => setShowRoleModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="user-cell" style={{ marginBottom: 16 }}>
                <div className="user-avatar-sm" style={{
                  background: getRoleStyle(selectedUser.role).bg,
                  color:      getRoleStyle(selectedUser.role).color,
                }}>
                  {getInitials(selectedUser.name, selectedUser.email)}
                </div>
                <div>
                  <div className="td-bold">{selectedUser.name}</div>
                  <div className="td-muted" style={{ fontSize: 12 }}>{selectedUser.email}</div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Select New Role</label>
                <div className="role-options">
                  {ROLES.map(r => {
                    const style = getRoleStyle(r.toLowerCase());
                    return (
                      <div
                        key={r}
                        className={`role-option ${newRole === r ? 'selected' : ''}`}
                        onClick={() => setNewRole(r)}
                        style={newRole === r ? { borderColor: style.color, background: style.bg } : {}}
                      >
                        <RiUserStarLine size={16}
                          style={{ color: newRole === r ? style.color : 'var(--text-muted)' }} />
                        <span style={{ color: newRole === r ? style.color : 'var(--text-primary)' }}>{r}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRoleModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRoleChange} disabled={savingRole}>
                {savingRole ? 'Saving...' : 'Update Role'}
              </button>
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