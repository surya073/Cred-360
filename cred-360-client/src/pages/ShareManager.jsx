import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Toast, { useToast } from '../components/Toast';
import {
  RiShareLine, RiRefreshLine, RiDeleteBinLine,
  RiUserLine, RiTeamLine, RiGlobalLine,
  RiFolderLine, RiKeyLine, RiTimeLine,
  RiEyeLine, RiSearchLine, RiShieldLine
} from 'react-icons/ri';

const API = '/server/cred_360_function';

const SHARE_TYPE_ICON = {
  user:            <RiUserLine size={14} />,
  team:            <RiTeamLine size={14} />,
  external:        <RiGlobalLine size={14} />,
  folder:          <RiFolderLine size={14} />,
  external_folder: <RiFolderLine size={14} />,
};

const SHARE_TYPE_LABEL = {
  user:            'User',
  team:            'Team',
  external:        'External',
  folder:          'Folder',
  external_folder: 'External Folder',
};

const SHARE_TYPE_COLOR = {
  user: {
    bg: 'rgba(59, 130, 246, 0.12)',
    color: '#2563eb',
    border: 'rgba(59, 130, 246, 0.25)',
  },

  team: {
    bg: 'rgba(34, 197, 94, 0.12)',
    color: '#16a34a',
    border: 'rgba(34, 197, 94, 0.25)',
  },

  external: {
    bg: 'rgba(168, 85, 247, 0.12)',
    color: '#9333ea',
    border: 'rgba(168, 85, 247, 0.25)',
  },

  folder: {
    bg: 'rgba(234, 179, 8, 0.14)',
    color: '#ca8a04',
    border: 'rgba(234, 179, 8, 0.28)',
  },

  external_folder: {
    bg: 'rgba(249, 115, 22, 0.14)',
    color: '#ea580c',
    border: 'rgba(249, 115, 22, 0.28)',
  },
};

const timeLeft = (expiry) => {
  if (!expiry) return 'No Expiry';
  const diff = new Date(expiry.replace(' ', 'T') + 'Z') - new Date();
  if (diff <= 0) return 'Expired';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h % 24}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
};

