import React, { useEffect, useState, useCallback } from 'react';
import axios from '../services/api';
import {
  RiKeyLine, RiAddLine, RiEditLine, RiDeleteBinLine,
  RiEyeLine, RiEyeOffLine, RiSearchLine, RiShareLine,
  RiRefreshLine, RiLockLine, RiFileCopyLine, RiDownloadLine,
  RiTimeLine, RiPauseCircleLine,
} from 'react-icons/ri';
import ShareModal from '../components/ShareModal';
import PasswordStrength from '../components/PasswordStrength';
import Toast, { useToast } from '../components/Toast';
import { useShareNotif } from '../context/ShareNotifContext';

const API = '/server/cred_360_function';

const FALLBACK_CATEGORIES = [
  { ROWID: 'General',      name: 'General',      color: '#7c3aed' },
  { ROWID: 'Social Media', name: 'Social Media', color: '#2563eb' },
  { ROWID: 'Banking',      name: 'Banking',      color: '#059669' },
  { ROWID: 'Email',        name: 'Email',        color: '#d97706' },
  { ROWID: 'Work',         name: 'Work',         color: '#dc2626' },
  { ROWID: 'Shopping',     name: 'Shopping',     color: '#db2777' },
  { ROWID: 'Other',        name: 'Other',        color: '#65a30d' },
];

const emptyForm = {
  name: '', category: 'General', web_account: '',
  username: '', password: '', url: '', notes: '', folder_id: '',
  expiry_date: '',
};

const PER_PAGE = 8;

