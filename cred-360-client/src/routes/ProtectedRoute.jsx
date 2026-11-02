import React from 'react';
import { useAuth } from '../context/AuthContext';

const CATALYST_LOGIN = 'https://keyshare-60069659585.development.catalystserverless.in/__catalyst/auth/login';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#f8fafc'
      }}>
        <p style={{ color: '#475569', fontSize: 14 }}>Loading KeyShare...</p>
      </div>
    );
  }

  if (!user) {
    window.location.href = CATALYST_LOGIN;
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