const ShareManager = () => {
  const { toasts, removeToast, toast } = useToast();

  const [shares, setShares]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [revokeId, setRevokeId] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/shares/my`);
      if (res.data.success) setShares(res.data.data || []);
    } catch(e) {
      toast.error('Failed to load shares');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchShares(); }, [fetchShares]);

  useEffect(() => { setPage(1); }, [search, filter, pageSize]);

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await axios.delete(`${API}/api/shares/${revokeId}/revoke`);
      toast.success('Share revoked successfully');
      setRevokeId(null);
      fetchShares();
   } catch(e) {
  toast.error('Revoke failed: ' + (e.response?.data?.error || e.message));
    }finally {
      setRevoking(false);
    }
  };

  const filtered = shares
    .filter(s => {
      if (filter === 'active')  return !s.is_expired;
      if (filter === 'expired') return s.is_expired;
      return true;
    })
    .filter(s =>
      s.shared_with_label?.toLowerCase().includes(search.toLowerCase()) ||
      s.password_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.folder_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.share_type?.toLowerCase().includes(search.toLowerCase())
    );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  const activeCount  = shares.filter(s => !s.is_expired).length;
  const expiredCount = shares.filter(s => s.is_expired).length;
  const viewedCount  = shares.filter(s =>
    s.is_viewed === 'true' || s.is_viewed === true
  ).length;

  const renderPageButtons = () => {
    const buttons = [];
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= page - 1 && i <= page + 1)
      ) {
        buttons.push(
          <button
            key={i}
            className={`page-btn ${page === i ? 'active' : ''}`}
            onClick={() => setPage(i)}
          >
            {i}
          </button>
        );
      } else if (i === page - 2 || i === page + 2) {
        buttons.push(
          <span key={i} style={{ color: 'var(--text-muted)', padding: '0 2px' }}>
            ...
          </span>
        );
      }
    }
    return buttons;
  };

  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Share Manager</h1>
          <p className="page-subtitle">Manage and revoke all your active shares</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchShares}>
          <RiRefreshLine size={16} /> 
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#eff6ff18', color: '#2563eb' }}>
            <RiShareLine size={20} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{shares.length}</div>
            <div className="stat-label">Total Shares</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#f0fdf415', color: '#16a34a' }}>
            <RiShieldLine size={20} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{activeCount}</div>
            <div className="stat-label">Active</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef2f217', color: '#dc2626' }}>
            <RiTimeLine size={20} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{expiredCount}</div>
            <div className="stat-label">Expired</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fdf4ff1c', color: '#7c3aed' }}>
            <RiEyeLine size={20} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{viewedCount}</div>
            <div className="stat-label">Viewed</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div className="search-box">
            <RiSearchLine size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search shares..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="flex gap-8">
            <select
              className="filter-select"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">All shares</option>
              <option value="active">Active only</option>
              <option value="expired">Expired only</option>
            </select>
            <select
              className="filter-select"
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
            >
              <option value={5}>5 / page</option>
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="table-loading">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <RiShareLine size={40} />
            <p>{search ? 'No shares match your search' : 'No shares created yet'}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shared Item</th>
                    <th>Shared With</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Viewed</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((share) => {
                    const typeStyle = SHARE_TYPE_COLOR[share.share_type] || SHARE_TYPE_COLOR.user;
                    const isFolder  = share.share_type === 'folder' ||
                                      share.share_type === 'external_folder';
                    const itemName  = isFolder ? share.folder_name : share.password_name;
                    const isViewed  = share.is_viewed === 'true' || share.is_viewed === true;

                    return (
                      <tr key={share.ROWID}>
                        <td>
                          <div className="flex gap-8" style={{ alignItems: 'center' }}>
                            <div className="pw-icon" style={{
                              background: typeStyle.bg,
                              color: typeStyle.color,
                            }}>
                              {isFolder
                                ? <RiFolderLine size={13} />
                                : <RiKeyLine size={13} />}
                            </div>
                            <span className="td-bold">{itemName || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="td-muted">{share.shared_with_label || share.shared_with}</td>
                        <td>
                          <span className="badge" style={{
                            background: typeStyle.bg,
                            color: typeStyle.color,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}>
                            {SHARE_TYPE_ICON[share.share_type]}
                            {SHARE_TYPE_LABEL[share.share_type] || share.share_type}
                          </span>
                        </td>
                        <td>
                          {share.is_expired
                            ? <span className="badge badge-danger">Expired</span>
                            : !share.item_is_active
                              ? <span className="badge badge-warning">Item Inactive</span>
                              : <span className="badge badge-success">Active</span>
                          }
                        </td>
                        <td>
                          {isViewed
                            ? <span className="badge badge-info">Viewed</span>
                            : <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>Not viewed</span>
                          }
                        </td>
                        <td>
                          <div style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: share.is_expired
                              ? 'var(--danger)'
                              : 'var(--text-primary)',
                          }}>
                            {timeLeft(share.expiry)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {share.expiry
                              ? new Date(share.expiry.replace(' ', 'T') + 'Z').toLocaleDateString()
                              : '—'}
                          </div>
                        </td>
                        <td>
                          {!share.is_expired && (
                            <button
                              className="icon-btn danger"
                              onClick={() => setRevokeId(share.ROWID)}
                              title="Revoke share"
                            >
                              <RiDeleteBinLine size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-row">
              <div className="pagination-info">
                Showing{' '}
                {Math.min((page - 1) * pageSize + 1, filtered.length)}–
                {Math.min(page * pageSize, filtered.length)}{' '}
                of {filtered.length} shares
              </div>
              <div className="flex gap-8" style={{ alignItems: 'center' }}>
                <div className="pagination">
                  <button
                    className="page-btn"
                    disabled={page === 1}
                    onClick={() => setPage(1)}
                    title="First"
                  >«</button>
                  <button
                    className="page-btn"
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                  >Previous</button>

                  {renderPageButtons()}

                  <button
                    className="page-btn"
                    disabled={page === totalPages}
                    onClick={() => setPage(p => p + 1)}
                  >Next</button>
                  <button
                    className="page-btn"
                    disabled={page === totalPages}
                    onClick={() => setPage(totalPages)}
                    title="Last"
                  >»</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {revokeId && (
        <div className="modal-overlay" onClick={() => setRevokeId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Revoke Share</h2>
              <button className="modal-close" onClick={() => setRevokeId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
                Are you sure you want to revoke this share?
              </p>
              <div className="share-info-box">
                <RiShieldLine size={14} />
                The recipient will immediately lose access to this shared password.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRevokeId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleRevoke}
                disabled={revoking}
              >
                {revoking ? 'Revoking...' : 'Revoke Access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShareManager;
