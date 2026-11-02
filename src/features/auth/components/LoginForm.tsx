'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Phone, Lock, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { detectIdentifierType, validateUsername, validatePhoneNumber } from '@/lib/validations';

interface LoginFormProps {
  onSuccess: (data: {
    userId: string;
    email: string;
    maskedEmail: string;
    expirySeconds: number;
    devPreviewOtp?: string;
  }) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'username' | 'phone'>('username');
  const [identifier, setIdentifier] = useState('jon222597');
  const [password, setPassword] = useState('Pass@1234');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim()) {
      setError(`Please enter your ${activeTab === 'username' ? 'Username' : 'Phone number'}.`);
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    // Client-side quick syntax check
    if (activeTab === 'phone') {
      const phoneCheck = validatePhoneNumber(identifier);
      if (!phoneCheck.isValid) {
        setError(phoneCheck.error || 'Invalid phone number format.');
        return;
      }
    } else {
      const userCheck = validateUsername(identifier);
      if (!userCheck.isValid) {
        setError(userCheck.error || 'Invalid username format.');
        return;
      }
    }

    try {
      setIsLoading(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.message || 'Login failed. Please verify your credentials.');
        return;
      }

      onSuccess(json.data);
    } catch (err: any) {
      setError('Failed to reach server. Please check your network connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabSwitch = (tab: 'username' | 'phone') => {
    setActiveTab(tab);
    setError(null);
    if (tab === 'phone' && identifier === 'jon222597') {
      setIdentifier('9876543211');
    } else if (tab === 'username' && identifier === '9876543211') {
      setIdentifier('jon222597');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Sliding Mode Switcher with Framer Motion LayoutId */}
      <div
        style={{
          display: 'flex',
          background: '#f1f5f9',
          padding: '4px',
          borderRadius: '12px',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={() => handleTabSwitch('username')}
          style={{
            flex: 1,
            padding: '9px 14px',
            fontSize: '13px',
            fontWeight: activeTab === 'username' ? 700 : 500,
            color: activeTab === 'username' ? '#0284c7' : 'var(--text-muted)',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'color 0.2s ease',
          }}
        >
          {activeTab === 'username' && (
            <motion.div
              layoutId="loginTabPill"
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              style={{
                position: 'absolute',
                inset: 0,
                background: '#ffffff',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                zIndex: -1,
              }}
            />
          )}
          <User size={15} /> Username
        </button>

        <button
          type="button"
          onClick={() => handleTabSwitch('phone')}
          style={{
            flex: 1,
            padding: '9px 14px',
            fontSize: '13px',
            fontWeight: activeTab === 'phone' ? 700 : 500,
            color: activeTab === 'phone' ? '#0284c7' : 'var(--text-muted)',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'color 0.2s ease',
          }}
        >
          {activeTab === 'phone' && (
            <motion.div
              layoutId="loginTabPill"
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              style={{
                position: 'absolute',
                inset: 0,
                background: '#ffffff',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                zIndex: -1,
              }}
            />
          )}
          <Phone size={15} /> Phone Number
        </button>
      </div>

      {/* Dynamic Identifier Input */}
      {activeTab === 'username' ? (
        <Input
          label="Username"
          placeholder="e.g. jon222597 or admin"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            if (error) setError(null);
          }}
          leftIcon={<User size={18} />}
          hint="Strict: min 4 chars, alphanumeric"
          autoComplete="username"
          autoFocus
        />
      ) : (
        <Input
          label="Phone Number"
          placeholder="e.g. 9876543211"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            if (error) setError(null);
          }}
          leftIcon={<Phone size={18} />}
          hint="Strict: 10 digits mobile number"
          autoComplete="tel"
          autoFocus
        />
      )}

      {/* Password Input */}
      <div>
        <Input
          label="Password"
          placeholder="Enter password (e.g. Pass@1234)"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          isPassword
          leftIcon={<Lock size={18} />}
          autoComplete="current-password"
        />
      </div>

      {/* Error Banner */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            background: '#fff1f2',
            border: '1px solid #fecdd3',
            color: '#be123c',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '13px',
            lineHeight: 1.4,
          }}
        >
          {error}
        </motion.div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={isLoading}
        rightIcon={<ArrowRight size={18} />}
      >
        Sign In & Receive Real OTP
      </Button>
    </form>
  );
};
