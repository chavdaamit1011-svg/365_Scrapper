/**
 * ==============================================================================
 * The screpper - Reusable OTP Generation & 60-Second Expiry Management
 * ==============================================================================
 * Handles:
 * 1. Generating 6-digit secure numerical OTP
 * 2. 60-second strict expiration window
 * 3. Rate limiting and attempt tracking
 * 4. Verification with detailed status codes
 */

import crypto from 'crypto';
import { OtpRecord } from '@/types';

// In-memory OTP store (keyed by email or userId)
// In production or distributed servers, this can be synced with Redis/Database
const globalForOtp = global as unknown as {
  otpStore?: Map<string, OtpRecord>;
};

export const otpStore = globalForOtp.otpStore || new Map<string, OtpRecord>();
if (process.env.NODE_ENV !== 'production') globalForOtp.otpStore = otpStore;

export const DEFAULT_OTP_EXPIRY_SECONDS = 60; // STRICT: 60 SECONDS

export interface GenerateOtpResult {
  code: string;
  expiresAt: number;
  remainingSeconds: number;
  maskedEmail: string;
}

export interface VerifyOtpResult {
  success: boolean;
  message: string;
  isExpired?: boolean;
  remainingSeconds?: number;
}

/**
 * Mask an email for safe UI display (e.g. j***e@example.com)
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***.com';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  const visibleStart = local.slice(0, 2);
  const visibleEnd = local.slice(-1);
  return `${visibleStart}***${visibleEnd}@${domain}`;
}

/**
 * Generate a cryptographically secure 6-digit numeric OTP
 * Valid strictly for 60 seconds.
 */
export function createAndStoreOtp(
  userId: string,
  email: string,
  expirySeconds: number = DEFAULT_OTP_EXPIRY_SECONDS
): GenerateOtpResult {
  // Generate 6 digit numeric code
  const code = crypto.randomInt(100000, 999999).toString();
  const now = Date.now();
  const expiresAt = now + expirySeconds * 1000;

  const record: OtpRecord = {
    code,
    email: email.toLowerCase().trim(),
    userId,
    createdAt: now,
    expiresAt,
    verified: false,
    attempts: 0,
  };

  // Key by email to allow single active OTP per email
  otpStore.set(record.email, record);

  return {
    code,
    expiresAt,
    remainingSeconds: expirySeconds,
    maskedEmail: maskEmail(email),
  };
}

/**
 * Verify user submitted OTP
 * Returns success or specific error (expired, invalid, too many attempts)
 */
export function verifySubmittedOtp(
  email: string,
  enteredCode: string
): VerifyOtpResult {
  const cleanEmail = email.toLowerCase().trim();
  const cleanCode = enteredCode.trim();

  const record = otpStore.get(cleanEmail);

  if (!record) {
    return {
      success: false,
      message: 'No OTP request found. Please request a new OTP.',
    };
  }

  const now = Date.now();

  // Check 60-second expiration
  if (now > record.expiresAt) {
    otpStore.delete(cleanEmail); // Clear expired OTP
    return {
      success: false,
      isExpired: true,
      message: 'OTP has expired (60-second validity ended). Please request a new one.',
    };
  }

  // Check max attempts
  if (record.attempts >= 5) {
    otpStore.delete(cleanEmail);
    return {
      success: false,
      message: 'Too many incorrect attempts. Please request a new OTP.',
    };
  }

  record.attempts += 1;

  // Compare code
  if (record.code !== cleanCode) {
    const remainingAttempts = 5 - record.attempts;
    return {
      success: false,
      message: `Invalid OTP code. ${remainingAttempts} attempts remaining.`,
    };
  }

  // Mark verified and clean up
  record.verified = true;
  otpStore.delete(cleanEmail);

  return {
    success: true,
    message: 'OTP verified successfully.',
  };
}

/**
 * Check remaining seconds on an active OTP
 */
export function getOtpRemainingSeconds(email: string): number {
  const cleanEmail = email.toLowerCase().trim();
  const record = otpStore.get(cleanEmail);
  if (!record) return 0;

  const diffMs = record.expiresAt - Date.now();
  if (diffMs <= 0) {
    otpStore.delete(cleanEmail);
    return 0;
  }

  return Math.ceil(diffMs / 1000);
}

