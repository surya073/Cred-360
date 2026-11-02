import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';


// Remove "index.html" from URL if present (common in hash-based routing setups)
if (window.location.pathname.includes("index.html")) {
  const cleanUrl = window.location.href.replace("index.html", "");
  window.history.replaceState({}, "", cleanUrl);
}

// Restore saved primary color
try {
  const saved = localStorage.getItem('ks-primary');
  if (saved) {
    const color = JSON.parse(saved);
    const root = document.documentElement;
    root.style.setProperty('--primary',       color.value);
    root.style.setProperty('--primary-dark',  color.dark);
    root.style.setProperty('--primary-light', color.light);
  }
} catch(e) {}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
