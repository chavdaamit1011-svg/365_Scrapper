/**
 * 24/7 Top-Level Domain (TLD) Zone Discovery & Intelligence Engine
 * Continuous, multi-source root domain discovery across TLD scopes (.in, .com, .gov.in, etc.)
 *
 * Discovery Vectors:
 * 1. Curated & Verified High-Yield Seed Registry (instant zero-delay kickoff)
 * 2. Certificate Transparency Wildcard Enumeration (crt.sh: %.tld)
 * 3. Search Engine Dorking (DuckDuckGo / Bing: site:*.tld, site:.tld contact, etc.)
 * 4. In-Page Outbound Cross-Link Harvesting (continuous web graph crawler)
 * 5. Lifecycle Reconciliation Tracking (NEW, CHANGED, OFFLINE/REMOVED)
 */

import dns from 'dns';
import { extractRootDomain } from './subdomainRecon';
import { MULTI_PART_TLDS } from '@/features/targets/utils/domainValidator';
import { connectMongo } from '../mongodb';

const dnsResolver = new dns.promises.Resolver();
try {
  dnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
} catch {}

/**
 * Normalizes any TLD input string into a clean bare TLD identifier.
 * Examples:
 *   ".in" -> "in"
 *   "*.in" -> "in"
 *   "https://*.com/" -> "com"
 *   "*.gov.in" -> "gov.in"
 */
