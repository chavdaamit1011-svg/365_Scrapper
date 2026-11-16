/**
 * Strict RFC 1035 / RFC 1123 Hostname Syntax Validator
 */

export function isValidHostnameSyntax(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') return false;

  const clean = hostname.trim().toLowerCase();

  // Total length must not exceed 253 characters
  if (clean.length === 0 || clean.length > 253) return false;

  // Filter out email addresses, wildcards, ports, paths
  if (clean.includes('@') || clean.includes('*') || clean.includes('/') || clean.includes(':')) {
    return false;
  }

  // Must not start or end with a dot
  if (clean.startsWith('.') || clean.endsWith('.')) return false;

  const labels = clean.split('.');
  // Must have at least two labels (e.g. domain.com or sub.domain.com)
  if (labels.length < 2) return false;

  for (const label of labels) {
    // Label length between 1 and 63 characters
    if (label.length === 0 || label.length > 63) return false;

    // Label must not start or end with a hyphen
    if (label.startsWith('-') || label.endsWith('-')) return false;

    // Label must only contain letters, numbers, and hyphens
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return false;
  }

  // Top level domain (last label) must not be all-numeric
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) return false;

  return true;
}

/**
 * Normalizes a hostname to lower case, removes leading www. if needed, strips whitespace & URL encoding artifacts
 */
export function normalizeHostname(hostname: string): string {
  if (!hostname || typeof hostname !== 'string') return '';
  let h = hostname.trim().toLowerCase();
  try {
    if (h.includes('%')) {
      h = decodeURIComponent(h);
    }
  } catch {}

  let prev = '';
  while (h !== prev) {
    prev = h;
    h = h.replace(/^[a-z0-9_-]+:\/\//i, '').replace(/^\/\//, '').replace(/^\/+/, '');
    h = h.replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
    h = h.replace(/^\*\./, '').replace(/^\./, '');
  }

  h = h.split('/')[0].split('?')[0].split('#')[0].split(':')[0];

  prev = '';
  while (h !== prev) {
    prev = h;
    h = h.replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
    h = h.replace(/^\*\./, '').replace(/^\./, '');
  }

  return h;
}

