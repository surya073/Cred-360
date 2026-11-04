import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

// Only two themes exist: "light" and "dark".
const normalize = (t) => (t === 'light' ? 'light' : 'dark');

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => normalize(localStorage.getItem('ks-theme')));

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('ks-theme', theme);
    // Drop legacy customisation (styles / presets / custom accent colours).
    root.removeAttribute('data-style');
    root.removeAttribute('data-bg-feel');
    ['--primary', '--primary-dark', '--primary-light'].forEach(v => root.style.removeProperty(v));
    ['ks-style', 'ks-bg-feel', 'ks-primary', 'ks-primary-custom'].forEach(k => localStorage.removeItem(k));
  }, [theme]);

  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
