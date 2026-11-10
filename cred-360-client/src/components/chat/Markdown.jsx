import React from 'react';

// Zoho Cliq-style message markdown, rendered straight to React elements (no innerHTML, so
// message text can never inject markup).
//
//   *bold*   _italic_   ~strike~   `inline code`   ```code block```
//   > quote   - bullet / • bullet   1. numbered   https://links   @mentions
//
// Markers must hug the text (no space just inside) so "2 * 3 * 4" is left alone.

const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Earliest-match inline tokenizer. Each rule: regex, and how to turn a match into a node.
function inline(str, keyPrefix, mentionRe) {
  const rules = [
    { re: /`([^`\n]+)`/,                                          node: (m, k) => <code key={k} className="md-code">{m[1]}</code> },
    { re: /\*(?!\s)([^*\n]+?)(?<!\s)\*/,                          node: (m, k) => <strong key={k}>{inline(m[1], k, mentionRe)}</strong> },
    { re: /(?<![\w])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w])/,           node: (m, k) => <em key={k}>{inline(m[1], k, mentionRe)}</em> },
    { re: /~(?!\s)([^~\n]+?)(?<!\s)~/,                            node: (m, k) => <del key={k}>{inline(m[1], k, mentionRe)}</del> },
    { re: URL_RE,                                                 node: (m, k) => <a key={k} href={m[0]} target="_blank" rel="noreferrer noopener" className="chat-link">{m[0]}</a> },
  ];
  if (mentionRe) rules.push({ re: mentionRe, node: (m, k) => <span key={k} className="md-mention">{m[0]}</span> });

  const out = [];
  let rest = str;
  let n = 0;
  while (rest) {
    let best = null;
    for (const rule of rules) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) { out.push(rest); break; }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.node(best.m, `${keyPrefix}-${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// Split into block-level pieces: fenced code, quotes, lists, plain paragraphs.
function toBlocks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push({ t: 'code', lines: buf });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ t: 'quote', lines: buf });
      continue;
    }
    if (/^\s*[-•]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-•]\s+/, '')); i++; }
      blocks.push({ t: 'ul', lines: buf });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push({ t: 'ol', lines: buf });
      continue;
    }
    const buf = [];
    while (
      i < lines.length &&
      !/^```/.test(lines[i]) && !/^>\s?/.test(lines[i]) &&
      !/^\s*[-•]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    blocks.push({ t: 'p', lines: buf });
  }
  return blocks;
}

const Markdown = ({ text, names }) => {
  const mentionRe = React.useMemo(() => {
    const list = (names || []).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
    return list.length ? new RegExp(`@(?:${list.join('|')})(?![\\w])`, 'i') : null;
  }, [names]);

  const blocks = React.useMemo(() => toBlocks(text), [text]);

  return (
    <div className="chat-text md">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        if (b.t === 'code') {
          return <pre key={k} className="md-pre"><code>{b.lines.join('\n')}</code></pre>;
        }
        if (b.t === 'quote') {
          return <blockquote key={k} className="md-quote">{b.lines.map((l, li) => <div key={li}>{inline(l, `${k}-${li}`, mentionRe)}</div>)}</blockquote>;
        }
        if (b.t === 'ul') {
          return <ul key={k} className="md-list">{b.lines.map((l, li) => <li key={li}>{inline(l, `${k}-${li}`, mentionRe)}</li>)}</ul>;
        }
        if (b.t === 'ol') {
          return <ol key={k} className="md-list">{b.lines.map((l, li) => <li key={li}>{inline(l, `${k}-${li}`, mentionRe)}</li>)}</ol>;
        }
        return (
          <div key={k} className="md-p">
            {b.lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 && '\n'}
                {inline(l, `${k}-${li}`, mentionRe)}
              </React.Fragment>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(Markdown);
