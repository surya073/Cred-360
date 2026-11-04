import React from 'react';
import { useAuth } from '../context/AuthContext';
import Login from '../pages/Login';


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

  if (!user) return <Login />;

  return <>{children}</>;
};

export default ProtectedRoute;
