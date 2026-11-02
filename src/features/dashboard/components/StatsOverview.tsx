'use client';

import React from 'react';
import { Users, ShieldAlert, KeyRound, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';

interface StatsOverviewProps {
  userCount: number;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ userCount }) => {
  const stats = [
    {
      title: 'Registered Users',
      value: userCount,
      description: 'Authorized logins configured in system',
      icon: <Users size={20} color="#0284c7" />,
      bg: 'rgba(2, 132, 199, 0.08)',
    },
    {
      title: 'OTP Expiry Protocol',
      value: '60 Seconds',
      description: 'Strict time-based one-time email verification',
      icon: <KeyRound size={20} color="#10b981" />,
      bg: 'rgba(16, 185, 129, 0.08)',
    },
    {
      title: 'Credential Security',
      value: 'Strict Rules',
      description: 'Enforces uppercase, lowercase, special char, digits',
      icon: <ShieldAlert size={20} color="#f59e0b" />,
      bg: 'rgba(245, 158, 11, 0.08)',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '20px',
        marginBottom: '28px',
      }}
    >
      {stats.map((s, idx) => (
        <Card key={idx} style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
              {s.title}
            </span>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: s.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {s.icon}
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-main)', marginBottom: '4px' }}>
            {s.value}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-subtle)', margin: 0 }}>
            {s.description}
          </p>
        </Card>
      ))}
    </div>
  );
};

