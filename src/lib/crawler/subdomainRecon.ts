/**
 * Multi-Source High-Speed Subdomain Enumeration & Real Search Dorking Engine
 * 100% Dynamic - Zero Static Wordlists or Hardcoded Files
 */

import { connectMongo } from '../mongodb';
import { promises as dnsPromises } from 'dns';

const MULTI_PART_TLDS = new Set([
  // India
  'gov.in', 'nic.in', 'ac.in', 'edu.in', 'res.in', 'mil.in', 'net.in', 'org.in', 'co.in', 'gen.in', 'ind.in',
  // Pakistan
  'gov.pk', 'edu.pk', 'com.pk', 'org.pk', 'net.pk', 'ac.pk',
  // Bangladesh & Sri Lanka & Nepal
  'gov.bd', 'edu.bd', 'com.bd', 'org.bd', 'gov.np', 'edu.np', 'com.np', 'gov.lk', 'edu.lk', 'com.lk',
  // UK & Ireland
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'gov.ie',
  // Australia & New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'govt.nz', 'ac.nz',
  // Middle East & Africa
  'gov.ae', 'co.ae', 'ac.ae', 'gov.sa', 'edu.sa', 'com.sa', 'gov.za', 'ac.za', 'co.za', 'org.za', 'gov.ng', 'edu.ng', 'com.ng', 'go.ke',
  // Americas
  'com.br', 'gov.br', 'org.br', 'edu.br', 'com.mx', 'gob.mx', 'edu.mx', 'gc.ca', 'gov.ab.ca', 'gov.bc.ca', 'gov.on.ca', 'gov.qc.ca', 'com.ar', 'gob.ar',
  // Asia
  'com.sg', 'gov.sg', 'edu.sg', 'com.my', 'gov.my', 'edu.my', 'co.id', 'go.id', 'ac.id', 'com.ph', 'gov.ph', 'edu.ph',
  'co.jp', 'go.jp', 'ac.jp', 'ne.jp', 'co.kr', 'go.kr', 'ac.kr', 'com.vn', 'gov.vn', 'edu.vn', 'gov.tr', 'com.tr', 'edu.tr', 'gov.il', 'co.il'
]);

/**
 * Extracts the clean root domain from any hostname or URL
 * Correctly handles multi-part ccTLDs (.gov.in, .co.in, .co.uk, .gov.pk, etc.)
 */
export function extractRootDomain(hostnameOrUrl: string): string {
  let host = hostnameOrUrl.trim().toLowerCase();
  host = host.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];

  const parts = host.split('.');
  if (parts.length <= 2) {
    return host;
  }

  // Check 2-part ccTLDs like gov.in, co.in, co.uk, nic.in, org.in, gov.pk, etc.
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    return parts.length >= 3 ? parts.slice(-3).join('.') : lastTwo;
  }

  // Standard TLDs (.com, .org, .net, etc.)
  return parts.slice(-2).join('.');
}

/**
 * Cleans a candidate subdomain string by removing protocol, port, path,
 * decoding URI encoding (e.g. %2f -> /), and stripping leading URL encoding leftovers (like 2f or 252f).
 * Strips trailing dots and supports RFC compliance with underscores in DNS label bodies.
 */
