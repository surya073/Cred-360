import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import Toast, { useToast } from '../components/Toast';
import { Confirm, useConfirm } from '../components/Confirm';
import { useAuth } from '../context/AuthContext';
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

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z');
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
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

  const [logs, setLogs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('all');
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(15);
  const [selectedLog, setSelectedLog] = useState(null); // offcanvas

  const [scope, setScope]         = useState('mine'); // 'mine' | 'org'
  const [isAdmin, setIsAdmin]     = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting]   = useState(false);

  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const fetchLogs = useCallback(async (scopeParam) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/activity-logs`, { params: { scope: scopeParam } });
      if (res.data.success) {
        setLogs(res.data.data || []);
        if (typeof res.data.isAdmin === 'boolean') setIsAdmin(res.data.isAdmin);
      }
    } catch(e) {
      toast.error('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => { fetchLogs(scope); }, [scope, fetchLogs]);
  useEffect(() => { setPage(1); setSelectedIds([]); }, [search, filter, pageSize, scope]);
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

  const filtered = logs
    .filter(l => {
      if (filter === 'all') return true;
      return l.action?.toLowerCase().includes(filter);
    })
    .filter(l =>
      l.action?.toLowerCase().includes(search.toLowerCase()) ||
      l.user_email?.toLowerCase().includes(search.toLowerCase()) ||
      l.details?.toLowerCase().includes(search.toLowerCase())
    );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  const allOnPageSelected = paginated.length > 0 && paginated.every(l => selectedIds.includes(l.ROWID));

  const toggleSelectAllOnPage = () => {
    if (allOnPageSelected) {
      setSelectedIds(prev => prev.filter(id => !paginated.some(l => l.ROWID === id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...paginated.map(l => l.ROWID)])));
    }
  };

  const toggleSelectOne = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

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
      fetchLogs(scope);
    }
  } catch(e) {
    toast.error(e.response?.data?.error || 'Failed to delete logs');
  } finally {
    setDeleting(false);
  }
};

  const renderPageButtons = () => {
    const buttons = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
        buttons.push(
          <button key={i} className={`page-btn ${page === i ? 'active' : ''}`} onClick={() => setPage(i)}>
            {i}
          </button>
        );
      } else if (i === page - 2 || i === page + 2) {
        buttons.push(<span key={i} style={{ color: 'var(--text-muted)', padding: '0 2px' }}>...</span>);
      }
    }
    return buttons;
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
        <button className="btn btn-secondary" onClick={() => activeTab === 'table' ? fetchLogs(scope) : fetchAnalytics()}>
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
        <div className="card">
          <div className="table-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="search-box">
              <RiSearchLine size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search logs..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="search-input"
              />
            </div>

            <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {isAdmin && (
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

              {selectedIds.length > 0 && (
                <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={deleting}>
                  <RiDeleteBinLine size={14} />
                  {deleting ? 'Deleting...' : `Delete (${selectedIds.length})`}
                </button>
              )}

              <select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)}>
                {ACTION_FILTERS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select className="filter-select" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                <option value={10}>10 / page</option>
                <option value={15}>15 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="table-loading">
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton-row" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <RiHistoryLine size={40} />
              <p>{search ? 'No logs match your search' : 'No activity yet'}</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={toggleSelectAllOnPage}
                        />
                      </th>
                      <th>Action</th>
                      <th>Details</th>
                      <th>User</th>
                      <th>When</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((log, i) => {
                      const color = getActionColor(log.action);
                      const display = getUserDisplay(log);
                      const isYou = display === 'You';
                      const checked = selectedIds.includes(log.ROWID);
                      return (
                        <tr
                          key={log.ROWID || i}
                          onClick={() => setSelectedLog(log)}
                          style={{ cursor: 'pointer' }}
                          className={`table-row-hover ${checked ? 'row-selected' : ''}`}
                        >
                          <td onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => toggleSelectOne(log.ROWID, e)}
                            />
                          </td>
                          <td>
                            <div className="flex gap-8" style={{ alignItems: 'center' }}>
                              <div className="pw-icon" style={{ background: color.bg, color: color.color }}>
                                {getActionIcon(log.action)}
                              </div>
                              <span className="td-bold">{log.action}</span>
                            </div>
                          </td>
                          <td className="td-muted" style={{ maxWidth: 240 }}>
                            <span style={{
                              display: 'block', whiteSpace: 'nowrap',
                              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240,
                            }}>
                              {formatDetails(log.action, log.details, log.user_email)}
                            </span>
                          </td>
                          <td className="td-muted">
                            {display
                              ? (isYou ? <span className="badge badge-info">You</span> : display)
                              : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>External</span>
                            }
                          </td>
                          <td>
                            <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                              {timeAgo(log.created_time)}
                            </span>
                          </td>
                          <td className="td-muted" style={{ fontSize: 12 }}>
                            {log.created_time
                              ? new Date(log.created_time.replace(' ', 'T') + 'Z').toLocaleString()
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pagination-row">
                <div className="pagination-info">
                  Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–
                  {Math.min(page * pageSize, filtered.length)} of {filtered.length} logs
                </div>
                <div className="pagination">
                  <button className="page-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
                  <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                  {renderPageButtons()}
                  <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                  <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
                </div>
              </div>
            </>
          )}
        </div>
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
      {selectedLog && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 1000,
          }}
          onClick={() => setSelectedLog(null)}
        />
      )}

      {/* ── Offcanvas panel ── */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0,
        width: 380,
        height: '100vh',
        background: 'var(--card-bg)',
        borderLeft: '0.5px solid var(--border-color)',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        transform: selectedLog ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
        boxShadow: selectedLog ? '-4px 0 24px rgba(0,0,0,0.08)' : 'none',
      }}>
        <div style={{
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
                value={selectedLog.created_time
                  ? new Date(selectedLog.created_time.replace(' ', 'T') + 'Z').toLocaleString()
                  : '—'}
              />
              <DetailRow label="Time ago" value={timeAgo(selectedLog.created_time)} />
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