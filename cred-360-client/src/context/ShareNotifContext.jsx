import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const ShareNotifContext = createContext({ passwords: 0, folders: 0, refresh: () => {} });

export const ShareNotifProvider = ({ children }) => {
  const [counts, setCounts] = useState({ passwords: 0, folders: 0 });

  const refresh = useCallback(async () => {
    try {
      const res = await axios.get('/server/cred_360_function/api/shares/unread-counts');
      if (res.data.success) setCounts(res.data.data);
    } catch(e) {}
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <ShareNotifContext.Provider value={{ ...counts, refresh }}>
      {children}
    </ShareNotifContext.Provider>
  );
};

export const useShareNotif = () => useContext(ShareNotifContext);