/**
 * Multi-Source High-Speed Subdomain Enumeration & Real Search Dorking Engine
 * 100% Dynamic - Zero Static Wordlists or Hardcoded Files
 */

import { connectMongo } from '../mongodb';

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
    // If input is "ceogujarat.gov.in" (3 parts) -> returns "ceogujarat.gov.in"
    // If input is "sub.ceogujarat.gov.in" (4 parts) -> returns "ceogujarat.gov.in"
    return parts.length >= 3 ? parts.slice(-3).join('.') : lastTwo;
  }

  // Standard TLDs (.com, .org, .net, etc.)
  // Example: "sub.example.com" -> "example.com"
  return parts.slice(-2).join('.');
}

/**
 * Cleans a candidate subdomain string by removing protocol, port, path,
 * decoding URI encoding (e.g. %2f -> /), and stripping leading URL encoding leftovers (like 2f or 252f).
 */
export function cleanSubdomainCandidate(raw: string, cleanRoot?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();

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

  if (!s) return null;

  if (cleanRoot) {
    const root = cleanRoot.trim().toLowerCase().replace(/^\*?\./, '');
    if (s === root || !s.endsWith(`.${root}`)) return null;
  }

  // Filter out emails, wildcards, slashes, percent, etc.
  if (
    s.includes('@') ||
    s.includes('*') ||
    s.includes(' ') ||
    s.includes('/') ||
    s.includes('\\') ||
    s.includes('%') ||
    s.includes('&') ||
    s.includes('=')
  ) {
    return null;
  }

  // Strict RFC DNS check
  const dnsRegex = /^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)*$/;
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
 * Strips URL-encoded artifacts (like 2f or 252f) and validates RFC compliance.
 */
