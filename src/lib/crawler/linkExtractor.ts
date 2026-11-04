/**
 * High-Performance HTML Link & Subdomain Extractor (Cheerio + URL Normalization)
 */

import * as cheerio from 'cheerio';
import { URL } from 'url';
import { isValidSubdomain, extractRootDomain } from './subdomainRecon';

export interface ExtractedLinksResult {
  internalUrls: string[];
  externalUrls: string[];
  discoveredSubdomains: string[];
}

/**
 * Normalizes an absolute URL for deterministic crawl queues
 */
export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);

    // Only crawl HTTP and HTTPS schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // Lowercase hostname and port
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';

    // Strip URL fragments/anchors (#section)
    parsed.hash = '';

    // Remove tracking query params (utm_*, fbclid, etc.)
    const cleanParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      if (!key.toLowerCase().startsWith('utm_') && key !== 'fbclid' && key !== 'gclid') {
        cleanParams.append(key, val);
      }
    });

    const search = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
    let pathname = parsed.pathname;

    // Normalize trailing slash (keep root slash)
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return `${parsed.protocol}//${hostname}${port}${pathname}${search}`;
  } catch {
    return null;
  }
}

/**
 * Assigns crawl priority to URLs:
 * Contact / About / Support -> 100
 * Services / Products -> 30
 * Standard pages -> 10
 * Noise (login, terms, privacy, cart) -> -50
 */
export function getUrlPriority(urlStr: string): number {
  try {
    const path = new URL(urlStr).pathname.toLowerCase();
    if (/(contact|contact-us|contactus|reach-us|get-in-touch|locations|branches)/i.test(path)) {
      return 100;
    }
    if (/(support|help|enquiry|enquiries|feedback|office|address)/i.test(path)) {
      return 80;
    }
    if (/(about|about-us|aboutus|team|leadership|management|board)/i.test(path)) {
      return 60;
    }
    if (/(services|service|solutions|products|courses|programs)/i.test(path)) {
      return 30;
    }
    if (/(login|signin|signup|register|cart|checkout|privacy|terms|policy|disclaimer)/i.test(path)) {
      return -50;
    }
  } catch {}
  return 10;
}

/**
 * Parses raw HTML and extracts internal links, external links, and discovered subdomains
 */
export function extractLinksAndSubdomains(
  html: string,
  currentUrl: string,
  startingHost: string
): ExtractedLinksResult {
  const internalUrls = new Set<string>();
  const externalUrls = new Set<string>();
  const discoveredSubdomains = new Set<string>();

  const cleanStartingHost = startingHost.toLowerCase().split(':')[0];
  const rootDomain = extractRootDomain(cleanStartingHost);

  if (!html || typeof html !== 'string') {
    return { internalUrls: [], externalUrls: [], discoveredSubdomains: [] };
  }

  const $ = cheerio.load(html);

  const processCandidateHref = (href: string | undefined) => {
    if (!href) return;
    const trimmed = href.trim();
    if (
      !trimmed ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('data:')
    ) {
      return;
    }

    const normalized = normalizeUrl(trimmed, currentUrl);
    if (!normalized) return;

    try {
      const parsed = new URL(normalized);
      const linkHost = parsed.hostname.toLowerCase();

      // Check if internal (exact host match OR www variant)
      const isSameHost =
        linkHost === cleanStartingHost ||
        linkHost.replace(/^www\./, '') === cleanStartingHost.replace(/^www\./, '');

      if (isSameHost) {
        internalUrls.add(normalized);
      } else {
        externalUrls.add(normalized);

        // Subdomain check (multi-level)
        if (isValidSubdomain(linkHost, rootDomain) && !isSameHost) {
          discoveredSubdomains.add(linkHost);
        }
      }
    } catch {}
  };

  // 1. Process all anchor links
  $('a[href]').each((_, el) => {
    processCandidateHref($(el).attr('href'));
  });

  // 2. Process scripts, iframes, and link tags for hidden subdomains
  $('script[src], iframe[src], link[href]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('href');
    processCandidateHref(src);
  });

  return {
    internalUrls: Array.from(internalUrls),
    externalUrls: Array.from(externalUrls),
    discoveredSubdomains: Array.from(discoveredSubdomains),
  };
}
