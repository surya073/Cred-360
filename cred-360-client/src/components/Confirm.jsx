import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiDeleteBinLine, RiErrorWarningLine, RiQuestionLine } from 'react-icons/ri';

const CONFIG = {
  danger: {
    icon: <RiDeleteBinLine size={28} />,
    color: 'var(--danger)',
    bg:    'var(--danger-bg)',
    ring:  'rgba(220,38,38,0.15)',
  },
  warning: {
    icon: <RiErrorWarningLine size={28} />,
    color: 'var(--warning)',
    bg:    'var(--warning-bg)',
    ring:  'rgba(217,119,6,0.15)',
  },
  default: {
    icon: <RiQuestionLine size={28} />,
    color: 'var(--primary)',
    bg:    'var(--primary-light)',
    ring:  'rgba(124,58,237,0.15)',
  },
};

export const Confirm = ({ confirmState, onCancel, onConfirm }) => {
  if (!confirmState) return null;

  const cfg = CONFIG[confirmState.type] || CONFIG.default;

  return createPortal(
    <div className="sa-overlay" onClick={onCancel}>
      <div
        className="sa-card"
        style={{ '--sa-color': cfg.color, '--sa-bg': cfg.bg, '--sa-ring': cfg.ring }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sa-icon-wrap">
          <div className="sa-icon-ring" />
          <div className="sa-icon">{cfg.icon}</div>
        </div>
        {confirmState.title && <p className="sa-title">{confirmState.title}</p>}
        <p className="sa-message">{confirmState.message}</p>
        <div className="sa-btn-row">
          <button className="sa-btn sa-btn-ghost" onClick={onCancel}>
            {confirmState.cancelLabel || 'Cancel'}
          </button>
          <button className="sa-btn" onClick={onConfirm} disabled={confirmState.loading}>
            {confirmState.loading ? 'Please wait...' : (confirmState.confirmLabel || 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const useConfirm = () => {
  const [confirmState, setConfirmState] = useState(null);
  const [resolver, setResolver] = useState(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setConfirmState({ message, loading: false, ...options });
      setResolver(() => resolve);
    });
  }, []);

  const handleCancel = useCallback(() => {
    if (resolver) resolver(false);
    setConfirmState(null);
    setResolver(null);
  }, [resolver]);

  const handleConfirm = useCallback(() => {
    if (resolver) resolver(true);
    setConfirmState(null);
    setResolver(null);
  }, [resolver]);

  const setLoading = useCallback((val) => {
    setConfirmState(prev => prev ? { ...prev, loading: val } : prev);
  }, []);

  return { confirmState, confirm, handleCancel, handleConfirm, setLoading };
};

export default Confirm;