const Passwords = () => {
  const { refresh } = useShareNotif();
  const { toasts, removeToast, toast } = useToast();

  // ── Core data ──
  const [passwords, setPasswords]     = useState([]);
  const [folders, setFolders]         = useState([]);
  const [categories, setCategories]   = useState(FALLBACK_CATEGORIES);
  const [loading, setLoading]         = useState(true);

  // ── Table controls ──
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('newest');
  const [page, setPage]       = useState(1);

  // ── Modals ──
  const [showModal, setShowModal]         = useState(false);
  const [editItem, setEditItem]           = useState(null);
  const [form, setForm]                   = useState(emptyForm);
  const [saving, setSaving]               = useState(false);
  const [deleteId, setDeleteId]           = useState(null);
  const [sharePassword, setSharePassword] = useState(null);

  // ── Password visibility / copy ──
  const [visibleIds, setVisibleIds] = useState({});
  const [copied, setCopied]         = useState('');

  // ── Shared tab ──
  const [activeTab, setActiveTab]             = useState('my');
  const [sharedPasswords, setSharedPasswords] = useState([]);
  const [sharedLoading, setSharedLoading]     = useState(false);
  const [sharedVisible, setSharedVisible]     = useState({});
  const [sharedCopied, setSharedCopied]       = useState('');
  const [deleteSharedItem, setDeleteSharedItem] = useState(null);

  // ── Category helpers ──
  const findCategory = (name) =>
    categories.find(c => c.name === name) || FALLBACK_CATEGORIES[0];

  const CategoryBadge = ({ name }) => {
    const cat   = findCategory(name);
    const color = cat?.color || '#7c3aed';
    return (
      <span className="badge" style={{
        background: color + '22', color,
        border: `1px solid ${color}44`, fontSize: 12,
      }}>
        {name || 'General'}
      </span>
    );
  };

  // ── Fetch categories (separate, lightweight) ──
  const fetchCategories = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/categories`);
      if (res.data.success && res.data.data?.length > 0) {
        setCategories(res.data.data);
      }
    } catch {
      // keep FALLBACK_CATEGORIES
    }
  }, []);

  // ── ONE combined fetch for passwords + folders ──
  const fetchData = useCallback(async (fresh) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/folders-with-passwords`, { fresh: fresh === true });
      if (res.data.success) {
        setPasswords(res.data.passwords || []);
        setFolders(res.data.folders    || []);
      }
    } catch (e) {
      console.log('Fetch error:', e.message);
      toast.error('Failed to load passwords');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── On mount: both fetches fire in parallel ──
  useEffect(() => {
    Promise.all([fetchData(), fetchCategories()]);
  }, [fetchData, fetchCategories]);

  // ── Tab switch ──
  const handleTabChange = async (tab) => {
    setActiveTab(tab);
    if (tab === 'shared') {
      await axios.post(`${API}/api/shares/mark-viewed`, { type: 'passwords' });
      refresh();
    }
  };

  // ── Export CSV ──
  const exportCSV = () => {
    const headers = ['Name', 'Category', 'Username', 'Password', 'URL', 'Notes', 'Folder', 'Expiry Date'];
    const rows = passwords.map(p => [
      p.name        || '',
      p.category    || '',
      p.username    || '',
      p.password    || '',
      p.url         || '',
      p.notes       || '',
      getFolderName(p.folder_id) || '',
      p.expiry_date || '',
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `keyshare-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Passwords exported successfully!');
  };

  // ── Derived: only root-level passwords (no folder) for My Passwords tab ──
  const myPasswords = passwords.filter(p => !p.folder_id || p.folder_id === '');

  const filtered = myPasswords
    .filter(p =>
      p.name?.toLowerCase().includes(search.toLowerCase())     ||
      p.username?.toLowerCase().includes(search.toLowerCase()) ||
      p.category?.toLowerCase().includes(search.toLowerCase()) ||
      p.url?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name')   return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'newest') return new Date(b.created_time) - new Date(a.created_time);
      if (sortBy === 'oldest') return new Date(a.created_time) - new Date(b.created_time);
      return 0;
    });

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Modal helpers ──
  const openAdd = () => {
    setEditItem(null);
    setForm({ ...emptyForm, category: categories[0]?.name || 'General' });
    setShowModal(true);
  };

  const openEditShared = (item) => {
    setEditItem({ ROWID: item.password_id, isShared: true, folder_id: item.folder_id || '' });
    setForm({
      name: item.name || '', category: item.category || categories[0]?.name || 'General',
      web_account: '', username: item.username || '', password: item.password || '',
      url: item.url || '', notes: item.notes || '', folder_id: item.folder_id || '', expiry_date: '',
    });
    setShowModal(true);
  };

  const handleDeleteShared = async (item) => {
    try {
      await axios.delete(`${API}/api/passwords/${item.password_id}`);
      setSharedPasswords(prev => prev.filter(p => p.share_id !== item.share_id));
      setDeleteSharedItem(null);
      toast.success('Password deleted');
    } catch (e) {
      toast.error('Delete failed: ' + (e.response?.data?.error || e.message));
    }
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      name:        item.name        || '',
      category:    item.category    || categories[0]?.name || 'General',
      web_account: item.web_account || '',
      username:    item.username    || '',
      password:    item.password    || '',
      url:         item.url         || '',
      notes:       item.notes       || '',
      folder_id:   item.folder_id   || '',
      expiry_date: item.expiry_date ? item.expiry_date.split(' ')[0] : '',
    });
    setShowModal(true);
  };

  // ── Save ──
const handleSave = async () => {
    if (!form.name || !form.password) return toast.error('Name and password are required.');
    setSaving(true);
    const payload = {
      ...form,
      folder_id: editItem?.isShared ? (editItem.folder_id || '') : form.folder_id,
      expiry_date: form.expiry_date
        ? new Date(form.expiry_date).toISOString().slice(0, 19).replace('T', ' ')
        : '',
    };
    try {
      if (editItem) {
        await axios.put(`${API}/api/passwords/${editItem.ROWID}`, payload);
        toast.success('Password updated!');
      } else {
        await axios.post(`${API}/api/passwords`, payload);
        toast.success('Password saved!');
      }
      setShowModal(false);
      if (editItem?.isShared) fetchSharedPasswords(); else fetchData();
    } catch (e) {
      toast.error('Save failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle active/inactive ──
  const handleToggleActive = async (item) => {
    try {
      const res = await axios.put(`${API}/api/passwords/${item.ROWID}/toggle-active`);
      const nextActive = res.data?.data?.is_active;
      setPasswords(prev => prev.map(p =>
        String(p.ROWID) === String(item.ROWID) ? { ...p, is_active: nextActive } : p
      ));
      toast.success(nextActive ? 'Password activated' : 'Password deactivated — existing shares are now blocked');
    } catch (e) {
      toast.error('Failed to toggle status: ' + (e.response?.data?.error || e.message));
    }
  };

  // ── Delete ──
  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/api/passwords/${id}`);
      setDeleteId(null);
      // optimistic: remove from state instantly, no refetch needed
      setPasswords(prev => prev.filter(p => String(p.ROWID) !== String(id)));
      toast.success('Password deleted');
    } catch (e) {
      toast.error('Delete failed: ' + e.message);
    }
  };

  // ── Misc helpers ──
  const toggleVisible = (id) =>
    setVisibleIds(prev => ({ ...prev, [id]: !prev[id] }));

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };

  const getFolderName = (id) => {
    if (!id || id === '') return '—';
    const f = folders.find(f => String(f.ROWID) === String(id));
    return f ? f.name : '—';
  };

  const SharedByCell = ({ name, image }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    {image ? (
      <img
        src={`${API}/api/profile/image/${image}`}
        alt={name}
        style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={e => { e.target.style.display = 'none'; }}
      />
    ) : (
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: 'var(--primary-light)', color: 'var(--primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700,
      }}>
        {(name || '?').charAt(0).toUpperCase()}
      </div>
    )}
    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{name || 'Unknown'}</span>
  </div>
);

  const renderExpiryBadge = (expiry_date) => {
    if (!expiry_date) return <span className="td-muted">—</span>;
    const diff = Math.ceil(
      (new Date(expiry_date.replace(' ', 'T') + 'Z') - new Date()) / 86_400_000
    );
    if (diff <= 0)  return <span className="badge badge-danger">Expired</span>;
    if (diff <= 7)  return <span className="badge badge-warning">{diff}d left</span>;
    if (diff <= 30) return <span className="badge badge-info">{diff}d left</span>;
    return (
      <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
        {new Date(expiry_date).toLocaleDateString()}
      </span>
    );
  };

  // ── Shared passwords ──
  const fetchSharedPasswords = useCallback(async () => {
    setSharedLoading(true);
    try {
      const res = await axios.get(`${API}/api/shares/received`);
      if (res.data.success) setSharedPasswords(res.data.data || []);
    } catch (e) {
      console.log('Shared fetch error:', e.message);
    } finally {
      setSharedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'shared') fetchSharedPasswords();
  }, [activeTab, fetchSharedPasswords]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      {/* ── Header ── */}
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Passwords</h1>
          <p className="page-subtitle">{myPasswords.length} passwords stored securely</p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-secondary" onClick={() => fetchData(true)} title="Refresh">
            <RiRefreshLine size={16} />
          </button>
          <button className="btn btn-secondary" onClick={exportCSV}>
            <RiDownloadLine size={16} /> Export CSV
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <RiAddLine size={16} /> Add Password
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="pw-tabs">
        <button
          className={`pw-tab ${activeTab === 'my' ? 'active' : ''}`}
          onClick={() => setActiveTab('my')}
        >
          <RiKeyLine size={15} /> My Passwords
          <span className="pw-tab-count">{myPasswords.length}</span>
        </button>
        <button
          className={`pw-tab ${activeTab === 'shared' ? 'active' : ''}`}
          onClick={() => handleTabChange('shared')}
        >
          <RiShareLine size={15} /> Shared With Me
          <span className="pw-tab-count">{sharedPasswords.length}</span>
        </button>
      </div>

      {/* ── My Passwords Tab ── */}
      {activeTab === 'my' && (
        <div className="card">
          <div className="table-toolbar">
            <div className="search-box">
              <RiSearchLine size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search passwords..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="search-input"
              />
            </div>
            <div className="flex gap-8">
              <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">A - Z</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="table-loading">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton-row" />)}
            </div>
          ) : paginated.length === 0 ? (
            <div className="empty-state">
              <RiKeyLine size={40} />
              <p>{search ? 'No passwords match your search' : 'No passwords yet — add your first one'}</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Username</th>
                    <th>Password</th>
                    <th>URL</th>
                    <th>Folder</th>
                    <th>Created</th>
                    <th>Expiry</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item) => {
                    const isActive = item.is_active !== false && item.is_active !== 'false';
                    return (
                    <tr key={item.ROWID} style={!isActive ? { opacity: 0.55 } : {}}>
                      <td className="td-bold">
                        <div className="flex gap-8" style={{ alignItems: 'center' }}>
                          <div className="pw-icon"><RiLockLine size={14} /></div>
                          {item.name}
                        </div>
                      </td>
                      <td><CategoryBadge name={item.category} /></td>
                      <td className="td-muted">{item.username || '—'}</td>
                      <td>
                        <div className="pw-field">
                          <span className="pw-value">
                            {visibleIds[item.ROWID] ? item.password : '••••••••'}
                          </span>
                          <button className="icon-btn"
                            onClick={() => toggleVisible(item.ROWID)}
                            title={visibleIds[item.ROWID] ? 'Hide' : 'Show'}>
                            {visibleIds[item.ROWID] ? <RiEyeOffLine size={14} /> : <RiEyeLine size={14} />}
                          </button>
                          <button className="icon-btn"
                            onClick={() => copyToClipboard(item.password, item.ROWID)}
                            title="Copy password">
                            <RiFileCopyLine size={14} />
                          </button>
                          {copied === item.ROWID && <span className="copied-badge">Copied!</span>}
                        </div>
                      </td>
                      <td className="td-muted">
                        {item.url ? (
                          <a
                            href={item.url.startsWith('http') ? item.url : `https://${item.url}`}
                            target="_blank" rel="noreferrer" className="td-link"
                          >
                            {item.url.replace(/^https?:\/\//, '').slice(0, 20)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="td-muted">{getFolderName(item.folder_id)}</td>
                      <td className="td-muted">
                        {item.created_time ? new Date(item.created_time).toLocaleDateString() : '—'}
                      </td>
                      <td>{renderExpiryBadge(item.expiry_date)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <label className="form-check form-switch" style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              role="switch"
                              checked={isActive}
                              onChange={() => handleToggleActive(item)}
                              style={{ cursor: 'pointer' }}
                            />
                          </label>
                          {!isActive && (
                            <span className="badge badge-danger" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <RiPauseCircleLine size={11} /> Inactive
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-8">
                          <button className="icon-btn" onClick={() => openEdit(item)} title="Edit">
                            <RiEditLine size={15} />
                          </button>
                          <button className="icon-btn danger" onClick={() => setDeleteId(item.ROWID)} title="Delete">
                            <RiDeleteBinLine size={15} />
                          </button>
                          <button className="icon-btn success" onClick={() => setSharePassword(item)} title="Share">
                            <RiShareLine size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </button>
              {[...Array(totalPages)].map((_, i) => (
                <button key={i}
                  className={`page-btn ${page === i + 1 ? 'active' : ''}`}
                  onClick={() => setPage(i + 1)}>
                  {i + 1}
                </button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}
      {/* ── Shared With Me Tab ── */}
      {activeTab === 'shared' && (
        <div className="card">
          <div className="table-toolbar">
            <div className="search-box">
              <RiSearchLine size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search shared passwords..."
                className="search-input"
              />
            </div>
            <button className="btn btn-secondary" onClick={fetchSharedPasswords}>
              <RiRefreshLine size={16} />
            </button>
          </div>

          {sharedLoading ? (
            <div className="table-loading">
              {[...Array(3)].map((_, i) => <div key={i} className="skeleton-row" />)}
            </div>
          ) : sharedPasswords.length === 0 ? (
            <div className="empty-state">
              <RiShareLine size={40} />
              <p>No passwords shared with you yet</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Shared By</th>
                    <th>Username</th>
                    <th>Password</th>
                    <th>URL</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sharedPasswords.map((item) => {
                    const inactive = item.is_active === false;
                    return (
                    <tr key={item.share_id} className={inactive ? 'row-deactivated' : ''}>
                      <td>
                        <div className="flex gap-8" style={{ alignItems: 'center' }}>
                          <div className="pw-icon"><RiLockLine size={13} /></div>
                          <span className="td-bold">{item.name}</span>
                        </div>
                      </td>
                      <td><CategoryBadge name={item.category} /></td>
                      <td><SharedByCell name={item.shared_by_name} image={item.shared_by_image} /></td>
                      <td className="td-muted">
                        {inactive ? <span className="blurred-field">••••••••</span> : (item.username || '—')}
                      </td>
                      <td>
                        {inactive ? (
                          <div className="pw-field">
                            <span className="pw-value blurred-field">••••••••</span>
                          </div>
                        ) : (
                          <div className="pw-field">
                            <span className="pw-value">
                              {sharedVisible[item.share_id] ? item.password : '••••••••'}
                            </span>
                            <button className="icon-btn"
                              onClick={() => setSharedVisible(prev => ({
                                ...prev, [item.share_id]: !prev[item.share_id],
                              }))}>
                              {sharedVisible[item.share_id] ? <RiEyeOffLine size={13} /> : <RiEyeLine size={13} />}
                            </button>
                            <button className="icon-btn"
                              onClick={() => {
                                navigator.clipboard.writeText(item.password);
                                setSharedCopied(item.share_id);
                                setTimeout(() => setSharedCopied(''), 1500);
                              }}>
                              <RiFileCopyLine size={13} />
                            </button>
                            {sharedCopied === item.share_id && <span className="copied-badge">Copied!</span>}
                          </div>
                        )}
                      </td>
                      <td className="td-muted">
                        {inactive ? '—' : (
                          item.url
                            ? <a href={item.url} target="_blank" rel="noreferrer" className="td-link">
                                {item.url.replace(/^https?:\/\//, '').slice(0, 22)}
                              </a>
                            : '—'
                        )}
                      </td>
                      <td>
                        {inactive ? (
                          <span className="badge badge-danger" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <RiPauseCircleLine size={11} /> Deactivated by owner
                          </span>
                        ) : (
                          <span className={`badge ${item.expiry ? 'badge-warning' : 'badge-success'}`}
                            style={{ fontSize: 11 }}>
                            {item.expiry ? new Date(item.expiry).toLocaleString() : 'Never'}
                          </span>
                        )}
                      </td>
                      <td>
                        {inactive ? (
                          <span className="td-muted" style={{ fontSize: 11 }}>—</span>
                        ) : (
                          <div className="flex gap-8">
                            {(item.permissions || []).includes('edit') && (
                              <button className="icon-btn" onClick={() => openEditShared(item)} title="Edit">
                                <RiEditLine size={14} />
                              </button>
                            )}
                            {(item.permissions || []).includes('delete') && (
                              <button className="icon-btn danger" onClick={() => setDeleteSharedItem(item)} title="Delete">
                                <RiDeleteBinLine size={14} />
                              </button>
                            )}
                            {!(item.permissions || []).length && (
                              <span className="td-muted" style={{ fontSize: 11 }}>View only</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editItem ? (editItem.isShared ? 'Edit Shared Password' : 'Edit Password') : 'Add Password'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">

                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="form-input" placeholder="e.g. Gmail account"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>

                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-input" value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {categories.map(c => (
                      <option key={c.ROWID} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  {(() => {
                    const cat = findCategory(form.category);
                    return cat ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: cat.color || '#7c3aed', display: 'inline-block',
                        }} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cat.name}</span>
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* <div className="form-group">
                  <label className="form-label">Web Account</label>
                  <input className="form-input" placeholder="e.g. google.com"
                    value={form.web_account}
                    onChange={e => setForm(f => ({ ...f, web_account: e.target.value }))} />
                </div> */}

                {!editItem?.isShared && (
                  <div className="form-group">
                    <label className="form-label">Folder</label>
                    <select className="form-input" value={form.folder_id}
                      onChange={e => setForm(f => ({ ...f, folder_id: e.target.value }))}>
                      <option value="">No folder</option>
                      {folders.map(f => (
                        <option key={f.ROWID} value={f.ROWID}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="form-input" placeholder="Username or email"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                </div>

                <div className="form-group">
                  <label className="form-label">Password *</label>
                  <div className="pw-gen-row">
                    <input className="form-input" type="text"
                      placeholder="Enter or generate password"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                    <button className="btn btn-secondary pw-gen-btn" type="button"
                      onClick={() => {
                        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
                        const pwd = Array.from({ length: 16 },
                          () => chars[Math.floor(Math.random() * chars.length)]).join('');
                        setForm(f => ({ ...f, password: pwd }));
                      }}
                      title="Generate strong password">
                      Generate
                    </button>
                  </div>
                  <PasswordStrength password={form.password} />
                </div>

                <div className="form-group form-full">
                  <label className="form-label">URL</label>
                  <input className="form-input" placeholder="https://example.com"
                    value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
                </div>

                <div className="form-group form-full">
                  <label className="form-label">
                    <RiTimeLine size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Password Expiry Date (optional)
                  </label>
                  <input className="form-input" type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={form.expiry_date || ''}
                    onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    You'll receive email reminders 7 days and 1 day before expiry
                  </span>
                </div>

                <div className="form-group form-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-input" rows={3} placeholder="Optional notes..."
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>

              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editItem ? 'Update' : 'Save Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Password</h2>
              <button className="modal-close" onClick={() => setDeleteId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Are you sure you want to delete this password? This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {deleteSharedItem && (
        <div className="modal-overlay" onClick={() => setDeleteSharedItem(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Shared Password</h2>
              <button className="modal-close" onClick={() => setDeleteSharedItem(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                You have delete access on "{deleteSharedItem.name}". Deleting removes it for the owner too — this cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteSharedItem(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeleteShared(deleteSharedItem)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share Modal ── */}
      {sharePassword && (
        <ShareModal
          password={sharePassword}
          onClose={() => setSharePassword(null)}
        />
      )}
    </div>
  );
};

export default Passwords;