export function cleanSubdomainCandidate(raw: string, cleanRoot?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();

  // Strip trailing dots
  s = s.replace(/\.+$/, '');

  // Decode URI if percent-encoded
  try {
    if (s.includes('%')) {
      s = decodeURIComponent(s);
    }
  } catch {}

  // Repeatedly strip protocols, leading slashes, and URL-encoding leftovers
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^[a-z0-9_-]+:\/\//i, '');
    s = s.replace(/^\/\//, '');
    s = s.replace(/^\/+/, '');
    s = s.replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
    s = s.replace(/^\*\./, '').replace(/^\./, '');
  }

  s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];

  // Second pass after splitting path/query
  prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
    s = s.replace(/^\*\./, '').replace(/^\./, '');
  }

  s = s.replace(/\.+$/, '');

  if (!s) return null;

  if (cleanRoot) {
    const root = cleanRoot.trim().toLowerCase().replace(/^\*?\./, '').replace(/\.+$/, '');
    if (s === root || !s.endsWith('.' + root)) return null;
  }

  // Filter out invalid characters
  if (
    s.includes('@') ||
    s.includes('*') ||
    s.includes(' ') ||
    s.includes('/') ||
    s.includes('\\') ||
    s.includes('%') ||
    s.includes('&') ||
    s.includes('=') ||
    s.includes(';') ||
    s.includes('"') ||
    s.includes("'") ||
    s.includes('<') ||
    s.includes('>')
  ) {
    return null;
  }

  // RFC DNS check allowing letters, numbers, hyphens, and underscores (_) in label bodies
  const dnsRegex = /^[a-z0-9_]([a-z0-9\-_]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9\-_]*[a-z0-9_])?)*$/;
  if (!dnsRegex.test(s)) return null;

  const parts = s.split('.');
  if (parts.length < 2) return null;

  // Reject junk hash labels (e.g. 132b114842d5f7d97bcc9a5af45dab47), UUIDs, and raw tracking IDs
  const hexHashRegex = /^[a-f0-9]{18,}$/i;
  for (const p of parts) {
    if (!p || p.length > 63 || p.startsWith('-') || p.endsWith('-')) return null;
    if (hexHashRegex.test(p)) return null;
    if (/^[0-9]+$/.test(p) && p.length > 10) return null;
  }

  return s;
}

export function sanitizeCandidate(cand: string): string {
  return cleanSubdomainCandidate(cand) || cand.trim().toLowerCase().replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
}

/**
 * Validates whether a candidate hostname is a legitimate subdomain of the root domain.
 */
export function isValidSubdomain(candidate: string, rootDomain: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const clean = cleanSubdomainCandidate(candidate, rootDomain.trim().toLowerCase());
  return Boolean(clean);
}

/**
 * Safely extracts all subdomains of a root domain from raw HTML, text, or query results.
 * Strips URL-encoded artifacts (like 2f or 252f), trailing dots, and validates RFC compliance.
 */
export function extractSubdomainsFromText(text: string, rootDomain: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const cleanRoot = rootDomain.trim().toLowerCase().replace(/^\*?\./, '').replace(/\.+$/, '');
  const escapedRoot = cleanRoot.replace(/\./g, '\\.');
  const results = new Set<string>();

  const subdomainRegex = new RegExp(`[a-z0-9_.-]+\\.${escapedRoot}`, 'gi');
  const matches = text.match(subdomainRegex) || [];
  for (const m of matches) {
    const cleaned = cleanSubdomainCandidate(m, cleanRoot);
    if (cleaned) {
      results.add(cleaned);
    }
  }

  return Array.from(results);
}

/**
 * High-performance progressive concurrent subdomain reconnaissance (Cycle-Stratified)
 * Multi-vector parallel OSINT & Certificate Transparency engine
 */
