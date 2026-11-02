'use client';

import React from 'react';
import { LogOut, Radar } from 'lucide-react';
import { UserSummary } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface DashboardHeaderProps {
  user: UserSummary | null;
  onLogout: () => void;
  onOpenCreateUser: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  user,
  onLogout,
  onOpenCreateUser,
}) => {
  return (
    <header
      className="spatial-glass spatial-specular"
      style={{
        padding: '16px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '32px',
        borderRadius: '20px',
      }}
    >
      {/* Brand Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            boxShadow: '0 8px 16px -2px rgba(2, 132, 199, 0.4)',
          }}
        >
          <Radar size={22} />
        </div>
        <div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: 'var(--text-main)',
              letterSpacing: '-0.5px',
              margin: 0,
            }}
          >
            The Scrapper
          </h1>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Spatial Security & User Management Portal
          </span>
        </div>
      </div>

      {/* User Session & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {user && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '6px 14px',
              background: '#f8fafc',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                {user.username}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{user.phoneNumber}</div>
            </div>
            <Badge variant="primary">{user.role}</Badge>
          </div>
        )}

        <Button variant="primary" size="sm" onClick={onOpenCreateUser}>
          + Create User
        </Button>

        <button
          type="button"
          onClick={onLogout}
          className="spatial-btn-secondary"
          style={{
            padding: '8px 14px',
            fontSize: '13px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
          title="Sign out of session"
        >
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </header>
  );
};
