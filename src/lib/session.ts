/**
 * ==============================================================================
 * The screpper - Session & Auth Token Management
 * ==============================================================================
 */

import { UserSummary } from '@/types';

const SESSION_STORAGE_KEY = 'the_screpper_auth_user';

export function saveClientSession(user: UserSummary, token?: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    if (token) {
      document.cookie = `screpper_session=${token}; path=/; max-age=86400; SameSite=Lax`;
    }
  } catch (err) {
    console.error('Failed to save client session', err);
  }
}

export function getClientSession(): UserSummary | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSummary;
  } catch (err) {
    return null;
  }
}

export function clearClientSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    document.cookie = 'screpper_session=; path=/; max-age=0; SameSite=Lax';
  } catch (err) {
    console.error('Failed to clear session', err);
  }
}

