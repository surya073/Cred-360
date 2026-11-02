import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { RiTimeLine, RiAlarmWarningLine, RiCloseLine } from 'react-icons/ri';

const API = '/server/cred_360_function';

const ExpiryAlert = () => {
  const [expiring, setExpiring] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchExpiring();
  }, []);

  const fetchExpiring = async () => {
    try {
      const res = await axios.get(`${API}/api/passwords/expiring`);
      if (res.data.success) setExpiring(res.data.data || []);
    } catch(e) {}
  };

  if (dismissed || expiring.length === 0) return null;

  const critical = expiring.filter(p => p.diffDays <= 1);
  const warning  = expiring.filter(p => p.diffDays > 1 && p.diffDays <= 7);
  const notice   = expiring.filter(p => p.diffDays > 7);

  const bgColor   = critical.length > 0 ? 'var(--warning-bg)'  : 'var(--warning-bg)';
  const color     = critical.length > 0 ? 'var(--warning)'     : 'var(--warning)';
  const border    = critical.length > 0 ? 'var(--warning)'     : 'var(--warning)';

  return (
    <div style={{
      background: bgColor,
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
      marginBottom: 16,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <RiAlarmWarningLine size={20} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color, marginBottom: 6 }}>
          {critical.length > 0
            ? `${critical.length} password${critical.length > 1 ? 's' : ''} expired or expiring today!`
            : `${expiring.length} password${expiring.length > 1 ? 's' : ''} expiring soon`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {expiring.slice(0, 4).map((p, i) => (
            <span key={i} style={{
              background: 'rgba(0,0,0,0.06)',
              padding: '2px 10px',
              borderRadius: 20,
              fontSize: 12,
              color,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <RiTimeLine size={11} />
              {p.name} —{' '}
              {p.diffDays <= 0
                ? 'Expired'
                : p.diffDays === 1
                ? 'Tomorrow'
                : `${p.diffDays}d`}
            </span>
          ))}
          {expiring.length > 4 && (
            <span style={{ fontSize: 12, color }}>+{expiring.length - 4} more</span>
          )}
        </div>
        <button
          onClick={() => navigate('/passwords')}
          style={{
            marginTop: 10,
            fontSize: 12,
            fontWeight: 600,
            color,
            background: 'none',
            border: `1px solid ${border}`,
            borderRadius: 'var(--radius-md)',
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          View & Update Passwords
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color, flexShrink: 0 }}
      >
        <RiCloseLine size={18} />
      </button>
    </div>
  );
};

export default ExpiryAlert;