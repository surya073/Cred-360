import { useEffect, useRef, useState } from 'react';

export const useCountUp = (target, duration = 900) => {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const from = prevTarget.current;
    const to = Number(target) || 0;
    if (from === to) { setValue(to); return; }

    const start = performance.now();
    let raf;

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(from + (to - from) * eased);
      setValue(current);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else prevTarget.current = to;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
};