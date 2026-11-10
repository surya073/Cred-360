import { useLayoutEffect, useState } from 'react';

// Height that makes an element fill the rest of the viewport below where it starts, so a page
// can fit the screen (with its own inner scrolling) instead of scrolling as a whole.
// Measured from the element itself, so it stays right whatever sits above it.
//   ref   ref of the element to size
//   deps  re-measure when these change (e.g. the view / tab that changes what is above it)
//   pad   breathing room kept below the element (match .main-content's bottom padding)
//   min   never shrink below this (tiny windows scroll normally instead)
export default function useFitHeight(ref, deps = [], { pad = 28, min = 380 } = {}) {
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) { setHeight(null); return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = Math.max(min, Math.floor(window.innerHeight - top - pad));
      setHeight(prev => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    // layout above can shift after fonts/images/data load; re-check once things settle
    const t = setTimeout(measure, 250);
    return () => { window.removeEventListener('resize', measure); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return height;
}
