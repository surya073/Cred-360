import React, { useEffect, useState, useCallback } from 'react';
import axios from '../services/api';
import Toast, { useToast } from '../components/Toast';
import DataTable from '../components/DataTable';
import { formatDate, formatDateTime } from '../utils/dateHelper';
import {
  RiShareLine, RiRefreshLine, RiDeleteBinLine,
  RiUserLine, RiTeamLine, RiGlobalLine,
  RiFolderLine, RiKeyLine, RiTimeLine,
  RiEyeLine, RiShieldLine
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
  const [revokeId, setRevokeId] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing,  setClearing]  = useState(false);
  const [revoking, setRevoking] = useState(false);

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

  const handleClearExpired = async () => {
    setClearing(true);
    try {
      const res = await axios.delete(`${API}/api/shares/expired/mine`);
      toast.success(`Cleared ${res.data.removed ?? 0} expired share(s)`);
      setClearOpen(false);
      fetchShares();
    } catch(e) {
      toast.error('Clear failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setClearing(false);
    }
  };

  const rows = React.useMemo(() => shares.map(s => {
    const isFolder = s.share_type === 'folder' || s.share_type === 'external_folder';
    return { ...s, _item: (isFolder ? s.folder_name : s.password_name) || 'Unknown', _who: s.shared_with_label || s.shared_with || '' };
  }), [shares]);

  const activeCount  = shares.filter(s => !s.is_expired).length;
  const expiredCount = shares.filter(s => s.is_expired).length;
  const viewedCount  = shares.filter(s =>
    s.is_viewed === 'true' || s.is_viewed === true
  ).length;

  const columns = [
    {
      key: '_item', label: 'Shared Item', sortable: true,
      render: (share) => {
        const typeStyle = SHARE_TYPE_COLOR[share.share_type] || SHARE_TYPE_COLOR.user;
        const isFolder  = share.share_type === 'folder' || share.share_type === 'external_folder';
        return (
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <div className="pw-icon" style={{ background: typeStyle.bg, color: typeStyle.color }}>
              {isFolder ? <RiFolderLine size={13} /> : <RiKeyLine size={13} />}
            </div>
            <span className="td-bold">{share._item}</span>
          </div>
        );
      },
    },
    { key: '_who', label: 'Shared With', sortable: true, render: (s) => <span className="td-muted">{s._who}</span> },
    {
      key: 'share_type', label: 'Type', sortable: true,
      render: (share) => {
        const typeStyle = SHARE_TYPE_COLOR[share.share_type] || SHARE_TYPE_COLOR.user;
        return (
          <span className="badge" style={{ background: typeStyle.bg, color: typeStyle.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {SHARE_TYPE_ICON[share.share_type]}
            {SHARE_TYPE_LABEL[share.share_type] || share.share_type}
          </span>
        );
      },
    },
    {
      key: 'status', label: 'Status',
      render: (share) => share.is_expired
        ? <span className="badge badge-danger">Expired</span>
        : !share.item_is_active
          ? <span className="badge badge-warning">Item Inactive</span>
          : <span className="badge badge-success">Active</span>,
    },
    {
      key: 'is_viewed', label: 'Viewed',
      render: (share) => (share.is_viewed === 'true' || share.is_viewed === true)
        ? <span className="badge badge-info">Viewed</span>
        : <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>Not viewed</span>,
    },
    {
      key: 'expiry', label: 'Expires', sortable: true,
      sortValue: (s) => (s.expiry ? new Date(s.expiry.replace(' ', 'T') + 'Z').getTime() : Infinity),
      render: (share) => (
        <>
          <div style={{ fontSize: 12, fontWeight: 500, color: share.is_expired ? 'var(--danger)' : 'var(--text-primary)' }}>
            {timeLeft(share.expiry)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {share.expiry ? formatDateTime(share.expiry) : '—'}
          </div>
        </>
      ),
    },
    {
      key: 'created_time', label: 'Shared On', sortable: true,
      render: (s) => <span className="td-muted" style={{ fontSize: 12.5 }}>{formatDate(s.created_time)}</span>,
    },
    {
      key: 'actions', label: 'Actions', align: 'right',
      render: (share) => !share.is_expired && (
        <button className="icon-btn danger" onClick={() => setRevokeId(share.ROWID)} title="Revoke share">
          <RiDeleteBinLine size={15} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Share Manager</h1>
          <p className="page-subtitle">Manage and revoke all your active shares</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {expiredCount > 0 && (
            <button className="btn btn-danger" onClick={() => setClearOpen(true)}>
              <RiDeleteBinLine size={16} /> Clear {expiredCount} expired
            </button>
          )}
          <button className="btn btn-secondary" onClick={fetchShares}>
            <RiRefreshLine size={16} />
          </button>
        </div>
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

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        dateField="created_time"
        searchKeys={['_item', '_who', 'share_type']}
        searchPlaceholder="Search item, recipient or type…"
        filters={[
          { key: 'status', label: 'All status', options: [{ value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }],
            match: (r, v) => (v === 'expired' ? !!r.is_expired : !r.is_expired) },
          { key: 'share_type', label: 'All types', options: Object.keys(SHARE_TYPE_LABEL).map(k => ({ value: k, label: SHARE_TYPE_LABEL[k] })) },
        ]}
        onRefresh={fetchShares}
        emptyIcon={<RiShareLine size={34} />}
        emptyText="No shares created yet"
      />

      {clearOpen && (
        <div className="modal-overlay" onClick={() => !clearing && setClearOpen(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Clear expired shares</h2>
              <button className="modal-close" onClick={() => setClearOpen(false)} disabled={clearing}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
                Remove all {expiredCount} expired shares you created?
              </p>
              <div className="share-info-box">
                <RiShieldLine size={14} />
                Expired shares already grant no access. This only removes the records, including their viewed history.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setClearOpen(false)} disabled={clearing}>Cancel</button>
              <button className="btn btn-danger" onClick={handleClearExpired} disabled={clearing}>
                {clearing ? 'Clearing...' : 'Clear expired'}
              </button>
            </div>
          </div>
        </div>
      )}

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
