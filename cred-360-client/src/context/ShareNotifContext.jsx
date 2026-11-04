import React, { createContext, useContext, useState, useCallback } from 'react';

const ShareNotifContext = createContext({ passwords: 0, folders: 0, refresh: () => {} });

export const ShareNotifProvider = ({ children }) => {
  const [counts, setCounts] = useState({ passwords: 0, folders: 0 });

  // The backend route /api/shares/unread-counts is disabled (commented out in cred_360_function),
  // so calling it only produced a 404 every minute and on every tab switch. Keep the context API
  // (consumers read passwords/folders/refresh) but make no network calls until the route returns.
  const refresh = useCallback(async () => { setCounts(c => c); }, []);

  return (
    <ShareNotifContext.Provider value={{ ...counts, refresh }}>
      {children}
    </ShareNotifContext.Provider>
  );
};

export const useShareNotif = () => useContext(ShareNotifContext);