'use client';

import React from 'react';
import { motion } from 'framer-motion';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  className = '',
  onClick,
  type = 'button',
  ...props
}) => {
  const variantClass = {
    primary: 'spatial-btn-primary',
    secondary: 'spatial-btn-secondary',
    danger: 'spatial-btn-danger',
    ghost: 'spatial-btn-ghost',
  }[variant];

  const sizeClass = {
    sm: 'spatial-btn-sm',
    md: '',
    lg: 'spatial-btn-lg',
  }[size];

  return (
    <motion.button
      type={type}
      whileHover={!disabled && !isLoading ? { scale: 1.015, y: -0.5 } : undefined}
      whileTap={!disabled && !isLoading ? { scale: 0.98, y: 0.5 } : undefined}
      transition={{ type: 'spring', damping: 25, stiffness: 450, mass: 0.4 }}
      className={`spatial-btn ${variantClass} ${sizeClass} ${className}`}
      disabled={disabled || isLoading}
      style={{ width: fullWidth ? '100%' : 'auto' }}
      onClick={onClick}
      {...(props as any)}
    >
      {isLoading ? (
        <span
          style={{
            display: 'inline-block',
            width: 16,
            height: 16,
            border: '2px solid rgba(255,255,255,0.4)',
            borderTopColor: '#ffffff',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      ) : (
        leftIcon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>{rightIcon}</span>
      )}
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </motion.button>
  );
};
