'use client';

import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  hoverEffect?: boolean;
  tiltEffect?: boolean; // kept for interface compatibility
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  style,
  hoverEffect = false,
}) => {
  return (
    <div
      className={`pro-card ${className}`}
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.02)',
        position: 'relative',
        transition: hoverEffect ? 'border-color 0.2s ease, box-shadow 0.2s ease' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
