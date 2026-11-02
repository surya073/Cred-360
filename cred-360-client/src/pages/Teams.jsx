import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import Toast, { useToast } from '../components/Toast';
import {
  RiTeamLine, RiAddLine, RiEditLine, RiDeleteBinLine,
  RiRefreshLine, RiSearchLine, RiUserAddLine,
  RiCloseLine, RiArrowRightSLine, RiKeyLine,
  RiLockLine, RiEyeLine, RiEyeOffLine, RiFileCopyLine,
  RiTimeLine, RiShieldLine, RiSendPlaneLine,
  RiFolderLine, RiArrowLeftLine, RiInformationLine,
  RiFilter3Line, RiArrowDownSLine, RiPauseCircleLine
} from 'react-icons/ri';
import TeamChat from '../components/TeamChat';
import '../styles/teams.css';

const API_CORE   = '/server/cred_360_function';
const API_PEOPLE = '/server/cred_360_people_function';
const emptyForm = { name: '', description: '' };

const PERM_DEFS = [
  { key: 'edit',         label: 'Edit' },
  { key: 'delete',       label: 'Delete' },
  { key: 'toggleActive', label: 'Activate/Deactivate' },
  { key: 'addMember',    label: 'Add Member' },
];

const SORT_OPTIONS = [
  { value: 'recent',   label: 'Recently added' },
  { value: 'alpha',    label: 'Alphabetical (A–Z)' },
  { value: 'oldest',   label: 'Old to New' },
  { value: 'newest',   label: 'New to Old' },
  { value: 'active',   label: 'Active teams first' },
  { value: 'inactive', label: 'Inactive teams first' },
];

