import React, { memo, useEffect, useRef, useState } from 'react';
import {
  RiImageLine, RiFileLine, RiMusicLine, RiVideoLine, RiFilePdfLine, RiDownloadLine,
  RiCheckDoubleLine, RiCheckLine, RiTimeLine, RiErrorWarningLine, RiArrowDownSLine,
  RiPushpinFill, RiEyeLine, RiEyeOffLine, RiChat3Line, RiForbid2Line, RiCheckboxCircleFill,
} from 'react-icons/ri';
import Markdown from './Markdown';
import { tallyPoll, previewOf } from './chatModel';
import { API, colorFor, formatFileSize, formatTime, isEmojiOnly } from './chatUtils';

const FileIcon = ({ type }) => {
  if (type === 'image') return <RiImageLine size={20} />;
  if (type === 'video') return <RiVideoLine size={20} />;
  if (type === 'audio') return <RiMusicLine size={20} />;
  if (type === 'pdf')   return <RiFilePdfLine size={20} />;
  return <RiFileLine size={20} />;
};

// ── poll ─────────────────────────────────────────────────────────────────────
const PollCard = ({ item, myId, onVote }) => {
  const { options, perOption, voters, mine, multi } = tallyPoll(item, myId);
  const total = perOption.reduce((a, v) => a + v.length, 0) || 1;

  const toggle = (i) => {
    if (multi) onVote(item, mine.includes(i) ? mine.filter(x => x !== i) : [...mine, i].sort((a, b) => a - b));
    else onVote(item, mine.includes(i) ? [] : [i]);
  };

  return (
    <div className="poll-card">
      <div className="poll-q">📊 {item.meta?.q}</div>
      <div className="poll-hint">{multi ? 'Select one or more' : 'Select one'}</div>
      {options.map((label, i) => {
        const names = perOption[i];
        const picked = mine.includes(i);
        const pct = voters ? Math.round((names.length / total) * 100) : 0;
        return (
          <button
            type="button" key={i} className={`poll-opt ${picked ? 'picked' : ''}`}
            onClick={() => toggle(i)} title={names.length ? names.join(', ') : 'No votes yet'}
          >
            <span className="poll-bar" style={{ width: `${pct}%` }} />
            <span className="poll-mark">{picked ? <RiCheckboxCircleFill size={18} /> : <span className={`poll-dot ${multi ? 'sq' : ''}`} />}</span>
            <span className="poll-label">{label}</span>
            <span className="poll-count">{names.length}</span>
          </button>
        );
      })}
      <div className="poll-foot">{voters} {voters === 1 ? 'vote' : 'votes'}</div>
    </div>
  );
};

// ── view once ────────────────────────────────────────────────────────────────
const OnceCard = ({ item, isMe, myId, onReveal }) => {
  const isImage = item.kind === 'once_image';
  const openedByMe = !!item.viewedBy?.has(myId);
  const openers = item.viewedBy ? [...item.viewedBy.values()] : [];

  if (isMe) {
    return (
      <div className="once-card">
        <div className="once-tag"><RiEyeLine size={14} /> View once</div>
        {isImage
          ? <img src={`${API}/api/teams/files/${item.msg.file_id}`} alt="view once" className="chat-image" loading="lazy" />
          : <Markdown text={item.text} />}
        {isImage && item.text && <Markdown text={item.text} />}
        <div className="once-status">{openers.length ? `Opened by ${openers.join(', ')}` : 'Not opened yet'}</div>
      </div>
    );
  }
  if (openedByMe) {
    return (
      <div className="once-card opened"><RiEyeOffLine size={18} /> <span>Opened · {isImage ? 'Photo' : 'Message'}</span></div>
    );
  }
  return (
    <button type="button" className="once-card tap" onClick={() => onReveal(item)}>
      <RiEyeLine size={18} /> <span>{isImage ? 'Photo' : 'Message'} · Tap to view once</span>
    </button>
  );
};

