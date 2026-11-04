import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

const API = '/server/cred_360_function';

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Local UI preview only (REACT_APP_PREVIEW=1): skip sign-in with a demo admin.
    if (process.env.REACT_APP_PREVIEW === '1') {
      setUser({ first_name: 'Alex', last_name: 'Morgan', email_id: 'alex@example.com', role_details: { role_name: 'App Administrator' }, role: 'Admin' });
      setLoading(false);
      return;
    }
    fetch(`${API}/api/userinfo`, { credentials: 'include' })
      .then(async (res) => {
        // 401 = not signed in → App shows the embedded Login page
        if (res.status === 401) return null;
        return res.json();
      })
      .then((data) => {
        if (data?.user) setUser(data.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

const logout = () => {
 const auth = window.catalyst.auth;
  auth.signOut(window.location.origin + "/app/index.html");
};

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
