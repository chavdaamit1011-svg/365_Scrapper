'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Radar } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { OtpVerification } from '@/features/auth/components/OtpVerification';
import { IpStreamBackground } from '@/components/network/IpStreamBackground';
import { UserSummary } from '@/types';
import { getClientSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    const session = getClientSession();
    if (session) {
      router.replace('/dashboard');
    }
  }, [router]);

  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [authData, setAuthData] = useState<{
    userId: string;
    email: string;
    maskedEmail: string;
    expirySeconds: number;
    devPreviewOtp?: string;
  } | null>(null);

  const handleLoginSuccess = (data: {
    userId: string;
    email: string;
    maskedEmail: string;
    expirySeconds: number;
    devPreviewOtp?: string;
  }) => {
    setAuthData(data);
    setStep('otp');
  };

  const handleOtpSuccess = (user: UserSummary) => {
    router.push('/dashboard');
  };

  return (
    <>
      <IpStreamBackground />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
      <div style={{ width: '100%', maxWidth: '440px' }}>
        {/* Clean Modern Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              boxShadow: '0 6px 18px rgba(2, 132, 199, 0.3)',
              marginBottom: '12px',
            }}
          >
            <Radar size={26} strokeWidth={2.2} />
          </div>

          <h1
            style={{
              fontSize: '26px',
              fontWeight: 800,
              color: 'var(--text-main)',
              letterSpacing: '-0.6px',
              margin: 0,
            }}
          >
            The Scrapper
          </h1>
        </div>

        {/* Clean Professional Login Card (No Playful Wobbly Tilt) */}
        <Card style={{ padding: '30px' }}>
          <AnimatePresence mode="wait">
            {step === 'credentials' ? (
              <motion.div
                key="credentials"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div style={{ marginBottom: '18px' }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)' }}>
                    Operator Authorization
                  </h2>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Enter authorized username or phone number to sign in
                  </p>
                </div>

                <LoginForm onSuccess={handleLoginSuccess} />
              </motion.div>
            ) : (
              <motion.div
                key="otp"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {authData && (
                  <OtpVerification
                    email={authData.email}
                    maskedEmail={authData.maskedEmail}
                    initialExpirySeconds={authData.expirySeconds}
                    devPreviewOtp={authData.devPreviewOtp}
                    onSuccess={handleOtpSuccess}
                    onBack={() => setStep('credentials')}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </div>
    </>
  );
}
