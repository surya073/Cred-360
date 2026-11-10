import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCountUp } from '../hooks/useCountUp';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import {
  RiKeyLine, RiShareLine, RiTeamLine, RiFolderLine, RiUserLine,
  RiShieldKeyholeLine, RiRefreshLine, RiCloseLine, RiArrowRightSLine, RiAddLine,
} from 'react-icons/ri';
import axios from '../services/api';
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
const DONUT_COLORS  = ['#c31b88', '#16a34a', '#efb71f', '#2563eb', '#64748b'];
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
  const [pill,            setPill]            = useState('all');
  const [hoverIdx,        setHoverIdx]        = useState(null);

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

  // ── Monthly chart: check if all zeros ──
  const hasMonthlyData = monthlyData.some(d => d.Passwords > 0);

  const animPw  = useCountUp(stats.totalPasswords);
  const animExp = useCountUp(stats.expiredShares);

  const total = (shareTypeData || []).reduce((a, d) => a + (d.value || 0), 0);
  const NX_DONUT = ['#8b7cf6', '#d4f56b', '#3fb58a', '#38bdf8', '#94a3b8'];
  const PILLS = [
    { key: 'all',      label: 'All' },
    { key: 'strong',   label: 'Strong' },
    { key: 'moderate', label: 'Moderate' },
    { key: 'weak',     label: 'Weak' },
  ];
  const listed = recentPasswords.filter(p => pill === 'all' || p.strength === pill).slice(0, 6);
  const activeIdx = hoverIdx != null ? hoverIdx : monthlyData.length - 1;

  const NxBar = (props) => {
    const { x, y, width, height, index, value } = props;
    const isActive = index === activeIdx;
    // Empty months get a short stub so zero never looks like real data; others keep a pill-friendly minimum.
    const h = value > 0 ? Math.max(height, 44) : 20;
    const yy = y + height - h;
    const r = Math.min(width / 2, h / 2);
    return (
      <g onMouseEnter={() => setHoverIdx(index)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: 'pointer' }}>
        <rect x={x} y={yy} width={width} height={h} rx={r} style={{ fill: isActive ? '#8b7cf6' : 'var(--nx-bar)' }} />
        {!isActive && <rect x={x} y={yy} width={width} height={h} rx={r} fill="url(#nxHatch)" />}
        {isActive && (
          <>
            <circle cx={x + width / 2} cy={yy + 14} r={7} fill="none" stroke="#fff" strokeWidth={3} />
            <rect x={x + width / 2 - 30} y={yy - 32} width={60} height={24} rx={12} fill="#2a3a36" />
            <text x={x + width / 2} y={yy - 16} textAnchor="middle" fontSize={11} fill="#e8f5ef">+{value}</text>
          </>
        )}
      </g>
    );
  };

  if (loading) return (
    <div className="nx-dash">
      <div className="nx-skel" style={{ height: 60, marginBottom: 20 }} />
      <div className="nx-skel" style={{ height: 420 }} />
    </div>
  );

  return (
    <div>
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

      <ExpiryAlert />

      <div className="nx-dash">
        <div className="nx-grid">
          {/* ── Left column ── */}
          <div className="nx-left">
            <div className="nx-head">
              <h1 className="nx-title">My Dashboard</h1>
              <button className="nx-refresh" onClick={fetchData} title="Refresh"><RiRefreshLine size={16} /></button>
            </div>
            <p className="nx-greet">{getGreeting()}, {user?.first_name || 'User'}</p>

            <div className="nx-pills">
              {PILLS.map(p => (
                <button key={p.key} className={`nx-pill ${pill === p.key ? 'on' : ''}`} onClick={() => setPill(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Compact stat strip */}
            <div className="nx-chips">
              {[
                { type: 'shared',  icon: <RiShareLine size={16} />,  label: 'Shared',  value: stats.sharedPasswords, color: COLORS.shared },
                { type: 'teams',   icon: <RiTeamLine size={16} />,   label: 'Teams',   value: stats.totalTeams,      color: COLORS.teams },
                { type: 'folders', icon: <RiFolderLine size={16} />, label: 'Folders', value: stats.totalFolders,    color: COLORS.folders },
                { type: 'users',   icon: <RiUserLine size={16} />,   label: 'Users',   value: stats.totalUsers,      color: COLORS.users },
              ].map(c => (
                <button key={c.type} className="nx-chip" onClick={() => openCard(c.type, c.label, c.color)}>
                  <span className="nx-chip-ic" style={{ color: c.color }}>{c.icon}</span>
                  <b>{c.value}</b>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>

            {/* Activity bar chart */}
            <div className="nx-card nx-flow">
              <div className="nx-card-head">
                <h2>Password Activity</h2>
                <button className="nx-link" onClick={() => navigate('/passwords')}>View All <RiArrowRightSLine /></button>
              </div>
              {hasMonthlyData ? (
                <ResponsiveContainer width="100%" height={185}>
                  <BarChart data={monthlyData} margin={{ top: 40, right: 8, left: -14, bottom: 0 }} barCategoryGap="24%">
                    <defs>
                      <pattern id="nxHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="7" stroke="#8b7cf6" strokeWidth="2.4" />
                      </pattern>
                    </defs>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Bar dataKey="Passwords" shape={<NxBar />} maxBarSize={52} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="nx-empty" style={{ height: 185 }}><RiKeyLine size={30} /><p>No passwords added yet</p></div>
              )}
            </div>

            {/* Bottom row */}
            <div className="nx-bottom">
              <div className="nx-card nx-avail">
                <div className="nx-card-head">
                  <h2>Shares</h2>
                  <button className="nx-link" onClick={() => navigate('/shares')}>View All <RiArrowRightSLine /></button>
                </div>
                {total === 0 ? (
                  <div className="nx-empty"><RiShareLine size={28} /><p>No shares yet</p></div>
                ) : (
                  <div className="nx-donut-row">
                    <div className="nx-donut">
                      <PieChart width={140} height={140}>
                        <Pie data={shareTypeData} dataKey="value" cx={70} cy={70} innerRadius={48} outerRadius={68} paddingAngle={4}
                             cornerRadius={10} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
                          {shareTypeData.map((_, i) => <Cell key={i} fill={NX_DONUT[i % NX_DONUT.length]} />)}
                        </Pie>
                      </PieChart>
                      <div className="nx-donut-c"><b>{total}</b><span>Total Shares</span></div>
                    </div>
                    <div className="nx-legend">
                      {shareTypeData.map((d, i) => (
                        <div key={i}><i style={{ background: NX_DONUT[i % NX_DONUT.length] }} /><div><span>{d.name}</span><b>{d.value}</b></div></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="nx-stack">
                <div className="nx-card nx-stat" onClick={() => openCard('passwords', 'Total passwords', COLORS.passwords)}>
                  <div className="nx-card-head"><h2>Passwords</h2><span className="nx-dots">···</span></div>
                  <div className="nx-big">{animPw}</div>
                  <div className="nx-stat-foot">
                    <span>Stored in your vault</span>
                    <em className="nx-badge g">{stats.passwordDelta >= 0 ? '+' : ''}{stats.passwordDelta || 0}%</em>
                  </div>
                </div>
                <div className="nx-card nx-stat" onClick={() => openCard('expired', 'Expired shares', COLORS.expired)}>
                  <div className="nx-card-head"><h2>Expired</h2><span className="nx-dots">···</span></div>
                  <div className="nx-big">{animExp}</div>
                  <div className="nx-stat-foot">
                    <span>Shares past expiry</span>
                    <em className="nx-badge p">{stats.sharedPasswords - stats.expiredShares} active</em>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <aside className="nx-right">
            <div className="nx-card nx-mycard">
              <div className="nx-card-head">
                <h2>Vault Health</h2>
                <button className="nx-link" onClick={() => navigate('/passwords')}>View All <RiArrowRightSLine /></button>
              </div>
              <div className="nx-cardstack">
                <div className="nx-c3" /><div className="nx-c2" />
                <div className="nx-c1">
                  <button className="nx-plus" onClick={() => navigate('/passwords')} title="Add password"><RiAddLine size={20} /></button>
                  <span className="nx-lbl">Health Score</span>
                  <strong>{healthData.score}<small>/100</small></strong>
                </div>
              </div>

              <div className="nx-glass">
                <div className="nx-meta">
                  <span>{healthData.strong} strong · {healthData.moderate} moderate · {healthData.weak} weak</span>
                  <span>{stats.totalPasswords} passwords</span>
                </div>
                <div className="nx-card-head nx-tx-head">
                  <h2>Recent Passwords</h2>
                  <button className="nx-link" onClick={() => navigate('/passwords')}>View All <RiArrowRightSLine /></button>
                </div>
                {listed.length === 0 ? (
                  <p className="nx-none">Nothing in this filter</p>
                ) : listed.map((p, i) => (
                  <div className="nx-tx" key={i}>
                    <span className="nx-ava" style={{ background: ['#1f6f5a', '#2a7a63', '#b4561f', '#4a4aa6'][i % 4] }}>
                      {(p.name || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="nx-tx-name">{p.name}</span>
                    <span className={`nx-tx-st ${p.strength || ''}`}>{p.strength || '—'}</span>
                  </div>
                ))}

                <div className="nx-tiles">
                  <div className="nx-tile nx-teams" onClick={() => navigate('/teams')}>
                    <b>Teams</b>
                    <p>{stats.totalTeams} teams · {stats.totalUsers} users in your organization</p>
                    <div className="nx-avs">
                      {[...Array(Math.min(stats.totalTeams || 1, 3))].map((_, i) => (
                        <span key={i} style={{ background: ['#8b7cf6', '#d4f56b', '#3fb58a'][i] }}><RiTeamLine size={13} /></span>
                      ))}
                    </div>
                  </div>
                  <div className="nx-tile nx-wave" onClick={() => navigate('/folders')}>
                    <b>Folders · {stats.totalFolders}</b>
                    <svg viewBox="0 0 120 60" preserveAspectRatio="none">
                      <path d="M2 18 C 14 18, 14 52, 28 52 S 42 18, 56 18 S 70 52, 84 52 S 98 18, 118 18" fill="none" stroke="#3fb58a" strokeWidth="5" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <SecurityPosture recommendations={recommendations} onAction={navigate} />
    </div>
  );
};

export default Dashboard;
