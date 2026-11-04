import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { getTimeZone, setTimeZone as persistTimeZone } from '../utils/dateHelper';

const TimezoneContext = createContext({ timeZone: getTimeZone(), setTimeZone: () => {} });

export const TimezoneProvider = ({ children }) => {
  const [timeZone, setTz] = useState(getTimeZone());

  const setTimeZone = useCallback((tz) => {
    if (persistTimeZone(tz)) setTz(tz);
  }, []);

  const value = useMemo(() => ({ timeZone, setTimeZone }), [timeZone, setTimeZone]);
  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
};

export const useTimeZone = () => useContext(TimezoneContext);
