import React, { useState, useEffect, useCallback } from 'react';
import { RiGlobalLine, RiEditLine, RiDeleteBinLine, RiShieldLine,
         RiCheckLine, RiSearchLine, RiRefreshLine, RiMailLine,
         RiBuilding2Line, RiTimeLine, RiShareLine,
         RiArrowLeftLine, RiArrowRightLine,
         RiStarFill, RiStarLine } from 'react-icons/ri';
import { useNavbar } from '../context/NavbarContext';
import '../styles/external-users.css';

const API = '/server/cred_360_extras_function/api';
const PAGE_SIZE = 10;
const STATUS_LABELS = { active: 'Active', blocked: 'Blocked' };

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr.replace(' ', 'T') + 'Z').toLocaleDateString();
}

export default function ExternalUsers() {
  const { setRecordCount, setFilterCount } = useNavbar();

  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filterStatus, setFilter] = useState('all');
  const [page, setPage]           = useState(1);
  const [editTarget, setEdit]     = useState(null);
  const [deleteTarget, setDelete] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);
  const [addOpen, setAddOpen]     = useState(false);
  const [addForm, setAddForm]     = useState({ name: '', email: '', company: '', notes: '' });
  const [isAdmin, setIsAdmin]           = useState(false);
  const [detailUser, setDetailUser]     = useState(null);
  const [analytics, setAnalytics]       = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [orgView, setOrgView] = useState(false); // false = my users, true = org view

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

const fetchUsers = useCallback(async () => {
  setLoading(true);
  try {
    const url  = isAdmin && orgView
      ? `${API}/external-users?view=org`
      : `${API}/external-users`;
    const res  = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const data = await res.json();
    if (data.success) {
      setUsers(data.data || []);
      setIsAdmin(!!data.is_admin);
    }
  } catch { showToast('Failed to load external users', 'error'); }
  finally  { setLoading(false); }
}, [isAdmin, orgView]);


