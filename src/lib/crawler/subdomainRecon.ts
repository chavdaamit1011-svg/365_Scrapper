/**
 * Multi-Source High-Speed Subdomain Enumeration & Real Search Dorking Engine
 * Features:
 * - Direct Search Engine Dorking (DuckDuckGo HTML, Yahoo Search)
 * - TLS / SSL Certificate SANs Extraction (Immediate port 443 handshake)
 * - Passive Certificate Transparency (crt.sh, HackerTarget, RapidDNS, ThreatMiner)
 * - Historical & Open Web Intelligence (Archive.org CDX, URLScan.io)
 * - Active In-Page Subdomain Harvester (Crawls landing page HTML & assets)
 * - Concurrent High-Speed DNS Probing (450+ Common & Enterprise prefixes)
 * - Persistent MongoDB Cross-Reference (scraped_results + master_subdomains + dorking_results)
 */

import dns from 'dns';
import * as tls from 'tls';
import { connectMongo } from '../mongodb';

const dnsResolver = new dns.promises.Resolver();
try {
  dnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
} catch {}

const MULTI_PART_TLDS = new Set([
  'gov.in', 'nic.in', 'ac.in', 'edu.in', 'res.in', 'mil.in', 'net.in', 'org.in', 'co.in',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'edu.au',
  'co.nz', 'co.za', 'com.br', 'com.sg', 'com.my', 'co.jp', 'com.mx', 'gc.ca'
]);

/**
 * Extracts the clean root domain from any hostname or URL
 * Correctly handles multi-part ccTLDs (.gov.in, .co.in, .co.uk, etc.)
 */
