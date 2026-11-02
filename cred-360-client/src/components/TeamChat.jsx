import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  RiSendPlaneLine, RiAttachmentLine, RiImageLine,
  RiFileLine, RiMusicLine, RiVideoLine, RiFilePdfLine,
  RiDownloadLine, RiCheckDoubleLine, RiCheckLine,
  RiRefreshLine
} from 'react-icons/ri';

const API = '/server/cred_360_function';

const formatTime = (t) => {
  if (!t) return '';
  try {
    return new Date(t.replace(' ', 'T') + 'Z').toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit'
    });
  } catch(e) { return ''; }
};

const formatFileSize = (bytes) => {
  if (!bytes) return '';
  const b = parseInt(bytes);
  if (b < 1024)         return `${b} B`;
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const FileIcon = ({ type }) => {
  if (type === 'image') return <RiImageLine size={20} />;
  if (type === 'video') return <RiVideoLine size={20} />;
  if (type === 'audio') return <RiMusicLine size={20} />;
  if (type === 'pdf')   return <RiFilePdfLine size={20} />;
  return <RiFileLine size={20} />;
};

const MessageBubble = ({ msg, isMe, currentUserId }) => {
  const fileUrl = msg.file_id ? `${API}/api/teams/files/${msg.file_id}` : null;
  const readByList = msg.read_by ? msg.read_by.split(',').map(s => s.trim()) : [];
  const isRead = readByList.filter(id => id !== String(currentUserId)).length > 0;

  return (
    <div className={`chat-bubble-row ${isMe ? 'me' : 'them'}`}>
      {!isMe && (
        <div className="chat-avatar">
          {(msg.sender_name || 'U').charAt(0).toUpperCase()}
        </div>
      )}
      <div className={`chat-bubble ${isMe ? 'bubble-me' : 'bubble-them'}`}>
        {!isMe && (
          <div className="chat-sender-name">{msg.sender_name}</div>
        )}

        {msg.message_type === 'text' && (
          <div className="chat-text">{msg.message}</div>
        )}

        {msg.message_type === 'image' && (
          <div>
            <img
              src={fileUrl} alt={msg.file_name}
              className="chat-image"
              onClick={() => window.open(fileUrl, '_blank')}
            />
            {msg.message && (
              <div className="chat-text" style={{ marginTop: 4 }}>{msg.message}</div>
            )}
          </div>
        )}

        {msg.message_type === 'video' && (
          <video controls className="chat-video" src={fileUrl} />
        )}

        {msg.message_type === 'audio' && (
          <audio controls src={fileUrl} style={{ width: '100%', marginTop: 4 }} />
        )}

        {(msg.message_type === 'pdf' || msg.message_type === 'file') && (
          <a href={fileUrl} target="_blank" rel="noreferrer" className="chat-file-card">
            <FileIcon type={msg.message_type} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {msg.file_name}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {formatFileSize(msg.file_size)}
              </div>
            </div>
            <RiDownloadLine size={16} />
          </a>
        )}

        <div className="chat-meta">
          <span className="chat-time">{formatTime(msg.created_time)}</span>
          {isMe && (
            <span style={{ color: isRead ? '#34b7f1' : 'rgba(255,255,255,0.6)' }}>
              {isRead
                ? <RiCheckDoubleLine size={13} />
                : <RiCheckLine size={13} />
              }
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const TeamChat = ({ team, currentUser, members }) => {
  const [messages, setMessages] = useState([]);
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading]   = useState(true);
  const bottomRef = useRef(null);
  const fileRef   = useRef(null);
  const pollRef   = useRef(null);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  };

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await axios.get(`${API}/api/teams/${team.ROWID}/messages`);
      if (res.data.success) {
        setMessages(prev => {
          const newMsgs = res.data.data || [];
          if (JSON.stringify(prev.map(m => m.ROWID)) !== JSON.stringify(newMsgs.map(m => m.ROWID))) {
            return newMsgs;
          }
          return prev;
        });
      }
      axios.patch(`${API}/api/teams/${team.ROWID}/messages/read`).catch(() => {});
    } catch(e) {}
    finally { setLoading(false); }
  }, [team.ROWID]);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(() => fetchMessages(true), 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length]);

  const sendText = async () => {
    if (!text.trim()) return;
    const msg = text.trim();
    setText('');
    setSending(true);
    try {
      await axios.post(`${API}/api/teams/${team.ROWID}/messages`, { message: msg });
      await fetchMessages(true);
      setTimeout(() => scrollToBottom(), 100);
    } catch(e) {
      setText(msg);
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      alert('File must be under 10MB');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', '');
      await axios.post(
        `${API}/api/teams/${team.ROWID}/messages/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      await fetchMessages(true);
      setTimeout(() => scrollToBottom(), 100);
    } catch(e) {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  };

  const groupByDate = (msgs) => {
    const groups = {};
    msgs.forEach(msg => {
      const date = msg.created_time
        ? new Date(msg.created_time.replace(' ', 'T') + 'Z').toLocaleDateString()
        : 'Unknown';
      if (!groups[date]) groups[date] = [];
      groups[date].push(msg);
    });
    return groups;
  };

  const grouped = groupByDate(messages);

  return (
    <div className="team-chat">
      <div className="chat-header">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            {team.name} — Group Chat
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {members.length} members · refreshes every 5s
          </div>
        </div>
        <button
          className="nav-icon-btn"
          onClick={() => fetchMessages()}
          title="Refresh"
          style={{ flexShrink: 0 }}
        >
          <RiRefreshLine size={16} />
        </button>
      </div>

      <div className="chat-messages">
        {loading ? (
          <div className="chat-empty">
            <div className="chat-spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
            <p>Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div style={{ fontSize: 36, marginBottom: 10 }}>
              <RiSendPlaneLine size={36} />
            </div>
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, msgs]) => (
            <div key={date}>
              <div className="chat-date-divider">
                <span>{date}</span>
              </div>
              {msgs.map((msg, i) => (
                <MessageBubble
                  key={msg.ROWID || i}
                  msg={msg}
                  isMe={String(msg.sender_id) === String(currentUser.user_id)}
                  currentUserId={currentUser.user_id}
                />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <button
          className="chat-attach-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach file (max 10MB)"
        >
          {uploading
            ? <div className="chat-spinner" style={{ width: 18, height: 18 }} />
            : <RiAttachmentLine size={20} />
          }
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
          onChange={handleFileSelect}
        />
        <textarea
          className="chat-input"
          placeholder="Type a message... (Enter to send)"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={sendText}
          disabled={sending || !text.trim()}
        >
          <RiSendPlaneLine size={18} />
        </button>
      </div>
    </div>
  );
};

export default TeamChat;
