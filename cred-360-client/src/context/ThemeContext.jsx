import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

const applyColorToRoot = (color) => {
  const root = document.documentElement;
  root.style.setProperty('--primary', color.value);
  root.style.setProperty('--primary-dark', color.dark);
  root.style.setProperty('--primary-light', color.light);
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(localStorage.getItem('ks-theme') || 'light');
  const [bgFeel, setBgFeelState] = useState(localStorage.getItem('ks-bg-feel') || 'plain');

  // Theme mode (light/dark)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ks-theme', theme);
  }, [theme]);

  // Background feel attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-bg-feel', bgFeel);
    localStorage.setItem('ks-bg-feel', bgFeel);
  }, [bgFeel]);

  // Runs ONCE on app boot, on every page — restores style + primary color
  // regardless of which route the user refreshed on.
  useEffect(() => {
    try {
      const savedStyle = localStorage.getItem('ks-style');
      if (savedStyle) {
        document.documentElement.setAttribute('data-style', savedStyle);
      }

      const currentBgFeel = localStorage.getItem('ks-bg-feel') || 'plain';
      if (currentBgFeel !== 'plain') {
        const savedPreset = localStorage.getItem('ks-primary');
        if (savedPreset) applyColorToRoot(JSON.parse(savedPreset));
      } else {
        const savedColor = localStorage.getItem('ks-primary-custom') || localStorage.getItem('ks-primary');
        if (savedColor) applyColorToRoot(JSON.parse(savedColor));
      }
    } catch (e) {}
  }, []);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const setBgFeel = (feel) => setBgFeelState(feel);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, bgFeel, setBgFeel }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);