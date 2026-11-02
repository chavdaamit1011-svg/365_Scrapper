'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getClientSession } from '@/lib/session';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const session = getClientSession();
    if (session) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid rgba(2, 132, 199, 0.2)',
          borderTopColor: '#0284c7',
          borderRadius: '50%',
          animation: 'spin 0.6s linear infinite',
        }}
      />
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

