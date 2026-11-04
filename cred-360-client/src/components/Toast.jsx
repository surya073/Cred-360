import React, { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RiCheckLine, RiErrorWarningLine, RiAlertLine, RiInformationLine, RiCloseLine } from 'react-icons/ri';

/*
 * Unified app notification: a small pill pinned to the top-center of the screen.
 *   success -> green   warning -> yellow   error -> red   info -> blue
 * Only the latest message is shown. Styles live in styles/toast.css.
 */
const ICONS = {
  success: <RiCheckLine size={16} />,
  warning: <RiAlertLine size={16} />,
  error:   <RiErrorWarningLine size={16} />,
  info:    <RiInformationLine size={16} />,
};

export const Toast = ({ toasts, removeToast }) => {
  if (!toasts.length) return null;

  const t    = toasts[toasts.length - 1];
  const type = ICONS[t.type] ? t.type : 'info';

  return createPortal(
    <div className="ks-toast-wrap" role="status" aria-live="polite">
      <div key={t.id} className={`ks-toast ks-toast-${type}`}>
        <span className="ks-toast-icon">{ICONS[type]}</span>
        <span className="ks-toast-msg">{t.message}</span>
        <button className="ks-toast-close" onClick={() => removeToast(t.id)} aria-label="Dismiss">
          <RiCloseLine size={14} />
        </button>
      </div>
    </div>,
    document.body
  );
};

export const useToast = () => {
  const [toasts, setToasts] = React.useState([]);
  const seq = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++seq.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const toast = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    warning: (msg, dur) => addToast(msg, 'warning', dur),
    error:   (msg, dur) => addToast(msg, 'error',   dur),
    info:    (msg, dur) => addToast(msg, 'info',    dur),
  };

  return { toasts, removeToast, toast };
};

export default Toast;
