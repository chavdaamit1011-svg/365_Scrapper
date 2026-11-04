/**
 * High-Precision Email Extractor & Native DNS MX Record Verifier
 */

import { promises as dns } from 'dns';
import { VerifiedEmailDetail } from './types';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const JUNK_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff',
  'css', 'js', 'ts', 'jsx', 'tsx', 'woff', 'woff2', 'ttf', 'eot', 'otf',
  'pdf', 'zip', 'rar', 'gz', 'mp4', 'mp3', 'wav', 'json', 'xml'
]);

const DUMMY_EMAILS = new Set([
  'example@example.com',
  'user@example.com',
  'test@example.com',
  'admin@example.com',
  'yourname@domain.com',
  'email@example.com',
  'info@yourdomain.com',
  'name@domain.com',
]);

const MX_CACHE = new Map<string, boolean>();

/**
 * Checks DNS MX records for the given domain using native Node.js DNS promises
 */
export async function verifyDomainMx(domain: string): Promise<boolean> {
  const cleanDomain = domain.toLowerCase().trim();
  if (MX_CACHE.has(cleanDomain)) {
    return MX_CACHE.get(cleanDomain)!;
  }

  try {
    const mxRecords = await dns.resolveMx(cleanDomain);
    const isValid = Array.isArray(mxRecords) && mxRecords.length > 0;
    MX_CACHE.set(cleanDomain, isValid);
    return isValid;
  } catch {
    // If MX lookup fails, check standard A record fallback
    try {
      const aRecords = await dns.resolve4(cleanDomain);
      const isValid = Array.isArray(aRecords) && aRecords.length > 0;
      MX_CACHE.set(cleanDomain, isValid);
      return isValid;
    } catch {
      MX_CACHE.set(cleanDomain, false);
      return false;
    }
  }
}

/**
 * Calculates priority score for email based on business utility
 */
export function calculateEmailPriorityScore(email: string): number {
  const localPart = email.split('@')[0].toLowerCase();

  if (/^(contact|info|support|admin|help|office|principal|director|inquiry)$/.test(localPart)) {
    return 100;
  }
  if (/^(sales|enquiries|admission|admissions|reach|desk|services)$/.test(localPart)) {
    return 80;
  }
  if (/^(hr|careers|jobs|team|media|press|editor)$/.test(localPart)) {
    return 50;
  }
  return 30;
}

/**
 * Extracts and verifies emails from HTML and raw text
 */
export async function extractAndVerifyEmails(
  rawHtml: string,
  sourceUrl: string = ''
): Promise<VerifiedEmailDetail[]> {
  if (!rawHtml || typeof rawHtml !== 'string') return [];

  const matches = rawHtml.match(EMAIL_REGEX) || [];
  const uniqueEmails = new Set<string>();

  for (let match of matches) {
    let clean = match.trim().toLowerCase();

    // Strip leading/trailing dots or special characters
    clean = clean.replace(/^[^\w]+|[^\w]+$/g, '');

    if (!clean.includes('@') || DUMMY_EMAILS.has(clean)) {
      continue;
    }

    const [local, host] = clean.split('@');
    if (!local || !host || !host.includes('.')) {
      continue;
    }

    // Filter out image/font file false positives (e.g. icon@2x.png)
    const hostExt = host.split('.').pop() || '';
    if (JUNK_EXTENSIONS.has(hostExt)) {
      continue;
    }

    uniqueEmails.add(clean);
  }

  const results: VerifiedEmailDetail[] = [];

  for (const email of uniqueEmails) {
    const host = email.split('@')[1];
    const isMxValid = await verifyDomainMx(host);
    const score = calculateEmailPriorityScore(email);

    results.push({
      email,
      status: isMxValid ? 'ACTIVE' : 'BOUNCED',
      mxVerified: isMxValid,
      priorityScore: score,
      sourceUrl,
      section: 'Contact Section',
      isPrimary: false,
    });
  }

  // Sort by priorityScore descending
  results.sort((a, b) => b.priorityScore - a.priorityScore || a.email.localeCompare(b.email));

  // Mark the top email as primary
  if (results.length > 0) {
    results[0].isPrimary = true;
  }

  return results;
}

