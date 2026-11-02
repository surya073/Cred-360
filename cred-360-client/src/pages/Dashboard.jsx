import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCountUp } from '../hooks/useCountUp';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import {
  RiKeyLine, RiShareLine, RiTimeLine, RiTeamLine,
  RiFolderLine, RiShieldKeyholeLine, RiRefreshLine,
  RiUserLine, RiCloseLine,
} from 'react-icons/ri';
import axios from 'axios';
import ExpiryAlert from '../components/ExpiryAlert';

const API = '/server/cred_360_function';

const COLORS = {
  passwords: '#2563eb',
  shared:    '#16a34a',
  expired:   '#dc2626',
  teams:     '#d97706',
  folders:   '#7c3aed',
  users:     '#0284c7',
};
const DONUT_COLORS  = ['#c31b88', '#16a34a', '#efb71f'];
const HEALTH_COLORS = ['#16a34a', '#d97706', '#dc2626'];
const TEAM_COLORS   = ['#2563eb', '#7c3aed', '#16a34a', '#d97706', '#0284c7'];
const SEVERITY_STYLE = {
  high:   { color: '#dc2626', bg: 'var(--danger-bg)' },
  medium: { color: '#d97706', bg: 'var(--warning-bg)' },
  low:    { color: '#0284c7', bg: 'var(--info-bg)' },
};

/* ── Offcanvas ── */
const Offcanvas = ({ open, onClose, title, color, children }) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      <div className={`offcanvas-backdrop ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`offcanvas-panel ${open ? 'open' : ''}`}>
        <div className="offcanvas-header">
          <div className="offcanvas-title-row">
            <div className="offcanvas-dot" style={{ background: color }} />
            <span className="offcanvas-title">{title}</span>
          </div>
          <button className="offcanvas-close" onClick={onClose}>
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="offcanvas-body">{children}</div>
      </div>
    </>
  );
};

/* ── Offcanvas shared sub-components ── */
const OcRow = ({ label, value, color }) => (
  <div className="oc-row">
    <span className="oc-row-label">{label}</span>
    <span className="oc-row-value" style={{ color: color || 'var(--text-primary)' }}>{value}</span>
  </div>
);

const OcBadge = ({ text, color, bg }) => (
  <span className="oc-badge" style={{ background: bg, color }}>{text}</span>
);

/* ── Offcanvas content per card type ── */
const OffcanvasContent = ({ type, stats, recentPasswords, shareTypeData, healthData, teamData }) => {
  if (type === 'passwords') return (
    <div>
      <p className="oc-desc">All passwords stored in your vault</p>
      <OcRow label="Total passwords" value={stats.totalPasswords} />
      <OcRow label="Strong"          value={healthData.strong}   color="#16a34a" />
      <OcRow label="Moderate"        value={healthData.moderate} color="#d97706" />
      <OcRow label="Weak"            value={healthData.weak}     color="#dc2626" />
      <p className="oc-section-label">Recent entries</p>
      {recentPasswords.slice(0, 5).map((p, i) => (
        <div key={i} className="oc-pw-item">
          <div>
            <div className="oc-pw-name">{p.name}</div>
            <div className="oc-pw-cat">{p.category}</div>
          </div>
          <OcBadge
            text={p.strength || 'unknown'}
            color={p.strength === 'strong' ? '#16a34a' : p.strength === 'moderate' ? '#d97706' : '#dc2626'}
            bg={p.strength === 'strong' ? 'var(--success-bg)' : p.strength === 'moderate' ? 'var(--warning-bg)' : 'var(--danger-bg)'}
          />
        </div>
      ))}
    </div>
  );

  if (type === 'shared') return (
    <div>
      <p className="oc-desc">Breakdown of all shared passwords</p>
      <OcRow label="Total shares"   value={stats.sharedPasswords} />
      <OcRow label="Active shares"  value={stats.sharedPasswords - stats.expiredShares} color="#16a34a" />
      <OcRow label="Expired shares" value={stats.expiredShares}                         color="#dc2626" />
      <p className="oc-section-label">By share type</p>
      {shareTypeData.map((s, i) => (
        <div key={i} className="oc-share-item">
          <div className="oc-share-name">
            <span className="oc-share-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            {s.name}
          </div>
          <span className="oc-share-count">{s.value}</span>
        </div>
      ))}
    </div>
  );

  if (type === 'expired') return (
    <div>
      <p className="oc-desc">Shares that have passed their expiry date</p>
      <OcRow label="Expired shares" value={stats.expiredShares}                         color="#dc2626" />
      <OcRow label="Active shares"  value={stats.sharedPasswords - stats.expiredShares} color="#16a34a" />
      <OcRow label="Total shares"   value={stats.sharedPasswords} />
      <div className="oc-alert oc-alert-danger">
        <p className="oc-alert-title">Action required</p>
        <p className="oc-alert-desc">Review and revoke expired shares to keep your vault secure. Go to Share Manager to manage them.</p>
      </div>
    </div>
  );

  if (type === 'teams') return (
    <div>
      <p className="oc-desc">Teams in your organization</p>
      <OcRow label="Total teams" value={stats.totalTeams} />
      <p className="oc-section-label">Password count per team</p>
      {teamData.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No team data yet</p>
      ) : teamData.map((t, i) => (
        <div key={i} className="oc-team-item">
          <div className="oc-team-row">
            <span className="oc-team-name">{t.name}</span>
            <span className="oc-team-count" style={{ color: TEAM_COLORS[i % TEAM_COLORS.length] }}>{t.count}</span>
          </div>
          <div className="oc-team-track">
            <div className="oc-team-fill" style={{
              width: `${(t.count / Math.max(...teamData.map(x => x.count), 1)) * 100}%`,
              background: TEAM_COLORS[i % TEAM_COLORS.length],
            }} />
          </div>
        </div>
      ))}
    </div>
  );

  if (type === 'folders') return (
    <div>
      <p className="oc-desc">Folders organizing your passwords</p>
      <OcRow label="Total folders"        value={stats.totalFolders} />
      <OcRow label="Passwords in folders" value={recentPasswords.filter(p => p.folder_id).length} />
      <OcRow label="Unfiled passwords"    value={recentPasswords.filter(p => !p.folder_id).length} />
    </div>
  );

  if (type === 'users') return (
    <div>
      <p className="oc-desc">Users in your organization</p>
      <OcRow label="Total CRED-360 users" value={stats.totalUsers} />
      <OcRow label="Total teams" value={stats.totalTeams} />
      <div className="oc-alert oc-alert-info">
        <p className="oc-alert-title">Manage users</p>
        <p className="oc-alert-desc">Go to the Users section to invite members, manage roles, and assign teams.</p>
      </div>
    </div>
  );

  return null;
};

/* ── Stat card ── */
const StatCard = ({ icon, label, value, color, onClick, trend }) => {
  const animatedValue = useCountUp(value);
  return (
    <div className="stat-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="stat-icon" style={{ background: color + '18', color }}>
        {icon}
      </div>
      <div className="stat-info">
        <div className="stat-value">{animatedValue}</div>
        <div className="stat-label">{label}</div>
        {trend != null && (
          <div className={`stat-trend ${trend >= 0 ? 'trend-up' : 'trend-dn'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last month
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Chart tooltip ── */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      <p className="chart-tooltip-value">{payload[0].value}</p>
    </div>
  );
  return null;
};

