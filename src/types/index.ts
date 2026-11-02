/**
 * Global Type Definitions for The screpper
 */

export type UserRole = 'admin' | 'user' | 'manager';

export interface User {
  id: string;
  username: string;
  phoneNumber: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
}

export interface UserSummary {
  id: string;
  username: string;
  phoneNumber: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface OtpRecord {
  code: string;
  email: string;
  userId: string;
  createdAt: number; // timestamp in ms
  expiresAt: number; // timestamp in ms
  verified: boolean;
  attempts: number;
}

export interface AuthSession {
  user: UserSummary;
  token: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  meta?: Record<string, any>;
}

