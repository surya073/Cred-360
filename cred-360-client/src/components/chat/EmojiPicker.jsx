import React, { useMemo, useRef, useState } from 'react';
import { EMOJI_CATEGORIES, loadRecentEmojis, rememberEmoji } from './emojiData';

// Searchable, categorised emoji picker with a "recent" row. Used by the composer, the thread
// composer and the "more reactions" popover.
const EmojiPicker = ({ onPick, autoFocus = true }) => {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(loadRecentEmojis);
  const [cat, setCat] = useState(recent.length ? 'recent' : EMOJI_CATEGORIES[0].id);
  const gridRef = useRef(null);

  const pick = (emoji) => {
    setRecent(rememberEmoji(emoji));
    onPick(emoji);
  };

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const out = [];
    EMOJI_CATEGORIES.forEach(c => c.items.forEach(([e, name]) => { if (name.includes(q)) out.push(e); }));
    return out;
  }, [q]);

  const visible = q
    ? results
    : cat === 'recent'
      ? recent
      : (EMOJI_CATEGORIES.find(c => c.id === cat)?.items || []).map(([e]) => e);

  const tabs = [
    ...(recent.length ? [{ id: 'recent', icon: '🕘', label: 'Recent' }] : []),
    ...EMOJI_CATEGORIES,
  ];

  return (
    <div className="emoji-picker" onMouseDown={(e) => e.stopPropagation()}>
      <input
        className="emoji-search" placeholder="Search emoji…" value={query}
        onChange={(e) => setQuery(e.target.value)} autoFocus={autoFocus}
        aria-label="Search emoji"
      />
      {!q && (
        <div className="emoji-tabs" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id} type="button" role="tab" aria-selected={cat === t.id} title={t.label}
              className={`emoji-tab ${cat === t.id ? 'active' : ''}`}
              onClick={() => { setCat(t.id); if (gridRef.current) gridRef.current.scrollTop = 0; }}
            >{t.icon}</button>
          ))}
        </div>
      )}
      <div className="emoji-grid" ref={gridRef}>
        {visible.length === 0 && <div className="emoji-empty">No emoji found</div>}
        {visible.map(e => (
          <button key={e} type="button" className="emoji-item" onClick={() => pick(e)}>{e}</button>
        ))}
      </div>
    </div>
  );
};

export default EmojiPicker;
