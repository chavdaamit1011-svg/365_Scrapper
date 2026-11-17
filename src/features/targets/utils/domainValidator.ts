import { TargetType } from '../types/target.types';

// Regex for standard domains and subdomains
const DOMAIN_REGEX =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

// Regex for IPv4 addresses
const IP_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

// Multi-part ccTLDs / Public suffix zones
export const MULTI_PART_TLDS = new Set([
  'gov.in', 'nic.in', 'ac.in', 'edu.in', 'res.in', 'mil.in', 'net.in', 'org.in', 'co.in',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'edu.au',
  'co.nz', 'co.za', 'com.br', 'com.sg', 'com.my', 'co.jp', 'com.mx', 'gc.ca'
]);

// Common generic and regional top-level domains
export const COMMON_TLDS = new Set([
  'in', 'com', 'org', 'net', 'edu', 'gov', 'io', 'ai', 'co', 'me', 'xyz',
  'info', 'biz', 'app', 'dev', 'tech', 'store', 'online', 'site', 'cloud', 'pro',
  'uk', 'us', 'ca', 'de', 'fr', 'jp', 'au', 'eu', 'ru', 'cn', 'ch', 'nl', 'it', 'es',
  'live', 'agency', 'space', 'club', 'top', 'vip', 'one', 'shop', 'global', 'cc'
]);

/**
 * Checks whether an input string specifies a Top-Level Domain (TLD) Zone or Wildcard Zone
 * Examples: ".in", "*.in", "in", ".com", "*.com", "com", ".gov.in", "gov.in", "*.co.in"
 */
export function isTldZone(raw: string): boolean {
  if (!raw) return false;
  let s = raw.trim().toLowerCase();

  // Strip protocol, port, slashes
  s = s.replace(/^[a-zA-Z]+:\/\//, '');
  s = s.replace(/[\/?#].*$/, '');
  s = s.replace(/:\d+$/, '');

  const hasWildcardOrDotPrefix = s.startsWith('*.') || s.startsWith('.');
  const bare = s.replace(/^\*\./, '').replace(/^\./, '').replace(/\.+$/, '');

  if (!bare) return false;

  // 1. If explicitly prefixed with '.' or '*.' (e.g. .in, *.in, .com, *.com, .gov.in, *.gov.in)
  if (hasWildcardOrDotPrefix) {
    if (COMMON_TLDS.has(bare) || MULTI_PART_TLDS.has(bare) || /^[a-zA-Z]{2,24}$/.test(bare)) {
      return true;
    }
  }

  // 2. Single-part bare TLD (no internal dots, e.g. "in", "com", "org", "net")
  if (!bare.includes('.') && COMMON_TLDS.has(bare)) {
    return true;
  }

  return false;
}

/**
 * Strips protocols, paths, query params, ports, and trailing slashes
 * For TLD Zones (e.g. *.in, in, .in), normalizes to a standard dot-prefixed format (".in", ".com", ".gov.in")
 * Examples:
 *   "https://api.example.com/v1" -> "api.example.com"
 *   "*.in" -> ".in"
 *   "in" -> ".in"
 *   "http://sub.domain.co.in:8080/path?q=1" -> "sub.domain.co.in"
 */
export function cleanDomainString(raw: string): string {
  let cleaned = raw.trim().toLowerCase();

  // Strip protocol (http://, https://, ftp://, ws://, etc.)
  cleaned = cleaned.replace(/^[a-zA-Z]+:\/\//, '');

  // Strip credentials if present (user:pass@)
  cleaned = cleaned.replace(/^[^@]+@/, '');

  // Strip path and query parameters
  cleaned = cleaned.replace(/[\/?#].*$/, '');

  // Strip port (e.g. :3000, :8080)
  cleaned = cleaned.replace(/:\d+$/, '');

  // If this represents a TLD Zone (e.g. *.in, .in, in, gov.in), normalize to standard .<tld>
  if (isTldZone(cleaned)) {
    const bare = cleaned.replace(/^\*\./, '').replace(/^\./, '').replace(/\.+$/, '');
    return `.${bare}`;
  }

  // Strip trailing periods for standard domains
  cleaned = cleaned.replace(/\.+$/, '');

  return cleaned.trim();
}

/**
 * Validates whether the cleaned string is a valid Domain, Subdomain, IPv4, or TLD Zone
 */
export function isValidTarget(target: string): boolean {
  if (!target || target.length > 253) return false;
  if (isTldZone(target)) return true;
  return DOMAIN_REGEX.test(target) || IP_REGEX.test(target);
}

/**
 * Classifies target as 'tld_zone', 'ip_address', 'root_domain', or 'subdomain'
 */
export function classifyTargetType(target: string): TargetType {
  if (isTldZone(target)) {
    return 'tld_zone';
  }

  if (IP_REGEX.test(target)) {
    return 'ip_address';
  }

  // Count domain labels (dots)
  const parts = target.split('.');
  
  // Handling special two-part TLDs like .co.uk, .com.au, .gov.in, .edu.in
  const twoPartTlds = [
    'co.uk',
    'com.au',
    'gov.in',
    'co.in',
    'org.in',
    'net.in',
    'ac.uk',
    'com.sg',
    'co.nz',
    'com.br',
  ];

  const matchedTwoPart = twoPartTlds.some((tld) => target.endsWith('.' + tld));

  if (matchedTwoPart) {
    // If it has more than 3 segments (e.g. sub.example.co.uk = 4 parts), it's a subdomain
    return parts.length > 3 ? 'subdomain' : 'root_domain';
  }

  // Standard TLD (e.g. example.com = 2 parts is root, api.example.com = 3 parts is subdomain)
  return parts.length > 2 ? 'subdomain' : 'root_domain';
}

