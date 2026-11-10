import React, { useState } from 'react';
import { RiCloseLine, RiAddLine, RiDeleteBinLine } from 'react-icons/ri';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

// "Create poll" dialog. Calls onCreate({ question, options, multi }) and stays open until it resolves.
const PollModal = ({ onClose, onCreate }) => {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);

  const filled = options.map(o => o.trim()).filter(Boolean);
  const canSend = question.trim() && filled.length >= MIN_OPTIONS && !busy;

  const setOpt = (i, v) => setOptions(prev => prev.map((o, j) => (j === i ? v : o)));

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await onCreate({ question: question.trim(), options: filled, multi });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-modal-overlay" onMouseDown={onClose}>
      <div className="chat-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Create poll">
        <div className="chat-modal-head">
          <h3>Create poll</h3>
          <button className="chat-icon-btn" onClick={onClose} title="Close"><RiCloseLine size={20} /></button>
        </div>

        <label className="chat-field-label">Question</label>
        <input
          className="chat-field" placeholder="Ask something…" maxLength={200} autoFocus
          value={question} onChange={(e) => setQuestion(e.target.value)}
        />

        <label className="chat-field-label">Options</label>
        {options.map((o, i) => (
          <div className="chat-opt-row" key={i}>
            <input
              className="chat-field" placeholder={`Option ${i + 1}`} maxLength={100}
              value={o} onChange={(e) => setOpt(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && i === options.length - 1 && options.length < MAX_OPTIONS) setOptions(p => [...p, '']); }}
            />
            {options.length > MIN_OPTIONS && (
              <button className="chat-icon-btn" onClick={() => setOptions(p => p.filter((_, j) => j !== i))} title="Remove option">
                <RiDeleteBinLine size={17} />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button className="chat-link-btn" onClick={() => setOptions(p => [...p, ''])}>
            <RiAddLine size={16} /> Add option
          </button>
        )}

        <label className="chat-check">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Allow multiple answers
        </label>

        <div className="chat-modal-foot">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSend}>
            {busy ? 'Sending…' : 'Send poll'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PollModal;