export function extractSubdomainsFromText(text: string, rootDomain: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const cleanRoot = rootDomain.trim().toLowerCase().replace(/^\*?\./, '');
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
  const cleanRoot = rootDomain.trim().toLowerCase().replace(/^\*?\./, '');
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

  // 1. Vector: Real DuckDuckGo Search Dorking
  const fetchDuckDuckGoDorks = async () => {
    try {
      const queries = [
        `site:${cleanRoot}`,
        `site:*.${cleanRoot}`,
        `site:${cleanRoot} -www`,
        `site:*.${cleanRoot} -www`,
        `site:*.${cleanRoot} -www -mail`,
      ];
      await Promise.allSettled(
        queries.map(async (q) => {
          try {
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const html = await res.text();
              const matches = html.match(subdomainRegex) || [];
              for (const m of matches) addSub(m);
            }
          } catch {}
        })
      );
    } catch {}
  };

  // 2. Vector: Yahoo Web Search Dorking
  const fetchYahooDorks = async () => {
    const urls = [
      `https://search.yahoo.com/search?p=site:${encodeURIComponent(cleanRoot)}&b=1`,
      `https://search.yahoo.com/search?p=site:${encodeURIComponent(cleanRoot)}&b=11`,
      `https://search.yahoo.com/search?p=site:*.${encodeURIComponent(cleanRoot)}&b=1`,
      `https://search.yahoo.com/search?p=site:*.${encodeURIComponent(cleanRoot)}+-www&b=1`,
    ];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            const matches = html.match(subdomainRegex) || [];
            for (const m of matches) addSub(m);
          }
        } catch {}
      })
    );
  };

  // 3. Vector: Bing Web Search Dorking
  const fetchBingDorks = async () => {
    const urls = [
      `https://www.bing.com/search?q=site:${encodeURIComponent(cleanRoot)}&count=50`,
      `https://www.bing.com/search?q=site:*.${encodeURIComponent(cleanRoot)}&count=50`,
      `https://www.bing.com/search?q=site:*.${encodeURIComponent(cleanRoot)}+-www&count=50`,
    ];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            const matches = html.match(subdomainRegex) || [];
            for (const m of matches) addSub(m);
          }
        } catch {}
      })
    );
  };

  // 4. Vector: URLScan.io Open Intelligence API (High Capacity)
  const fetchUrlScan = async () => {
    try {
      const res = await fetch(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(cleanRoot)}&size=1000`, {
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
              try {
                addSub(new URL(item.page.url).hostname);
              } catch {}
            }
            if (item.task?.url) {
              try {
                addSub(new URL(item.task.url).hostname);
              } catch {}
            }
          }
        }
      }
    } catch {}
  };

  // 5. Vector: RapidDNS Subdomain Database
  const fetchRapidDns = async () => {
    try {
      const res = await fetch(`https://rapiddns.io/subdomain/${cleanRoot}?full=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const matches = html.match(subdomainRegex) || [];
        for (const m of matches) addSub(m);
      }
    } catch {}
  };

  // 6. Vector: HackerTarget Host Search
  const fetchHackerTarget = async () => {
    try {
      const res = await fetch(`https://api.hackertarget.com/hostsearch/?q=${cleanRoot}`, {
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
              const host = trimmed.split(',')[0].trim().toLowerCase();
              addSub(host);
            } else if (trimmed) {
              const host = trimmed.split(/\s+/)[0].trim().toLowerCase();
              addSub(host);
            }
          }
        }
      }
    } catch {}
  };

  // 7. Vector: Certspotter Certificate Transparency (Ultra-Reliable JSON API)
  const fetchCertSpotter = async () => {
    try {
      const res = await fetch(
        `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(cleanRoot)}&include_subdomains=true&expand=dns_names`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(12000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            if (Array.isArray(item.dns_names)) {
              for (const name of item.dns_names) {
                addSub(name);
              }
            }
          }
        }
      }
    } catch {}
  };

  // 8. Vector: AlienVault OTX Passive DNS + URL Records
  const fetchAlienVault = async () => {
    try {
      const [dnsRes, urlRes] = await Promise.allSettled([
        fetch(
          `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(cleanRoot)}/passive_dns`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(10000),
          }
        ),
        fetch(
          `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(cleanRoot)}/url_list?limit=500`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(10000),
          }
        ),
      ]);

      if (dnsRes.status === 'fulfilled' && dnsRes.value.ok) {
        const data = await dnsRes.value.json();
        if (Array.isArray(data?.passive_dns)) {
          for (const item of data.passive_dns) {
            if (item.hostname) addSub(item.hostname);
          }
        }
      }

      if (urlRes.status === 'fulfilled' && urlRes.value.ok) {
        const data = await urlRes.value.json();
        if (Array.isArray(data?.url_list)) {
          for (const item of data.url_list) {
            if (item.hostname) addSub(item.hostname);
            else if (item.url) {
              try { addSub(new URL(item.url).hostname); } catch {}
            }
          }
        }
      }
    } catch {}
  };

  // 9. Vector: Subdomain Center Public Recon API
  const fetchSubdomainCenter = async () => {
    try {
      const res = await fetch(`https://api.subdomain.center/?domain=${encodeURIComponent(cleanRoot)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
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

  // 10. Vector: ThreatCrowd Passive Intelligence API
  const fetchThreatCrowd = async () => {
    try {
      const res = await fetch(`https://ci-www.threatcrowd.org/searchApi/v2/domain/report/?domain=${encodeURIComponent(cleanRoot)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.subdomains)) {
          for (const s of data.subdomains) {
            if (typeof s === 'string') addSub(s);
          }
        }
      }
    } catch {}
  };

  // 11. Vector: Anubis Subdomain Engine
  const fetchAnubis = async () => {
    try {
      const res = await fetch(`https://jldc.me/anubis/subdomains/${encodeURIComponent(cleanRoot)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            addSub(item);
          }
        }
      }
    } catch {}
  };

  // 12. Vector: ThreatMiner API
  const fetchThreatMiner = async () => {
    try {
      const res = await fetch(`https://api.threatminer.org/v2/domain.php?q=${encodeURIComponent(cleanRoot)}&rt=5`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.results)) {
          for (const item of data.results) {
            addSub(item);
          }
        }
      }
    } catch {}
  };

  // 13. Vector: Certificate Transparency (crt.sh) - Full Coverage (Zero Artificial Truncation)
  const fetchCrtSh = async () => {
    const urls = [
      `https://crt.sh/?q=%.${encodeURIComponent(cleanRoot)}&output=json`,
      `https://crt.sh/?q=%25.${encodeURIComponent(cleanRoot)}&output=json`,
      `https://crt.sh/?q=${encodeURIComponent(cleanRoot)}&output=json`,
    ];

    await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'application/json, text/html, */*',
            },
            signal: AbortSignal.timeout(25000),
          });
          if (res.ok) {
            const text = await res.text();
            let parsedAsJson = false;
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data)) {
                parsedAsJson = true;
                // Ingest ALL certificates - strictly zero artificial slicing!
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
              }
            } catch {}

            // Fallback: If JSON parsing was not applicable or partial, extract subdomains via regex from response body
            if (!parsedAsJson) {
              const extracted = extractSubdomainsFromText(text, cleanRoot);
              for (const s of extracted) addSub(s);
            }
          }
        } catch {}
      })
    );
  };

  // 14. Vector: Archive.org Wayback Machine CDX (High Capacity)
  const fetchArchiveOrg = async () => {
    try {
      const res = await fetch(
        `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(cleanRoot)}/*&output=json&collapse=urlkey&fl=original&limit=10000`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          for (const row of rows.slice(1)) {
            try {
              const raw = row[0];
              if (raw) {
                const urlStr = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
                const parsed = new URL(urlStr);
                addSub(parsed.hostname);
              }
            } catch {}
          }
        }
      }
    } catch {}
  };

  // 15. Vector: Active In-Page Subdomain Harvester (Crawls landing page HTML & assets)
  const fetchInPageSubdomains = async () => {
    const urls = [`https://${cleanRoot}`, `https://www.${cleanRoot}`];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const html = await res.text();
            const matches = html.match(subdomainRegex) || [];
            for (const m of matches) addSub(m);
          }
        } catch {}
      })
    );
  };

  // 16. Vector: MongoDB Cross-Reference (scraped_results + master_subdomains + dorking_results)
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
      ).limit(1000).toArray();

      for (const ds of dorkSubs) {
        if (ds.subdomain) addSub(ds.subdomain);
      }

      const dorkResults = await db.collection('dorking_results').find(
        { rootDomain: cleanRoot },
        { projection: { hostname: 1 } }
      ).limit(1000).toArray();

      for (const dr of dorkResults) {
        if (dr.hostname) addSub(dr.hostname);
      }
    } catch {}
  };

  // Run all 16 discovery vectors concurrently (100% Dynamic Online OSINT & Crawling)
  await Promise.allSettled([
    fetchDuckDuckGoDorks(),
    fetchYahooDorks(),
    fetchBingDorks(),
    fetchUrlScan(),
    fetchCertSpotter(),
    fetchAlienVault(),
    fetchSubdomainCenter(),
    fetchThreatCrowd(),
    fetchAnubis(),
    fetchRapidDns(),
    fetchHackerTarget(),
    fetchThreatMiner(),
    fetchCrtSh(),
    fetchArchiveOrg(),
    fetchInPageSubdomains(),
    fetchMongo(),
  ]);

  console.log(`[SubdomainRecon] Reconnaissance complete for ${cleanRoot}: Discovered ${subdomains.size} unique subdomains.`);
  return Array.from(subdomains).sort();
}