/* ── Health ring ── */
const HealthRing = ({ score, strongPct, moderatePct, weakPct }) => {
  const r = 52, circ = 2 * Math.PI * r;
  const segments = [
    { pct: strongPct   / 100, color: HEALTH_COLORS[0] },
    { pct: moderatePct / 100, color: HEALTH_COLORS[1] },
    { pct: weakPct     / 100, color: HEALTH_COLORS[2] },
  ];
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" style={{ flexShrink: 0 }}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--bg-tertiary)" strokeWidth="10" />
      {segments.map((s, i) => {
        const dash   = s.pct * circ;
        const gap    = circ - dash;
        const rotate = offset * 360 - 90;
        offset += s.pct;
        return (
          <circle key={i} cx="60" cy="60" r={r} fill="none"
            stroke={s.color} strokeWidth="10"
            strokeDasharray={`${dash} ${gap}`} strokeLinecap="round"
            style={{
              transform: `rotate(${rotate}deg)`,
              transformOrigin: '60px 60px',
              transition: 'stroke-dasharray 0.6s ease',
            }}
          />
        );
      })}
      <text x="60" y="55" textAnchor="middle" fontSize="18" fontWeight="500" fill="var(--text-primary)">{score}</text>
      <text x="60" y="70" textAnchor="middle" fontSize="9" fill="var(--text-muted)">health score</text>
    </svg>
  );
};

/* ── Mini bar ── */
const MiniBar = ({ label, value, max, color }) => (
  <div className="mini-bar-row">
    <span className="mini-bar-label">{label}</span>
    <div className="mini-bar-track">
      <div className="mini-bar-fill" style={{ width: `${(value / Math.max(max, 1)) * 100}%`, background: color }} />
    </div>
    <span className="mini-bar-val">{value}</span>
  </div>
);