export function extractRootDomain(hostnameOrUrl: string): string {
  let host = hostnameOrUrl.trim().toLowerCase();
  host = host.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];

  const parts = host.split('.');
  if (parts.length <= 2) {
    return host;
  }

  // Check 2-part ccTLDs like gov.in, co.in, co.uk, nic.in, org.in
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
    const root = cleanRoot.trim().toLowerCase();
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
  for (const p of parts) {
    if (!p || p.length > 63 || p.startsWith('-') || p.endsWith('-')) return null;
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
  const cleanRoot = rootDomain.trim().toLowerCase();
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
 * High-performance concurrent subdomain reconnaissance
 */
export async function discoverAllSubdomains(rootDomain: string): Promise<string[]> {
  const cleanRoot = rootDomain.trim().toLowerCase();
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

  // 1. Vector: Real DuckDuckGo Search Dorking (site:rootDomain)
  const fetchDuckDuckGoDorks = async () => {
    try {
      const queries = [
        `site:${cleanRoot}`,
        `site:*.${cleanRoot}`,
        `site:${cleanRoot} -www`,
        `site:*.${cleanRoot} -www`,
      ];
      await Promise.allSettled(
        queries.map(async (q) => {
          try {
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    ];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    ];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

  // 4. Vector: URLScan.io Open Intelligence API
  const fetchUrlScan = async () => {
    try {
      const res = await fetch(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(cleanRoot)}&size=100`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.results)) {
          for (const item of data.results) {
            if (item.page?.domain) addSub(item.page.domain);
            if (item.page?.url) {
              try {
                addSub(new URL(item.page.url).hostname);
              } catch {}
            }
          }
        }
      }
    } catch {}
  };

  // 3. Vector: Direct TLS/SSL Certificate SANs Extraction (Port 443 Handshake)
  const extractTlsSans = async () => {
    const targets = [cleanRoot, `www.${cleanRoot}`, `mail.${cleanRoot}`, `portal.${cleanRoot}`, `api.${cleanRoot}`];
    await Promise.allSettled(
      targets.map(
        (targetHost) =>
          new Promise<void>((resolve) => {
            try {
              const socket = tls.connect(
                443,
                targetHost,
                { servername: targetHost, rejectUnauthorized: false },
                () => {
                  try {
                    const cert = socket.getPeerCertificate(true);
                    if (cert && cert.subjectaltname) {
                      const sans = cert.subjectaltname.split(',');
                      for (let item of sans) {
                        item = item.trim();
                        if (item.startsWith('DNS:')) item = item.slice(4);
                        if (item.startsWith('*.')) item = item.slice(2);
                        if (item.startsWith('*')) item = item.slice(1);
                        addSub(item);
                      }
                    }
                  } catch {}
                  socket.destroy();
                  resolve();
                }
              );

              socket.setTimeout(3500, () => {
                socket.destroy();
                resolve();
              });

              socket.on('error', () => {
                socket.destroy();
                resolve();
              });
            } catch {
              resolve();
            }
          })
      )
    );
  };

  // 5. Vector: RapidDNS Subdomain Database
  const fetchRapidDns = async () => {
    try {
      const res = await fetch(`https://rapiddns.io/subdomain/${cleanRoot}?full=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const html = await res.text();
        const matches = html.match(subdomainRegex) || [];
        for (const m of matches) addSub(m);
      }
    } catch {}
  };

  // 5. Vector: HackerTarget Host Search
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
            if (line.includes(',')) {
              const host = line.split(',')[0].trim().toLowerCase();
              addSub(host);
            }
          }
        }
      }
    } catch {}
  };

  // 6. Vector: Certspotter Certificate Transparency (Ultra-Reliable JSON API)
  const fetchCertSpotter = async () => {
    try {
      const res = await fetch(
        `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(cleanRoot)}&include_subdomains=true&expand=dns_names`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(8000),
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

  // 7. Vector: AlienVault OTX Passive DNS
  const fetchAlienVault = async () => {
    try {
      const res = await fetch(
        `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(cleanRoot)}/passive_dns`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.passive_dns)) {
          for (const item of data.passive_dns) {
            if (item.hostname) addSub(item.hostname);
          }
        }
      }
    } catch {}
  };

  // 8. Vector: Anubis Subdomain Engine
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

  // 9. Vector: ThreatMiner API
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

  // 10. Vector: Certificate Transparency (crt.sh) with %25 wildcard encoding
  const fetchCrtSh = async () => {
    const urls = [
      `https://crt.sh/?q=%25.${encodeURIComponent(cleanRoot)}&output=json`,
      `https://crt.sh/?q=${encodeURIComponent(cleanRoot)}&output=json`,
      `https://crt.sh/?q=%.${encodeURIComponent(cleanRoot)}&output=json`,
    ];

    await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(22000),
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              for (const item of data) {
                const rawNames = item.name_value || '';
                for (let sub of rawNames.split('\n')) {
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
          }
        } catch {}
      })
    );
  };

  // 11. Vector: Archive.org Wayback Machine CDX (Deep Open Intelligence)
  const fetchArchiveOrg = async () => {
    try {
      const res = await fetch(
        `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(cleanRoot)}/*&output=json&collapse=urlkey&fl=original&limit=10000`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(20000),
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

  // 12. Vector: Active In-Page Subdomain Harvester (Crawls landing page HTML & assets)
  const fetchInPageSubdomains = async () => {
    const urls = [`https://${cleanRoot}`, `https://www.${cleanRoot}`];
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

  // 13. Vector: Active Concurrent Anycast DNS Dictionary Probing (600+ Prefixes)
  const probeDnsDictionary = async () => {
    const candidatePrefixes = [
      // Standard Infrastructure, Web, and Auth
      'www', 'mail', 'webmail', 'email', 'portal', 'admin', 'login', 'auth', 'sso',
      'secure', 'api', 'app', 'apps', 'dashboard', 'dev', 'developer', 'developers',
      'beta', 'stage', 'staging', 'test', 'demo', 'm', 'mobile', 'cdn', 'static', 'media',
      'assets', 'cloud', 'vpn', 'remote', 'gateway', 'connect', 'direct', 'support', 'help',
      'services', 'service', 'pay', 'epay', 'payment', 'payments', 'billing', 'shop', 'store',
      'cart', 'checkout', 'status', 'monitor', 'ns1', 'ns2', 'ns3', 'ns4', 'dns1', 'dns2',
      'mx1', 'mx2', 'ftp', 'sftp', 'docs', 'documentation', 'files', 'git', 'gitlab', 'github',
      'hub', 'jira', 'confluence', 'jenkins', 'ci', 'cd', 'internal', 'corp', 'corporate',
      'office', 'live', 'prod', 'production', 'qa', 'uat', 'review', 'sandbox', 'stage-api',
      'dev-api', 'v1', 'v2', 'ws', 'socket', 'graphql', 'identity', 'id', 'accounts', 'user',
      'users', 'client', 'clients', 'customer', 'customers', 'partners', 'partner', 'affiliate',
      'affiliates', 'investors', 'news', 'blog', 'blogs', 'forum', 'community', 'crm', 'erp',
      'hr', 'careers', 'jobs', 'team', 'staff', 'member', 'members', 'download', 'downloads',
      'register', 'signup', 'signin', 'account', 'security', 'cpanel', 'whm', 'webdisk',
      'autodiscover', 'autoconfig', 'search', 'chat', 'meet', 'video', 'db', 'database', 'sql',
      'redis', 'cache', 'proxy', 'edge', 'tracking', 'track', 'order', 'orders', 'delivery',
      'my', 'home', 'start', 'main', 'web',
      // National Ministries, Departments & Bodies
      'india', 'mygov', 'uidai', 'gst', 'epfindia', 'epfo', 'nic', 'rbi', 'upsc', 'ssc', 'cbse',
      'irctc', 'nvsp', 'parivahan', 'incometax', 'incometaxindia', 'mca', 'ayush', 'cowin', 'digilocker',
      'mea', 'mha', 'finmin', 'mof', 'isro', 'drdo', 'railnet', 'indiapost', 'sebi', 'cbic',
      'icegate', 'gem', 'esic', 'nhp', 'pmindia', 'presidentofindia', 'sansad', 'eci', 'dgft',
      'ncs', 'samarth', 'swayam', 'ndl', 'aiims', 'ignou', 'ugc', 'aicte', 'nta', 'bis',
      'trai', 'fssai', 'ibbi', 'cpcb', 'pmkisan', 'pmay', 'mgnrega', 'cybercrime', 'pib', 'davp',
      'sarathi', 'vahan', 'aadhar', 'echallan', 'scholarship', 'edistrict', 'eprocure', 'cppp',
      'tenders', 'tender', 'recruitment', 'exam', 'results', 'result', 'admitcard', 'parliament',
      'supremecourt', 'highcourt', 'cbi', 'nia', 'crpf', 'bsf', 'cisf', 'defence', 'navy', 'airforce',
      'army', 'nha', 'abdm', 'pmjay', 'jaljeevanmission', 'swachhbharat', 'agricoop', 'enam',
      'goidirectory', 'cpgrams', 'pgportal', 'rti', 'darpg', 'eproc', 'jeemain', 'neet',
      // State Governments & Regional Portals (Gujarat & All Indian States)
      'gujarat', 'digitalgujarat', 'ceogujarat', 'maharashtra', 'aaplesarkar', 'karnataka', 'sevasindhu',
      'delhi', 'kerala', 'tamilnadu', 'tnesevai', 'telangana', 'meeseva', 'andhra', 'rajasthan',
      'up', 'mp', 'punjab', 'haryana', 'bihar', 'odisha', 'bengal', 'wb', 'assam', 'jharkhand',
      'chhattisgarh', 'goa', 'jk', 'ladakh', 'hp', 'uttarakhand', 'tripura', 'manipur', 'meghalaya',
      'mizoram', 'nagaland', 'sikkim', 'puducherry', 'chandigarh',
      // Regional Department & Municipal Subdomains (Gujarat Focus)
      'digital', 'ceo', 'revenue', 'police', 'education', 'health', 'gad', 'finance', 'forest',
      'sports', 'transport', 'labour', 'urban', 'rural', 'agri', 'energy', 'tourism', 'it', 'dst',
      'gmdc', 'gidc', 'gsrtc', 'gwssb', 'ssnl', 'gseb', 'gswan', 'collector', 'panchayat',
      'court', 'districts', 'sp', 'rto', 'cyber', 'vmc', 'smc', 'amc', 'rmc',
      'bmc', 'jmc', 'gpcb', 'getco', 'gsecl', 'ugvcl', 'mgvcl', 'pgvcl', 'dgvcl', 'guvnl',
      'anyror', 'garvi', 'jantri', 'ikhedut', 'kuarbaishala', 'landrecords', 'tribal', 'diragri',
      // Additional Government, Education & Public Sector Portals
      'ahmedabad', 'surat', 'vadodara', 'rajkot', 'bhavnagar', 'jamnagar', 'junagadh', 'gandhinagar',
      'iim', 'iit', 'nit', 'iiit', 'nift', 'nirma', 'gtu', 'vnsgu', 'msubaroda', 'hngu', 'spuvvn', 'sauuni',
      'passport', 'passports', 'visa', 'evisa', 'immigration', 'customs', 'revenue', 'tax', 'incometax',
      'policerecruitment', 'policegov', 'forestgov', 'agrigov', 'healthgov', 'edugov', 'transportgov',
      'tendergov', 'eprocurement', 'etender', 'eauction', 'smartcity', 'corporation', 'nagarpalika',
      'discom', 'energygov', 'solar', 'wind', 'water', 'jal', 'jalshakti', 'swachh', 'krishi', 'kisan'
    ];

    // Concurrently resolve in high-speed batches with Anycast DNS and non-blocking timeout
    const batchSize = 60;
    for (let i = 0; i < candidatePrefixes.length; i += batchSize) {
      const batch = candidatePrefixes.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (prefix) => {
          const candidate = `${prefix}.${cleanRoot}`;
          try {
            await Promise.race([
              dnsResolver.resolve4(candidate),
              dnsResolver.resolveCname(candidate),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
            ]);
            addSub(candidate);
          } catch {}
        })
      );
    }
  };

  // 11. Vector: MongoDB Cross-Reference (scraped_results + master_subdomains + dorking_results)
  const fetchMongo = async () => {
    try {
      const conn = await connectMongo();
      if (!conn?.connection?.db) return;
      const db = conn.connection.db;

      const coll = db.collection('scraped_results');
      const docs = await coll.find(
        { rootDomain: cleanRoot },
        { projection: { subdomains: 1, subdomain: 1 } }
      ).limit(200).toArray();

      for (const d of docs) {
        if (d.subdomain) addSub(d.subdomain);
        if (Array.isArray(d.subdomains)) {
          for (const s of d.subdomains) addSub(s);
        }
      }

      const dorkSubs = await db.collection('master_subdomains').find(
        { domain: cleanRoot },
        { projection: { subdomain: 1 } }
      ).limit(500).toArray();

      for (const ds of dorkSubs) {
        if (ds.subdomain) addSub(ds.subdomain);
      }

      const dorkResults = await db.collection('dorking_results').find(
        { rootDomain: cleanRoot },
        { projection: { hostname: 1 } }
      ).limit(500).toArray();

      for (const dr of dorkResults) {
        if (dr.hostname) addSub(dr.hostname);
      }
    } catch {}
  };

  // Run all 16 discovery vectors concurrently!
  await Promise.allSettled([
    fetchDuckDuckGoDorks(),
    fetchYahooDorks(),
    fetchBingDorks(),
    fetchUrlScan(),
    extractTlsSans(),
    fetchCertSpotter(),
    fetchAlienVault(),
    fetchAnubis(),
    fetchRapidDns(),
    fetchHackerTarget(),
    fetchThreatMiner(),
    fetchCrtSh(),
    fetchArchiveOrg(),
    fetchInPageSubdomains(),
    probeDnsDictionary(),
    fetchMongo(),
  ]);

  console.log(`[SubdomainRecon] Reconnaissance complete for ${cleanRoot}: Discovered ${subdomains.size} unique subdomains.`);
  return Array.from(subdomains).sort();
}