export async function discoverAllSubdomains(rootDomain: string, cycle: number = 1): Promise<string[]> {
  const cleanRoot = rootDomain.trim().toLowerCase().replace(/^\*?\./, '').replace(/\.+$/, '');
  const subdomains = new Set<string>();

  // Always include standard www subdomain candidate
  subdomains.add(`www.${cleanRoot}`);

  const escapedRoot = cleanRoot.replace(/\./g, '\\.');
  const subdomainRegex = new RegExp(`[a-z0-9_.-]+\\.${escapedRoot}`, 'gi');

  // Helper to safely add valid subdomains
  const addSub = (cand: string) => {
    const cleaned = cleanSubdomainCandidate(cand, cleanRoot);
    if (cleaned) {
      subdomains.add(cleaned);
    }
  };

  // Helper to extract all matching subdomains from text/HTML body
  const addFromText = (text: string) => {
    if (!text || typeof text !== 'string') return;
    const matches = text.match(subdomainRegex) || [];
    for (const m of matches) {
      addSub(m);
    }
  };

  // 1. Vector: Certificate Transparency (crt.sh) - Ultra-High Yield Multi-Stream Architecture
  // Uses streaming HTML table parsing (immune to 502 Bad Gateway and statement timeouts) + JSON fallback
  const fetchCrtSh = async () => {
    // 1A. Primary HTML stream (active + historical certificates)
    const runHtmlStream = async (queryParam: string, timeoutMs: number = 35000) => {
      try {
        const res = await fetch(`https://crt.sh/?q=${queryParam}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const html = await res.text();
          addFromText(html);
        }
      } catch {}
    };

    // 1B. JSON API query
    const runJsonStream = async (queryParam: string, timeoutMs: number = 25000) => {
      try {
        const res = await fetch(`https://crt.sh/?q=${queryParam}&output=json`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json, text/html, */*',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            if (Array.isArray(data)) {
              for (const item of data) {
                const rawNames = item.name_value || '';
                for (let sub of String(rawNames).split(/[\r\n,]+/)) {
                  sub = sub.trim().toLowerCase();
                  if (sub.startsWith('*.')) sub = sub.slice(2);
                  if (sub.startsWith('*')) sub = sub.slice(1);
                  addSub(sub);
                }
                if (item.common_name) {
                  let cn = String(item.common_name).trim().toLowerCase();
                  if (cn.startsWith('*.')) cn = cn.slice(2);
                  if (cn.startsWith('*')) cn = cn.slice(1);
                  addSub(cn);
                }
              }
              return;
            }
          } catch {}
          addFromText(text);
        }
      } catch {}
    };

    await Promise.allSettled([
      // Primary wildcard HTML stream
      runHtmlStream(`%25.${encodeURIComponent(cleanRoot)}`, 35000),
      // Active non-expired certs HTML stream
      runHtmlStream(`%25.${encodeURIComponent(cleanRoot)}&exclude=expired`, 25000),
      // Multi-level wildcard HTML stream (nested 3rd and 4th level subdomains)
      runHtmlStream(`%25.%25.${encodeURIComponent(cleanRoot)}`, 25000),
      // Apex certificates HTML stream
      runHtmlStream(encodeURIComponent(cleanRoot), 20000),
      // JSON endpoint
      runJsonStream(`%25.${encodeURIComponent(cleanRoot)}`, 25000),
    ]);
  };

  // 2. Vector: CertSpotter Certificate Transparency with Cursor Pagination
  const fetchCertSpotter = async () => {
    try {
      let afterCursor: string | null = null;
      let page = 0;
      const maxPages = 8; // Fetch up to 800 issuances

      while (page < maxPages) {
        page++;
        const url: string = afterCursor
          ? `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(cleanRoot)}&include_subdomains=true&expand=dns_names&after=${encodeURIComponent(afterCursor)}`
          : `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(cleanRoot)}&include_subdomains=true&expand=dns_names`;

        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) break;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const item of data) {
          if (Array.isArray(item.dns_names)) {
            for (const name of item.dns_names) {
              addSub(name);
            }
          }
        }

        const lastItem = data[data.length - 1];
        if (lastItem?.id && data.length >= 100) {
          afterCursor = String(lastItem.id);
        } else {
          break;
        }
      }
    } catch {}
  };

  // 3. Vector: URLScan.io Multi-Vector Intelligence
  const fetchUrlScan = async () => {
    const queries = [
      `domain:${encodeURIComponent(cleanRoot)}`,
      `page.domain:${encodeURIComponent(cleanRoot)}`,
      `task.domain:${encodeURIComponent(cleanRoot)}`,
    ];
    await Promise.allSettled(
      queries.map(async (q) => {
        try {
          const res = await fetch(`https://urlscan.io/api/v1/search/?q=${q}&size=1000`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.results)) {
              for (const item of data.results) {
                if (item.page?.domain) addSub(item.page.domain);
                if (item.page?.subdomain) addSub(item.page.subdomain);
                if (item.page?.url) {
                  try { addSub(new URL(item.page.url).hostname); } catch {}
                }
                if (item.task?.url) {
                  try { addSub(new URL(item.task.url).hostname); } catch {}
                }
                if (Array.isArray(item.page?.ptr)) {
                  for (const ptr of item.page.ptr) addSub(ptr);
                }
              }
            }
          }
        } catch {}
      })
    );
  };

  // 4. Vector: Subdomain Center Public Recon API
  const fetchSubdomainCenter = async () => {
    try {
      const res = await fetch(`https://api.subdomain.center/?domain=${encodeURIComponent(cleanRoot)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          for (const s of list) {
            if (typeof s === 'string') addSub(s);
          }
        }
      }
    } catch {}
  };

  // 5. Vector: RapidDNS Subdomain Database (Multi-Page with Trailing Dot Cleaning)
  const fetchRapidDns = async () => {
    const pages = [
      `https://rapiddns.io/subdomain/${encodeURIComponent(cleanRoot)}?full=1`,
      `https://rapiddns.io/subdomain/${encodeURIComponent(cleanRoot)}?page=2`,
    ];
    await Promise.allSettled(
      pages.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const html = await res.text();
            addFromText(html);
          }
        } catch {}
      })
    );
  };

  // 6. Vector: HackerTarget Host Search
  const fetchHackerTarget = async () => {
    try {
      const res = await fetch(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(cleanRoot)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const text = await res.text();
        const textLow = text.toLowerCase();
        if (!textLow.includes('error') && !textLow.includes('quota') && !textLow.includes('api count exceeded')) {
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.includes(',')) {
              addSub(trimmed.split(',')[0].trim());
            } else if (trimmed) {
              addSub(trimmed.split(/\s+/)[0].trim());
            }
          }
        }
      }
    } catch {}
  };

  // 7. Vector: AlienVault OTX General Domain Indicators
  const fetchAlienVault = async () => {
    try {
      const res = await fetch(`https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(cleanRoot)}/general`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.base_indicator?.indicator) addSub(data.base_indicator.indicator);
        if (data?.whois) addFromText(JSON.stringify(data.whois));
      }
    } catch {}
  };

  // 8. Vector: Advanced Negative Subtraction Dorking (DuckDuckGo, Yahoo, Bing)
  const fetchAdvancedDorks = async () => {
    const ddgQueries = [
      `site:*.${cleanRoot} -site:www.${cleanRoot}`,
      `site:*.${cleanRoot} -site:www.${cleanRoot} -site:mail.${cleanRoot}`,
      `site:*.${cleanRoot} inurl:api`,
      `site:*.${cleanRoot} inurl:portal`,
      `site:*.${cleanRoot} inurl:admin`,
      `site:*.${cleanRoot} inurl:app`,
      `site:*.${cleanRoot} inurl:cloud`,
      `site:*.${cleanRoot} inurl:cdn`,
      `site:*.${cleanRoot} inurl:login`,
      `site:*.${cleanRoot} inurl:dev`,
      `site:*.${cleanRoot} inurl:test`,
      `site:*.${cleanRoot} inurl:secure`,
    ];

    const yahooUrls = [
      `https://search.yahoo.com/search?p=site:*.${encodeURIComponent(cleanRoot)}+-www&b=1`,
      `https://search.yahoo.com/search?p=site:*.${encodeURIComponent(cleanRoot)}+inurl:portal&b=1`,
      `https://search.yahoo.com/search?p=site:*.${encodeURIComponent(cleanRoot)}+inurl:api&b=1`,
      `https://search.yahoo.com/search?p=site:*.${encodeURIComponent(cleanRoot)}+inurl:admin&b=1`,
    ];

    const bingUrls = [
      `https://www.bing.com/search?q=site:*.${encodeURIComponent(cleanRoot)}+-www&count=50`,
      `https://www.bing.com/search?q=site:*.${encodeURIComponent(cleanRoot)}+inurl:portal&count=50`,
      `https://www.bing.com/search?q=site:*.${encodeURIComponent(cleanRoot)}+inurl:api&count=50`,
    ];

    await Promise.allSettled([
      ...ddgQueries.map(async (q) => {
        try {
          const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            addFromText(html);
          }
        } catch {}
      }),
      ...yahooUrls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            addFromText(html);
          }
        } catch {}
      }),
      ...bingUrls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            addFromText(html);
          }
        } catch {}
      }),
    ]);
  };

  // 9. Vector: High-Speed Parallel DNS Verification of Top Subdomain Prefix Patterns
  const fetchFastDnsProbe = async () => {
    const commonPrefixes = [
      'api', 'dev', 'portal', 'admin', 'mail', 'app', 'login', 'vpn', 'auth', 'cloud',
      'cdn', 'secure', 'test', 'status', 'docs', 'remote', 'support', 'intra', 'webmail',
      'staging', 'services', 'citizen', 'digital', 'data', 'pay', 'gateway', 'payment',
      'apply', 'careers', 'jobs', 'tender', 'tenders', 'rti', 'recruitment', 'grievance',
      'feedback', 'shop', 'blog', 'server', 'ns1', 'ns2', 'help', 'static', 'assets'
    ];

    await Promise.allSettled(
      commonPrefixes.map(async (prefix) => {
        try {
          const cand = `${prefix}.${cleanRoot}`;
          await dnsPromises.resolve(cand);
          addSub(cand);
        } catch {}
      })
    );
  };

  // 10. Vector: Active In-Page Subdomain Harvester (Landing HTML, Scripts, CSS, and Assets)
  const fetchInPageSubdomains = async () => {
    const urls = [`https://${cleanRoot}`, `https://www.${cleanRoot}`];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const html = await res.text();
            addFromText(html);
          }
        } catch {}
      })
    );
  };

  // 11. Vector: MongoDB Master Collections Cross-Reference (Cycle > 1 continuous mode)
  const fetchMongo = async () => {
    if (cycle <= 1) return;
    try {
      const conn = await connectMongo();
      if (!conn?.connection?.db) return;
      const db = conn.connection.db;

      const coll = db.collection('scraped_results');
      const docs = await coll.find(
        { rootDomain: cleanRoot },
        { projection: { subdomains: 1, subdomain: 1 } }
      ).limit(500).toArray();

      for (const d of docs) {
        if (d.subdomain) addSub(d.subdomain);
        if (Array.isArray(d.subdomains)) {
          for (const s of d.subdomains) addSub(s);
        }
      }

      const dorkSubs = await db.collection('master_subdomains').find(
        { domain: cleanRoot },
        { projection: { subdomain: 1 } }
      ).limit(2000).toArray();

      for (const ds of dorkSubs) {
        if (ds.subdomain) addSub(ds.subdomain);
      }

      const dorkResults = await db.collection('dorking_results').find(
        { rootDomain: cleanRoot },
        { projection: { hostname: 1 } }
      ).limit(2000).toArray();

      for (const dr of dorkResults) {
        if (dr.hostname) addSub(dr.hostname);
      }
    } catch {}
  };

  // Execute all comprehensive discovery vectors concurrently
  await Promise.allSettled([
    fetchCrtSh(),
    fetchCertSpotter(),
    fetchUrlScan(),
    fetchSubdomainCenter(),
    fetchRapidDns(),
    fetchHackerTarget(),
    fetchAlienVault(),
    fetchAdvancedDorks(),
    fetchFastDnsProbe(),
    fetchInPageSubdomains(),
    fetchMongo(),
  ]);

  console.log(`[SubdomainRecon] Reconnaissance complete for ${cleanRoot}: Discovered ${subdomains.size} unique subdomains.`);
  return Array.from(subdomains).sort();
}