/* ── Security posture ── */
const SecurityPosture = ({ recommendations, onAction }) => {
  if (!recommendations?.length) return (
    <div className="security-posture sp-clear">
      <RiShieldKeyholeLine size={20} />
      <div>
        <p className="sp-title">Your vault is in good shape</p>
        <p className="sp-sub">No security issues need attention right now.</p>
      </div>
    </div>
  );
  return (
    <div className="security-posture">
      <div className="sp-header">
        <RiShieldKeyholeLine size={16} />
        <span>Security recommendations</span>
      </div>
      <div className="sp-list">
        {recommendations.map(r => {
          const s = SEVERITY_STYLE[r.severity] || SEVERITY_STYLE.low;
          return (
            <div className="sp-item" key={r.id}>
              <div className="sp-item-left">
                <span className="sp-dot" style={{ background: s.color }} />
                <span className="sp-text">{r.text}</span>
              </div>
              <button
                className="sp-action"
                style={{ color: s.color, background: s.bg }}
                onClick={() => onAction(r.link)}
              >
                {r.action}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Dashboard
══════════════════════════════════════════ */
const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats,           setStats]           = useState({ totalPasswords: 0, sharedPasswords: 0, expiredShares: 0, totalTeams: 0, totalFolders: 0, totalUsers: 0, passwordDelta: 0 });
  const [recentPasswords, setRecentPasswords] = useState([]);
  const [monthlyData,     setMonthlyData]     = useState([]);
  const [shareTypeData,   setShareTypeData]   = useState([]);
  const [healthData,      setHealthData]      = useState({ score: 0, strong: 0, moderate: 0, weak: 0 });
  const [teamData,        setTeamData]        = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [offcanvas,       setOffcanvas]       = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/dashboard`);
      if (res.data.success) {
        setStats(res.data.stats);
        setRecentPasswords(res.data.recentPasswords || []);
        setMonthlyData(res.data.monthlyData         || []);
        setShareTypeData(res.data.shareTypeData     || []);
        setHealthData(res.data.healthData           || { score: 0, strong: 0, moderate: 0, weak: 0 });
        setTeamData(res.data.teamData               || []);
        setRecommendations(res.data.recommendations || []);
      }
    } catch(e) {
      console.log('Dashboard error:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

// ── Scroll lock when offcanvas open ──
  useEffect(() => {
    if (offcanvas) {
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
  }, [offcanvas]);
  
  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const openCard  = (type, title, color) => setOffcanvas({ type, title, color });
  const closeCard = useCallback(() => setOffcanvas(null), []);

  // ── Health ring: convert counts to real percentages ──
  const healthTotal = (healthData.strong + healthData.moderate + healthData.weak) || 1;
  const strongPct   = (healthData.strong   / healthTotal) * 100;
  const moderatePct = (healthData.moderate / healthTotal) * 100;
  const weakPct     = (healthData.weak     / healthTotal) * 100;

  // ── Monthly chart: check if all zeros ──
  const hasMonthlyData = monthlyData.some(d => d.Passwords > 0);

  const teamMax = teamData.length ? Math.max(...teamData.map(t => t.count), 1) : 1;

  const statCards = [
    { type: 'passwords', icon: <RiKeyLine size={20} />,    label: 'Total passwords',  value: stats.totalPasswords,  color: COLORS.passwords, trend: stats.passwordDelta },
    { type: 'shared',    icon: <RiShareLine size={20} />,  label: 'Shared passwords', value: stats.sharedPasswords, color: COLORS.shared    },
    { type: 'expired',   icon: <RiTimeLine size={20} />,   label: 'Expired shares',   value: stats.expiredShares,   color: COLORS.expired   },
    { type: 'teams',     icon: <RiTeamLine size={20} />,   label: 'Teams',            value: stats.totalTeams,      color: COLORS.teams     },
    { type: 'folders',   icon: <RiFolderLine size={20} />, label: 'Folders',          value: stats.totalFolders,    color: COLORS.folders   },
    { type: 'users',     icon: <RiUserLine size={20} />,   label: 'Total users',      value: stats.totalUsers,      color: COLORS.users     },
  ];

  if (loading) return (
    <div>
      <div className="page-header flex-between">
        <div><h1 className="page-title">Dashboard</h1><p className="page-subtitle">Loading your overview…</p></div>
      </div>
      <div className="dashboard-skeleton">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card" />)}
      </div>
      <div className="skeleton-card" style={{ height: 240, marginBottom: 14 }} />
      <div className="dashboard-charts-row2">
        <div className="skeleton-card" style={{ height: 200 }} />
        <div className="skeleton-card" style={{ height: 200 }} />
      </div>
      <div className="skeleton-card" style={{ height: 260 }} />
    </div>
  );

  return (
    <div>
      {/* ── Offcanvas ── */}
      <Offcanvas open={!!offcanvas} onClose={closeCard} title={offcanvas?.title} color={offcanvas?.color}>
        {offcanvas && (
          <OffcanvasContent
            type={offcanvas.type}
            stats={stats}
            recentPasswords={recentPasswords}
            shareTypeData={shareTypeData}
            healthData={healthData}
            teamData={teamData}
          />
        )}
      </Offcanvas>

      {/* ── Header ── */}
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">{getGreeting()}, {user?.first_name || 'User'}</h1>
          <p className="page-subtitle">Here is your CRED 360 security overview</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchData}>
          <RiRefreshLine size={15} />
        </button>
      </div>
      <ExpiryAlert />

      {/* ── Security posture ── */}
      <SecurityPosture recommendations={recommendations} onAction={navigate} />

      {/* ── Stat cards ── */}
      <div className="stats-grid stagger-in">
        {statCards.map((card) => (
          <StatCard
            key={card.type}
            {...card}
            onClick={() => openCard(card.type, card.label, card.color)}
          />
        ))}
      </div>

      {/* ── Row 1: Monthly + Share types ── */}
      <div className="dashboard-charts-row" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Monthly password activity</h2>
            <span className="card-sub">Last 6 months</span>
          </div>
         {hasMonthlyData ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="Passwords"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  fill="url(#waveFill)"
                  dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: 'var(--primary)', stroke: 'var(--bg-primary)', strokeWidth: 2 }}
                  animationDuration={900}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ height: 200 }}>
              <RiKeyLine size={32} />
              <p>No passwords added yet</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Share types</h2>
          </div>
          {shareTypeData.length === 0 || shareTypeData.every(d => d.value === 0) ? (
            <div className="empty-state"><RiShareLine size={32} /><p>No shares yet</p></div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={shareTypeData} cx="50%" cy="50%" innerRadius={42} outerRadius={65} dataKey="value" paddingAngle={3}>
                    {shareTypeData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-legend">
                {shareTypeData.map((item, i) => (
                  <div className="legend-item" key={i}>
                    <span className="legend-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="legend-label">{item.name}</span>
                    <span className="legend-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: Health + Team activity ── */}
      <div className="dashboard-charts-row2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Password health</h2>
            <span className="card-sub">Strength breakdown</span>
          </div>
          {stats.totalPasswords === 0 ? (
            <div className="empty-state">
              <RiShieldKeyholeLine size={32} />
              <p>No passwords to analyse yet</p>
            </div>
          ) : (
            <div className="health-row">
              <HealthRing
                score={healthData.score}
                strongPct={strongPct}
                moderatePct={moderatePct}
                weakPct={weakPct}
              />
              <div className="health-bars">
                <MiniBar label="Strong"   value={healthData.strong}   max={stats.totalPasswords} color={HEALTH_COLORS[0]} />
                <MiniBar label="Moderate" value={healthData.moderate} max={stats.totalPasswords} color={HEALTH_COLORS[1]} />
                <MiniBar label="Weak"     value={healthData.weak}     max={stats.totalPasswords} color={HEALTH_COLORS[2]} />
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Team activity</h2>
            <span className="card-sub">Passwords per team</span>
          </div>
          {teamData.length === 0 ? (
            <div className="empty-state"><RiTeamLine size={32} /><p>No team data yet</p></div>
          ) : (
            <div className="team-bars">
              {teamData.map((t, i) => (
                <MiniBar key={i} label={t.name} value={t.count} max={teamMax} color={TEAM_COLORS[i % TEAM_COLORS.length]} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent passwords ── */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent passwords</h2>
          <span className="card-sub">Latest 6 entries</span>
        </div>
        {recentPasswords.length === 0 ? (
          <div className="empty-state"><RiShieldKeyholeLine size={36} /><p>No passwords added yet</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Username</th>
                  <th>URL</th>
                  <th>Strength</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentPasswords.map((p, i) => (
                  <tr key={i}>
                    <td className="td-bold">{p.name}</td>
                    <td><span className="badge badge-info">{p.category || 'General'}</span></td>
                    <td className="td-muted">{p.username || '—'}</td>
                    <td className="td-muted">
                      {p.url ? (
                        <a
                          href={p.url.startsWith('http') ? p.url : `https://${p.url}`}
                          target="_blank" rel="noreferrer" className="td-link"
                        >
                          {p.url.replace(/^https?:\/\//, '').slice(0, 22)}
                        </a>
                      ) : '—'}
                    </td>
                    <td>
                      {p.strength === 'strong'   && <span className="badge badge-success">Strong</span>}
                      {p.strength === 'moderate' && <span className="badge badge-warning">Moderate</span>}
                      {p.strength === 'weak'     && <span className="badge badge-danger">Weak</span>}
                      {!p.strength && '—'}
                    </td>
                    <td className="td-muted">
                      {p.created_time ? new Date(p.created_time).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;