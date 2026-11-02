import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  RiLockPasswordLine, RiKeyLine, RiTimeLine,
  RiUserLine, RiLinksLine, RiEyeLine, RiEyeOffLine,
  RiFileCopyLine, RiShieldKeyholeLine, RiErrorWarningLine,
  RiFolderLine
} from 'react-icons/ri';

const API = '/server/cred_360_function';

const PublicShare = () => {
  const { token } = useParams();
  const [step, setStep]             = useState('loading');
  const [share, setShare]           = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');
  const [verifying, setVerifying]   = useState(false);
  const [timeLeft, setTimeLeft]     = useState('');

  const [visibleIds, setVisibleIds] = useState({});
  const [copiedIds, setCopiedIds]   = useState({});
  const [editingIndex, setEditingIndex] = useState(null); // null | 'single' | number (folder pw index)
  const [editForm, setEditForm]         = useState({});
  const [savingEdit, setSavingEdit]     = useState(false);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState(null);

  useEffect(() => { validateToken(); }, [token]);

  useEffect(() => {
    if (!result?.expiry) return;
    const interval = setInterval(() => {
      const diff = new Date(result.expiry.replace(' ', 'T') + 'Z') - new Date();
      if (diff <= 0) { setStep('expired'); clearInterval(interval); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [result]);

  const validateToken = async () => {
    try {
      const res = await axios.get(`${API}/api/shares/validate/${token}`);
      if (res.data.success) {
        setShare(res.data.share);
        setStep('passphrase');
      }
    } catch(e) {
      const msg = e.response?.data?.error || '';
      setStep(msg.includes('expired') ? 'expired' : 'invalid');
    }
  };

  const handleVerify = async () => {
    if (!passphrase) return setError('Please enter the passphrase.');
    setVerifying(true);
    setError('');
    try {
      const res = await axios.post(`${API}/api/shares/verify-passphrase`, { token, passphrase });
      if (res.data.success) {
        setResult(res.data);
        setStep('revealed');
      }
    } catch(e) {
      const msg = e.response?.data?.error || 'Verification failed';
      if (msg.includes('expired')) setStep('expired');
      else setError(msg);
    } finally {
      setVerifying(false);
    }
  };

  const toggleVisible = (key) =>
    setVisibleIds(prev => ({ ...prev, [key]: !prev[key] }));

  const canEdit   = (result?.permissions || []).includes('edit');
  const canDelete = (result?.permissions || []).includes('delete');

  const startEdit = (idx, pw) => {
    setEditingIndex(idx);
    setEditForm({
      name: pw.name, username: pw.username || '', password: pw.password,
      url: pw.url || '', notes: pw.notes || '', category: pw.category || '',
    });
  };

  const saveEdit = async (idx, pw) => {
    setSavingEdit(true);
    try {
      const isFolder = result.share_type === 'external_folder';
      await axios.put(`${API}/api/external/password/${token}`, {
        passphrase, password_id: isFolder ? pw.ROWID : undefined, ...editForm,
      });
      setResult(prev => isFolder
        ? { ...prev, passwords: prev.passwords.map((p, i) => i === idx ? { ...p, ...editForm } : p) }
        : { ...prev, password: { ...prev.password, ...editForm } });
      setEditingIndex(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async (idx, pw) => {
    try {
      const isFolder = result.share_type === 'external_folder';
      await axios.post(`${API}/api/external/password/${token}/delete`, {
        passphrase, password_id: isFolder ? pw.ROWID : undefined,
      });
      if (isFolder) {
        setResult(prev => ({ ...prev, passwords: prev.passwords.filter((_, i) => i !== idx) }));
        setConfirmDeleteIndex(null);
      } else {
        setStep('deleted');
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed');
      setConfirmDeleteIndex(null);
    }
  };

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedIds(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopiedIds(prev => ({ ...prev, [key]: false })), 1500);
  };

  if (step === 'loading') return (
    <div className="public-share-page">
      <div className="public-share-card">
        <div className="public-share-logo">
          <RiShieldKeyholeLine size={28} />
        </div>
        <p className="public-share-loading">Validating secure link...</p>
      </div>
    </div>
  );

  if (step === 'expired') return (
    <div className="public-share-page">
      <div className="public-share-card">
        <div className="public-share-logo expired">
          <RiTimeLine size={28} />
        </div>
        <h2 className="public-share-title">Link Expired</h2>
        <p className="public-share-sub">
          This secure link has expired. Please request a new link from the sender.
        </p>
      </div>
    </div>
  );

   if (step === 'deleted') return (
    <div className="public-share-page">
      <div className="public-share-card">
        <div className="public-share-logo success">
          <RiKeyLine size={28} />
        </div>
        <h2 className="public-share-title">Password Deleted</h2>
        <p className="public-share-sub">This password has been removed and is no longer available.</p>
      </div>
    </div>
  );

  if (step === 'invalid') return (
    <div className="public-share-page">
      <div className="public-share-card">
        <div className="public-share-logo invalid">
          <RiErrorWarningLine size={28} />
        </div>
        <h2 className="public-share-title">Invalid Link</h2>
        <p className="public-share-sub">
          This link is invalid or does not exist.
        </p>
      </div>
    </div>
  );

  if (step === 'passphrase') return (
    <div className="public-share-page">
      <div className="public-share-card">
        <div className="public-share-logo">
          {share?.share_type === 'external_folder'
            ? <RiFolderLine size={28} />
            : <RiShieldKeyholeLine size={28} />
          }
        </div>
        <h2 className="public-share-title">
          {share?.share_type === 'external_folder'
            ? 'Secure Folder Access'
            : 'Secure Password Access'}
        </h2>
        <p className="public-share-sub">
          {share?.share_type === 'external_folder'
            ? 'A folder has been securely shared with you. Enter the passphrase to view all passwords inside.'
            : 'A password has been securely shared with you. Enter the passphrase to reveal it.'}
        </p>

        {share?.description && (
          <div className="public-share-desc">{share.description}</div>
        )}

        <div className="public-share-form">
          <div className="form-group">
            <label className="form-label">
              <RiLockPasswordLine size={13} style={{ marginRight: 4 }} />
              Enter Passphrase
            </label>
            <input
              className="form-input"
              type="password"
              placeholder="Enter passphrase from email"
              value={passphrase}
              onChange={e => { setPassphrase(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleVerify()}
              autoFocus
            />
            {error && <span className="public-share-error">{error}</span>}
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            onClick={handleVerify}
            disabled={verifying}
          >
            <RiKeyLine size={15} />
            {verifying ? 'Verifying...' : share?.share_type === 'external_folder'
              ? 'View Folder Passwords'
              : 'Reveal Password'}
          </button>
        </div>

        <div className="public-share-expiry">
          <RiTimeLine size={13} />
          Expires: {share?.expiry
            ? new Date(share.expiry.replace(' ', 'T') + 'Z').toLocaleString()
            : '—'}
        </div>

        <div className="public-share-footer">
          <RiShieldKeyholeLine size={13} />
          Secured by CRED-360
        </div>
      </div>
    </div>
  );

  if (step === 'revealed') {
    const isFolder = result?.share_type === 'external_folder';

    return (
      <div className="public-share-page">
        <div className="public-share-card" style={{ maxWidth: isFolder ? 600 : 440 }}>
          <div className="public-share-logo success">
            {isFolder ? <RiFolderLine size={28} /> : <RiKeyLine size={28} />}
          </div>

          <h2 className="public-share-title">
            {isFolder ? result.folder_name : 'Password Revealed'}
          </h2>

          {timeLeft && (
            <div className="public-share-countdown">
              <RiTimeLine size={14} />
              Expires in <strong>{timeLeft}</strong>
            </div>
          )}

          {isFolder ? (
            <div className="public-folder-cards">
              {result.passwords.map((pw, i) => (
                <div key={i} className="public-pw-card">
                  <div className="public-pw-card-header">
                    <div className="public-pw-card-name">
                      <RiKeyLine size={14} />
                      {pw.name}
                    </div>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      {pw.category && (
                        <span className="badge badge-info" style={{ fontSize: 11 }}>{pw.category}</span>
                      )}
                      {canEdit && (
                        <button className="icon-btn" title="Edit" onClick={() => startEdit(i, pw)}>
                          <RiKeyLine size={13} />
                        </button>
                      )}
                      {canDelete && (
                        <button className="icon-btn danger" title="Delete" onClick={() => setConfirmDeleteIndex(i)}>
                          <RiErrorWarningLine size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {editingIndex === i ? (
                    <div className="public-share-fields">
                      <div className="form-group">
                        <label className="form-label">Name</label>
                        <input className="form-input" value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Username</label>
                        <input className="form-input" value={editForm.username}
                          onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Password</label>
                        <input className="form-input" value={editForm.password}
                          onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} />
                      </div>
                      <div className="flex gap-8" style={{ marginTop: 8 }}>
                        <button className="btn btn-secondary" onClick={() => setEditingIndex(null)}>Cancel</button>
                        <button className="btn btn-primary" disabled={savingEdit} onClick={() => saveEdit(i, pw)}>
                          {savingEdit ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : confirmDeleteIndex === i ? (
                    <div className="public-share-fields">
                      <p style={{ fontSize: 13, color: 'var(--danger)' }}>Delete this password? This cannot be undone.</p>
                      <div className="flex gap-8">
                        <button className="btn btn-secondary" onClick={() => setConfirmDeleteIndex(null)}>Cancel</button>
                        <button className="btn btn-danger" onClick={() => confirmDelete(i, pw)}>Delete</button>
                      </div>
                    </div>
                  ) : (

                  <div className="public-share-fields">
                    {pw.username && (
                      <div className="public-share-field">
                        <span className="public-share-field-label">
                          <RiUserLine size={13} /> Username
                        </span>
                        <div className="public-share-field-copy">
                          <span className="public-share-field-value">{pw.username}</span>
                          <button className="icon-btn"
                            onClick={() => copyText(pw.username, `u-${i}`)}>
                            <RiFileCopyLine size={13} />
                          </button>
                          {copiedIds[`u-${i}`] && <span className="copied-badge">Copied!</span>}
                        </div>
                      </div>
                    )}

                    <div className="public-share-field">
                      <span className="public-share-field-label">
                        <RiLockPasswordLine size={13} /> Password
                      </span>
                      <div className="public-share-field-copy">
                        <span className="public-share-field-value mono">
                          {visibleIds[i] ? pw.password : '••••••••••••'}
                        </span>
                        <button className="icon-btn" onClick={() => toggleVisible(i)}>
                          {visibleIds[i] ? <RiEyeOffLine size={13} /> : <RiEyeLine size={13} />}
                        </button>
                        <button className="icon-btn"
                          onClick={() => copyText(pw.password, `p-${i}`)}>
                          <RiFileCopyLine size={13} />
                        </button>
                        {copiedIds[`p-${i}`] && <span className="copied-badge">Copied!</span>}
                      </div>
                    </div>

                    {pw.url && (
                      <div className="public-share-field">
                        <span className="public-share-field-label">
                          <RiLinksLine size={13} /> URL
                        </span>
                        <a href={pw.url} target="_blank" rel="noreferrer"
                          className="public-share-field-value td-link">
                          {pw.url.replace(/^https?:\/\//, '').slice(0, 30)}
                        </a>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              ))}
            </div>
          ) : editingIndex === 'single' ? (
            <div className="public-share-fields">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="form-input" value={editForm.username}
                  onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" value={editForm.password}
                  onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">URL</label>
                <input className="form-input" value={editForm.url}
                  onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div className="flex gap-8" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => setEditingIndex(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={savingEdit} onClick={() => saveEdit('single', result.password)}>
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : confirmDeleteIndex === 'single' ? (
            <div className="public-share-fields">
              <p style={{ fontSize: 13, color: 'var(--danger)' }}>Delete this password? This cannot be undone.</p>
              <div className="flex gap-8">
                <button className="btn btn-secondary" onClick={() => setConfirmDeleteIndex(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={() => confirmDelete('single', result.password)}>Delete</button>
              </div>
            </div>
          ) : (
            <div className="public-share-fields">
              <div className="public-share-field">
                <span className="public-share-field-label">
                  <RiKeyLine size={13} /> Name
                </span>
                <span className="public-share-field-value">{result.password.name}</span>
              </div>

              {result.password.username && (
                <div className="public-share-field">
                  <span className="public-share-field-label">
                    <RiUserLine size={13} /> Username
                  </span>
                  <div className="public-share-field-copy">
                    <span className="public-share-field-value">{result.password.username}</span>
                    <button className="icon-btn" onClick={() => copyText(result.password.username, 'username')}>
                      <RiFileCopyLine size={13} />
                    </button>
                    {copiedIds['username'] && <span className="copied-badge">Copied!</span>}
                  </div>
                </div>
              )}

              <div className="public-share-field">
                <span className="public-share-field-label">
                  <RiLockPasswordLine size={13} /> Password
                </span>
                <div className="public-share-field-copy">
                  <span className="public-share-field-value mono">
                    {visibleIds['pw'] ? result.password.password : '••••••••••••'}
                  </span>
                  <button className="icon-btn" onClick={() => toggleVisible('pw')}>
                    {visibleIds['pw'] ? <RiEyeOffLine size={13} /> : <RiEyeLine size={13} />}
                  </button>
                  <button className="icon-btn" onClick={() => copyText(result.password.password, 'password')}>
                    <RiFileCopyLine size={13} />
                  </button>
                  {copiedIds['password'] && <span className="copied-badge">Copied!</span>}
                </div>
              </div>

              {result.password.url && (
                <div className="public-share-field">
                  <span className="public-share-field-label">
                    <RiLinksLine size={13} /> URL
                  </span>
                  <a href={result.password.url} target="_blank" rel="noreferrer"
                    className="public-share-field-value td-link">
                    {result.password.url}
                  </a>
                </div>
              )}

              {result.password.notes && (
                <div className="public-share-field">
                  <span className="public-share-field-label">Notes</span>
                  <span className="public-share-field-value">{result.password.notes}</span>
                </div>
              )}
              {(canEdit || canDelete) && (
                <div className="flex gap-8" style={{ marginTop: 10 }}>
                  {canEdit && (
                    <button className="btn btn-secondary" onClick={() => startEdit('single', result.password)}>Edit</button>
                  )}
                  {canDelete && (
                    <button className="btn btn-danger" onClick={() => setConfirmDeleteIndex('single')}>Delete</button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="public-share-footer">
            <RiShieldKeyholeLine size={13} />
            Secured by CRED-360 — Do not share this information further
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default PublicShare;
