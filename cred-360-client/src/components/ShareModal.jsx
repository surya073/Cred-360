import React, { useState, useEffect, useRef } from 'react';
import axios from '../services/api';
import Toast, { useToast } from './Toast';
import {
  RiUserLine, RiTeamLine, RiGlobalLine,
  RiTimeLine, RiLockPasswordLine, RiMailLine,
  RiShareLine, RiCloseLine, RiAddLine,
  RiCheckLine, RiDeleteBinLine, RiShieldCheckLine,
} from 'react-icons/ri';

const API          = '/server/cred_360_function';
const API_EXTRAS   = '/server/cred_360_extras_function';
const API_PEOPLES  = '/server/cred_360_people_function';

const EXPIRY_OPTIONS = [
  { label: '10 minutes', minutes: 10       },
  { label: '40 minutes', minutes: 40       },
  { label: '1 hour',     minutes: 60       },
  { label: '1 day',      minutes: 1440     },
  { label: 'Custom',     minutes: 'custom' },
  { label: 'Never',      minutes: 'never'  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
const isExpired = (expiry) => expiry && new Date(expiry.replace(' ', 'T') + 'Z') < new Date();

const expiryLabel = (expiry) => {
  if (!expiry) return { text: 'Never expires', color: 'var(--success)' };
  const diff = Math.ceil((new Date(expiry.replace(' ', 'T') + 'Z') - new Date()) / 86_400_000);
  if (diff <= 0)  return { text: 'Expired',          color: 'var(--danger)'  };
  if (diff <= 1)  return { text: 'Expires today',    color: 'var(--danger)'  };
  if (diff <= 7)  return { text: `${diff}d left`,    color: 'var(--warning)' };
  return           { text: `${diff}d left`,           color: 'var(--success)' };
};

// ── TagSelect ─────────────────────────────────────────────────────────────────
const TagSelect = ({ options, selected, onChange, placeholder, valueKey, labelKey }) => {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o =>
    (o[labelKey] || '').toLowerCase().includes(query.toLowerCase()) &&
    !selected.find(s => s[valueKey] === o[valueKey])
  );

  return (
    <div className="tag-select" ref={ref}>
      <div className={`tag-select-box ${open ? 'focused' : ''}`} onClick={() => setOpen(true)}>
        {selected.map(item => (
          <span key={item[valueKey]} className="tag-chip">
            {item[labelKey]}
            <button className="tag-chip-remove"
              onClick={e => { e.stopPropagation(); onChange(selected.filter(s => s[valueKey] !== item[valueKey])); }}>
              <RiCloseLine size={12} />
            </button>
          </span>
        ))}
        <input
          className="tag-select-input"
          placeholder={selected.length === 0 ? placeholder : ''}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="tag-dropdown">
          {filtered.map(item => (
            <div key={item[valueKey]} className="tag-dropdown-item"
              onClick={() => { onChange([...selected, item]); setQuery(''); }}>
              <div className="tag-dropdown-avatar">{(item[labelKey] || '').charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{item[labelKey]}</div>
                {item.email && item.email !== item[labelKey] && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.email}</div>
                )}
              </div>
              <RiCheckLine size={14} style={{ marginLeft: 'auto', color: 'var(--primary)' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── PermissionCheckboxes ──────────────────────────────────────────────────────
const PermissionCheckboxes = ({ permissions, onChange }) => {
  const toggle = (perm) =>
    onChange(permissions.includes(perm) ? permissions.filter(p => p !== perm) : [...permissions, perm]);

  return (
    <div className="form-group" style={{ marginBottom: 14 }}>
      <label className="form-label">
        <RiShieldCheckLine size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Permissions
      </label>
      <div style={{ display: 'flex', gap: 18 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          <input type="checkbox" checked disabled style={{ width: 14, height: 14 }} />
          View
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={permissions.includes('edit')}
            onChange={() => toggle('edit')} style={{ width: 14, height: 14 }} />
          Edit
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={permissions.includes('delete')}
            onChange={() => toggle('delete')} style={{ width: 14, height: 14 }} />
          Delete
        </label>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
        View access is always granted. Check Edit/Delete to allow those actions too.
      </span>
    </div>
  );
};

// ── EmailTagInput ─────────────────────────────────────────────────────────────
const EmailTagInput = ({ emails, onChange, contacts = [] }) => {
  const [input, setInput]     = useState('');
  const [error, setError]     = useState('');
  const [open, setOpen]       = useState(false);
  const wrapRef = useRef(null);

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addEmail = (emailToAdd) => {
    const trimmed = (emailToAdd ?? input).trim();
    if (!trimmed) return;
    if (!isValidEmail(trimmed)) { setError('Invalid email address'); return; }
    if (emails.includes(trimmed)) { setError('Email already added'); return; }
    onChange([...emails, trimmed]);
    setInput(''); setError(''); setOpen(false);
  };

  const suggestions = contacts
    .filter(c => c.status !== 'blocked' && !emails.includes(c.email))
    .filter(c => {
      if (!input.trim()) return true;
      const q = input.toLowerCase();
      return (c.email || '').toLowerCase().includes(q) ||
             (c.name  || '').toLowerCase().includes(q) ||
             (c.company || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (b.is_favorite === true) - (a.is_favorite === true))
    .slice(0, 6);

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <div className="email-tag-box">
        {emails.map(email => (
          <span key={email} className="tag-chip tag-chip-email">
            {email}
            <button className="tag-chip-remove" onClick={() => onChange(emails.filter(e => e !== email))}>
              <RiCloseLine size={12} />
            </button>
          </span>
        ))}
        <div className="email-tag-input-row">
          <input
            className="email-tag-input"
            type="email"
            placeholder="client@company.com"
            value={input}
            onFocus={() => setOpen(true)}
            onChange={e => { setInput(e.target.value); setError(''); setOpen(true); }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmail(); }
              if (e.key === 'Backspace' && !input && emails.length > 0)
                onChange(emails.slice(0, -1));
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button className="btn btn-secondary" style={{ padding: '6px 10px', flexShrink: 0 }}
            onClick={() => addEmail()} type="button"><RiAddLine size={16} /></button>
        </div>
      </div>

      {open && suggestions.length > 0 && (
        <div className="email-suggest-dropdown">
          {suggestions.map(c => (
            <div
              key={c.ROWID}
              className="email-suggest-item"
              onClick={() => addEmail(c.email)}
            >
              <div className="email-suggest-avatar">
                {(c.name || c.email || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="email-suggest-name">
                  {c.name || c.email}
                  {c.is_favorite && <RiCheckLine size={11} style={{ marginLeft: 5, color: 'var(--primary)' }} />}
                </div>
                <div className="email-suggest-sub">
                  {c.email}{c.company ? ` — ${c.company}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <span style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4, display: 'block' }}>{error}</span>}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
        Type to search contacts, or press Enter to add a new email
      </span>
    </div>
  );
};


// ── Already Shared List ───────────────────────────────────────────────────────
const AlreadySharedList = ({ shares, shareType, users, teams, onRevoke, revoking }) => {
  const [expanded, setExpanded] = useState(false);

  const relevant = shares.filter(s => {
    if (shareType === 'user')     return s.share_type === 'user';
    if (shareType === 'team')     return s.share_type === 'team';
    if (shareType === 'external') return s.share_type === 'external';
    return false;
  });

  if (relevant.length === 0) return null;

  const resolveLabel = (share) => {
    if (share.share_type === 'user' || share.share_type === 'external') {
      return share.shared_with;
    }
    if (share.share_type === 'team') {
      const t = teams.find(t => String(t.ROWID) === String(share.shared_with));
      return t ? t.name : `Team #${share.shared_with}`;
    }
    return share.shared_with;
  };

  const formatSharedAt = (createdTime) => {
    if (!createdTime) return null;
    const d = new Date(createdTime.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          marginBottom: 8, fontSize: 12, fontWeight: 600,
          color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
        }}
      >
        <RiShieldCheckLine size={13} />
        Already shared ({relevant.length})
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {expanded ? '▲ Collapse' : '▼ Expand'}
        </span>
      </button>

      {expanded && (
        <div className="already-shared-grid">
          {relevant.map(share => {
            const label      = resolveLabel(share);
            const exp        = expiryLabel(share.expiry);
            const expired    = isExpired(share.expiry);
            const isRevoking = revoking === share.ROWID;
            const sharedAt   = formatSharedAt(share.created_time);

            return (
              <div key={share.ROWID} className={`already-shared-card ${expired ? 'expired' : ''}`}>
                <div className="already-shared-card-top">
                  <div className="already-shared-avatar">
                    {(label || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="already-shared-label">{label}</div>
                    <div style={{ fontSize: 11, color: exp.color, marginTop: 1 }}>
                      {exp.text}
                      {(share.is_viewed === 'true' || share.is_viewed === true) ? ' · Viewed' : ''}
                    </div>
                  </div>
                  <button
                    className="icon-btn danger"
                    title="Revoke access"
                    disabled={isRevoking}
                    onClick={() => onRevoke(share.ROWID)}
                    style={{ flexShrink: 0, opacity: isRevoking ? 0.5 : 1 }}
                  >
                    {isRevoking ? <span style={{ fontSize: 10 }}>…</span> : <RiDeleteBinLine size={13} />}
                  </button>
                </div>

                <div className="already-shared-badges">
                  <span className="badge" style={{ fontSize: 9, padding: '1px 6px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>View</span>
                  {(share.permissions || []).includes('edit') && (
                    <span className="badge" style={{ fontSize: 9, padding: '1px 6px', background: 'var(--success-bg)', color: 'var(--success)' }}>Edit</span>
                  )}
                  {(share.permissions || []).includes('delete') && (
                    <span className="badge" style={{ fontSize: 9, padding: '1px 6px', background: '#fef2f2', color: 'var(--danger)' }}>Delete</span>
                  )}
                  {sharedAt && (
                    <span className="badge already-shared-date-badge">
                      <RiTimeLine size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                      {sharedAt}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Expiry fields — shared across tabs ───────────────────────────────────────
const ExpiryFields = ({ expiryOption, setExpiryOption, customMinutes, setCustomMinutes, label }) => (
  <>
    <div className="form-group" style={{ marginBottom: 14 }}>
      <label className="form-label">
        <RiTimeLine size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        {label || 'Access expires in'}
      </label>
      <select className="form-input" value={expiryOption} onChange={e => setExpiryOption(e.target.value)}>
        {EXPIRY_OPTIONS.map(o => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
      </select>
    </div>
    {expiryOption === 'custom' && (
      <div className="form-group" style={{ marginBottom: 14 }}>
        <label className="form-label">Custom expiry (minutes)</label>
        <input className="form-input" type="number" placeholder="e.g. 120" min="1"
          value={customMinutes} onChange={e => setCustomMinutes(e.target.value)} />
      </div>
    )}
  </>
);

// ── Main ShareModal ───────────────────────────────────────────────────────────
const ShareModal = ({ password, onClose }) => {
  const { toasts, removeToast, toast } = useToast();

  const [shareType, setShareType]         = useState('user');
  const [users, setUsers]                 = useState([]);
  const [teams, setTeams]                 = useState([]);
  const [existingShares, setExistingShares] = useState([]); // ← all shares for this password
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [expiryOption, setExpiryOption]   = useState('60');
  const [customMinutes, setCustomMinutes] = useState('');
  const [permissions, setPermissions]     = useState([]);
  const [sharing, setSharing]             = useState(false);
  const [revoking, setRevoking]           = useState(null); // ROWID being revoked
  const [loadingInit, setLoadingInit]     = useState(true);

  const [clientEmails, setClientEmails]   = useState([]);
  const [description, setDescription]     = useState('');
  const [externalContacts, setExternalContacts] = useState([]);
  const [generatedPassphrase, setGeneratedPassphrase] = useState('');
  const [sharedCount, setSharedCount]     = useState(0);
  const [showSuccess, setShowSuccess]     = useState(false);
  const [copiedPassphrase, setCopiedPassphrase] = useState(false);

  // ── Single fetch on mount: users + teams + existing shares ──
  useEffect(() => {
    const init = async () => {
      setLoadingInit(true);
      try {
        const [uRes, tRes, sRes, eRes] = await Promise.all([
          axios.get(`${API_PEOPLES}/api/users`),
          axios.get(`${API_PEOPLES}/api/teams`),
          axios.get(`${API}/api/shares/my`),
          axios.get(`${API_EXTRAS}/api/external-users?view=mine`),
        ]);
        if (uRes.data.success) setUsers(uRes.data.data || []);
        if (tRes.data.success) setTeams(tRes.data.data || []);
        if (sRes.data.success) {
          // filter to only shares belonging to this specific password
          const mine = (sRes.data.data || []).filter(
            s => String(s.password_id) === String(password.ROWID) &&
                 !['folder','external_folder'].includes(s.share_type)
          );
          setExistingShares(mine);
        }
        if (eRes.data.success) setExternalContacts(eRes.data.data || []);
      } catch (e) {
        toast.error('Failed to load share data');
      } finally {
        setLoadingInit(false);
      }
    };
    init();
  }, []);

  const getExpiryDate = () => {
    if (expiryOption === 'never') return null;
    const mins = expiryOption === 'custom' ? parseInt(customMinutes) || 60 : parseInt(expiryOption);
    return new Date(Date.now() + mins * 60000).toISOString().slice(0, 19).replace('T', ' ');
  };

  // ── Revoke ──
  const handleRevoke = async (shareRowId) => {
    setRevoking(shareRowId);
    try {
      await axios.delete(`${API}/api/shares/${shareRowId}/revoke`);
      setExistingShares(prev => prev.filter(s => s.ROWID !== shareRowId));
      toast.success('Access revoked');
    } catch (e) {
      toast.error('Revoke failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setRevoking(null);
    }
  };

  // ── Internal share ──
  const handleInternalShare = async () => {
    const targets = shareType === 'user' ? selectedUsers : selectedTeams;
    if (targets.length === 0) return toast.error(`Please select at least one ${shareType}`);
    if (expiryOption === 'custom' && !customMinutes) return toast.error('Please enter custom expiry minutes.');
    setSharing(true);
    try {
      const expiry = getExpiryDate();
      const results = await Promise.all(
        targets.map(target =>
          axios.post(`${API}/api/shares`, {
            password_id:  password.ROWID,
            shared_with:  shareType === 'user' ? target.email : target.ROWID,
            share_type:   shareType,
            expiry,
            permissions,
            created_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
          })
        )
      );
      // Add new shares to local state — no refetch needed
     const newShares = results.map((r, i) => ({
        ROWID:       r.data.data?.ROWID || Date.now() + i,
        password_id: password.ROWID,
        shared_with: shareType === 'user' ? targets[i].email : targets[i].ROWID,
        share_type:  shareType,
        expiry,
        is_viewed:   false,
        permissions: [...permissions],
      }));
      setExistingShares(prev => [...prev, ...newShares]);
      setSelectedUsers([]);
      setSelectedTeams([]);
      setPermissions([]);

      toast.success(`Password shared with ${targets.length} ${shareType}${targets.length > 1 ? 's' : ''}!`);
    } catch (e) {
      toast.error('Share failed: ' + e.message);
    } finally {
      setSharing(false);
    }
  };

  // ── External share ──
  const handleExternalShare = async () => {
    if (clientEmails.length === 0) return toast.error('Please add at least one client email.');
    if (expiryOption === 'custom' && !customMinutes) return toast.error('Please enter custom expiry minutes.');
    setSharing(true);
    try {
      const expiry = getExpiryDate();
      const responses = await Promise.all(
        clientEmails.map(email =>
          axios.post(`${API}/api/shares/external`, {
            password_id: password.ROWID, client_email: email, description, expiry, permissions,
          })
        )
      );
      // Append to local existing shares
     const newShares = clientEmails.map((email, i) => ({
        ROWID:       responses[i]?.data?.token || Date.now() + i,
        password_id: password.ROWID,
        shared_with: email,
        share_type:  'external',
        expiry,
        is_viewed:   false,
        permissions: [...permissions],
        created_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }));
      setExistingShares(prev => [...prev, ...newShares]);
      setGeneratedPassphrase(responses[0]?.data?.passphrase || '');
      setSharedCount(clientEmails.length);
      setClientEmails([]);
      setPermissions([]);
      setShowSuccess(true);
      
    } catch (e) {
      toast.error('External share failed: ' + e.message);
    } finally {
      setSharing(false);
    }
  };

  const userOptions = users.map(u => ({ ROWID: u.ROWID, label: u.name || u.email, email: u.email, value: u.email }));
  const teamOptions = teams.map(t => ({ ROWID: t.ROWID, label: t.name, value: t.ROWID }));
  const tabs = [
    { id: 'user',     label: 'User',     icon: <RiUserLine size={15} />   },
    { id: 'team',     label: 'Team',     icon: <RiTeamLine size={15} />   },
    { id: 'external', label: 'External', icon: <RiGlobalLine size={15} /> },
  ];

  return (
    <>
      <Toast toasts={toasts} removeToast={removeToast} />
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-xl" onClick={e => e.stopPropagation()}>

          <div className="modal-header">
            <div>
              <h2 className="modal-title">
                <RiShareLine size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Share Password
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {password.name}
                {existingShares.length > 0 && (
                  <span style={{
                    marginLeft: 8, fontSize: 11,
                    background: 'var(--primary-light)', color: 'var(--primary)',
                    padding: '1px 7px', borderRadius: 20, fontWeight: 600,
                  }}>
                    {existingShares.length} active share{existingShares.length > 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
            <button className="modal-close" onClick={onClose}><RiCloseLine size={16} /></button>
          </div>

          <div className="modal-body">
            {loadingInit ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Loading share data…
              </div>
            ) : (
              <>
                {/* ── Tabs ── */}
                <div className="share-type-tabs" style={{ marginBottom: 20 }}>
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      className={`share-tab ${shareType === tab.id ? 'active' : ''}`}
                      onClick={() => { setShareType(tab.id); setSelectedUsers([]); setSelectedTeams([]); setPermissions([]); }}
                    >
                      {tab.icon} {tab.label}
                      {/* badge count per tab */}
                      {existingShares.filter(s =>
                        tab.id === 'user'     ? s.share_type === 'user'     :
                        tab.id === 'team'     ? s.share_type === 'team'     :
                        s.share_type === 'external'
                      ).length > 0 && (
                        <span style={{
                          marginLeft: 5, fontSize: 10, fontWeight: 700,
                          background: 'var(--primary)', color: '#fff',
                          borderRadius: 20, padding: '0 5px', lineHeight: '16px',
                          display: 'inline-block',
                        }}>
                          {existingShares.filter(s =>
                            tab.id === 'user'     ? s.share_type === 'user'     :
                            tab.id === 'team'     ? s.share_type === 'team'     :
                            s.share_type === 'external'
                          ).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* ── User tab ── */}
                {shareType === 'user' && (
                  <>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label className="form-label">Select Users</label>
                      <TagSelect
                        options={userOptions}
                        selected={selectedUsers}
                        onChange={setSelectedUsers}
                        placeholder="Search and select users..."
                        valueKey="value" labelKey="label"
                      />
                      {selectedUsers.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                          {selectedUsers.length} user{selectedUsers.length > 1 ? 's' : ''} selected
                        </span>
                      )}
                    </div>
                    <AlreadySharedList
                      shares={existingShares} shareType="user"
                      users={users} teams={teams}
                      onRevoke={handleRevoke} revoking={revoking}
                    />
                    <PermissionCheckboxes permissions={permissions} onChange={setPermissions} />
                    <ExpiryFields expiryOption={expiryOption} setExpiryOption={setExpiryOption}
                      customMinutes={customMinutes} setCustomMinutes={setCustomMinutes} />
                    <div className="share-info-box">
                      <RiLockPasswordLine size={14} />
                      Password accessible until expiry for all selected users
                    </div>
                  </>
                )}

                {/* ── Team tab ── */}
                {shareType === 'team' && (
                  <>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label className="form-label">Select Teams</label>
                      <TagSelect
                        options={teamOptions}
                        selected={selectedTeams}
                        onChange={setSelectedTeams}
                        placeholder="Search and select teams..."
                        valueKey="value" labelKey="label"
                      />
                      {selectedTeams.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                          {selectedTeams.length} team{selectedTeams.length > 1 ? 's' : ''} selected
                        </span>
                      )}
                    </div>
                    <AlreadySharedList
                      shares={existingShares} shareType="team"
                      users={users} teams={teams}
                      onRevoke={handleRevoke} revoking={revoking}
                    />
                    <PermissionCheckboxes permissions={permissions} onChange={setPermissions} />
                    <ExpiryFields expiryOption={expiryOption} setExpiryOption={setExpiryOption}
                      customMinutes={customMinutes} setCustomMinutes={setCustomMinutes} />
                    <div className="share-info-box">
                      <RiLockPasswordLine size={14} />
                      All team members will have access until expiry
                    </div>
                  </>
                )}

               {/* ── External tab ── */}
                {shareType === 'external' && (
                  <>
                    {externalContacts.filter(c => c.status !== 'blocked' && !clientEmails.includes(c.email)).length > 0 && (
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label className="form-label" style={{ fontSize: 11 }}>Known external contacts</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {externalContacts
                            .filter(c => c.status !== 'blocked' && !clientEmails.includes(c.email))
                            .sort((a, b) => (b.is_favorite === true) - (a.is_favorite === true))
                            .slice(0, 8)
                            .map(c => (
                             <button
                              key={c.ROWID}
                              type="button"
                              className={`tag-chip ${c.is_favorite ? 'tag-chip-favorite' : ''}`}
                              style={{ cursor: 'pointer', background: c.is_favorite ? 'var(--primary-light)' : 'var(--bg-secondary)' }}
                              onClick={() => setClientEmails(prev => [...prev, c.email])}
                              title={c.company ? `${c.email} — ${c.company}` : c.email}
                            >
                              {c.is_favorite && <RiCheckLine size={11} style={{ marginRight: 3, color: 'var(--primary)' }} />}
                              {c.name || c.email}
                              <RiAddLine size={12} style={{ marginLeft: 4 }} />
                            </button>
                            ))}
                        </div>
                      </div>
                    )}
                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label className="form-label">
                        <RiMailLine size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Client Emails *
                      </label>
                      <EmailTagInput emails={clientEmails} onChange={setClientEmails} contacts={externalContacts} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label className="form-label">Description</label>
                      <input className="form-input" placeholder="What is this password for?"
                        value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                    <AlreadySharedList
                      shares={existingShares} shareType="external"
                      users={users} teams={teams}
                      onRevoke={handleRevoke} revoking={revoking}
                    />
                    <PermissionCheckboxes permissions={permissions} onChange={setPermissions} />
                    <ExpiryFields expiryOption={expiryOption} setExpiryOption={setExpiryOption}
                      customMinutes={customMinutes} setCustomMinutes={setCustomMinutes}
                      label="Link expires in" />
                    <div className="share-info-box">
                      <RiMailLine size={14} />
                      Each client gets a separate email with unique passphrase
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary"
              onClick={shareType === 'external' ? handleExternalShare : handleInternalShare}
              disabled={sharing || loadingInit}>
              <RiShareLine size={15} />
              {sharing ? 'Sharing...' : 'Share Password'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Success modal ── */}
      {showSuccess && (
        <div className="modal-overlay" onClick={() => setShowSuccess(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Password Shared Successfully</h2>
              <button className="modal-close" onClick={() => setShowSuccess(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'var(--success-bg)', color: 'var(--success)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px', fontSize: 26,
                }}>✓</div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Email sent to <strong style={{ color: 'var(--text-primary)' }}>
                    {sharedCount} recipient{sharedCount > 1 ? 's' : ''}
                  </strong>
                </p>
                {sharedCount > 1 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Each recipient received a unique passphrase
                  </p>
                )}
              </div>
              <div style={{
                background: 'var(--primary-light)', border: '2px solid var(--primary)',
                borderRadius: 'var(--radius-lg)', padding: '20px', textAlign: 'center', marginBottom: 14,
              }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
                  {sharedCount > 1 ? 'Sample Passphrase (first recipient)' : 'Generated Passphrase'}
                </p>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)', letterSpacing: '3px', fontFamily: 'monospace', marginBottom: 14 }}>
                  {generatedPassphrase}
                </div>
                <button className="btn btn-primary" style={{ fontSize: 13 }}
                  onClick={() => {
                    navigator.clipboard.writeText(generatedPassphrase);
                    setCopiedPassphrase(true);
                    setTimeout(() => setCopiedPassphrase(false), 2000);
                  }}>
                  {copiedPassphrase ? '✓ Copied!' : 'Copy Passphrase'}
                </button>
              </div>
              <div className="share-info-box">
                <RiMailLine size={14} />
                Passphrases are included in each client's email
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowSuccess(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ShareModal;