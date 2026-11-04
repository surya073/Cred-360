import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initScrollLock } from './utils/scrollLock';

initScrollLock();


// Remove "index.html" from URL if present (common in hash-based routing setups)
if (window.location.pathname.includes("index.html")) {
  const cleanUrl = window.location.href.replace("index.html", "");
  window.history.replaceState({}, "", cleanUrl);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
