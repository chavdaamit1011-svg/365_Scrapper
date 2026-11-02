'use client';

import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'primary',
  className = '',
  icon,
}) => {
  const variantClass = {
    primary: 'spatial-badge-primary',
    success: 'spatial-badge-success',
    warning: 'spatial-badge-warning',
    danger: 'spatial-badge-danger',
  }[variant];

  return (
    <span className={`spatial-badge ${variantClass} ${className}`}>
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  );
};

