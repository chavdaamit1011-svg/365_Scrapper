import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Scrapper — IP Intelligence & Network Scanner Platform',
  description:
    'Professional IP Intelligence, Proxy Rotation, Network Scanner & User Management Platform with 60s OTP Verification.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Application Container */}
        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
