import React, { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { RiCheckLine, RiErrorWarningLine, RiInformationLine, RiCloseLine } from 'react-icons/ri';

const CONFIG = {
  success: {
    icon: <RiCheckLine size={28} />,
    color: 'var(--success)',
    bg:    'var(--success-bg)',
    ring:  'rgba(22,163,74,0.15)',
  },
  error: {
    icon: <RiErrorWarningLine size={28} />,
    color: 'var(--danger)',
    bg:    'var(--danger-bg)',
    ring:  'rgba(220,38,38,0.15)',
  },
  info: {
    icon: <RiInformationLine size={28} />,
    color: 'var(--info)',
    bg:    'var(--info-bg)',
    ring:  'rgba(2,132,199,0.15)',
  },
};

export const Toast = ({ toasts, removeToast }) => {
  if (!toasts.length) return null;

  // Show only the latest toast (SweetAlert style — one at a time)
  const toast = toasts[toasts.length - 1];
  const cfg   = CONFIG[toast.type] || CONFIG.info;

  return createPortal(
    <div className="sa-overlay">
      <div className="sa-card" style={{ '--sa-color': cfg.color, '--sa-bg': cfg.bg, '--sa-ring': cfg.ring }}>
        <button className="sa-close" onClick={() => removeToast(toast.id)}>
          <RiCloseLine size={18} />
        </button>
        <div className="sa-icon-wrap">
          <div className="sa-icon-ring" />
          <div className="sa-icon">{cfg.icon}</div>
        </div>
        <p className="sa-message">{toast.message}</p>
        <button className="sa-btn" onClick={() => removeToast(toast.id)}>OK</button>
      </div>
    </div>,
    document.body
  );
};

export const useToast = () => {
  const [toasts, setToasts] = React.useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const toast = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    error:   (msg, dur) => addToast(msg, 'error',   dur),
    info:    (msg, dur) => addToast(msg, 'info',    dur),
  };

  return { toasts, removeToast, toast };
};

export default Toast;