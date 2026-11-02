import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

const Tooltip = ({ label, position = 'bottom', children }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const hideTimer = useRef(null);

  // ← Disable tooltip on mobile (≤768px)
  const isMobile = () => window.innerWidth <= 768;

  const calculatePos = (el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (position === 'right') {
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 12 });
    } else {
      setPos({ top: rect.bottom + 10, left: rect.left + rect.width / 2 });
    }
  };

  const handleMouseEnter = (e) => {
    if (isMobile()) return; // ← skip
    clearTimeout(hideTimer.current);
    calculatePos(e.currentTarget);
    setShow(true);
  };

  const handleMouseLeave = () => {
    if (isMobile()) return; // ← skip
    hideTimer.current = setTimeout(() => setShow(false), 100);
  };

  const child = React.Children.only(children);

  const cloned = React.cloneElement(child, {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
  });

  return (
    <>
      {cloned}
      {show && createPortal(
        <div
          className={`app-tooltip app-tooltip-${position}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {label}
        </div>,
        document.body
      )}
    </>
  );
};

export default Tooltip;