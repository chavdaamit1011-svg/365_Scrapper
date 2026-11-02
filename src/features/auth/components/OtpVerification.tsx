'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mail, Clock, RefreshCw, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { OtpInput } from '@/components/ui/OtpInput';
import { Button } from '@/components/ui/Button';
import { UserSummary } from '@/types';
import { saveClientSession } from '@/lib/session';

interface OtpVerificationProps {
  email: string;
  maskedEmail: string;
  initialExpirySeconds?: number;
  devPreviewOtp?: string;
  onSuccess: (user: UserSummary) => void;
  onBack: () => void;
}

export const OtpVerification: React.FC<OtpVerificationProps> = ({
  email,
  maskedEmail,
  initialExpirySeconds = 60,
  devPreviewOtp,
  onSuccess,
  onBack,
}) => {
  const [otp, setOtp] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(initialExpirySeconds);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<string | undefined>(devPreviewOtp);

  // 60-Second Countdown Timer
  useEffect(() => {
    if (secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft]);

  // Handle Verify API
  const handleVerify = async (codeToVerify?: string) => {
    const code = codeToVerify || otp;
    if (code.length < 6) {
      setError('Please enter the full 6-digit OTP code.');
      return;
    }

    if (secondsLeft === 0) {
      setError('OTP has expired! Please click "Resend Code" to receive a new one.');
      return;
    }

    setError(null);
    setInfoMessage(null);
    setIsVerifying(true);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.message || 'Invalid or expired OTP code.');
        return;
      }

      // Save session to localStorage and cookies
      saveClientSession(json.data.user, json.data.token);
      onSuccess(json.data.user);
    } catch (err: any) {
      setError('Verification service unavailable. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  // Auto-verify when all 6 digits are typed
  const handleOtpChange = (newVal: string) => {
    setOtp(newVal);
    if (error) setError(null);
    if (newVal.length === 6 && secondsLeft > 0) {
      handleVerify(newVal);
    }
  };

  // Resend OTP handler
  const handleResend = async () => {
    setError(null);
    setInfoMessage(null);
    setIsResending(true);

    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.message || 'Failed to resend OTP.');
        return;
      }

      // Reset timer to 60 seconds
      setSecondsLeft(60);
      setOtp('');
      if (json.data?.devPreviewOtp) {
        setActivePreview(json.data.devPreviewOtp);
      }
      setInfoMessage('A fresh 60-second OTP has been sent to your email!');
    } catch (err: any) {
      setError('Could not resend OTP. Check your internet connection.');
    } finally {
      setIsResending(false);
    }
  };

  // Percentage of timer remaining
  const timerPercent = (secondsLeft / 60) * 100;
  const isExpired = secondsLeft === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', textAlign: 'center' }}>
      {/* Top Back Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <button
          type="button"
          onClick={onBack}
          className="spatial-btn-secondary"
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={14} /> Back to Login
        </button>
      </div>

      {/* Header Info */}
      <div>
        <div
          style={{
            width: '56px',
            height: '56px',
            margin: '0 auto 16px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary)',
            boxShadow: '0 8px 20px -4px rgba(2, 132, 199, 0.25)',
          }}
        >
          <Mail size={28} />
        </div>

        <h3 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)' }}>
          Enter Verification Code
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px' }}>
          We sent a 6-digit one-time code to <strong>{maskedEmail}</strong>
        </p>
      </div>

      {/* Dev Preview Helper Box (Instant Testing Friendly) */}
      {activePreview && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
            border: '1px dashed #86efac',
            borderRadius: '12px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
            <CheckCircle2 size={16} color="#16a34a" />
            <div>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#166534' }}>
                Quick Test Code (Dev Preview):
              </span>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#14532d', letterSpacing: '2px' }}>
                {activePreview}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleOtpChange(activePreview)}
            className="spatial-btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '6px',
              background: '#ffffff',
              border: '1px solid #86efac',
              cursor: 'pointer',
            }}
          >
            Auto Fill
          </button>
        </motion.div>
      )}

      {/* 6-Digit PIN Boxes */}
      <OtpInput value={otp} onChange={handleOtpChange} disabled={isExpired || isVerifying} />

      {/* 60-Second Countdown Timer Display */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          background: isExpired ? '#fff1f2' : '#f8fafc',
          border: `1px solid ${isExpired ? '#fecdd3' : '#e2e8f0'}`,
          borderRadius: '12px',
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Clock size={16} color={isExpired ? '#e11d48' : '#0284c7'} />
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: isExpired ? '#e11d48' : 'var(--text-main)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {isExpired ? 'Code Expired (00:00)' : `Expires in 00:${secondsLeft < 10 ? `0${secondsLeft}` : secondsLeft}`}
          </span>
        </div>

        {/* Progress Bar for 60s */}
        <div
          style={{
            width: '100%',
            height: '4px',
            background: '#e2e8f0',
            borderRadius: '9999px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${timerPercent}%`,
              height: '100%',
              background: isExpired ? '#f43f5e' : 'linear-gradient(90deg, #0284c7, #38bdf8)',
              transition: 'width 1s linear',
            }}
          />
        </div>

        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {isExpired
            ? '60-second validity window elapsed. Request a new OTP below.'
            : 'Strict 60-second security window'}
        </span>
      </div>

      {/* Messages */}
      {error && (
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
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </motion.div>
      )}

      {infoMessage && (
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
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={16} />
          <span>{infoMessage}</span>
        </motion.div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          disabled={otp.length !== 6 || isExpired}
          isLoading={isVerifying}
          onClick={() => handleVerify()}
        >
          Verify OTP & Enter
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="md"
          fullWidth
          disabled={!isExpired && secondsLeft > 45} // Resend cooldown
          isLoading={isResending}
          onClick={handleResend}
          leftIcon={<RefreshCw size={14} />}
        >
          {isExpired ? 'Resend New 60s OTP' : `Resend OTP (${secondsLeft}s)`}
        </Button>
      </div>
    </div>
  );
};

