import { TargetType } from '../types/target.types';

// Regex for standard domains and subdomains
const DOMAIN_REGEX =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

// Regex for IPv4 addresses
const IP_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

/**
 * Strips protocols, paths, query params, ports, and trailing slashes
 * Examples:
 *   "https://api.example.com/v1" -> "api.example.com"
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

  // Strip trailing periods
  cleaned = cleaned.replace(/\.+$/, '');

  return cleaned.trim();
}

/**
 * Validates whether the cleaned string is a valid Domain, Subdomain, or IPv4
 */
export function isValidTarget(target: string): boolean {
  if (!target || target.length > 253) return false;
  return DOMAIN_REGEX.test(target) || IP_REGEX.test(target);
}

/**
 * Classifies target as 'ip_address', 'root_domain', or 'subdomain'
 */
export function classifyTargetType(target: string): TargetType {
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

