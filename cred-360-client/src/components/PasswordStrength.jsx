import React, { useMemo } from 'react';

const getStrength = (password) => {
  if (!password) return { score: 0, label: '', color: '' };

  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { score, label: 'Weak',    color: '#dc2626', width: '25%'  };
  if (score <= 3) return { score, label: 'Fair',    color: '#d97706', width: '50%'  };
  if (score <= 4) return { score, label: 'Good',    color: '#0284c7', width: '75%'  };
  return           { score, label: 'Strong',  color: '#16a34a', width: '100%' };
};

const PasswordStrength = ({ password }) => {
  const strength = useMemo(() => getStrength(password), [password]);

  if (!password) return null;

  return (
    <div className="pw-strength">
      <div className="pw-strength-bar">
        <div
          className="pw-strength-fill"
          style={{
            width: strength.width,
            background: strength.color,
          }}
        />
      </div>
      <span
        className="pw-strength-label"
        style={{ color: strength.color }}
      >
        {strength.label}
      </span>
    </div>
  );
};

export default PasswordStrength;