async function openDetail(u) {
  setDetailUser(u);
  setAnalytics(null);
  setAnalyticsLoading(true);
  try {
    const res  = await fetch(`${API}/external-users/${u.ROWID}/analytics`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const data = await res.json();
    if (data.success) setAnalytics(data.analytics);
  } catch { showToast('Failed to load analytics', 'error'); }
  finally { setAnalyticsLoading(false); }
}

  async function toggleFavorite(u, e) {
    e?.stopPropagation();
    const next = !u.is_favorite;
    try {
      const res  = await fetch(`${API}/external-users/${u.ROWID}/favorite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: next }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setUsers(prev => prev.map(x => x.ROWID === u.ROWID ? { ...x, is_favorite: next } : x));
      if (detailUser?.ROWID === u.ROWID) setDetailUser(prev => ({ ...prev, is_favorite: next }));
    } catch (e) { showToast(e.message || 'Favorite update failed', 'error'); }
  }

  useEffect(() => { fetchUsers(); }, [fetchUsers , orgView]);

  useEffect(() => {
  if (!isAdmin) setOrgView(false);
}, [isAdmin]);
 
   useEffect(() => {
  const open = !!(editTarget || deleteTarget || addOpen);

  document.documentElement.style.overflow = open ? 'hidden' : '';

  return () => {
    document.documentElement.style.overflow = '';
  };
  }, [editTarget, deleteTarget, addOpen]);

  useEffect(() => {
    const filtered = users.filter(u => matchesSearch(u) && matchesFilter(u));
    setRecordCount(filtered.length);
    setFilterCount(filterStatus !== 'all' || search ? 1 : 0);
    setPage(1); // reset to first page on filter/search change
  }, [users, search, filterStatus]);

  function matchesSearch(u) {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.email   || '').toLowerCase().includes(q)
        || (u.name    || '').toLowerCase().includes(q)
        || (u.domain  || '').toLowerCase().includes(q)
        || (u.company || '').toLowerCase().includes(q);
  }

  function matchesFilter(u) {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'favorites') return !!u.is_favorite;
    return u.status === filterStatus;
  }

  const visible = users.filter(u => {
  if (isAdmin && !orgView) {
    // admin "Mine" view — only their own shared/manual
    const emailKey = (u.email || '').toLowerCase();
    const myEmails = new Set(
      users
        .filter(x => x.can_edit && !x.shared_by?.length)
        .map(x => (x.email || '').toLowerCase())
    );
    // simpler: just check can_edit and share_count contributed by them
    // Actually use shared_by to filter
  }
  return matchesSearch(u) && matchesFilter(u);
});

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paginated  = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // clamp page if filter shrinks results
  const safePage = Math.min(page, totalPages);
  const currentPage = safePage;

  async function handleSave() {
    if (!editTarget) return;
    setSaving(true);
    try {
      const res  = await fetch(`${API}/external-users/${editTarget.ROWID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:    editTarget.name    || '',
          company: editTarget.company || '',
          status:  editTarget.status  || 'active',
          notes:   editTarget.notes   || '',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setUsers(prev => prev.map(u => u.ROWID === editTarget.ROWID ? { ...u, ...editTarget } : u));
      setEdit(null);
      showToast('External user updated');
    } catch (e) { showToast(e.message || 'Update failed', 'error'); }
    finally     { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res  = await fetch(`${API}/external-users/${deleteTarget.ROWID}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setUsers(prev => prev.filter(u => u.ROWID !== deleteTarget.ROWID));
      setDelete(null);
      showToast('External user removed');
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
    finally     { setSaving(false); }
  }

  async function handleAdd() {
    if (!addForm.email?.trim()) return showToast('Email is required', 'error');
    setSaving(true);
    try {
      const res  = await fetch(`${API}/external-users/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, status: 'active' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAddOpen(false);
      setAddForm({ name: '', email: '', company: '', notes: '' });
      showToast('External user added');
      fetchUsers();
    } catch (e) { showToast(e.message || 'Add failed', 'error'); }
    finally     { setSaving(false); }
  }

  async function quickToggleStatus(u) {
    const next = u.status === 'blocked' ? 'active' : 'blocked';
    try {
      const res  = await fetch(`${API}/external-users/${u.ROWID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: u.name || '', company: u.company || '', status: next, notes: u.notes || '' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setUsers(prev => prev.map(x => x.ROWID === u.ROWID ? { ...x, status: next } : x));
      showToast(`User ${next === 'blocked' ? 'blocked' : 'unblocked'}`);
    } catch (e) { showToast(e.message || 'Status update failed', 'error'); }
  }

  const stats = {
    total:   users.length,
    active:  users.filter(u => u.status === 'active').length,
    blocked: users.filter(u => u.status === 'blocked').length,
    domains: new Set(users.map(u => u.domain).filter(Boolean)).size,
  };

  // Generate page numbers to show (max 5 visible)
  function getPageNums() {
    const nums = [];
    let start = Math.max(1, currentPage - 2);
    let end   = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }

  return (
    <div className="eu-page">

      {/* ── Stats ── */}
      <div className="eu-stats">
        <div className="eu-stat-card">
          <RiGlobalLine size={20} className="eu-stat-icon eu-icon-blue" />
          <div>
            <div className="eu-stat-value">{stats.total}</div>
            <div className="eu-stat-label">Total External Users</div>
          </div>
        </div>
        <div className="eu-stat-card">
          <RiCheckLine size={20} className="eu-stat-icon eu-icon-green" />
          <div>
            <div className="eu-stat-value">{stats.active}</div>
            <div className="eu-stat-label">Active</div>
          </div>
        </div>
        <div className="eu-stat-card">
          <RiShieldLine size={20} className="eu-stat-icon eu-icon-red" />
          <div>
            <div className="eu-stat-value">{stats.blocked}</div>
            <div className="eu-stat-label">Blocked</div>
          </div>
        </div>
        <div className="eu-stat-card">
          <RiBuilding2Line size={20} className="eu-stat-icon eu-icon-purple" />
          <div>
            <div className="eu-stat-value">{stats.domains}</div>
            <div className="eu-stat-label">Unique Domains</div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="eu-toolbar">
        <div className="eu-search-wrap">
          <RiSearchLine className="eu-search-icon" size={15} />
          <input
            className="eu-search"
            placeholder="Search by email, name, domain, company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="eu-filter-tabs">
          {['all', 'active', 'blocked', 'favorites'].map(s => (
            <button
              key={s}
              className={`eu-filter-tab ${filterStatus === s ? 'active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s === 'favorites' && <RiStarFill size={12} style={{ marginRight: 3 }} />}
              {s === 'all' ? 'All' : s === 'favorites' ? 'Favorites' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button className="eu-refresh-btn" onClick={fetchUsers} title="Refresh">
          <RiRefreshLine size={16} />
        </button>
        {isAdmin && (
            <div className="eu-org-toggle" title={orgView ? 'Showing all organisation users' : 'Showing only your users'}>
              <span className={`eu-org-label ${!orgView ? 'active' : ''}`}>Mine</span>
              <button
                className={`eu-toggle-switch ${orgView ? 'on' : ''}`}
                onClick={() => setOrgView(v => !v)}
              />
              <span className={`eu-org-label ${orgView ? 'active' : ''}`}>Organisation</span>
            </div>
          )}
        <button className="eu-btn eu-btn-primary" onClick={() => setAddOpen(true)}>
          + Add User
        </button>
      </div>

      {/* ── Table ── */}
      <div className="eu-table-wrap">
        {loading ? (
          <div className="eu-empty">
            <div className="eu-spinner" />
            <p>Loading external users…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="eu-empty">
            <RiGlobalLine size={40} className="eu-empty-icon" />
            <p>{search || filterStatus !== 'all'
              ? 'No users match your filter.'
              : 'No external users yet. External shares will appear here automatically.'}</p>
          </div>
        ) : (
          <>
            <table className="eu-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Domain</th>
                  <th>Company</th>
                  {isAdmin && <th>Shared By</th>}
                  <th><RiShareLine size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Shares</th>
                  <th>Last Shared</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(u => (
                  <tr key={u.ROWID} className="eu-row-clickable" onClick={() => openDetail(u)}>
                    <td>
                      <div className="eu-user-cell">
                        <div className="eu-avatar">
                          {(u.name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="eu-user-name">
                            {u.name || <span className="eu-unnamed">—</span>}
                            {u.is_favorite && <RiStarFill size={12} className="eu-icon-gold" style={{ marginLeft: 5, verticalAlign: 'middle' }} />}
                          </div>
                          <div className="eu-user-email">
                            <RiMailLine size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><span className="eu-domain-pill">{u.domain || '—'}</span></td>
                    <td className="eu-muted">{u.company || '—'}</td>
                    {isAdmin && (
                      <td className="eu-muted" style={{ fontSize: 12 }}>
                        {(u.shared_by || []).map(s => s.name).join(', ') || '—'}
                      </td>
                    )}
                    <td><span className="eu-share-count">{u.share_count || 0}</span></td>
                    <td className="eu-muted">
                      <RiTimeLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      {timeAgo(u.last_shared_time)}
                    </td>
                    <td>
                      {u.can_edit ? (
                        <button
                          className={`eu-status-badge eu-status-${u.status}`}
                          onClick={e => { e.stopPropagation(); quickToggleStatus(u); }}
                          title={u.status === 'active' ? 'Click to block' : 'Click to unblock'}
                        >
                          {u.status === 'blocked' ? <RiShieldLine size={11} /> : <RiCheckLine size={11} />}
                          {STATUS_LABELS[u.status] || u.status}
                        </button>
                      ) : (
                        <span className={`eu-status-badge eu-status-${u.status}`}>
                          {u.status === 'blocked' ? <RiShieldLine size={11} /> : <RiCheckLine size={11} />}
                          {STATUS_LABELS[u.status] || u.status}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="eu-actions">
                        <button className="eu-action-btn" onClick={e => toggleFavorite(u, e)}
                          title={u.is_favorite ? 'Unfavorite' : 'Favorite'}>
                          {u.is_favorite ? <RiStarFill size={15} className="eu-icon-gold" /> : <RiStarLine size={15} />}
                        </button>
                        {u.can_edit && (
                          <>
                            <button className="eu-action-btn" onClick={e => { e.stopPropagation(); setEdit({ ...u }); }} title="Edit">
                              <RiEditLine size={15} />
                            </button>
                            <button className="eu-action-btn eu-action-danger" onClick={e => { e.stopPropagation(); setDelete(u); }} title="Delete">
                              <RiDeleteBinLine size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="eu-pagination">
                <span className="eu-page-info">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length}
                </span>
                <div className="eu-page-controls">
                  <button
                    className="eu-page-btn"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <RiArrowLeftLine size={14} />
                  </button>
                  {getPageNums().map(n => (
                    <button
                      key={n}
                      className={`eu-page-btn ${currentPage === n ? 'active' : ''}`}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    className="eu-page-btn"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <RiArrowRightLine size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Edit Modal ── */}
      {editTarget && (
        <div className="eu-modal-backdrop" onClick={() => setEdit(null)}>
          <div className="eu-modal" onClick={e => e.stopPropagation()}>
            <div className="eu-modal-header">
              <h3 className="eu-modal-title">Edit External User</h3>
              <button className="eu-modal-close" onClick={() => setEdit(null)}>×</button>
            </div>
            <div className="eu-modal-body">
              <div className="eu-field">
                <label>Email</label>
                <input value={editTarget.email} disabled className="eu-input eu-input-disabled" />
              </div>
              <div className="eu-field">
                <label>Name</label>
                <input className="eu-input" placeholder="Full name" value={editTarget.name || ''}
                  onChange={e => setEdit(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="eu-field">
                <label>Company</label>
                <input className="eu-input" placeholder="Company name" value={editTarget.company || ''}
                  onChange={e => setEdit(prev => ({ ...prev, company: e.target.value }))} />
              </div>
              <div className="eu-field">
                <label>Status</label>
                <select className="eu-input" value={editTarget.status || 'active'}
                  onChange={e => setEdit(prev => ({ ...prev, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <div className="eu-field">
                <label>Notes</label>
                <textarea className="eu-input eu-textarea" placeholder="Internal notes about this user…"
                  value={editTarget.notes || ''} rows={3}
                  onChange={e => setEdit(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>
            <div className="eu-modal-footer">
              <button className="eu-btn eu-btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="eu-btn eu-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteTarget && (
        <div className="eu-modal-backdrop" onClick={() => setDelete(null)}>
          <div className="eu-modal eu-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="eu-modal-header">
              <h3 className="eu-modal-title">Remove External User</h3>
              <button className="eu-modal-close" onClick={() => setDelete(null)}>×</button>
            </div>
            <div className="eu-modal-body">
              <p className="eu-confirm-text">
                Remove <strong>{deleteTarget.email}</strong> from the external users list?
                This does not revoke any active shares.
              </p>
            </div>
            <div className="eu-modal-footer">
              <button className="eu-btn eu-btn-ghost" onClick={() => setDelete(null)}>Cancel</button>
              <button className="eu-btn eu-btn-danger" onClick={handleDelete} disabled={saving}>
                {saving ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Modal ── */}
      {addOpen && (
        <div className="eu-modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="eu-modal" onClick={e => e.stopPropagation()}>
            <div className="eu-modal-header">
              <h3 className="eu-modal-title">Add External User</h3>
              <button className="eu-modal-close" onClick={() => setAddOpen(false)}>×</button>
            </div>
            <div className="eu-modal-body">
              <div className="eu-field">
                <label>Email *</label>
                <input className="eu-input" placeholder="user@example.com" value={addForm.email}
                  onChange={e => setAddForm(prev => ({ ...prev, email: e.target.value }))} />
              </div>
              <div className="eu-field">
                <label>Name</label>
                <input className="eu-input" placeholder="Full name" value={addForm.name}
                  onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="eu-field">
                <label>Company</label>
                <input className="eu-input" placeholder="Company name" value={addForm.company}
                  onChange={e => setAddForm(prev => ({ ...prev, company: e.target.value }))} />
              </div>
              <div className="eu-field">
                <label>Notes</label>
                <textarea className="eu-input eu-textarea" placeholder="Internal notes…"
                  value={addForm.notes} rows={3}
                  onChange={e => setAddForm(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>
            <div className="eu-modal-footer">
              <button className="eu-btn eu-btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="eu-btn eu-btn-primary" onClick={handleAdd} disabled={saving}>
                {saving ? 'Adding…' : 'Add User'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Toast ── */}
      {toast && (
        <div className={`eu-toast eu-toast-${toast.type}`}>
          {toast.type === 'success' ? <RiCheckLine size={15} /> : <RiShieldLine size={15} />}
          {toast.msg}
        </div>
      )}

      {/* ── Detail Offcanvas ── */}
      {detailUser && (
        <div className="eu-offcanvas-backdrop" onClick={() => setDetailUser(null)}>
          <div className="eu-offcanvas" onClick={e => e.stopPropagation()}>
            <div className="eu-offcanvas-header">
              <div className="eu-user-cell">
                <div className="eu-avatar eu-avatar-lg">{(detailUser.name || detailUser.email || '?')[0].toUpperCase()}</div>
                <div>
                  <div className="eu-user-name">{detailUser.name || detailUser.email}</div>
                  <div className="eu-user-email">
                    <RiMailLine size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {detailUser.email}
                  </div>
                </div>
              </div>
              <div className="flex gap-8" style={{ alignItems: 'center' }}>
                <button className="eu-action-btn" onClick={e => toggleFavorite(detailUser, e)}
                  title={detailUser.is_favorite ? 'Unfavorite' : 'Favorite'}>
                  {detailUser.is_favorite ? <RiStarFill size={18} className="eu-icon-gold" /> : <RiStarLine size={18} />}
                </button>
                <button className="eu-modal-close" onClick={() => setDetailUser(null)}>×</button>
              </div>
            </div>

            <div className="eu-offcanvas-body">
              {analyticsLoading ? (
                <div className="eu-empty"><div className="eu-spinner" /><p>Loading analytics…</p></div>
              ) : !analytics ? (
                <p className="eu-muted">No analytics available.</p>
              ) : (
                <>
                  <div className="eu-analytics-stats">
                    <div className="eu-analytics-stat"><div className="eu-stat-value">{analytics.total}</div><div className="eu-stat-label">Total Shares</div></div>
                    <div className="eu-analytics-stat"><div className="eu-stat-value">{analytics.active}</div><div className="eu-stat-label">Active</div></div>
                    <div className="eu-analytics-stat"><div className="eu-stat-value">{analytics.expired}</div><div className="eu-stat-label">Expired</div></div>
                    <div className="eu-analytics-stat"><div className="eu-stat-value">{analytics.passwordShares}</div><div className="eu-stat-label">Passwords</div></div>
                    <div className="eu-analytics-stat"><div className="eu-stat-value">{analytics.folderShares}</div><div className="eu-stat-label">Folders</div></div>
                  </div>

                  <p className="eu-section-label">Share Timeline</p>
                  {analytics.timeline.length === 0 ? (
                    <p className="eu-muted">No shares yet.</p>
                  ) : (
                    <div className="eu-timeline">
                      {analytics.timeline.map(t => (
                        <div key={t.ROWID} className="eu-timeline-item">
                          <div className={`eu-timeline-icon ${t.type === 'folder' ? 'eu-icon-purple' : 'eu-icon-blue'}`}>
                            {t.type === 'folder' ? <RiGlobalLine size={14} /> : <RiMailLine size={14} />}
                          </div>
                          <div className="eu-timeline-content">
                            <div className="eu-timeline-title">{t.item_name}</div>
                            <div className="eu-timeline-meta">
                              {t.permissions?.includes('edit') && <span className="badge eu-perm-badge">Edit</span>}
                              {t.permissions?.includes('delete') && <span className="badge eu-perm-badge eu-perm-danger">Delete</span>}
                              <span className={t.is_expired ? 'eu-muted' : 'eu-icon-green'}>
                                {t.is_expired ? 'Expired' : (t.expiry ? 'Active' : 'Never expires')}
                              </span>
                              {t.shared_by && <span className="eu-muted"> · Shared by {t.shared_by}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}