const UserAvatar = ({ user, size = 32, fontSize = 13 }) => {
  const [imgError, setImgError] = useState(false);
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  const imageUrl = user?.profile_image
    ? `${API_CORE}/api/profile/image/${user.profile_image}`
    : null;

  if (imageUrl && !imgError) {
    return (
      <div className="user-avatar" style={{ width: size, height: size }}>
        <img
          src={imageUrl} alt={initial}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return (
    <div className="user-avatar user-avatar-fallback" style={{ width: size, height: size, fontSize }}>
      {initial}
    </div>
  );
};

const SortDropdown = ({ sortBy, setSortBy, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const current = SORT_OPTIONS.find(o => o.value === sortBy);

  return (
    <div className="sort-dropdown" ref={ref}>
      <button
        type="button"
        className={`sort-dropdown-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sort-dropdown-trigger-label">
          <RiFilter3Line size={14} /> {current?.label}
        </span>
        <RiArrowDownSLine size={16} className={`sort-dropdown-chevron ${open ? 'open' : ''}`} />
      </button>
      <div className={`sort-dropdown-menu ${open ? 'open' : ''}`}>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`sort-dropdown-item ${sortBy === opt.value ? 'active' : ''}`}
            onClick={() => { setSortBy(opt.value); setOpen(false); onChange?.(); }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const Teams = () => {
  const { user: currentUser } = useAuth();
  const { toasts, removeToast, toast } = useToast();

  const [teams, setTeams]           = useState([]);
  const [users, setUsers]           = useState([]);
  const [members, setMembers]       = useState({});
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [activeTeam, setActiveTeam] = useState(null);
  const [activeTab, setActiveTab]   = useState('members');

  const [sharedPasswords, setSharedPasswords]   = useState([]);
  const [sharedLoading, setSharedLoading]       = useState(false);
  const [visibleIds, setVisibleIds]             = useState({});
  const [copiedIds, setCopiedIds]               = useState({});

  const [showModal, setShowModal]           = useState(false);
  const [editItem, setEditItem]             = useState(null);
  const [form, setForm]                     = useState(emptyForm);
  const [saving, setSaving]                 = useState(false);
  const [showAddMember, setShowAddMember]   = useState(false);
  const [addingMember, setAddingMember]     = useState(false);
  const [deleteId, setDeleteId]             = useState(null);

  const [sharedFolders, setSharedFolders]     = useState([]);
  const [foldersLoading, setFoldersLoading]   = useState(false);
  const [activeFolderShared, setActiveFolderShared] = useState(null);
  const [folderVisible, setFolderVisible]     = useState({});
  const [folderCopied, setFolderCopied]       = useState('');
  const [editSharedPw, setEditSharedPw]       = useState(null);
  const [sharedPwForm, setSharedPwForm]       = useState({ name:'', category:'General', username:'', password:'', url:'', notes:'' });
  const [savingSharedPw, setSavingSharedPw]   = useState(false);
  const [deleteSharedPw, setDeleteSharedPw]   = useState(null);

  // pagination / search / info popup / sort
  const [teamPage, setTeamPage] = useState(1);
  const [infoTeam, setInfoTeam] = useState(null);
  const [sortBy, setSortBy]     = useState('recent');
  const TEAMS_PER_PAGE = 10;

  const [pwSearch, setPwSearch] = useState('');
  const [pwPage, setPwPage]     = useState(1);
  const PW_PER_PAGE = 10;

  const [folderSearch, setFolderSearch] = useState('');
  const [folderPage, setFolderPage]     = useState(1);
  const FOLDERS_PER_PAGE = 10;

  // add-member: tagify multi-select + permissions
  const [selectedUsers, setSelectedUsers]   = useState([]); // [{ROWID, name, email}]
  const [tagInput, setTagInput]             = useState('');
  const [newMemberPerms, setNewMemberPerms] = useState({ edit: false, delete: false, toggleActive: false, addMember: false });

  // cache of per-team fetched data so switching tabs doesn't refetch
  const [teamDataCache, setTeamDataCache] = useState({});

  const isAdmin = ['admin', 'team lead'].includes(
    currentUser?.role_details?.role_name?.toLowerCase()
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, userRes] = await Promise.all([
        axios.get(`${API_PEOPLE}/api/teams`),
        axios.get(`${API_PEOPLE}/api/users`),
      ]);
      if (teamRes.data.success) setTeams(teamRes.data.data || []);
      if (userRes.data.success) setUsers(userRes.data.data || []);

      if (teamRes.data.success) {
        const memberMap = {};
        await Promise.all(
          (teamRes.data.data || []).map(async (team) => {
            try {
              const res = await axios.get(`${API_PEOPLE}/api/teams/${team.ROWID}/members`);
              if (res.data.success) memberMap[team.ROWID] = res.data.data || [];
            } catch(e) { memberMap[team.ROWID] = []; }
          })
        );
        setMembers(memberMap);
      }
    } catch(e) {
      toast.error('Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Consolidated single-shot fetch per team (members + passwords + folders together) ──
  const loadTeamData = useCallback(async (teamId, force = false) => {
    if (!force && teamDataCache[teamId]) {
      const cached = teamDataCache[teamId];
      setMembers(prev => ({ ...prev, [teamId]: cached.members }));
      setSharedPasswords(cached.passwords);
      setSharedFolders(cached.folders);
      return;
    }
    setSharedLoading(true);
    setFoldersLoading(true);
    try {
      const [memRes, pwRes, folderRes] = await Promise.all([
        axios.get(`${API_PEOPLE}/api/teams/${teamId}/members`),
        axios.get(`${API_PEOPLE}/api/teams/${teamId}/shared-passwords`),
        axios.get(`${API_PEOPLE}/api/teams/${teamId}/shared-folders`),
      ]);
      const data = {
        members:   memRes.data.success ? memRes.data.data : [],
        passwords: pwRes.data.success ? pwRes.data.data : [],
        folders:   folderRes.data.success ? folderRes.data.data : [],
      };
      setTeamDataCache(prev => ({ ...prev, [teamId]: data }));
      setMembers(prev => ({ ...prev, [teamId]: data.members }));
      setSharedPasswords(data.passwords);
      setSharedFolders(data.folders);
    } catch (e) {
      toast.error('Failed to load team data');
    } finally {
      setSharedLoading(false);
      setFoldersLoading(false);
    }
  }, [teamDataCache]);

  const openTeam = (team) => {
    if (team.is_active === false) {
      toast.error('This team is currently inactive. Reactivate it to access its contents.');
      return;
    }
    setActiveTeam(team);
    setActiveTab('members');
    setPwPage(1);
    setFolderPage(1);
    loadTeamData(team.ROWID);
  };

  const invalidateAndRefetch = () => {
    if (!activeTeam) return;
    setTeamDataCache(prev => {
      const copy = { ...prev };
      delete copy[activeTeam.ROWID];
      return copy;
    });
    loadTeamData(activeTeam.ROWID, true);
  };

  const fetchSharedPasswords = (teamId) => loadTeamData(teamId, true);
  const fetchSharedFolders   = (teamId) => loadTeamData(teamId, true);

  // ── Filter / sort / paginate: teams ──
  const filtered = teams
    .filter(t =>
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'alpha':    return (a.name || '').localeCompare(b.name || '');
        case 'oldest':   return new Date(a.created_time) - new Date(b.created_time);
        case 'newest':   return new Date(b.created_time) - new Date(a.created_time);
        case 'active':   return (b.is_active !== false) - (a.is_active !== false);
        case 'inactive': return (a.is_active !== false) - (b.is_active !== false);
        case 'recent':
        default:         return String(b.ROWID).localeCompare(String(a.ROWID));
      }
    });

  const totalTeamPages = Math.ceil(filtered.length / TEAMS_PER_PAGE);
  const paginatedTeams = filtered.slice((teamPage - 1) * TEAMS_PER_PAGE, teamPage * TEAMS_PER_PAGE);

  const filteredPasswords = sharedPasswords.filter(p =>
    p.name?.toLowerCase().includes(pwSearch.toLowerCase()) ||
    p.username?.toLowerCase().includes(pwSearch.toLowerCase()) ||
    p.category?.toLowerCase().includes(pwSearch.toLowerCase())
  );
  const totalPwPages = Math.ceil(filteredPasswords.length / PW_PER_PAGE);
  const paginatedPasswords = filteredPasswords.slice((pwPage - 1) * PW_PER_PAGE, pwPage * PW_PER_PAGE);

  const filteredFolders = sharedFolders.filter(f =>
    f.folder_name?.toLowerCase().includes(folderSearch.toLowerCase())
  );
  const totalFolderPages = Math.ceil(filteredFolders.length / FOLDERS_PER_PAGE);
  const paginatedFolders = filteredFolders.slice((folderPage - 1) * FOLDERS_PER_PAGE, folderPage * FOLDERS_PER_PAGE);

  const getTeamMembers = (teamId) => members[teamId] || [];

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowModal(true); };

  const openEdit = (team, e) => {
    e.stopPropagation();
    setEditItem(team);
    setForm({ name: team.name || '', description: team.description || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Team name is required.');
    setSaving(true);
    try {
      if (editItem) {
        await axios.put(`${API_PEOPLE}/api/teams/${editItem.ROWID}`, form);
        if (activeTeam?.ROWID === editItem.ROWID) setActiveTeam(prev => ({ ...prev, ...form }));
      } else {
        await axios.post(`${API_PEOPLE}/api/teams`, form);
      }
      setShowModal(false);
      fetchData();
    } catch(e) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_PEOPLE}/api/teams/${id}`);
      setDeleteId(null);
      if (activeTeam?.ROWID === id) setActiveTeam(null);
      fetchData();
    } catch(e) {
      toast.error('Delete failed: ' + e.message);
    }
  };

  const handleToggleTeamActive = async (team, e) => {
    e.stopPropagation();
    try {
      const res = await axios.put(`${API_PEOPLE}/api/teams/${team.ROWID}/toggle-active`);
      const nextActive = res.data?.data?.is_active;
      setTeams(prev => prev.map(t => t.ROWID === team.ROWID ? { ...t, is_active: nextActive } : t));
      toast.success(nextActive ? 'Team activated' : 'Team deactivated');
    } catch (e) {
      toast.error('Failed to update team status: ' + (e.response?.data?.error || e.message));
    }
  };

  const openAddMemberModal = () => {
    setSelectedUsers([]);
    setTagInput('');
    setNewMemberPerms({ edit: false, delete: false, toggleActive: false, addMember: false });
    setShowAddMember(true);
  };

  const handleAddMember = async () => {
    if (selectedUsers.length === 0) return toast.error('Please select at least one user.');
    setAddingMember(true);
    try {
      await axios.post(`${API_PEOPLE}/api/teams/${activeTeam.ROWID}/members`, {
        user_ids: selectedUsers.map(u => u.ROWID),
        permissions: newMemberPerms,
      });
      setShowAddMember(false);
      setSelectedUsers([]);
      setNewMemberPerms({ edit: false, delete: false, toggleActive: false, addMember: false });
      invalidateAndRefetch();
    } catch(e) {
      toast.error('Failed to add members: ' + (e.response?.data?.error || e.message));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (teamId, memberId) => {
    try {
      await axios.delete(`${API_PEOPLE}/api/teams/${teamId}/members/${memberId}`);
      invalidateAndRefetch();
    } catch(e) {
      toast.error('Failed to remove member: ' + e.message);
    }
  };

  const updateMemberPermission = async (member, key) => {
    if (!isAdmin) return;
    const newPerms = { ...(member.permissions || {}), [key]: !(member.permissions || {})[key] };
    try {
      await axios.put(`${API_PEOPLE}/api/teams/${activeTeam.ROWID}/members/${member.ROWID}/permissions`, {
        permissions: newPerms,
      });
      invalidateAndRefetch();
    } catch (e) {
      toast.error('Failed to update permission: ' + (e.response?.data?.error || e.message));
    }
  };

  // ── FIXED: use pw.ROWID for folder-view passwords, pw.password_id for team-passwords-tab passwords ──
  const openEditSharedPw = (pw, source) => {
    const id = source === 'team-folder' ? pw.ROWID : pw.password_id;
    setEditSharedPw({ ROWID: id, folder_id: pw.folder_id || '', source });
    setSharedPwForm({
      name: pw.name || '', category: pw.category || 'General',
      username: pw.username || '', password: pw.password || '',
      url: pw.url || '', notes: pw.notes || '',
    });
  };

  const handleSaveSharedPw = async () => {
    if (!sharedPwForm.name || !sharedPwForm.password) return toast.error('Name and password required.');
    setSavingSharedPw(true);
    try {
      await axios.put(`${API_CORE}/api/passwords/${editSharedPw.ROWID}`, {
        ...sharedPwForm, folder_id: editSharedPw.folder_id,
      });
      toast.success('Password updated!');
      if (editSharedPw.source === 'team-passwords') invalidateAndRefetch();
      else { invalidateAndRefetch(); setActiveFolderShared(null); }
      setEditSharedPw(null);
    } catch (e) {
      toast.error('Update failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSavingSharedPw(false);
    }
  };

  const handleDeleteSharedPw = async () => {
    if (!deleteSharedPw) return;
    try {
      await axios.delete(`${API_CORE}/api/passwords/${deleteSharedPw.id}`);
      toast.success('Password deleted');
      if (deleteSharedPw.source === 'team-passwords') {
        setSharedPasswords(prev => prev.filter(p => p.password_id !== deleteSharedPw.id));
      } else {
        setActiveFolderShared(prev => prev ? { ...prev, passwords: prev.passwords.filter(p => p.ROWID !== deleteSharedPw.id) } : prev);
      }
      invalidateAndRefetch();
      setDeleteSharedPw(null);
    } catch (e) {
      toast.error('Delete failed: ' + (e.response?.data?.error || e.message));
    }
  };

  const toggleVisible = (id) =>
    setVisibleIds(prev => ({ ...prev, [id]: !prev[id] }));

  const copyPw = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedIds(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setCopiedIds(prev => ({ ...prev, [id]: false })), 1500);
  };

  // ── Team detail view ──
  if (activeTeam) {
    const teamMembers = getTeamMembers(activeTeam.ROWID);
    const nonMembers  = users.filter(u =>
      !teamMembers.find(m => String(m.user_id) === String(u.ROWID)) &&
      !selectedUsers.find(s => String(s.ROWID) === String(u.ROWID))
    );
    const tagSuggestions = nonMembers.filter(u =>
      (u.name || u.email || '').toLowerCase().includes(tagInput.toLowerCase())
    );

    // ── Effective permissions for the logged-in user within this team ──
    const myMembership   = teamMembers.find(m => String(m.user_id) === String(currentUser?.user_id));
    const myPerms         = myMembership?.permissions || {};
    const canAddMember    = isAdmin || !!myPerms.addMember;

    return (
      <div>
        <Toast toasts={toasts} removeToast={removeToast} />

        <div className="page-header flex-between">
          <div>
            <div className="breadcrumb">
              <span className="breadcrumb-link" onClick={() => setActiveTeam(null)}>
                Teams
              </span>
              <RiArrowRightSLine size={16} className="breadcrumb-sep" />
              <span className="breadcrumb-current">{activeTeam.name}</span>
            </div>
            <h1 className="page-title">{activeTeam.name}</h1>
            <p className="page-subtitle">
              {activeTeam.description || 'No description'} · {teamMembers.length} members
            </p>
          </div>
          {canAddMember && activeTab === 'members' && (
            <button className="btn btn-primary" onClick={openAddMemberModal}>
              <RiUserAddLine size={16} /> Add Member
            </button>
          )}
        </div>

        <div className="pw-tabs" style={{ marginBottom: 16 }}>
          <button
            className={`pw-tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            <RiTeamLine size={15} /> Members
            <span className="pw-tab-count">{teamMembers.length}</span>
          </button>
          <button
            className={`pw-tab ${activeTab === 'passwords' ? 'active' : ''}`}
            onClick={() => { setActiveTab('passwords'); setPwPage(1); }}
          >
            <RiKeyLine size={15} /> Shared Passwords
            <span className="pw-tab-count">{sharedPasswords.length}</span>
          </button>
          <button
            className={`pw-tab ${activeTab === 'folders' ? 'active' : ''}`}
            onClick={() => { setActiveTab('folders'); setFolderPage(1); }}
          >
            <RiFolderLine size={15} /> Shared Folders
            <span className="pw-tab-count">{sharedFolders.length}</span>
          </button>
          <button
            className={`pw-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <RiSendPlaneLine size={15} /> Group Chat
          </button>
        </div>

        {activeTab === 'members' && (
          <div className="card">
            {teamMembers.length === 0 ? (
              <div className="empty-state">
                <RiTeamLine size={40} />
                <p>No members in this team yet</p>
                {canAddMember && (
                  <button className="btn btn-primary" onClick={openAddMemberModal}>
                    <RiUserAddLine size={15} /> Add First Member
                  </button>
                )}
              </div>
            ) : (
              <div className="members-list">
                {teamMembers.map((member, i) => {
                  const isSelf = String(member.user_id) === String(currentUser?.user_id);
                  return (
                    <div key={i} className="member-item">
                      <UserAvatar user={member} size={36} fontSize={14} />
                      <div style={{ flex: 1 }}>
                        <div className="td-bold">{member.name || member.email || member.user_id}</div>
                        <div className="td-muted" style={{ fontSize: 12 }}>
                          {member.email || ''}
                        </div>
                      </div>
                      {isSelf ? (
                        <span className="badge badge-info" style={{ fontSize: 11 }}>You</span>
                      ) : (
                        <>
                          <div className="perm-chip-row">
                            {PERM_DEFS.map(p => (
                              <button
                                key={p.key}
                                type="button"
                                className={`perm-chip ${member.permissions?.[p.key] ? 'active' : ''}`}
                                onClick={() => updateMemberPermission(member, p.key)}
                                disabled={!isAdmin}
                                style={!isAdmin ? { cursor: 'default', opacity: member.permissions?.[p.key] ? 1 : 0.5 } : undefined}
                                title={p.label}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          {isAdmin && (
                            <button
                              className="icon-btn danger"
                              onClick={() => handleRemoveMember(activeTeam.ROWID, member.ROWID)}
                              title="Remove member"
                            >
                              <RiCloseLine size={15} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'passwords' && (
          <div className="card">
            <div className="table-toolbar">
              <div className="search-box">
                <RiSearchLine size={16} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search shared passwords..."
                  value={pwSearch}
                  onChange={e => { setPwSearch(e.target.value); setPwPage(1); }}
                  className="search-input"
                />
              </div>
              <button className="btn btn-secondary" onClick={() => fetchSharedPasswords(activeTeam.ROWID)}>
                <RiRefreshLine size={16} />
              </button>
            </div>

            {sharedLoading ? (
              <div className="table-loading">
                {[...Array(3)].map((_, i) => <div key={i} className="skeleton-row" />)}
              </div>
            ) : paginatedPasswords.length === 0 ? (
              <div className="empty-state">
                <RiShieldLine size={40} />
                <p>{pwSearch ? 'No passwords match your search' : 'No passwords shared with this team yet'}</p>
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
                    {paginatedPasswords.map((pw, i) => (
                      <tr key={pw.share_id || i}>
                        <td>
                          <div className="flex gap-8" style={{ alignItems: 'center' }}>
                            <div className="pw-icon"><RiLockLine size={13} /></div>
                            <span className="td-bold">{pw.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-info">{pw.category || 'General'}</span>
                        </td>
                        <td>
                          <div className="shared-by-cell">
                            <UserAvatar user={{ name: pw.shared_by_name, profile_image: pw.shared_by_image }} size={22} fontSize={10} />
                            <span className="shared-by-name">{pw.shared_by_name || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="td-muted">{pw.username || '—'}</td>
                        <td>
                          <div className="pw-field">
                            <span className="pw-value">
                              {visibleIds[i] ? pw.password : '••••••••'}
                            </span>
                            <button className="icon-btn" onClick={() => toggleVisible(i)}>
                              {visibleIds[i] ? <RiEyeOffLine size={13} /> : <RiEyeLine size={13} />}
                            </button>
                            <button className="icon-btn" onClick={() => copyPw(pw.password, i)}>
                              <RiFileCopyLine size={13} />
                            </button>
                            {copiedIds[i] && <span className="copied-badge">Copied!</span>}
                          </div>
                        </td>
                        <td className="td-muted">
                          {pw.url
                            ? <a href={pw.url} target="_blank" rel="noreferrer" className="td-link">
                                {pw.url.replace(/^https?:\/\//, '').slice(0, 22)}
                              </a>
                            : '—'}
                        </td>
                        <td>
                          <div className="flex gap-8" style={{ alignItems: 'center' }}>
                            <RiTimeLine size={13} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {new Date(pw.expiry.replace(' ', 'T') + 'Z').toLocaleDateString()}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="flex gap-8">
                            {(pw.permissions || []).includes('edit') && (
                              <button className="icon-btn" onClick={() => openEditSharedPw(pw, 'team-passwords')}><RiEditLine size={14}/></button>
                            )}
                            {(pw.permissions || []).includes('delete') && (
                              <button className="icon-btn danger" onClick={() => setDeleteSharedPw({ id: pw.password_id, source: 'team-passwords' })}><RiDeleteBinLine size={14}/></button>
                            )}
                            {!(pw.permissions || []).length && (
                              <span className="td-muted" style={{ fontSize: 11 }}>View only</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPwPages > 1 && (
              <div className="pagination">
                <button className="page-btn" disabled={pwPage === 1} onClick={() => setPwPage(p => p - 1)}>Previous</button>
                {[...Array(totalPwPages)].map((_, i) => (
                  <button key={i} className={`page-btn ${pwPage === i + 1 ? 'active' : ''}`} onClick={() => setPwPage(i + 1)}>{i + 1}</button>
                ))}
                <button className="page-btn" disabled={pwPage === totalPwPages} onClick={() => setPwPage(p => p + 1)}>Next</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'folders' && (
          <div className="card">
            {foldersLoading ? (
              <div className="table-loading">
                {[...Array(3)].map((_, i) => <div key={i} className="skeleton-row" />)}
              </div>
            ) : activeFolderShared ? (
              // ── Folder opened ──
              <div>
                <div style={{ marginBottom: 16 }}>
                  <button className="btn btn-secondary" onClick={() => setActiveFolderShared(null)}>
                    <RiArrowLeftLine size={16} /> Back to Folders
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                     <thead>
                      <tr>
                        <th>Name</th><th>Category</th><th>Username</th>
                        <th>Password</th><th>URL</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeFolderShared.passwords || []).map((pw, i) => (
                        <tr key={i}>
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
                              <span className="pw-value">
                                {folderVisible[pw.ROWID] ? pw.password : '••••••••'}
                              </span>
                              <button className="icon-btn"
                                onClick={() => setFolderVisible(prev => ({ ...prev, [pw.ROWID]: !prev[pw.ROWID] }))}>
                                {folderVisible[pw.ROWID] ? <RiEyeOffLine size={13} /> : <RiEyeLine size={13} />}
                              </button>
                              <button className="icon-btn"
                                onClick={() => {
                                  navigator.clipboard.writeText(pw.password);
                                  setFolderCopied(pw.ROWID);
                                  setTimeout(() => setFolderCopied(''), 1500);
                                }}>
                                <RiFileCopyLine size={13} />
                              </button>
                              {folderCopied === pw.ROWID && <span className="copied-badge">Copied!</span>}
                            </div>
                          </td>
                          <td className="td-muted">
                            {pw.url
                              ? <a href={pw.url} target="_blank" rel="noreferrer" className="td-link">
                                  {pw.url.replace(/^https?:\/\//, '').slice(0, 22)}
                                </a>
                              : '—'}
                          </td>
                          <td>
                            <div className="flex gap-8">
                              {(activeFolderShared.permissions || []).includes('edit') && (
                                <button className="icon-btn" onClick={() => openEditSharedPw(pw, 'team-folder')}><RiEditLine size={14}/></button>
                              )}
                              {(activeFolderShared.permissions || []).includes('delete') && (
                                <button className="icon-btn danger" onClick={() => setDeleteSharedPw({ id: pw.ROWID, source: 'team-folder' })}><RiDeleteBinLine size={14}/></button>
                              )}
                              {!(activeFolderShared.permissions || []).length && (
                                <span className="td-muted" style={{ fontSize: 11 }}>View only</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <>
                <div className="table-toolbar">
                  <div className="search-box">
                    <RiSearchLine size={16} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Search shared folders..."
                      value={folderSearch}
                      onChange={e => { setFolderSearch(e.target.value); setFolderPage(1); }}
                      className="search-input"
                    />
                  </div>
                  <button className="btn btn-secondary" onClick={() => fetchSharedFolders(activeTeam.ROWID)}>
                    <RiRefreshLine size={16} />
                  </button>
                </div>

                {filteredFolders.length === 0 ? (
                  <div className="empty-state">
                    <RiFolderLine size={40} />
                    <p>{folderSearch ? 'No folders match your search' : 'No folders shared with this team yet'}</p>
                  </div>
                ) : (
                  <>
                    <div className="folders-grid">
                      {paginatedFolders.map((sf, i) => (
                        <div key={sf.share_id || i} className="folder-card" onClick={() => setActiveFolderShared(sf)}>
                          <div className="folder-card-top">
                            <div className="folder-card-icon"><RiFolderLine size={28} /></div>
                            <span className="badge badge-info" style={{ fontSize: 11 }}>Shared</span>
                          </div>
                          <div className="folder-card-name">{sf.folder_name}</div>
                          <div className="folder-card-meta">
                            <RiKeyLine size={13} /> {sf.password_count} passwords
                          </div>
                          <div className="folder-card-meta" style={{ marginTop: 4 }}>
                            <RiTimeLine size={13} />
                            {sf.expiry
                              ? `Expires ${new Date(sf.expiry.replace(' ', 'T') + 'Z').toLocaleDateString()}`
                              : 'Never expires'}
                          </div>
                          <div className="folder-shared-by">
                            <UserAvatar user={{ name: sf.shared_by_name, profile_image: sf.shared_by_image }} size={20} fontSize={9} />
                            <span className="folder-shared-by-name">
                              Shared by {sf.shared_by_name || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {totalFolderPages > 1 && (
                      <div className="pagination">
                        <button className="page-btn" disabled={folderPage === 1} onClick={() => setFolderPage(p => p - 1)}>Previous</button>
                        {[...Array(totalFolderPages)].map((_, i) => (
                          <button key={i} className={`page-btn ${folderPage === i + 1 ? 'active' : ''}`} onClick={() => setFolderPage(i + 1)}>{i + 1}</button>
                        ))}
                        <button className="page-btn" disabled={folderPage === totalFolderPages} onClick={() => setFolderPage(p => p + 1)}>Next</button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'chat' && (
          <TeamChat
            team={activeTeam}
            currentUser={currentUser}
            members={getTeamMembers(activeTeam.ROWID)}
          />
        )}

        {showAddMember && (
          <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Add Member to {activeTeam.name}</h2>
                <button className="modal-close" onClick={() => setShowAddMember(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Select Users</label>
                  <div className="tag-select">
                    {selectedUsers.map(u => (
                      <span key={u.ROWID} className="tag-select-chip">
                        {u.name || u.email}
                        <span className="tag-select-chip-remove"
                          onClick={() => setSelectedUsers(prev => prev.filter(s => s.ROWID !== u.ROWID))}>
                          <RiCloseLine size={13} />
                        </span>
                      </span>
                    ))}
                    <input
                      className="tag-select-input"
                      placeholder="Type to search users..."
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                    />
                  </div>
                  {tagInput && tagSuggestions.length > 0 && (
                    <div className="tag-select-suggestions">
                      {tagSuggestions.map(u => (
                        <div key={u.ROWID} className="tag-select-suggestion-item"
                          onClick={() => { setSelectedUsers(prev => [...prev, u]); setTagInput(''); }}>
                          <UserAvatar user={u} size={22} fontSize={10} />
                          {u.name || u.email}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Permissions for selected users</label>
                  <div className="perm-chip-row">
                    {PERM_DEFS.map(p => (
                      <button key={p.key} type="button"
                        className={`perm-chip ${newMemberPerms[p.key] ? 'active' : ''}`}
                        onClick={() => setNewMemberPerms(prev => ({ ...prev, [p.key]: !prev[p.key] }))}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddMember(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAddMember} disabled={addingMember}>
                  {addingMember ? 'Adding...' : 'Add Member(s)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {editSharedPw && (
          <div className="modal-overlay" onClick={() => setEditSharedPw(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Edit Shared Password</h2>
                <button className="modal-close" onClick={() => setEditSharedPw(null)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Name *</label>
                    <input className="form-input" value={sharedPwForm.name}
                      onChange={e => setSharedPwForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input className="form-input" value={sharedPwForm.username}
                      onChange={e => setSharedPwForm(f => ({ ...f, username: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password *</label>
                    <input className="form-input" value={sharedPwForm.password}
                      onChange={e => setSharedPwForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                  <div className="form-group form-full">
                    <label className="form-label">URL</label>
                    <input className="form-input" value={sharedPwForm.url}
                      onChange={e => setSharedPwForm(f => ({ ...f, url: e.target.value }))} />
                  </div>
                  <div className="form-group form-full">
                    <label className="form-label">Notes</label>
                    <textarea className="form-input" rows={3} value={sharedPwForm.notes}
                      onChange={e => setSharedPwForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setEditSharedPw(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveSharedPw} disabled={savingSharedPw}>
                  {savingSharedPw ? 'Saving...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteSharedPw && (
          <div className="modal-overlay" onClick={() => setDeleteSharedPw(null)}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Delete Shared Password</h2>
                <button className="modal-close" onClick={() => setDeleteSharedPw(null)}>✕</button>
              </div>
              <div className="modal-body">
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  Deleting removes this password for the owner too — this cannot be undone.
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleteSharedPw(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDeleteSharedPw}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Teams grid view ──
  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">{teams.length} teams in your organization</p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-secondary" onClick={fetchData}>
            <RiRefreshLine size={16} />
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={openAdd}>
              <RiAddLine size={16} /> Create Team
            </button>
          )}
        </div>
      </div>

      <div className="table-toolbar" style={{ marginBottom: 16 }}>
        <div className="search-box">
          <RiSearchLine size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search teams..."
            value={search}
            onChange={e => { setSearch(e.target.value); setTeamPage(1); }}
            className="search-input"
          />
        </div>
        <SortDropdown sortBy={sortBy} setSortBy={setSortBy} onChange={() => setTeamPage(1)} />
      </div>

      {loading ? (
        <div className="folders-grid">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton-card" style={{ height: 160 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <RiTeamLine size={40} />
            <p>{search ? 'No teams match your search' : 'No teams yet'}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="folders-grid">
            {paginatedTeams.map(team => {
              const teamMembers = getTeamMembers(team.ROWID);
              const visibleMembers = teamMembers.slice(0, 4);
              const extraCount = teamMembers.length - 4;
              const isInactive = team.is_active === false;

              const myCardMembership = teamMembers.find(m => String(m.user_id) === String(currentUser?.user_id));
              const canToggleThisTeam = isAdmin || !!myCardMembership?.permissions?.toggleActive;
              const canEditTeam       = isAdmin || !!myCardMembership?.permissions?.edit;
              const canDeleteTeam     = isAdmin || !!myCardMembership?.permissions?.delete;

              return (
                <div
                  key={team.ROWID}
                  className={`folder-card team-card ${isInactive ? 'team-card-inactive' : ''}`}
                  onClick={() => openTeam(team)}
                >
                  <div className="folder-card-top">
                    <div className="team-card-icon">
                      <RiTeamLine size={24} />
                    </div>
                    <div className="team-card-status-row" onClick={e => e.stopPropagation()}>
                      {canToggleThisTeam ? (
                        <label className="form-check form-switch" style={{ margin: 0 }}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            checked={!isInactive}
                            onChange={e => handleToggleTeamActive(team, e)}
                            style={{ cursor: 'pointer' }}
                          />
                        </label>
                      ) : (
                        <span className={`badge ${isInactive ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: 10 }}>
                          {isInactive ? 'Inactive' : 'Active'}
                        </span>
                      )}
                      {isInactive && canToggleThisTeam && (
                        <span className="badge badge-danger team-inactive-badge">
                          <RiPauseCircleLine size={11} /> Inactive
                        </span>
                      )}
                    </div>
                    <div className="folder-card-actions" onClick={e => e.stopPropagation()}>
                      <button className="icon-btn" onClick={() => setInfoTeam(team)} title="Team info">
                        <RiInformationLine size={14} />
                      </button>
                      {canEditTeam && (
                        <button className="icon-btn" onClick={e => openEdit(team, e)} title="Edit">
                          <RiEditLine size={14} />
                        </button>
                      )}
                      {canDeleteTeam && (
                        <button
                          className="icon-btn danger"
                          onClick={e => { e.stopPropagation(); setDeleteId(team.ROWID); }}
                          title="Delete"
                        >
                          <RiDeleteBinLine size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="folder-card-name">{team.name}</div>
                  <div className="team-card-desc">
                    {team.description || 'No description'}
                  </div>

                  <div className="team-card-footer">
                    <div className="team-avatar-stack">
                      {visibleMembers.map((m, i) => (
                        <div
                          key={i}
                          className="team-avatar-stack-item"
                          style={{ zIndex: 10 - i }}
                          title={m.name || m.email}
                        >
                          <UserAvatar user={m} size={28} fontSize={11} />
                        </div>
                      ))}
                      {extraCount > 0 && (
                        <div className="team-avatar-stack-item team-avatar-extra" style={{ zIndex: 1 }}>
                          +{extraCount}
                        </div>
                      )}
                    </div>
                    <span className="team-member-count">
                      {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {totalTeamPages > 1 && (
            <div className="pagination">
              <button className="page-btn" disabled={teamPage === 1} onClick={() => setTeamPage(p => p - 1)}>Previous</button>
              {[...Array(totalTeamPages)].map((_, i) => (
                <button key={i} className={`page-btn ${teamPage === i + 1 ? 'active' : ''}`} onClick={() => setTeamPage(i + 1)}>{i + 1}</button>
              ))}
              <button className="page-btn" disabled={teamPage === totalTeamPages} onClick={() => setTeamPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editItem ? 'Edit Team' : 'Create Team'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Team Name *</label>
                <input className="form-input" placeholder="e.g. Engineering"
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input" rows={3} placeholder="What does this team do?"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editItem ? 'Update' : 'Create Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Team</h2>
              <button className="modal-close" onClick={() => setDeleteId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Are you sure you want to delete this team? All members will be removed.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {infoTeam && (
        <div className="modal-overlay" onClick={() => setInfoTeam(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{infoTeam.name}</h2>
              <button className="modal-close" onClick={() => setInfoTeam(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="info-popup-section">
                <div>
                  <div className="info-popup-label">Created on</div>
                  <div className="td-bold info-popup-value">
                    {infoTeam.created_time ? new Date(infoTeam.created_time).toLocaleString() : '—'}
                  </div>
                </div>
                <div>
                  <div className="info-popup-label">Created by</div>
                  <div className="info-popup-creator-row">
                    <UserAvatar
                      user={{ name: infoTeam.created_by_name, profile_image: infoTeam.created_by_image }}
                      size={30} fontSize={12}
                    />
                    <span className="info-popup-value">
                      {String(infoTeam.created_by) === String(currentUser?.user_id)
                        ? 'You'
                        : (infoTeam.created_by_name || 'Unknown')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Teams;