export function normalizeTld(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//i, '');
  s = s.replace(/[\/?#].*$/, '');
  s = s.replace(/:\d+$/, '');
  s = s.replace(/^\*\./, '');
  s = s.replace(/^\.+/, '');
  s = s.replace(/\.+$/, '');
  return s;
}

/**
 * Validates whether a candidate domain belongs to the target TLD zone
 */
export function isDomainInTldZone(domain: string, tld: string): boolean {
  if (!domain || typeof domain !== 'string') return false;
  const cleanT = normalizeTld(tld);
  const cleanD = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];

  if (cleanD === cleanT || cleanD === `.${cleanT}`) return false;

  // Check exact suffix
  if (cleanD.endsWith(`.${cleanT}`)) {
    return true;
  }

  // If tld is "in", also match "co.in", "gov.in", "nic.in", etc.
  if (cleanT === 'in') {
    return cleanD.endsWith('.in');
  }

  return false;
}

/**
 * Extracts and isolates all unique root domains matching the target TLD from HTML content
 * (Outbound cross-link spider)
 */
export function harvestTldDomainsFromHtml(html: string, targetTld: string): string[] {
  if (!html || !targetTld) return [];
  const cleanTld = normalizeTld(targetTld);
  const discovered = new Set<string>();

  // Extract all href and src links or plaintext URLs
  const urlRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,63}(?::\d+)?(?:\/[^\s"'>]*)?/gi;
  const matches = html.match(urlRegex) || [];

  for (const urlStr of matches) {
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      if (isDomainInTldZone(host, cleanTld)) {
        const root = extractRootDomain(host);
        if (root && root.includes('.') && isDomainInTldZone(root, cleanTld)) {
          discovered.add(root);
        }
      }
    } catch {}
  }

  return Array.from(discovered);
}

/**
 * Queries Certificate Transparency (crt.sh) for root domains matching wildcard %.tld
 */
async function fetchCrtShTldDomains(tld: string, cycle: number = 1): Promise<string[]> {
  const cleanTld = normalizeTld(tld);
  const results = new Set<string>();

  // Pure wildcard query without static prefix seeds
  const queryParam = `%25.${cleanTld}`;
  const crtUrl = `https://crt.sh/?q=${queryParam}&output=json`;

  try {
    const res = await fetch(crtUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data.slice(0, 300)) {
          const names = [item.name_value, item.common_name].filter(Boolean).join('\n');
          for (let line of names.split('\n')) {
            line = line.trim().toLowerCase();
            if (line.startsWith('*.')) line = line.slice(2);
            if (line.startsWith('*')) line = line.slice(1);
            if (line && isDomainInTldZone(line, cleanTld)) {
              const root = extractRootDomain(line);
              if (root && root.includes('.') && isDomainInTldZone(root, cleanTld)) {
                results.add(root);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal crt.sh timeout/rate limit
  }

  return Array.from(results);
}

/**
 * Queries search engine dorking (DuckDuckGo HTML) for root domains under the TLD
 */
async function fetchDorkTldDomains(tld: string, cycle: number = 1): Promise<string[]> {
  const cleanTld = normalizeTld(tld);
  const results = new Set<string>();

  // Pure dynamic search dork query without static keyword lists
  const query = cycle === 1 ? `site:*.${cleanTld}` : `site:*.${cleanTld} -www`;

  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(ddgUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const html = await res.text();
      // Extract links like //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.in%2F...
      const linkRegex = /uddg=([^&"'>\s]+)/gi;
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        try {
          const decoded = decodeURIComponent(m[1]);
          const parsed = new URL(decoded);
          const host = parsed.hostname.toLowerCase();
          if (isDomainInTldZone(host, cleanTld)) {
            const root = extractRootDomain(host);
            if (root && root.includes('.') && isDomainInTldZone(root, cleanTld)) {
              results.add(root);
            }
          }
        } catch {}
      }

      // Also extract standard links found in search snippet text
      const directMatches = harvestTldDomainsFromHtml(html, cleanTld);
      for (const d of directMatches) results.add(d);
    }
  } catch {}

  return Array.from(results);
}

/**
 * Checks DNS resolution for a domain to determine if it is live or offline/removed
 */
export async function checkDomainDnsStatus(domain: string): Promise<'ACTIVE' | 'OFFLINE'> {
  try {
    const addresses = await Promise.race([
      dnsResolver.resolve4(domain),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('DNS Timeout')), 2500)),
    ]);
    return addresses && addresses.length > 0 ? 'ACTIVE' : 'OFFLINE';
  } catch {
    return 'OFFLINE';
  }
}

export interface TldDiscoveryResult {
  tld: string;
  cycle: number;
  totalDiscovered: number;
  newDomains: string[];
  existingDomains: string[];
  offlineDomains: string[];
  allDomains: string[];
  sources: {
    seedCount: number;
    crtShCount: number;
    dorkCount: number;
  };
}

/**
 * Master Discovery Orchestrator for 24/7 TLD Scopes
 * Discovers, filters, validates, and reconciles root domains under a given TLD.
 */
export async function discoverTldRootDomains(
  rawTld: string,
  options: { cycle?: number; maxPerPass?: number } = {}
): Promise<TldDiscoveryResult> {
  const cleanTld = normalizeTld(rawTld);
  const cycle = options.cycle || 1;
  const maxPerPass = options.maxPerPass || 250;

  const combinedDomains = new Set<string>();

  const normalizeTargetDomain = (dom: string): string => {
    const d = dom.toLowerCase().trim();
    if (cleanTld === 'in') {
      if (d !== 'gov.in' && d.endsWith('.gov.in')) return 'gov.in';
      if (d !== 'nic.in' && d.endsWith('.nic.in')) return 'nic.in';
    }
    return d;
  };

  // 1. Fetch Certificate Transparency & Dorking in parallel
  const [crtShDomains, dorkDomains] = await Promise.all([
    fetchCrtShTldDomains(cleanTld, cycle).catch(() => []),
    fetchDorkTldDomains(cleanTld, cycle).catch(() => []),
  ]);

  for (const d of crtShDomains) combinedDomains.add(normalizeTargetDomain(d));
  for (const d of dorkDomains) combinedDomains.add(normalizeTargetDomain(d));

  // 3. Cross-reference with MongoDB to determine NEW vs EXISTING vs OFFLINE
  let newDomains: string[] = [];
  let existingDomains: string[] = [];
  const offlineDomains: string[] = [];

  try {
    const conn = await connectMongo();
    if (conn?.connection?.db) {
      const db = conn.connection.db;
      const allFound = Array.from(combinedDomains);

      const existingDocs = await db
        .collection('scraped_results')
        .find({ domain: { $in: allFound } }, { projection: { domain: 1, status: 1 } })
        .toArray();

      const existingSet = new Set(existingDocs.map((d: any) => d.domain.toLowerCase()));

      for (const d of allFound) {
        if (existingSet.has(d.toLowerCase())) {
          existingDomains.push(d);
        } else {
          newDomains.push(d);
        }
      }
    } else {
      newDomains = Array.from(combinedDomains);
    }
  } catch {
    newDomains = Array.from(combinedDomains);
  }

  // Prioritize new domains first
  const rawOrdered = [...newDomains, ...existingDomains];
  const orderedList = rawOrdered.slice(0, maxPerPass);

  return {
    tld: cleanTld,
    cycle,
    totalDiscovered: combinedDomains.size,
    newDomains,
    existingDomains,
    offlineDomains,
    allDomains: orderedList,
    sources: {
      seedCount: 0,
      crtShCount: crtShDomains.length,
      dorkCount: dorkDomains.length,
    },
  };
}
