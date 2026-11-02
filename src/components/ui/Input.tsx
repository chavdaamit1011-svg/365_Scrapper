'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  isPassword?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  leftIcon,
  rightElement,
  isPassword = false,
  type = 'text',
  className = '',
  id,
  ...props
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="spatial-input-container">
      {label && (
        <label htmlFor={inputId} className="spatial-input-label">
          <span>{label}</span>
        </label>
      )}

      <div className="spatial-input-wrapper">
        {leftIcon && <span className="spatial-input-icon">{leftIcon}</span>}

        <input
          id={inputId}
          type={inputType}
          className={`spatial-input ${leftIcon ? 'spatial-input-with-icon' : ''} ${className}`}
          style={{
            borderColor: error ? 'var(--accent-rose)' : undefined,
            paddingRight: isPassword || rightElement ? 44 : 16,
          }}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            className="spatial-input-action"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}

        {!isPassword && rightElement && (
          <div style={{ position: 'absolute', right: 12, display: 'flex', alignItems: 'center' }}>
            {rightElement}
          </div>
        )}
      </div>

      {error ? (
        <span className="spatial-input-error-text">{error}</span>
      ) : hint ? (
        <span className="spatial-input-hint">{hint}</span>
      ) : null}
    </div>
  );
};

