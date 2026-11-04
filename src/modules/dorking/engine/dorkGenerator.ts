/**
 * Dynamic Dork Query Generator
 * Generates search engine dorking queries based on the target domain.
 * Supports standard templates, inurl patterns, wildcard syntax, and custom queries.
 */

import { DorkQuery, DorkPatternType } from '../types/dorking.types';
import { normalizeHostname } from '../validators/hostnameValidator';

export interface DorkGeneratorOptions {
  includeWildcards?: boolean;
  includeInUrlKeywords?: boolean;
  includeExclusions?: boolean;
  customQueries?: string[];
  provider?: string;
}

const INURL_KEYWORDS = [
  'subdomain',
  'dev',
  'staging',
  'api',
  'portal',
  'admin',
  'auth',
  'login',
  'app',
  'vpn',
  'test',
  'mail',
  'secure',
  'beta',
];

export function generateDorkQueries(
  targetDomain: string,
  options: DorkGeneratorOptions = {}
): DorkQuery[] {
  const cleanDomain = normalizeHostname(targetDomain);
  const provider = options.provider || 'all';
  const queries: DorkQuery[] = [];
  const seenQueries = new Set<string>();

  const addQuery = (queryString: string, patternType: DorkPatternType) => {
    const trimmed = queryString.trim();
    if (!trimmed || seenQueries.has(trimmed.toLowerCase())) {
      return;
    }
    seenQueries.add(trimmed.toLowerCase());

    const id = `dq_${cleanDomain.replace(/[^a-z0-9]/g, '_')}_${queries.length + 1}`;
    queries.push({
      id,
      query: trimmed,
      patternType,
      targetDomain: cleanDomain,
      provider,
      status: 'pending',
      resultsCount: 0,
    });
  };

  // 1. Base site index query
  addQuery(`site:${cleanDomain}`, 'site');

  // 2. Wildcard subdomain query
  if (options.includeWildcards !== false) {
    addQuery(`site:*.${cleanDomain}`, 'wildcard');
  }

  // 3. Negative query (-www) to filter out main site and uncover hidden subdomains
  if (options.includeExclusions !== false) {
    addQuery(`site:${cleanDomain} -www`, 'without_www');
    addQuery(`site:*.${cleanDomain} -www`, 'without_www');
  }

  // 4. Targeted inurl keyword patterns
  if (options.includeInUrlKeywords !== false) {
    for (const kw of INURL_KEYWORDS) {
      addQuery(`site:${cleanDomain} inurl:${kw}`, 'inurl');
    }
  }

  // 5. Custom user-supplied dork queries
  if (Array.isArray(options.customQueries)) {
    for (const cq of options.customQueries) {
      if (typeof cq === 'string' && cq.trim()) {
        addQuery(cq.trim(), 'custom');
      }
    }
  }

  return queries;
}

