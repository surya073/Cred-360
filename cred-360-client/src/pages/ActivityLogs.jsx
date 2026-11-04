import React, { useEffect, useState, useCallback } from 'react';
import axios from '../services/api';
import Toast, { useToast } from '../components/Toast';
import { Confirm, useConfirm } from '../components/Confirm';
import { useAuth } from '../context/AuthContext';
import DataTable from '../components/DataTable';
import { formatDateTime, formatRelative, dayRangeUtc } from '../utils/dateHelper';
import {
  RiHistoryLine, RiRefreshLine, RiSearchLine,
  RiKeyLine, RiShareLine, RiDeleteBinLine,
  RiEditLine, RiUserAddLine, RiBellLine,
  RiTimeLine, RiCloseLine, RiBarChartBoxLine,
  RiCheckboxMultipleLine,
} from 'react-icons/ri';

const API = '/server/cred_360_people_function';

const getActionIcon = (action) => {
  if (!action) return <RiBellLine size={14} />;
  const a = action.toLowerCase();
  if (a.includes('created'))  return <RiKeyLine size={14} />;
  if (a.includes('share'))    return <RiShareLine size={14} />;
  if (a.includes('deleted'))  return <RiDeleteBinLine size={14} />;
  if (a.includes('updated'))  return <RiEditLine size={14} />;
  if (a.includes('invited'))  return <RiUserAddLine size={14} />;
  if (a.includes('viewed'))   return <RiTimeLine size={14} />;
  if (a.includes('revoked'))  return <RiDeleteBinLine size={14} />;
  if (a.includes('role'))     return <RiUserAddLine size={14} />;
  if (a.includes('folder'))   return <RiHistoryLine size={14} />;
  if (a.includes('team'))     return <RiHistoryLine size={14} />;
  if (a.includes('expiry'))   return <RiTimeLine size={14} />;
  return <RiBellLine size={14} />;
};

const getActionColor = (action) => {
  if (!action) return { bg: '#f0f9ff', color: '#0284c7' };
  const a = action.toLowerCase();
  if (a.includes('created'))  return { bg: '#f0fdf4', color: '#16a34a' };
  if (a.includes('share'))    return { bg: '#fdf4ff', color: '#7c3aed' };
  if (a.includes('deleted'))  return { bg: '#fef2f2', color: '#dc2626' };
  if (a.includes('updated'))  return { bg: '#fffbeb', color: '#d97706' };
  if (a.includes('revoked'))  return { bg: '#fef2f2', color: '#dc2626' };
  if (a.includes('viewed'))   return { bg: '#f0f9ff', color: '#0284c7' };
  if (a.includes('invited'))  return { bg: '#f0fdf4', color: '#16a34a' };
  if (a.includes('role'))     return { bg: '#fffbeb', color: '#d97706' };
  if (a.includes('folder'))   return { bg: '#fdf4ff', color: '#7c3aed' };
  if (a.includes('team'))     return { bg: '#f0f9ff', color: '#0284c7' };
  if (a.includes('expiry'))   return { bg: '#fef2f2', color: '#dc2626' };
  return { bg: '#f0f9ff', color: '#0284c7' };
};

const formatDetails = (action, details, userEmail) => {
  if (!details) return '—';
  if (details.includes('Viewed via token')) {
    return userEmail ? `Viewed by ${userEmail}` : 'Viewed by external user';
  }
  if (details.includes('Shared with') && /\d{17}/.test(details)) {
    return details.replace(/\d{17}/g, 'a team');
  }
  if (details.includes('Folder shared with') && /\d{17}/.test(details)) {
    return details.replace(/\d{17}/g, 'a team');
  }
  if (details.includes('Share') && details.includes('revoked') && /\d{17}/.test(details)) {
    return 'Share access revoked';
  }
  return details;
};

