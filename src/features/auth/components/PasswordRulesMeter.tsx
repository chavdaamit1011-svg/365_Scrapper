'use client';

import React from 'react';
import { Check, X } from 'lucide-react';
import { validatePassword } from '@/lib/validations';

interface PasswordRulesMeterProps {
  password: string;
}

export const PasswordRulesMeter: React.FC<PasswordRulesMeterProps> = ({ password }) => {
  const result = validatePassword(password);

  const rules = [
    { label: 'Minimum 8 characters', passed: result.hasMinLength },
    { label: 'At least 1 uppercase letter (A-Z)', passed: result.hasUpperCase },
    { label: 'At least 1 lowercase letter (a-z)', passed: result.hasLowerCase },
    { label: 'At least 1 number (0-9)', passed: result.hasNumber },
    { label: 'At least 1 special symbol (@, #, $, %, etc.)', passed: result.hasSpecialChar },
    { label: 'No spaces allowed', passed: result.hasNoSpaces },
  ];

  const getMeterColor = () => {
    if (result.score === 100) return '#10b981'; // Green
    if (result.score >= 60) return '#f59e0b'; // Amber
    return '#f43f5e'; // Red
  };

  return (
    <div
      style={{
        background: '#f8fafc',
        borderRadius: '12px',
        padding: '12px 16px',
        border: '1px solid #e2e8f0',
        marginTop: '6px',
      }}
    >
      {/* Progress Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
          Password Strength Rules:
        </span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: getMeterColor() }}>
          {result.score}%
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: '5px',
          background: '#e2e8f0',
          borderRadius: '9999px',
          overflow: 'hidden',
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            width: `${result.score}%`,
            height: '100%',
            background: getMeterColor(),
            transition: 'width 0.3s ease, background 0.3s ease',
            borderRadius: '9999px',
          }}
        />
      </div>

      {/* Rules Checklist */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {rules.map((rule, idx) => (
          <div key={idx} className={`rule-item ${rule.passed ? 'passed' : ''}`}>
            <span className={`rule-icon ${rule.passed ? 'passed' : 'failed'}`}>
              {rule.passed ? <Check size={10} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}
            </span>
            <span style={{ fontSize: '11px' }}>{rule.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

