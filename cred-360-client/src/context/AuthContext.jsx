import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

const API = '/server/cred_360_function';

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/userinfo`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.replace('/__catalyst/auth/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.user) setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        window.location.replace('/__catalyst/auth/login');
      });
  }, []);

const logout = () => {
 const auth = window.catalyst.auth;
  auth.signOut(window.location.origin);
};

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