// ── bubble ───────────────────────────────────────────────────────────────────
const MessageBubble = memo(({
  item, isMe, isFirst, isLast, mode = 'main', myId, memberNames, mentionNames, otherCount,
  byId, threadCount, flash, onOpenImage, onMenu, onReact, onVote, onReveal, onOpenThread, onJump, onRetry,
}) => {
  const msg = item.msg;
  const fileUrl = msg.file_id ? `${API}/api/teams/files/${msg.file_id}` : null;
  const [showInfo, setShowInfo] = useState(false);
  const pressTimer = useRef(null);

  const readByList = msg.read_by ? msg.read_by.split(',').map(s => s.trim()) : [];
  const readers    = readByList.filter(id => id && id !== String(msg.sender_id));
  const isRead     = readers.length > 0;
  const readByAll  = otherCount > 0 && readers.length >= otherCount; // blue only once everyone has read it
  const emojiOnly  = (item.kind === 'text' || item.kind === 'rich') && !item.replyId && isEmojiOnly(item.text);
  const senderColor = colorFor(msg.sender_id);
  const unreadNames = Object.keys(memberNames)
    .filter(id => id !== String(msg.sender_id) && !readers.includes(id))
    .map(id => memberNames[id]);

  // Close the "message info" popover on any outside click or Escape.
  useEffect(() => {
    if (!showInfo) return undefined;
    const close = () => setShowInfo(false);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [showInfo]);

  const interactive = !msg._tmp && item.kind !== 'deleted';
  const openMenu = (e) => { if (!interactive) return; e.preventDefault(); onMenu(e, item, mode); };

  // Long-press opens the menu on touch screens.
  const pressStart = (e) => {
    if (!interactive) return;
    const t = e.touches?.[0];
    if (!t) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => onMenu({ clientX: t.clientX, clientY: t.clientY, preventDefault() {} }, item, mode), 450);
  };
  const pressEnd = () => clearTimeout(pressTimer.current);

  // reply quote
  const quoted = item.replyId ? byId.get(item.replyId) : null;

  // reaction chips grouped by emoji
  const chips = [];
  if (item.reactions && item.reactions.size) {
    const g = new Map();
    item.reactions.forEach((v, uid) => {
      if (!g.has(v.e)) g.set(v.e, { e: v.e, names: [], mine: false });
      const c = g.get(v.e);
      c.names.push(uid === myId ? 'You' : v.name);
      if (uid === myId) c.mine = true;
    });
    chips.push(...g.values());
  }

  let body;
  if (item.kind === 'deleted') {
    body = (
      <div className="chat-deleted"><RiForbid2Line size={15} /> {isMe ? 'You deleted this message' : 'This message was deleted'}</div>
    );
  } else if (item.kind === 'poll') {
    body = <PollCard item={item} myId={myId} onVote={onVote} />;
  } else if (item.kind === 'once' || item.kind === 'once_image') {
    body = <OnceCard item={item} isMe={isMe} myId={myId} onReveal={onReveal} />;
  } else if (item.kind === 'image') {
    body = (
      <div>
        <img src={fileUrl} alt={msg.file_name} className="chat-image" loading="lazy" onClick={() => onOpenImage(fileUrl, msg.file_name)} />
        {item.text && <Markdown text={item.text} names={mentionNames} />}
      </div>
    );
  } else if (item.kind === 'video') {
    body = <video controls preload="metadata" className="chat-video" src={fileUrl} />;
  } else if (item.kind === 'audio') {
    body = <audio controls preload="none" src={fileUrl} style={{ width: '100%', marginTop: 4 }} />;
  } else if (item.kind === 'pdf' || item.kind === 'file') {
    body = (
      <a href={fileUrl} target="_blank" rel="noreferrer" className="chat-file-card">
        <FileIcon type={item.kind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.file_name}</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>{formatFileSize(msg.file_size)}</div>
        </div>
        <RiDownloadLine size={16} />
      </a>
    );
  } else {
    body = <Markdown text={item.text} names={mentionNames} />;
  }

  const showAvatar = !isMe && mode === 'main';

  return (
    <div
      className={`chat-bubble-row ${isMe ? 'me' : 'them'} ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''} ${flash ? 'flash' : ''}`}
      data-mid={item.id}
      onContextMenu={openMenu}
      onTouchStart={pressStart} onTouchEnd={pressEnd} onTouchMove={pressEnd} onTouchCancel={pressEnd}
    >
      {showAvatar && (
        isLast ? (
          <div className="chat-avatar" style={{ background: senderColor, color: '#fff' }}>
            {(msg.sender_name || 'U').charAt(0).toUpperCase()}
          </div>
        ) : <div className="chat-avatar-spacer" />
      )}

      <div className={`chat-bubble ${isMe ? 'bubble-me' : 'bubble-them'} ${isFirst ? 'has-tail' : ''} ${emojiOnly ? 'emoji-only' : ''} ${item.kind === 'poll' ? 'is-poll' : ''}`}>
        {interactive && (
          <button type="button" className="chat-menu-btn" onClick={openMenu} title="Message options" aria-label="Message options">
            <RiArrowDownSLine size={18} />
          </button>
        )}

        {!isMe && isFirst && <div className="chat-sender-name" style={{ color: senderColor }}>{msg.sender_name}</div>}

        {item.replyId && item.kind !== 'deleted' && (
          <button
            type="button" className="chat-quote"
            style={{ borderLeftColor: quoted ? colorFor(quoted.msg.sender_id) : undefined }}
            onClick={() => quoted && onJump(item.replyId)}
          >
            <span className="chat-quote-name" style={{ color: quoted ? colorFor(quoted.msg.sender_id) : undefined }}>
              {quoted ? (String(quoted.msg.sender_id) === myId ? 'You' : quoted.msg.sender_name) : 'Message'}
            </span>
            <span className="chat-quote-text">{quoted ? previewOf(quoted) : 'Original message not loaded'}</span>
          </button>
        )}

        {body}

        {chips.length > 0 && (
          <div className="chat-reacts">
            {chips.map(c => (
              <button
                key={c.e} type="button" className={`chat-react ${c.mine ? 'mine' : ''}`}
                title={c.names.join(', ')} onClick={() => onReact(item, c.mine ? '' : c.e)}
              >
                <span>{c.e}</span>{c.names.length > 1 && <b>{c.names.length}</b>}
              </button>
            ))}
          </div>
        )}

        {mode === 'main' && threadCount > 0 && item.kind !== 'deleted' && (
          <button type="button" className="chat-thread-link" onClick={() => onOpenThread(item)}>
            <RiChat3Line size={14} /> {threadCount} {threadCount === 1 ? 'reply' : 'replies'}
          </button>
        )}

        <div className="chat-meta">
          {item.pinned && <span className="chat-pin-mark" title="Pinned"><RiPushpinFill size={12} /></span>}
          <span className="chat-time">{formatTime(msg.created_time)}</span>
          {isMe && item.kind !== 'deleted' && (
            msg._failed ? (
              <button
                type="button" onClick={() => onRetry(msg)} title="Tap to retry"
                style={{ background: 'none', border: 0, padding: 0, color: '#ff6b6b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11 }}
              >
                <RiErrorWarningLine size={13} /> Failed · retry
              </button>
            ) : msg._tmp ? (
              <span className="chat-tick"><RiTimeLine size={13} /></span>
            ) : (
              <button
                type="button" className={`chat-tick ${readByAll ? 'read' : ''}`}
                onClick={() => setShowInfo(v => !v)}
                title={readByAll ? 'Read by everyone' : isRead ? 'Read by some' : 'Sent'}
              >
                {isRead ? <RiCheckDoubleLine size={14} /> : <RiCheckLine size={14} />}
              </button>
            )
          )}
        </div>

        {isMe && showInfo && !msg._tmp && (
          <div className="chat-info-pop" onClick={() => setShowInfo(false)}>
            <div className="chat-info-title">Message info</div>
            <div className="chat-info-row"><b>Read by</b>
              <span>{readers.length ? readers.map(id => memberNames[id] || 'Member').join(', ') : '—'}</span>
            </div>
            {unreadNames.length > 0 && (
              <div className="chat-info-row"><b>Not read yet</b><span>{unreadNames.join(', ')}</span></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
