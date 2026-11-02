'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { UserPlus, User, Phone, Mail, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PasswordRulesMeter } from '@/features/auth/components/PasswordRulesMeter';
import {
  validateUsername,
  validatePhoneNumber,
  validatePassword,
  validateEmail,
} from '@/lib/validations';
import { UserSummary } from '@/types';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated: (user: UserSummary) => void;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  isOpen,
  onClose,
  onUserCreated,
}) => {
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin' | 'manager'>('user');

  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Live client-side validation
  const usernameCheck = validateUsername(username);
  const phoneCheck = validatePhoneNumber(phoneNumber);
  const emailCheck = validateEmail(email);
  const passwordCheck = validatePassword(password);

  const isFormValid =
    usernameCheck.isValid &&
    phoneCheck.isValid &&
    emailCheck.isValid &&
    passwordCheck.isValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setSuccessMessage(null);

    if (!isFormValid) {
      setServerError('Please fix all validation errors before proceeding.');
      return;
    }

    try {
      setIsLoading(true);
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          phoneNumber,
          email,
          password,
          role,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setServerError(json.message || 'Failed to create user.');
        return;
      }

      setSuccessMessage(`User "${json.data.username}" created successfully in MongoDB!`);
      onUserCreated(json.data);

      setTimeout(() => {
        setUsername('');
        setPhoneNumber('');
        setEmail('');
        setPassword('');
        setRole('user');
        setSuccessMessage(null);
        onClose();
      }, 1200);
    } catch (err: any) {
      setServerError('Network error while creating user.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New User"
      description="Create a new authorized account stored in MongoDB. Credentials strictly validated."
      maxWidth="540px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Username */}
        <Input
          label="Username (Strict Rule: Min 4 chars, Alphanumeric)"
          placeholder="e.g. pilot_user"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (serverError) setServerError(null);
          }}
          leftIcon={<User size={16} />}
          error={username && !usernameCheck.isValid ? usernameCheck.error : undefined}
          hint={usernameCheck.isValid ? '✓ Valid username' : undefined}
        />

        {/* Phone Number */}
        <Input
          label="Phone Number (Strict Rule: 10 Digits Numbers Only)"
          placeholder="e.g. 9876543210"
          value={phoneNumber}
          onChange={(e) => {
            setPhoneNumber(e.target.value);
            if (serverError) setServerError(null);
          }}
          leftIcon={<Phone size={16} />}
          error={phoneNumber && !phoneCheck.isValid ? phoneCheck.error : undefined}
          hint={phoneCheck.isValid ? '✓ Valid 10-digit mobile number' : undefined}
        />

        {/* Email */}
        <Input
          label="Email Address (Used for 60s OTP verification)"
          placeholder="e.g. user@thescraper.com"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (serverError) setServerError(null);
          }}
          leftIcon={<Mail size={16} />}
          error={email && !emailCheck.isValid ? emailCheck.error : undefined}
          hint={emailCheck.isValid ? '✓ Valid email format' : undefined}
        />

        {/* Password with real-time meter */}
        <div>
          <Input
            label="Password (Must have Upper, Lower, Number & Symbol)"
            placeholder="e.g. Secure@2026"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (serverError) setServerError(null);
            }}
            isPassword
            leftIcon={<Lock size={16} />}
          />
          <PasswordRulesMeter password={password} />
        </div>

        {/* Role Selector with Framer Motion Sliding Pill */}
        <div className="spatial-input-container">
          <label className="spatial-input-label">
            <span>Assign Role</span>
          </label>
          <div
            style={{
              display: 'flex',
              background: '#f1f5f9',
              padding: '4px',
              borderRadius: '12px',
              position: 'relative',
            }}
          >
            {(['user', 'manager', 'admin'] as const).map((r) => {
              const isSelected = role === r;

              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                    border: 'none',
                    background: 'transparent',
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? '#0284c7' : 'var(--text-muted)',
                    position: 'relative',
                    zIndex: 1,
                    transition: 'color 0.2s ease',
                  }}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="rolePill"
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
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        {/* Feedback Alerts */}
        {serverError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              color: '#be123c',
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={16} />
            <span>{serverError}</span>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircle2 size={16} />
            <span>{successMessage}</span>
          </motion.div>
        )}

        {/* Action Buttons with Spring micro-motion */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
          <Button type="button" variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!isFormValid}
            isLoading={isLoading}
            leftIcon={<UserPlus size={16} />}
            style={{ flex: 2 }}
          >
            Create User Account
          </Button>
        </div>
      </form>
    </Modal>
  );
};
