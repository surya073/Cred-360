import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RiSearchLine, RiCloseLine, RiKeyLine, RiFolderLine,
  RiTeamLine, RiUserLine, RiGlobalLine, RiLoader4Line,
} from 'react-icons/ri';

const API = '/server/cred_360_extras_function/api';

const SECTION_CONFIG = [
  { key: 'passwords',     label: 'Passwords',      icon: RiKeyLine,    path: '/passwords'      },
  { key: 'folders',       label: 'Folders',        icon: RiFolderLine, path: '/folders'        },
  { key: 'teams',         label: 'Teams',          icon: RiTeamLine,   path: '/teams'           },
  { key: 'users',         label: 'Users',          icon: RiUserLine,   path: '/users'           },
  { key: 'externalUsers', label: 'External Users', icon: RiGlobalLine, path: '/external-users' },
];

const GlobalSearch = ({ open, onClose }) => {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef    = useRef(null);
  const debounceRef = useRef(null);
  const navigate    = useNavigate();
  const [anchor, setAnchor] = useState(null);

  const runSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API}/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (data.success) setResults(data.data);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults(null); setLoading(false); return; }
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  // Reset + autofocus whenever the modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setActiveIndex(-1);
      // Expand from the navbar search box position (Zoho-style)
      const el = document.querySelector('.navbar-search-pill');
      const vw = window.innerWidth;
      const width = Math.min(720, vw - 16);
      if (el && vw > 640) {
        const r = el.getBoundingClientRect();
        setAnchor({ top: Math.max(r.top - 2, 4), left: Math.max(8, Math.min(r.left, vw - width - 8)), width });
      } else {
        setAnchor({ top: 8, left: Math.max(8, (vw - width) / 2), width });
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Lock background scroll while modal is open
  useEffect(() => {
    if (open) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const flatItems = [];
  if (results) {
    SECTION_CONFIG.forEach(section => {
      (results[section.key] || []).forEach(item => {
        flatItems.push({ section, item });
      });
    });
  }

  const close = () => { onClose(); setQuery(''); setResults(null); };

  const goTo = (section, item) => {
    close();
    navigate(section.path, { state: { focusId: item.ROWID, searchTerm: item.name || item.email } });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const { section, item } = flatItems[activeIndex];
      goTo(section, item);
    }
  };

  const itemLabel = (key, item) => {
    if (key === 'externalUsers') return item.name || item.email;
    return item.name;
  };

  const itemSubLabel = (key, item) => {
    if (key === 'passwords')     return item.username || item.category || '';
    if (key === 'teams')         return item.description || '';
    if (key === 'users')         return item.email || '';
    if (key === 'externalUsers') return item.company || item.email || '';
    return '';
  };

  const hasAnyResults = flatItems.length > 0;
  const showDropdown  = query.trim().length >= 2;

  return (
    <div className="gs-modal-backdrop" onMouseDown={close}>
      <div
        className="gs-modal"
        style={anchor ? { top: anchor.top, left: anchor.left, width: anchor.width } : undefined}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="gs-modal-input-row">
          <RiSearchLine size={18} className="gs-search-icon" />
          <input
            ref={inputRef}
            className="gs-modal-input"
            placeholder="Search passwords, folders, teams, users…"
            autoComplete="off"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(-1); }}
            onKeyDown={handleKeyDown}
          />
          {loading && <RiLoader4Line size={16} className="gs-spinner" />}
          <button className="gs-modal-close" onClick={close}><RiCloseLine size={16} /></button>
        </div>

        <div className="gs-modal-results">
          {!showDropdown ? (
            <div className="gs-placeholder">
              <div className="gs-placeholder-icon">
                <RiSearchLine size={26} />
              </div>
              <p className="gs-placeholder-title">What are you looking for?</p>
              <p className="gs-placeholder-sub">
                Search passwords, folders, teams, users, and external users across CRED 360.
              </p>
            </div>
          ) : loading && !results ? (
            <div className="gs-empty">Searching…</div>
          ) : !hasAnyResults ? (
            <div className="gs-empty">No results for "{query}"</div>
          ) : (
            SECTION_CONFIG.map(section => {
              const items = results?.[section.key] || [];
              if (items.length === 0) return null;
              const Icon = section.icon;
              return (
                <div key={section.key} className="gs-section">
                  <div className="gs-section-label">{section.label}</div>
                  {items.map(item => {
                    const flatIdx = flatItems.findIndex(f => f.item === item);
                    return (
                      <div
                        key={item.ROWID}
                        className={`gs-item ${activeIndex === flatIdx ? 'gs-item-active' : ''}`}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => goTo(section, item)}
                      >
                        <Icon size={15} className="gs-item-icon" />
                        <div className="gs-item-text">
                          <div className="gs-item-name">{itemLabel(section.key, item)}</div>
                          {itemSubLabel(section.key, item) && (
                            <div className="gs-item-sub">{itemSubLabel(section.key, item)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="gs-modal-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;