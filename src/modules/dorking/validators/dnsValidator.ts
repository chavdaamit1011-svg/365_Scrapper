/**
 * DNS Validation Engine for Dorking Discoveries
 * Queries A, AAAA, and CNAME records using native Node.js DNS promises.
 * Crucial Rule: Unresolved hostnames are never dropped; their discovery record is preserved with status 'UNRESOLVED'.
 */

import { promises as dns } from 'dns';
import { DnsValidationResult, DnsResolutionStatus } from '../types/dorking.types';

export async function validateHostnameDns(
  hostname: string,
  timeoutMs: number = 2500
): Promise<DnsValidationResult> {
  const cleanHost = hostname.trim().toLowerCase();
  const validatedAt = new Date().toISOString();

  let aRecords: string[] = [];
  let aaaaRecords: string[] = [];
  let cnameRecords: string[] = [];
  let lastError: string | undefined;

  // 1. Resolve A records (IPv4)
  try {
    const aRes = await Promise.race([
      dns.resolve4(cleanHost),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('ETIMEOUT')), timeoutMs)),
    ]);
    if (Array.isArray(aRes)) {
      aRecords = aRes;
    }
  } catch (err: any) {
    lastError = err?.code || err?.message || 'A lookup failed';
  }

  // 2. Resolve AAAA records (IPv6)
  try {
    const aaaaRes = await Promise.race([
      dns.resolve6(cleanHost),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('ETIMEOUT')), timeoutMs)),
    ]);
    if (Array.isArray(aaaaRes)) {
      aaaaRecords = aaaaRes;
    }
  } catch {
    // IPv6 lookup optional
  }

  // 3. Resolve CNAME records (Aliases)
  try {
    const cnameRes = await Promise.race([
      dns.resolveCname(cleanHost),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('ETIMEOUT')), timeoutMs)),
    ]);
    if (Array.isArray(cnameRes)) {
      cnameRecords = cnameRes;
    }
  } catch {
    // CNAME lookup optional
  }

  // Determine status
  let status: DnsResolutionStatus = 'UNRESOLVED';
  if (aRecords.length > 0 || aaaaRecords.length > 0) {
    status = 'RESOLVED';
  } else if (cnameRecords.length > 0) {
    status = 'CNAME_ONLY';
  }

  return {
    hostname: cleanHost,
    status,
    aRecords,
    aaaaRecords,
    cnameRecords,
    validatedAt,
    error: status === 'UNRESOLVED' ? lastError : undefined,
  };
}