const ACTION_FILTERS = [
  { value: 'all',      label: 'All Actions'     },
  { value: 'created',  label: 'Created'         },
  { value: 'updated',  label: 'Updated'         },
  { value: 'deleted',  label: 'Deleted'         },
  { value: 'share',    label: 'Shared'          },
  { value: 'revoked',  label: 'Revoked'         },
  { value: 'viewed',   label: 'Viewed'          },
  { value: 'external', label: 'External Shares' },
  { value: 'folder',   label: 'Folders'         },
  { value: 'team',     label: 'Teams'           },
  { value: 'invited',  label: 'User Invited'    },
  { value: 'role',     label: 'Role Changes'    },
  { value: 'expiry',   label: 'Expiry'          },
];

// ── Detail rows inside offcanvas ─────────────────────────────────────────────
const DetailRow = ({ label, value }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', gap: 3,
    padding: '12px 0',
    borderBottom: '0.5px solid var(--border-color)',
  }}>
    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {label}
    </span>
    <span style={{ fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
      {value || '—'}
    </span>
  </div>
);

// ── Simple horizontal bar row for analytics ──────────────────────────────────
const BarRow = ({ label, count, max, highlight }) => (
  <div className="analytics-bar-row">
    <div className="analytics-bar-label">
      {label} {highlight && <span className="analytics-bar-you">(You)</span>}
    </div>
    <div className="analytics-bar-track">
      <div
        className="analytics-bar-fill"
        style={{ width: `${max ? Math.max((count / max) * 100, 4) : 0}%` }}
      />
    </div>
    <div className="analytics-bar-count">{count}</div>
  </div>
);

const ActivityLogs = () => {
  const { toasts, removeToast, toast } = useToast();
  const { user } = useAuth();
const { confirmState, confirm, handleCancel, handleConfirm, setLoading: setConfirmLoading } = useConfirm();
  const [activeTab, setActiveTab] = useState('table'); // 'table' | 'analytics'

  const [selectedLog, setSelectedLog] = useState(null); // offcanvas

  const [scope, setScope]         = useState('mine'); // 'mine' | 'org'
  const [isAdmin, setIsAdmin]     = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting]   = useState(false);
  const [reload, setReload]       = useState(0);      // bump to re-query the table

  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Ajax page loader for <DataTable> — only the visible page is fetched.
  const fetchPage = useCallback(async ({ page, pageSize, search, from, to, filters }) => {
    try {
      const range = dayRangeUtc(from, to);
      const res = await axios.get(`${API}/api/activity-logs`, {
        params: {
          scope, page, limit: pageSize, search,
          action: filters?.action && filters.action !== 'all' ? filters.action : undefined,
          from: range.from || undefined, to: range.to || undefined,
        },
      });
      if (!res.data.success) return { rows: [], total: 0 };
      if (typeof res.data.isAdmin === 'boolean') setIsAdmin(res.data.isAdmin);
      return { rows: res.data.data || [], total: res.data.total ?? (res.data.data || []).length };
    } catch (e) {
      toast.error('Failed to load activity logs');
      return { rows: [], total: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await axios.get(`${API}/api/activity-logs/analytics`);
      if (res.data.success) {
        setAnalytics(res.data);
        setIsAdmin(res.data.isAdmin);
      }
    } catch(e) {
      toast.error('Failed to load analytics');
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => { setSelectedIds([]); }, [scope]);
  useEffect(() => { if (activeTab === 'analytics') fetchAnalytics(); }, [activeTab, fetchAnalytics]);

  // Lock body scroll when offcanvas is open
  useEffect(() => {
    if (selectedLog) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [selectedLog]);

  const getUserDisplay = (log) => {
    if (!log.user_email) return null; // external user
    if (user?.email_id && log.user_email === user.email_id) return 'You';
    return log.user_email.split('@')[0];
  };

  const columns = [
    {
      key: 'action', label: 'Action',
      render: (log) => {
        const color = getActionColor(log.action);
        return (
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <div className="pw-icon" style={{ background: color.bg, color: color.color }}>
              {getActionIcon(log.action)}
            </div>
            <span className="td-bold">{log.action}</span>
          </div>
        );
      },
    },
    {
      key: 'details', label: 'Details',
      render: (log) => (
        <span className="td-muted" style={{
          display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260,
        }}>
          {formatDetails(log.action, log.details, log.user_email)}
        </span>
      ),
    },
    {
      key: 'user_email', label: 'User',
      render: (log) => {
        const display = getUserDisplay(log);
        if (!display) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>External</span>;
        return display === 'You' ? <span className="badge badge-info">You</span> : <span className="td-muted">{display}</span>;
      },
    },
    {
      key: 'when', label: 'When',
      render: (log) => (
        <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
          {formatRelative(log.created_time, '')}
        </span>
      ),
    },
    {
      key: 'created_time', label: 'Date & Time',
      render: (log) => <span className="td-muted" style={{ fontSize: 12.5 }}>{formatDateTime(log.created_time)}</span>,
    },
  ];

const handleBulkDelete = async () => {
  if (selectedIds.length === 0) return;

  const ok = await confirm(
    `The selected activity log${selectedIds.length > 1 ? 's' : ''} will be permanently removed. This cannot be undone.`,
    {
      title: `Delete ${selectedIds.length} log${selectedIds.length > 1 ? 's' : ''}?`,
      type: 'danger',
      confirmLabel: 'Delete',
    }
  );
  if (!ok) return;

  setConfirmLoading(true);   // ← renamed
  setDeleting(true);
  try {
    const res = await axios.post(`${API}/api/activity-logs/bulk-delete`, { ids: selectedIds });
    if (res.data.success) {
      toast.success(`Deleted ${res.data.deleted} log${res.data.deleted > 1 ? 's' : ''}`);
      setSelectedIds([]);
      setReload(n => n + 1);
    }
  } catch(e) {
    toast.error(e.response?.data?.error || 'Failed to delete logs');
  } finally {
    setDeleting(false);
  }
};

  const maxUserCount = analytics?.byUser?.[0]?.count || 0;
  const maxActionCount = analytics?.byAction?.[0]?.count || 0;

  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />
      <Confirm confirmState={confirmState} onCancel={handleCancel} onConfirm={handleConfirm} />

      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Activity Logs</h1>
          <p className="page-subtitle">Complete audit trail of all actions in CRED 360.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => activeTab === 'table' ? setReload(n => n + 1) : fetchAnalytics()}>
          <RiRefreshLine size={16} />
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="log-tabs">
        <button
          className={`log-tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          <RiHistoryLine size={15} /> Activity Table
        </button>
        <button
          className={`log-tab ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <RiBarChartBoxLine size={15} /> Analytics
        </button>
      </div>

      {activeTab === 'table' && (
        <DataTable
          columns={columns}
          fetchPage={fetchPage}
          refreshKey={`${scope}-${reload}`}
          dateField="created_time"
          searchPlaceholder="Search action, user or details…"
          filters={[{ key: 'action', label: 'All Actions', options: ACTION_FILTERS.filter(f => f.value !== 'all') }]}
          selectable
          selected={selectedIds}
          onSelectedChange={setSelectedIds}
          onRowClick={setSelectedLog}
          emptyIcon={<RiHistoryLine size={34} />}
          emptyText="No activity yet"
          defaultPageSize={15}
          toolbarExtra={isAdmin && (
            <div className="scope-toggle">
              <span className={scope === 'mine' ? 'active' : ''}>Mine</span>
              <label className="form-check form-switch" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={scope === 'org'}
                  onChange={() => setScope(s => (s === 'mine' ? 'org' : 'mine'))}
                />
              </label>
              <span className={scope === 'org' ? 'active' : ''}>Organization</span>
            </div>
          )}
          bulkActions={() => (
            <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={deleting}>
              <RiDeleteBinLine size={14} />
              {deleting ? 'Deleting...' : `Delete (${selectedIds.length})`}
            </button>
          )}
        />
      )}

      {activeTab === 'analytics' && (
        <div className="card">
          {analyticsLoading ? (
            <div className="table-loading">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton-row" />)}
            </div>
          ) : !analytics ? (
            <div className="empty-state">
              <RiBarChartBoxLine size={40} />
              <p>No analytics available yet</p>
            </div>
          ) : (
            <>
              <div className="analytics-summary-row">
                <div className="analytics-summary-card">
                  <span className="analytics-summary-value">{analytics.totalLogs}</span>
                  <span className="analytics-summary-label">
                    {analytics.isAdmin ? 'Total Org Activity' : 'Your Total Activity'}
                  </span>
                </div>
                <div className="analytics-summary-card">
                  <span className="analytics-summary-value">{analytics.byAction?.length || 0}</span>
                  <span className="analytics-summary-label">Distinct Action Types</span>
                </div>
                {analytics.isAdmin && (
                  <div className="analytics-summary-card">
                    <span className="analytics-summary-value">{analytics.byUser?.length || 0}</span>
                    <span className="analytics-summary-label">Active Members</span>
                  </div>
                )}
              </div>

              <div className="settings-divider" />

              {analytics.isAdmin && (
                <>
                  <div className="settings-section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RiCheckboxMultipleLine size={13} /> Activity by Member
                  </div>
                  <div className="analytics-bar-list">
                    {analytics.byUser.map(u => (
                      <BarRow
                        key={u.email}
                        label={u.email === 'External' ? 'External Users' : u.email}
                        count={u.count}
                        max={maxUserCount}
                        highlight={u.email === analytics.currentUserEmail}
                      />
                    ))}
                  </div>
                  <div className="settings-divider" />
                </>
              )}

              <div className="settings-section-label">Activity by Action Type</div>
              <div className="analytics-bar-list">
                {analytics.byAction.map(a => (
                  <BarRow
                    key={a.action}
                    label={a.action.charAt(0).toUpperCase() + a.action.slice(1)}
                    count={a.count}
                    max={maxActionCount}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Offcanvas backdrop ── */}
      <div
        className={`offcanvas-backdrop ${selectedLog ? 'open' : ''}`}
        onClick={() => setSelectedLog(null)}
      />

      {/* ── Offcanvas panel ── */}
      <div className={`offcanvas-panel ks-oc ${selectedLog ? 'open' : ''}`} style={{ overflowY: 'auto' }}>
        <div className="ks-oc-head" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '0.5px solid var(--border-color)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {selectedLog && (() => {
              const color = getActionColor(selectedLog.action);
              return (
                <div className="pw-icon" style={{ background: color.bg, color: color.color, width: 32, height: 32 }}>
                  {getActionIcon(selectedLog.action)}
                </div>
              );
            })()}
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--text-primary)' }}>
                {selectedLog?.action || 'Log Detail'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                Activity detail
              </p>
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setSelectedLog(null)}
            style={{ flexShrink: 0 }}
          >
            <RiCloseLine size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 24px' }}>
          {selectedLog && (
            <>
              <DetailRow label="Action"  value={selectedLog.action} />
              <DetailRow
                label="Details"
                value={formatDetails(selectedLog.action, selectedLog.details, selectedLog.user_email)}
              />
              <DetailRow
                label="User"
                value={getUserDisplay(selectedLog) === 'You' ? `You (${selectedLog.user_email})` : (selectedLog.user_email || 'External user')}
              />
              <DetailRow
                label="Time"
                value={formatDateTime(selectedLog.created_time)}
              />
              <DetailRow label="Time ago" value={formatRelative(selectedLog.created_time)} />
              {selectedLog.password_id && (
                <DetailRow label="Reference ID" value={selectedLog.password_id} />
              )}
            </>
          )}
        </div>

        <div style={{
          padding: '14px 20px',
          borderTop: '0.5px solid var(--border-color)',
          flexShrink: 0,
        }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setSelectedLog(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActivityLogs;