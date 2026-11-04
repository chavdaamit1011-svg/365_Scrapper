/**
 * Dorking Result Parser & Scope Validator
 * Extracts URLs, parses hostnames, validates target domain scope,
 * and categorizes multi-level subdomains.
 */

import { SearchResultItem, ParsedHostname } from '../types/dorking.types';
import { isValidHostnameSyntax, normalizeHostname } from '../validators/hostnameValidator';

export class ResultParser {
  /**
   * Parses a single SearchResultItem against a target domain.
   * Discards third-party / out-of-scope results.
   */
  static parseResult(item: SearchResultItem, targetDomain: string): ParsedHostname | null {
    if (!item.url) return null;

    let urlObj: URL;
    try {
      urlObj = new URL(item.url);
    } catch {
      try {
        urlObj = new URL(`https://${item.url}`);
      } catch {
        return null;
      }
    }

    const rawHostname = urlObj.hostname;
    const normalized = normalizeHostname(rawHostname);

    // Validate hostname syntax
    if (!isValidHostnameSyntax(normalized)) {
      return null;
    }

    const cleanTarget = normalizeHostname(targetDomain);

    // Check scope: Must be targetDomain itself OR end with `.${cleanTarget}`
    const isExactMatch = normalized === cleanTarget;
    const isSubdomainOfTarget = normalized.endsWith(`.${cleanTarget}`);

    if (!isExactMatch && !isSubdomainOfTarget) {
      // Out of scope: unrelated third-party domain from search result
      return null;
    }

    let subdomain = '';
    let subdomainLevel = 0;

    if (isSubdomainOfTarget) {
      // e.g. 'dev.api.example.com' with target 'example.com' -> 'dev.api'
      subdomain = normalized.slice(0, -(cleanTarget.length + 1));
      const parts = subdomain.split('.').filter(Boolean);
      subdomainLevel = parts.length;
    }

    return {
      rawUrl: item.url,
      rawHostname,
      normalizedHostname: normalized,
      rootDomain: cleanTarget,
      isSubdomain: isSubdomainOfTarget,
      subdomainLevel,
      isWithinTargetScope: true,
      provider: item.provider,
      query: item.query,
    };
  }

  /**
   * Parses a batch of search results and filters out invalid or out-of-scope entries
   */
  static parseBatch(items: SearchResultItem[], targetDomain: string): ParsedHostname[] {
    const list: ParsedHostname[] = [];

    for (const item of items) {
      const parsed = this.parseResult(item, targetDomain);
      if (parsed) {
        list.push(parsed);
      }
    }

    return list;
  }
}

