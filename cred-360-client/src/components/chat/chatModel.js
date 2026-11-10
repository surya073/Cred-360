// Pure helpers that turn the raw TeamMessages rows (messages + small action "evt" rows) into
// the state the chat UI renders. No React in here, so it is easy to reason about and test.
//
// Row kinds (message_type): text | rich | poll | once | once_image | deleted | evt |
//                           image | video | audio | pdf | file
// See functions/cred_360_function/chat.js for how each is stored.

export const parseJson = (s) => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
};

export const isEvent = (m) => m.message_type === 'evt';

// A message that carries content (as opposed to an invisible action event).
export const isContent = (m) => !isEvent(m);

const FILE_KINDS = new Set(['image', 'video', 'audio', 'pdf', 'file']);

// Fold events (in order, so the latest one wins) and decorate every message.
//   items        top-level messages for the main timeline (thread replies excluded)
//   threads      rootId -> thread replies
//   byId         every message by ROWID (for quoting / jumping)
//   pinned       ids of pinned messages, newest pin first
export function buildChatState(messages, myId) {
  const reactions = new Map();   // target -> Map(userId -> { e, name })
  const votes     = new Map();   // target -> Map(userId -> { i:number[], name })
  const pinSeq    = new Map();   // target -> order of the pin event
  const viewed    = new Map();   // target -> Map(userId -> name)
  const deletedMe = new Set();
  const deletedAll = new Set();
  let seq = 0;

  const mapFor = (store, key) => {
    if (!store.has(key)) store.set(key, new Map());
    return store.get(key);
  };

  for (const m of messages) {
    if (!isEvent(m)) continue;
    const ev = parseJson(m.message);
    if (!ev || !ev.t) continue;
    const uid = String(m.sender_id);
    const t = String(ev.t);
    const name = m.sender_name || 'Member';
    switch (ev.o) {
      case 'react': {
        const mp = mapFor(reactions, t);
        if (ev.e) mp.set(uid, { e: ev.e, name }); else mp.delete(uid);
        break;
      }
      case 'vote': {
        const mp = mapFor(votes, t);
        if (Array.isArray(ev.i) && ev.i.length) mp.set(uid, { i: ev.i, name }); else mp.delete(uid);
        break;
      }
      case 'pin':   pinSeq.set(t, ++seq); break;
      case 'unpin': pinSeq.delete(t); break;
      case 'viewed': mapFor(viewed, t).set(String(ev.u || uid), name); break;
      case 'delme':  if (uid === myId) deletedMe.add(t); break;
      case 'del':    deletedAll.add(t); break;
      default: break;
    }
  }

  const byId = new Map();
  const decorate = (m) => {
    const id = String(m.ROWID);
    let kind = m.message_type;
    let text = '';
    let meta = null;

    if (kind === 'deleted' || deletedAll.has(id)) {
      kind = 'deleted';
    } else if (kind === 'rich') {
      meta = parseJson(m.message) || {};
      text = meta.x || '';
    } else if (kind === 'poll') {
      meta = parseJson(m.message) || { q: '', o: [], m: 0 };
    } else if (kind === 'text') {
      text = m.message || '';
    } else if (kind === 'once') {
      meta = parseJson(m.message); // only the sender receives content
      text = meta?.x || '';
    } else if (FILE_KINDS.has(kind) || kind === 'once_image') {
      text = m.message || ''; // caption
    }

    const item = {
      msg: m, id, kind, text, meta,
      replyId: meta?.r ? String(meta.r) : null,
      threadOf: meta?.th ? String(meta.th) : null,
      reactions: reactions.get(id) || null,
      votes: votes.get(id) || null,
      viewedBy: viewed.get(id) || null,
      pinned: pinSeq.has(id),
    };
    byId.set(id, item);
    return item;
  };

  const all = messages.filter(isContent).map(decorate);
  const items = [];
  const threads = new Map();
  for (const it of all) {
    if (deletedMe.has(it.id)) continue;
    if (it.threadOf) {
      if (!threads.has(it.threadOf)) threads.set(it.threadOf, []);
      threads.get(it.threadOf).push(it);
    } else {
      items.push(it);
    }
  }

  const pinned = [...pinSeq.entries()]
    .filter(([id]) => byId.has(id) && byId.get(id).kind !== 'deleted' && !deletedMe.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return { items, threads, byId, pinned };
}

// Markdown → plain text, for one-line previews (quotes, pinned bar, delete dialog).
export function plainText(md) {
  let s = String(md || '')
    .replace(/```([\s\S]*?)```/g, (_, code) => ` ${code.trim()} `)
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-•]\s+/gm, '• ')
    .replace(/^\s*\d+[.)]\s+/gm, '');
  // paired markers, innermost first; two passes handle one level of nesting (*bold _x_*)
  for (let i = 0; i < 2; i++) s = s.replace(/([*_~`])(?=\S)([^*_~`\n]+?)(?<=\S)\1/g, '$2');
  return s.replace(/\s+/g, ' ').trim();
}

// Short plain-text preview of a message (reply quotes, pinned banner, thread header).
export function previewOf(item) {
  if (!item) return 'Original message';
  switch (item.kind) {
    case 'deleted':    return 'This message was deleted';
    case 'poll':       return `📊 ${item.meta?.q || 'Poll'}`;
    case 'once':       return '👁 View-once message';
    case 'once_image': return '👁 View-once photo';
    case 'image':      return `📷 ${item.text || 'Photo'}`;
    case 'video':      return `🎬 ${item.text || 'Video'}`;
    case 'audio':      return `🎵 ${item.text || 'Audio'}`;
    case 'pdf':
    case 'file':       return `📎 ${item.msg.file_name || 'File'}`;
    default:           return plainText(item.text).slice(0, 140);
  }
}

// Poll tallies: option index -> voter names, plus how many people voted.
export function tallyPoll(item, myId) {
  const options = item.meta?.o || [];
  const perOption = options.map(() => []);
  let voters = 0;
  let mine = [];
  if (item.votes) {
    item.votes.forEach((v, uid) => {
      voters++;
      if (uid === myId) mine = v.i;
      v.i.forEach(i => { if (perOption[i]) perOption[i].push(uid === myId ? 'You' : v.name); });
    });
  }
  return { options, perOption, voters, mine, multi: !!item.meta?.m };
}
