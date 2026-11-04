import React, { useId } from 'react';

const SHIELD = 'M32 4 55 12.5V30c0 14.5-9.6 24.5-23 30C18.600 54.500 9 44.500 9 30V12.500Z';

/** KeyShare brand mark: shield + keyhole. `tile={false}` draws a single-colour version using currentColor. */
const KeyShareLogo = ({ size = 32, tile = true, className = '', title = 'KeyShare' }) => {
  const gid = useId().replace(/:/g, '');
  const hole = tile ? '#fff' : 'var(--bg-primary, #fff)';
  return (
    <svg
      className={`keyshare-logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
    >
      {tile && (
        <defs>
          <linearGradient id={`ks-${gid}`} x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4f9bff" />
            <stop offset="1" stopColor="#1d5fd6" />
          </linearGradient>
        </defs>
      )}
      <path d={SHIELD} fill={tile ? `url(#ks-${gid})` : 'currentColor'} />
      <path d="M32 21a7 7 0 0 1 3.200 13.200L37 46.500H27l1.800-12.300A7 7 0 0 1 32 21Z" fill={hole} />
      <circle cx="32" cy="28" r="2.800" fill="#34d57a" />
    </svg>
  );
};

export default KeyShareLogo;
