import React, { useEffect, useState, useCallback } from 'react';
import axios from '../services/api';
import {
  RiFolderLine, RiAddLine, RiEditLine, RiDeleteBinLine,
  RiRefreshLine, RiSearchLine, RiFolderOpenLine,
  RiKeyLine, RiShareLine, RiArrowLeftLine,
  RiLockLine, RiEyeLine, RiEyeOffLine,
  RiFileCopyLine, RiTimeLine, RiArrowRightSLine,
  RiArrowDownSLine, RiSubtractLine,RiPauseCircleLine 
} from 'react-icons/ri';
import Toast, { useToast } from '../components/Toast';
import FolderShareModal from '../components/FolderShareModal';
import { useShareNotif } from '../context/ShareNotifContext';

const API = '/server/cred_360_function';
const CATEGORIES = ['General','Social Media','Banking','Email','Work','Shopping','Other'];
const emptyPwForm = { name:'', category:'General', web_account:'', username:'', password:'', url:'', notes:'' };


// ── Recursive tree node ──────────────────────────────────────────────────────
const TreeNode = ({ folder, allFolders, allPasswords, depth, activeFolderId, expandedIds, onSelect, onToggle }) => {
  const children = allFolders.filter(f => String(f.parent_folder_id) === String(folder.ROWID));
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(String(folder.ROWID));
  const isActive   = String(activeFolderId) === String(folder.ROWID);
  const pwCount    = allPasswords.filter(p => String(p.folder_id) === String(folder.ROWID)).length;

  return (
    <div>
      <div
        onClick={() => onSelect(folder)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '5px 8px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
          marginLeft: depth * 16,
          background: isActive ? 'var(--color-background-info)' : 'transparent',
          opacity: folder.is_active === false ? 0.5 : 1,
        }}
      >
        {/* expand/collapse toggle */}
        <span
          onClick={e => { e.stopPropagation(); hasChildren && onToggle(folder.ROWID); }}
          style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          {hasChildren
            ? isExpanded
              ? <RiArrowDownSLine size={14} style={{ color: isActive ? 'var(--color-text-info)' : 'var(--color-text-secondary)' }} />
              : <RiArrowRightSLine size={14} style={{ color: isActive ? 'var(--color-text-info)' : 'var(--color-text-secondary)' }} />
            : <RiSubtractLine size={12} style={{ color: 'var(--color-text-secondary)', opacity: 0.3 }} />
          }
        </span>

        <RiFolderLine size={15} style={{ color: isActive ? 'var(--color-text-info)' : 'var(--color-text-secondary)', flexShrink: 0 }} />

        <span style={{
          fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: isActive ? 'var(--color-text-info)' : 'var(--color-text-primary)',
          fontWeight: isActive ? 500 : 400,
        }}>
          {folder.name}
        </span>

        <span style={{ fontSize: 11, color: isActive ? 'var(--color-text-info)' : 'var(--color-text-secondary)', opacity: 0.7, flexShrink: 0 }}>
          {pwCount}
        </span>
      </div>

      {hasChildren && isExpanded && children.map(child => (
        <TreeNode
          key={child.ROWID}
          folder={child}
          allFolders={allFolders}
          allPasswords={allPasswords}
          depth={depth + 1}
          activeFolderId={activeFolderId}
          expandedIds={expandedIds}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
};




// ── Build breadcrumb path ────────────────────────────────────────────────────
const buildBreadcrumb = (folder, allFolders) => {
  const path = [];
  let current = folder;
  while (current) {
    path.unshift(current);
    current = current.parent_folder_id
      ? allFolders.find(f => String(f.ROWID) === String(current.parent_folder_id))
      : null;
  }
  return path;
};

// ── Main component ───────────────────────────────────────────────────────────
const Folders = () => {
  const { refresh } = useShareNotif();
  const { toasts, removeToast, toast } = useToast();

  const [folders, setFolders]       = useState([]);
  const [passwords, setPasswords]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [activeFolder, setActiveFolder] = useState(null);
  const [expandedIds, setExpandedIds]   = useState(new Set());
  const [visibleIds, setVisibleIds]     = useState({});
  const [copied, setCopied]             = useState('');

  const [categories, setCategories] = useState([]);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [editFolder, setEditFolder]           = useState(null);
  const [folderForm, setFolderForm]           = useState({ name:'', parent_folder_id:'' });
  const [savingFolder, setSavingFolder]       = useState(false);

  const [showPwModal, setShowPwModal] = useState(false);
  const [editPw, setEditPw]           = useState(null);
  const [pwForm, setPwForm]           = useState(emptyPwForm);
  const [savingPw, setSavingPw]       = useState(false);

  const [shareFolder, setShareFolder] = useState(null);
  const [deleteId, setDeleteId]       = useState(null);
  const [deletePwId, setDeletePwId]   = useState(null);

  const [pwPage, setPwPage]                      = useState(1);
  const PW_PER_PAGE = 8;
  const [activeTab, setActiveTab]               = useState('my');
  const [sharedFolders, setSharedFolders]       = useState([]);
  const [sharedLoading, setSharedLoading]       = useState(false);
  const [activeFolderShared, setActiveFolderShared] = useState(null);
  const [sharedVisible, setSharedVisible]           = useState({});
  const [sharedCopied, setSharedCopied]             = useState('');
  const [deleteSharedPwId, setDeleteSharedPwId]     = useState(null);

const fetchData = useCallback(async () => {
  setLoading(true);
  try {
    const res = await axios.get(`${API}/api/folders-with-passwords`);
    if (res.data.success) {
      setFolders(res.data.folders   || []);
      setPasswords(res.data.passwords || []);
    }
  } catch(e) {
    console.log('Fetch error:', e.message);
  } finally {
    setLoading(false);
  }
}, []);

  const fetchSharedFolders = useCallback(async () => {
    setSharedLoading(true);
    try {
      const res = await axios.get(`${API}/api/shares/folders/received`);
      if (res.data.success) {
        const data = res.data.data || [];
        const seen = {};
        setSharedFolders(data.filter(sf => {
          if (seen[sf.folder_id]) return false;
          seen[sf.folder_id] = true;
          return true;
        }));
      }
    } catch(e) {
      console.log('Shared folders error:', e.message);
    } finally {
      setSharedLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (activeTab === 'shared') fetchSharedFolders(); }, [activeTab, fetchSharedFolders]);

  useEffect(() => {
  axios.get(`${API}/api/categories`)
    .then(res => {
          if (res.data.success) setCategories(res.data.data || []);
        })
        .catch(() => {});
    }, []);

  const handleTabChange = async (tab) => {
    setActiveTab(tab);
    if (tab === 'shared') {
      await axios.post(`${API}/api/shares/mark-viewed`, { type: 'folders' });
      refresh();
    }
  };

  // Root folders only (for tree top level)
  const rootFolders = folders.filter(f => !f.parent_folder_id || f.parent_folder_id === '');
  const filteredRoots = rootFolders.filter(f => f.name?.toLowerCase().includes(search.toLowerCase()));

  // Sub-folders of active folder
  const subFolders = activeFolder
    ? folders.filter(f => String(f.parent_folder_id) === String(activeFolder.ROWID))
    : [];

  // Passwords directly in active folder
  const folderPasswords = activeFolder
    ? passwords.filter(p => String(p.folder_id) === String(activeFolder.ROWID))
    : [];

  const getPwCount = (folderId) =>
    passwords.filter(p => String(p.folder_id) === String(folderId)).length;

  const toggleExpand = (folderId) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(String(folderId)) ? next.delete(String(folderId)) : next.add(String(folderId));
      return next;
    });
  };

  const selectFolder = (folder) => {
    setActiveFolder(folder);
    setPwPage(1);
    // auto-expand parent path
    const crumb = buildBreadcrumb(folder, folders);
    setExpandedIds(prev => {
      const next = new Set(prev);
      crumb.forEach(f => next.add(String(f.ROWID)));
      return next;
    });
  };

  // ── Folder CRUD ────────────────────────────────────────────────────────────
  const openAddFolder = (parentId = '') => {
    setEditFolder(null);
    setFolderForm({ name:'', parent_folder_id: parentId });
    setShowFolderModal(true);
  };

  const openEditFolder = (f, e) => {
    e?.stopPropagation();
    setEditFolder(f);
    setFolderForm({ name: f.name, parent_folder_id: f.parent_folder_id || '' });
    setShowFolderModal(true);
  };

  const handleSaveFolder = async () => {
    if (!folderForm.name.trim()) return toast.error('Folder name is required.');
    setSavingFolder(true);
    try {
      if (editFolder) {
        await axios.put(`${API}/api/folders/${editFolder.ROWID}`, folderForm);
        if (activeFolder?.ROWID === editFolder.ROWID)
          setActiveFolder(prev => ({ ...prev, name: folderForm.name, parent_folder_id: folderForm.parent_folder_id }));
      } else {
        await axios.post(`${API}/api/folders`, folderForm);
      }
      setShowFolderModal(false);
      fetchData();
    } catch(e) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSavingFolder(false);
    }
  };

  const handleDeleteFolder = async (id) => {
    try {
      await axios.delete(`${API}/api/folders/${id}`);
      setDeleteId(null);
      if (activeFolder?.ROWID === id) setActiveFolder(null);
      fetchData();
    } catch(e) {
      toast.error('Delete failed: ' + e.message);
    }
  };

  const handleToggleFolderActive = async (folder) => {
    try {
      const res = await axios.put(`${API}/api/folders/${folder.ROWID}/toggle-active`);
      const nextActive = res.data?.data?.is_active;
      setFolders(prev => prev.map(f =>
        String(f.ROWID) === String(folder.ROWID) ? { ...f, is_active: nextActive } : f
      ));
      if (activeFolder?.ROWID === folder.ROWID) {
        setActiveFolder(prev => ({ ...prev, is_active: nextActive }));
      }
      toast.success(nextActive ? 'Folder activated' : 'Folder deactivated — shared access is now blocked');
    } catch (e) {
      toast.error('Failed to toggle status: ' + (e.response?.data?.error || e.message));
    }
  };


  const openEditSharedPw = (pw) => {
    setEditPw({ ...pw, isSharedEdit: true, folder_id: pw.folder_id });
    setPwForm({
      name: pw.name || '', category: pw.category || 'General',
      web_account: pw.web_account || '', username: pw.username || '',
      password: pw.password || '', url: pw.url || '', notes: pw.notes || '',
    });
    setShowPwModal(true);
  };

  const handleDeleteSharedPw = async (id) => {
    try {
      await axios.delete(`${API}/api/passwords/${id}`);
      setActiveFolderShared(prev => prev ? { ...prev, passwords: prev.passwords.filter(p => p.ROWID !== id) } : prev);
      setDeleteSharedPwId(null);
      toast.success('Password deleted');
    } catch (e) {
      toast.error('Delete failed: ' + (e.response?.data?.error || e.message));
    }
  };

  // ── Password CRUD ──────────────────────────────────────────────────────────
  const openAddPw = () => { setEditPw(null); setPwForm(emptyPwForm); setShowPwModal(true); };
  const openEditPw = (pw) => {
    setEditPw(pw);
    setPwForm({
      name: pw.name || '', category: pw.category || 'General',
      web_account: pw.web_account || '', username: pw.username || '',
      password: pw.password || '', url: pw.url || '', notes: pw.notes || '',
    });
    setShowPwModal(true);
  };

  const handleSavePw = async () => {
    if (!pwForm.name || !pwForm.password) return toast.error('Name and password required.');
    setSavingPw(true);
    try {
      const folderIdToUse = editPw?.isSharedEdit ? (editPw.folder_id || '') : activeFolder.ROWID;
      if (editPw) {
        await axios.put(`${API}/api/passwords/${editPw.ROWID}`, { ...pwForm, folder_id: folderIdToUse });
      } else {
        await axios.post(`${API}/api/passwords`, { ...pwForm, folder_id: folderIdToUse });
      }
      setShowPwModal(false);
      if (editPw?.isSharedEdit) fetchSharedFolders(); else fetchData();
    } catch(e) {
      toast.error('Save failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSavingPw(false);
    }
  };

  const handleDeletePw = async (id) => {
    try {
      await axios.delete(`${API}/api/passwords/${id}`);
      setDeletePwId(null);
      fetchData();
    } catch(e) {
      toast.error('Delete failed: ' + e.message);
    }
  };

  const toggleVisible = (id) => setVisibleIds(prev => ({ ...prev, [id]: !prev[id] }));
  const copyPw = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };

  // ── Shared folder detail ───────────────────────────────────────────────────
  if (activeFolderShared) {
    return (
      <div>
        <Toast toasts={toasts} removeToast={removeToast} />
        <div className="page-header flex-between">
          <div className="flex gap-12" style={{ alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setActiveFolderShared(null)}>
              <RiArrowLeftLine size={16} /> Back
            </button>
            <div>
              <h1 className="page-title">
                <RiFolderOpenLine size={20} style={{ marginRight: 8, color: 'var(--primary)', verticalAlign: 'middle' }} />
                {activeFolderShared.folder_name}
              </h1>
              <p className="page-subtitle">
                {activeFolderShared.passwords?.length || 0} passwords ·{' '}
                {activeFolderShared.expiry
                  ? `Expires ${new Date(activeFolderShared.expiry.replace(' ','T')+'Z').toLocaleString()}`
                  : 'Never expires'}
                {activeFolderShared.is_active === false && (
                  <span className="badge badge-danger" style={{ fontSize: 11, marginLeft: 8 }}>
                    Deactivated by owner
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="card">
          {!activeFolderShared.passwords || activeFolderShared.passwords.length === 0 ? (
            <div className="empty-state"><RiKeyLine size={40} /><p>No passwords in this shared folder</p></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Category</th><th>Username</th><th>Password</th><th>URL</th><th>Actions</th></tr></thead>
                <tbody>
                  {activeFolderShared.passwords.map((pw, i) => {
                    const inactive = activeFolderShared.is_active === false;
                    return (
                    <tr key={i} className={inactive ? 'row-deactivated' : ''}>
                      <td><div className="flex gap-8" style={{ alignItems:'center' }}><div className="pw-icon"><RiLockLine size={13} /></div><span className="td-bold">{pw.name}</span></div></td>
                      <td><span className="badge badge-info">{pw.category || 'General'}</span></td>
                      <td className="td-muted">{inactive ? <span className="blurred-field">••••••••</span> : (pw.username || '—')}</td>
                      <td>
                        {inactive ? (
                          <div className="pw-field"><span className="pw-value blurred-field">••••••••</span></div>
                        ) : (
                          <div className="pw-field">
                            <span className="pw-value">{sharedVisible[pw.ROWID] ? pw.password : '••••••••'}</span>
                            <button className="icon-btn" onClick={() => setSharedVisible(p => ({ ...p, [pw.ROWID]: !p[pw.ROWID] }))}>
                              {sharedVisible[pw.ROWID] ? <RiEyeOffLine size={13}/> : <RiEyeLine size={13}/>}
                            </button>
                            <button className="icon-btn" onClick={() => { navigator.clipboard.writeText(pw.password); setSharedCopied(pw.ROWID); setTimeout(() => setSharedCopied(''), 1500); }}>
                              <RiFileCopyLine size={13}/>
                            </button>
                            {sharedCopied === pw.ROWID && <span className="copied-badge">Copied!</span>}
                          </div>
                        )}
                      </td>
                      <td className="td-muted">{inactive ? '—' : (pw.url ? <a href={pw.url} target="_blank" rel="noreferrer" className="td-link">{pw.url.replace(/^https?:\/\//,'').slice(0,22)}</a> : '—')}</td>
                      <td>
                        {inactive ? (
                          <span className="td-muted" style={{ fontSize: 11 }}>—</span>
                        ) : (
                          <div className="flex gap-8">
                            {(activeFolderShared.permissions || []).includes('edit') && (
                              <button className="icon-btn" onClick={() => openEditSharedPw(pw)}><RiEditLine size={14}/></button>
                            )}
                            {(activeFolderShared.permissions || []).includes('delete') && (
                              <button className="icon-btn danger" onClick={() => setDeleteSharedPwId(pw.ROWID)}><RiDeleteBinLine size={14}/></button>
                            )}
                            {!(activeFolderShared.permissions || []).length && (
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
      </div>
    );
  }

  // ── Main view: two-panel layout ────────────────────────────────────────────
  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Folders</h1>
          <p className="page-subtitle">
            {activeTab === 'my'
              ? `${folders.length} folders`
              : `${sharedFolders.length} folders shared with you`}
          </p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-secondary" onClick={activeTab === 'my' ? fetchData : fetchSharedFolders}>
            <RiRefreshLine size={16} />
          </button>
          {activeTab === 'my' && (
            <button className="btn btn-primary" onClick={() => openAddFolder('')}>
              <RiAddLine size={16} /> New Folder
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="pw-tabs">
        <button className={`pw-tab ${activeTab === 'my' ? 'active' : ''}`} onClick={() => setActiveTab('my')}>
          <RiFolderLine size={15} /> My Folders
          <span className="pw-tab-count">{folders.length}</span>
        </button>
        <button className={`pw-tab ${activeTab === 'shared' ? 'active' : ''}`} onClick={() => handleTabChange('shared')}>
          <RiShareLine size={15} /> Shared With Me
          <span className="pw-tab-count">{sharedFolders.length}</span>
        </button>
      </div>

      {/* ── MY FOLDERS TAB ── */}
      {activeTab === 'my' && (
        <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border-color)', borderRadius: 10, overflow: 'hidden', minHeight: 480, background: 'var(--card-bg)' }}>
          {/* LEFT: Folder tree */}
          <div style={{ width: 230, minWidth: 230, borderRight: '0.5px solid var(--border-color)', background: 'var(--sidebar-bg, var(--card-bg))', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 12px 8px', borderBottom: '0.5px solid var(--border-color)' }}>
              <div className="search-box">
                <RiSearchLine size={14} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="search-input"
                  style={{ fontSize: 12 }}
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton-card" style={{ height: 32, marginBottom: 4, borderRadius: 6 }} />
                ))
              ) : filteredRoots.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
                  {search ? 'No matches' : 'No folders yet'}
                </p>
              ) : (
                filteredRoots.map(folder => (
                  <TreeNode
                    key={folder.ROWID}
                    folder={folder}
                    allFolders={folders}
                    allPasswords={passwords}
                    depth={0}
                    activeFolderId={activeFolder?.ROWID}
                    expandedIds={expandedIds}
                    onSelect={selectFolder}
                    onToggle={toggleExpand}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT: Folder contents */}
          <div style={{ flex: 1, minWidth: 0, padding: '16px 20px', overflowY: 'auto' }}>
            {!activeFolder ? (
              <div className="empty-state" style={{ marginTop: 60 }}>
                <RiFolderLine size={40} />
                <p>Select a folder from the left to view its contents</p>
                <button className="btn btn-primary" onClick={() => openAddFolder('')}>
                  <RiAddLine size={15} /> New Folder
                </button>
              </div>
            ) : (
              <>
                {/* Breadcrumb */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span
                    style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}
                    onClick={() => setActiveFolder(null)}
                  >
                    Folders
                  </span>
                  {buildBreadcrumb(activeFolder, folders).map((crumb, i, arr) => (
                    <React.Fragment key={crumb.ROWID}>
                      <RiArrowRightSLine size={13} style={{ color: 'var(--text-muted)' }} />
                      <span
                        style={{
                          fontSize: 12,
                          color: i === arr.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontWeight: i === arr.length - 1 ? 500 : 400,
                          cursor: i < arr.length - 1 ? 'pointer' : 'default',
                        }}
                        onClick={() => i < arr.length - 1 && selectFolder(crumb)}
                      >
                        {crumb.name}
                      </span>
                    </React.Fragment>
                  ))}
                </div>

                {/* Header */}
                <div className="flex-between" style={{ marginBottom: 16 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <RiFolderOpenLine size={18} style={{ color: 'var(--primary)' }} />
                      {activeFolder.name}
                    </h2>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                      {subFolders.length} sub-folder{subFolders.length !== 1 ? 's' : ''} · {folderPasswords.length} password{folderPasswords.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-8" style={{ alignItems: 'center' }}>
                    <label className="form-check form-switch" style={{ margin: 0, marginRight: 4 }} title={activeFolder.is_active === false ? 'Activate folder' : 'Deactivate folder'}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        checked={activeFolder.is_active !== false}
                        onChange={() => handleToggleFolderActive(activeFolder)}
                      />
                    </label>
                    {activeFolder.is_active === false && (
                      <span className="badge badge-danger" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <RiPauseCircleLine size={11} /> Inactive
                      </span>
                    )}
                    <button className="btn btn-secondary" onClick={() => setShareFolder(activeFolder)}>
                      <RiShareLine size={14} /> Share
                    </button>
                    <button className="btn btn-secondary" onClick={() => openEditFolder(activeFolder)}>
                      <RiEditLine size={14} /> Edit
                    </button>
                    <button className="btn btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => setDeleteId(activeFolder.ROWID)}>
                      <RiDeleteBinLine size={14} />
                    </button>
                    <button className="btn btn-primary" onClick={openAddPw}>
                      <RiAddLine size={14} /> Add Password
                    </button>
                  </div>
                </div>

                {/* Sub-folders strip */}
                {subFolders.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px' }}>
                      Sub-folders
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {subFolders.map(sf => (
                        <div
                          key={sf.ROWID}
                          onClick={() => selectFolder(sf)}
                          style={{
                            border: '0.5px solid var(--border-color)', borderRadius: 8,
                            padding: '8px 14px', display: 'flex', alignItems: 'center',
                            gap: 8, cursor: 'pointer', background: 'var(--card-bg)',
                            minWidth: 140,
                          }}
                        >
                          <RiFolderLine size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {sf.name}
                            </p>
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                              {getPwCount(sf.ROWID)} passwords
                            </p>
                          </div>
                        </div>
                      ))}
                      {/* Quick add sub-folder */}
                      <div
                        onClick={() => openAddFolder(String(activeFolder.ROWID))}
                        style={{
                          border: '0.5px dashed var(--border-color)', borderRadius: 8,
                          padding: '8px 14px', display: 'flex', alignItems: 'center',
                          gap: 8, cursor: 'pointer', color: 'var(--text-muted)',
                        }}
                      >
                        <RiAddLine size={16} />
                        <span style={{ fontSize: 13 }}>New sub-folder</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* If no sub-folders yet, show inline add */}
                {subFolders.length === 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => openAddFolder(String(activeFolder.ROWID))}
                    >
                      <RiAddLine size={13} /> Add Sub-folder
                    </button>
                  </div>
                )}

                {/* Passwords in this folder */}
                <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px' }}>
                  Passwords
                </p>
                <div className="card" style={{ padding: 0 }}>
                  {folderPasswords.length === 0 ? (
                    <div className="empty-state">
                      <RiKeyLine size={36} />
                      <p>No passwords in this folder yet</p>
                      <button className="btn btn-primary" onClick={openAddPw}>
                        <RiAddLine size={15} /> Add First Password
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr><th>Name</th><th>Category</th><th>Username</th><th>Password</th><th>URL</th><th>Actions</th></tr>
                          </thead>
                          <tbody>
                            {folderPasswords
                              .slice((pwPage - 1) * PW_PER_PAGE, pwPage * PW_PER_PAGE)
                              .map(pw => (
                              <tr key={pw.ROWID}>
                                <td>
                                  <div className="flex gap-8" style={{ alignItems: 'center' }}>
                                    <div className="pw-icon"><RiLockLine size={13} /></div>
                                    <span className="td-bold">{pw.name}</span>
                                  </div>
                                </td>
                                <td><span className="badge badge-info">{pw.category || 'General'}</span></td>
                                <td className="td-muted">{pw.username || '—'}</td>
                                <td>
                                  <div className="pw-field">
                                    <span className="pw-value">{visibleIds[pw.ROWID] ? pw.password : '••••••••'}</span>
                                    <button className="icon-btn" onClick={() => toggleVisible(pw.ROWID)}>
                                      {visibleIds[pw.ROWID] ? <RiEyeOffLine size={13}/> : <RiEyeLine size={13}/>}
                                    </button>
                                    <button className="icon-btn" onClick={() => copyPw(pw.password, pw.ROWID)}>
                                      <RiFileCopyLine size={13}/>
                                    </button>
                                    {copied === pw.ROWID && <span className="copied-badge">Copied!</span>}
                                  </div>
                                </td>
                                <td className="td-muted">
                                  {pw.url
                                    ? <a href={pw.url} target="_blank" rel="noreferrer" className="td-link">{pw.url.replace(/^https?:\/\//, '').slice(0, 22)}</a>
                                    : '—'}
                                </td>
                                <td>
                                  <div className="flex gap-8">
                                    <button className="icon-btn" onClick={() => openEditPw(pw)}><RiEditLine size={14}/></button>
                                    <button className="icon-btn danger" onClick={() => setDeletePwId(pw.ROWID)}><RiDeleteBinLine size={14}/></button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {Math.ceil(folderPasswords.length / PW_PER_PAGE) > 1 && (
                        <div className="pagination">
                          <button className="page-btn" disabled={pwPage === 1} onClick={() => setPwPage(p => p - 1)}>
                            Previous
                          </button>
                          {[...Array(Math.ceil(folderPasswords.length / PW_PER_PAGE))].map((_, i) => (
                            <button key={i}
                              className={`page-btn ${pwPage === i + 1 ? 'active' : ''}`}
                              onClick={() => setPwPage(i + 1)}>
                              {i + 1}
                            </button>
                          ))}
                          <button className="page-btn"
                            disabled={pwPage === Math.ceil(folderPasswords.length / PW_PER_PAGE)}
                            onClick={() => setPwPage(p => p + 1)}>
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── SHARED TAB ── (unchanged) */}
      {activeTab === 'shared' && (
        <>
          {sharedLoading ? (
            <div className="folders-grid">{[...Array(4)].map((_,i) => <div key={i} className="skeleton-card" style={{ height:120 }}/>)}</div>
          ) : sharedFolders.length === 0 ? (
            <div className="card"><div className="empty-state"><RiShareLine size={40}/><p>No folders shared with you yet</p></div></div>
          ) : (
            <div className="folders-grid">
              {sharedFolders.map((sf, i) => {
                const inactive = sf.is_active === false || sf.is_active === 'false';
                return (
                <div
                  key={i}
                  className={`folder-card ${inactive ? 'folder-card-inactive' : ''}`}
                  onClick={() => {
                    if (inactive) {
                      toast.error(`"${sf.folder_name}" is currently inactive`);
                      return;
                    }
                    setActiveFolderShared(sf);
                  }}
                >
                  <div className="folder-card-top">
                    <div className="folder-card-icon"><RiFolderLine size={28}/></div>
                    {inactive
                      ? <span className="badge badge-danger" style={{ fontSize: 11 }}>Deactivated</span>
                      : <span className="badge badge-info" style={{ fontSize: 11 }}>Shared</span>}
                  </div>
                  <div className={`folder-card-name ${inactive ? 'blurred-field-soft' : ''}`}>{sf.folder_name}</div>
                  <div className="folder-card-meta"><RiKeyLine size={13}/>{sf.password_count} passwords</div>
                  <div className="folder-card-meta" style={{ marginTop: 4 }}>
                    <RiTimeLine size={13}/>
                    {sf.expiry ? `Expires ${new Date(sf.expiry.replace(' ','T')+'Z').toLocaleDateString()}` : 'Never expires'}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Folder modal (create / edit / move) ── */}
      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editFolder ? 'Edit Folder' : 'New Folder'}</h2>
              <button className="modal-close" onClick={() => setShowFolderModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Folder Name *</label>
                <input
                  className="form-input"
                  placeholder="e.g. Work Accounts"
                  value={folderForm.name}
                  onChange={e => setFolderForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Parent Folder</label>
                <select
                  className="form-input"
                  value={folderForm.parent_folder_id}
                  onChange={e => setFolderForm(f => ({ ...f, parent_folder_id: e.target.value }))}
                >
                  <option value="">Root level (no parent)</option>
                  {folders
                    .filter(f => !editFolder || f.ROWID !== editFolder.ROWID)
                    .map(f => <option key={f.ROWID} value={f.ROWID}>{f.name}</option>)
                  }
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveFolder} disabled={savingFolder}>
                {savingFolder ? 'Saving...' : editFolder ? 'Update' : 'Create Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Password modal ── */}
      {showPwModal && (
        <div className="modal-overlay" onClick={() => setShowPwModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editPw ? 'Edit Password' : `Add to "${activeFolder?.name}"`}</h2>
              <button className="modal-close" onClick={() => setShowPwModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="form-input" placeholder="e.g. Gmail" value={pwForm.name} onChange={e => setPwForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-input" value={pwForm.category} onChange={e => setPwForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">Select category</option>
                    {categories.map(c => (
                      <option key={c.ROWID} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="form-input" placeholder="Username or email" value={pwForm.username} onChange={e => setPwForm(f => ({ ...f, username: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Password *</label>
                  <input className="form-input" type="password" placeholder="Password" value={pwForm.password} onChange={e => setPwForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <div className="form-group form-full">
                  <label className="form-label">URL</label>
                  <input className="form-input" placeholder="https://example.com" value={pwForm.url} onChange={e => setPwForm(f => ({ ...f, url: e.target.value }))} />
                </div>
                <div className="form-group form-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-input" rows={3} placeholder="Optional notes..." value={pwForm.notes} onChange={e => setPwForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPwModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSavePw} disabled={savingPw}>
                {savingPw ? 'Saving...' : editPw ? 'Update' : 'Save Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareFolder && (
        <FolderShareModal folder={shareFolder} passwords={passwords} onClose={() => setShareFolder(null)} />
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Folder</h2>
              <button className="modal-close" onClick={() => setDeleteId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Are you sure? Sub-folders will be moved up one level. Passwords inside will remain unassigned if not in a sub-folder.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeleteFolder(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {deletePwId && (
        <div className="modal-overlay" onClick={() => setDeletePwId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Password</h2>
              <button className="modal-close" onClick={() => setDeletePwId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Are you sure you want to delete this password?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeletePwId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeletePw(deletePwId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {deleteSharedPwId && (
        <div className="modal-overlay" onClick={() => setDeleteSharedPwId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Shared Password</h2>
              <button className="modal-close" onClick={() => setDeleteSharedPwId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Deleting removes this password for the owner too — this cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteSharedPwId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeleteSharedPw(deleteSharedPwId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Folders;