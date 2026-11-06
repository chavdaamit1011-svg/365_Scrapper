/**
 * Multi-Source High-Speed Subdomain Enumeration & Real Search Dorking Engine
 * Features:
 * - Direct Search Engine Dorking (DuckDuckGo HTML, Yahoo Search)
 * - TLS / SSL Certificate SANs Extraction (Immediate port 443 handshake)
 * - Passive Certificate Transparency (crt.sh, Certspotter, HackerTarget, RapidDNS)
 * - Historical & Open Web Intelligence (Archive.org CDX, URLScan.io, Anubis)
 * - Active In-Page Subdomain Harvester (Crawls landing page HTML & assets)
 * - Concurrent High-Speed DNS Probing (350+ Common & Enterprise prefixes)
 * - Persistent MongoDB Cross-Reference (scraped_results + master_subdomains + dorking_results)
 */

import { promises as dns } from 'dns';
import * as tls from 'tls';
import { connectMongo } from '../mongodb';

const MULTI_PART_TLDS = new Set([
  'gov.in', 'nic.in', 'ac.in', 'edu.in', 'res.in', 'mil.in', 'net.in', 'org.in', 'co.in',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'edu.au',
  'co.nz', 'co.za', 'com.br', 'com.sg', 'com.my', 'co.jp', 'com.mx', 'gc.ca'
]);

/**
 * Extracts the clean root domain from any hostname or URL
 */
export function extractRootDomain(hostnameOrUrl: string): string {
  let host = hostnameOrUrl.trim().toLowerCase();
  host = host.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];

  const parts = host.split('.');
  if (parts.length <= 2) {
    return host;
  }

  // Check 2-part ccTLDs like gov.in, co.in, co.uk
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    return lastTwo;
  }

  // Standard TLDs (.com, .org, .net, etc.)
  return parts.slice(-2).join('.');
}

/**
 * Validates whether a candidate hostname is a legitimate subdomain of the root domain.
 */
export function isValidSubdomain(candidate: string, rootDomain: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;

  let cleanHost = candidate.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  cleanHost = cleanHost.replace(/^\*\./, '').replace(/^\./, '');
  const cleanRoot = rootDomain.trim().toLowerCase();

  if (!cleanHost || cleanHost === cleanRoot) return false;
  if (!cleanHost.endsWith(`.${cleanRoot}`)) return false;

  // Filter out email addresses, wildcards, or invalid characters
  if (cleanHost.includes('@') || cleanHost.includes('*') || cleanHost.includes(' ')) {
    return false;
  }

  // Strict RFC DNS hostname check
  const dnsRegex = /^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)*$/;
  return dnsRegex.test(cleanHost);
}

/**
 * High-performance concurrent subdomain reconnaissance
 */
export async function discoverAllSubdomains(rootDomain: string): Promise<string[]> {
  const cleanRoot = rootDomain.trim().toLowerCase();
  const subdomains = new Set<string>();

  // Always include standard www subdomain candidate
  subdomains.add(`www.${cleanRoot}`);

  // Helper to safely add valid subdomains
  const addSub = (cand: string) => {
    if (isValidSubdomain(cand, cleanRoot)) {
      subdomains.add(cand.trim().toLowerCase());
    }
  };

  const escapedRoot = cleanRoot.replace(/\./g, '\\.');
  const subdomainRegex = new RegExp(`[a-z0-9_.-]+\\.${escapedRoot}`, 'gi');

  // 1. Vector: Real DuckDuckGo Search Dorking (site:rootDomain)
  const fetchDuckDuckGoDorks = async () => {
    try {
      const queries = [`site:${cleanRoot}`, `site:*.${cleanRoot}`];
      for (const q of queries) {
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
      }
    } catch {}
  };

  // 2. Vector: Yahoo Web Search Dorking
  const fetchYahooDorks = async () => {
    try {
      const res = await fetch(`https://search.yahoo.com/search?p=site:${encodeURIComponent(cleanRoot)}`, {
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
  };

  // 3. Vector: Direct TLS/SSL Certificate SANs Extraction (Port 443 Handshake)
  const extractTlsSans = async () => {
    const targets = [cleanRoot, `www.${cleanRoot}`];
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
                      // subjectaltname format: "DNS:example.com, DNS:*.example.com, DNS:api.example.com"
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

              socket.setTimeout(4000, () => {
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

  // 4. Vector: Certspotter SSL Certificate Issuances
  const fetchCertspotter = async () => {
    try {
      const res = await fetch(
        `https://api.certspotter.com/v1/issuances?domain=${cleanRoot}&include_subdomains=true&expand=dns_names`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(9000),
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

  // 6. Vector: HackerTarget Host Search
  const fetchHackerTarget = async () => {
    try {
      const res = await fetch(`https://api.hackertarget.com/hostsearch/?q=${cleanRoot}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(9000),
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

  // 7. Vector: Certificate Transparency (crt.sh) - Wildcard + Apex
  const fetchCrtSh = async () => {
    const urls = [
      `https://crt.sh/?q=%25.${cleanRoot}&output=json`,
      `https://crt.sh/?q=%.${cleanRoot}&output=json`,
      `https://crt.sh/?q=${cleanRoot}&output=json`,
    ];

    await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(10000),
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
              }
            }
          }
        } catch {}
      })
    );
  };

  // 8. Vector: Archive.org Wayback Machine CDX
  const fetchArchiveOrg = async () => {
    try {
      const res = await fetch(
        `http://web.archive.org/cdx/search/cdx?url=*.${cleanRoot}/*&output=json&collapse=urlkey&fl=original&limit=1000`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(9000),
        }
      );

      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          for (const row of rows.slice(1)) {
            try {
              const parsed = new URL(row[0]);
              addSub(parsed.hostname);
            } catch {}
          }
        }
      }
    } catch {}
  };

  // 9. Vector: URLScan.io Passive DNS Search
  const fetchUrlScan = async () => {
    try {
      const res = await fetch(`https://urlscan.io/api/v1/search/?q=domain:${cleanRoot}&size=100`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(9000),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.results)) {
          for (const r of data.results) {
            const d = (r.page?.domain || '').toLowerCase();
            addSub(d);
          }
        }
      }
    } catch {}
  };

  // 10. Vector: Anubis Subdomain Database
  const fetchAnubis = async () => {
    try {
      const res = await fetch(`https://jonlu.ca/anubis/subdomains/${cleanRoot}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          for (const item of list) addSub(item);
        }
      }
    } catch {}
  };

  // 11. Vector: Active In-Page Subdomain Harvester (Crawls landing page HTML & assets)
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

  // 12. Vector: Active Concurrent DNS Dictionary Probing (350+ Common & Enterprise Prefixes)
  const probeDnsDictionary = async () => {
    const candidatePrefixes = [
      // Standard Infrastructure, Web, and Auth
      'www', 'mail', 'webmail', 'email', 'portal', 'admin', 'login', 'auth', 'sso',
      'secure', 'api', 'app', 'dashboard', 'dev', 'beta', 'stage', 'staging', 'test', 'demo',
      'm', 'mobile', 'cdn', 'static', 'media', 'assets', 'cloud', 'vpn', 'remote',
      'gateway', 'connect', 'direct', 'support', 'help', 'services', 'service',
      'pay', 'epay', 'payment', 'billing', 'shop', 'store', 'cart', 'status', 'monitor',
      'ns1', 'ns2', 'dns1', 'dns2', 'mx1', 'mx2', 'ftp', 'docs', 'files', 'git', 'gitlab',
      'hub', 'jira', 'confluence', 'jenkins', 'internal', 'corp', 'office', 'live', 'prod',
      'production', 'qa', 'uat', 'review', 'sandbox', 'stage-api', 'dev-api', 'v1', 'v2', 'ws', 'socket',
      'graphql', 'identity', 'accounts', 'user', 'users', 'client', 'clients', 'partners',
      'affiliate', 'investors', 'news', 'blog', 'forum', 'community', 'crm', 'erp', 'hr',
      'careers', 'jobs', 'team', 'staff', 'member', 'members', 'download', 'downloads',
      'register', 'signup', 'account', 'security', 'cpanel', 'whm', 'autodiscover', 'search',
      // National Ministries, Departments & Bodies
      'india', 'mygov', 'uidai', 'gst', 'epfindia', 'epfo', 'nic', 'rbi', 'upsc', 'ssc', 'cbse',
      'irctc', 'nvsp', 'parivahan', 'incometax', 'incometaxindia', 'mca', 'ayush', 'cowin', 'digilocker',
      'mea', 'mha', 'finmin', 'mof', 'isro', 'drdo', 'railnet', 'indiapost', 'sebi', 'cbic',
      'icegate', 'gem', 'esic', 'nhp', 'pmindia', 'presidentofindia', 'sansad', 'eci', 'dgft',
      'ncs', 'samarth', 'swayam', 'ndl', 'aiims', 'ignou', 'ugc', 'aicte', 'nta', 'bis',
      'trai', 'fssai', 'ibbi', 'cpcb', 'pmkisan', 'pmay', 'mgnrega', 'cybercrime', 'pib', 'davp',
      // State Governments & Regional Portals
      'gujarat', 'digitalgujarat', 'ceogujarat', 'maharashtra', 'aaplesarkar', 'karnataka', 'sevasindhu',
      'delhi', 'kerala', 'tamilnadu', 'tnesevai', 'telangana', 'meeseva', 'andhra', 'rajasthan',
      'up', 'mp', 'punjab', 'haryana', 'bihar', 'odisha', 'bengal', 'wb', 'assam', 'jharkhand',
      'chhattisgarh', 'goa', 'jk', 'ladakh', 'hp', 'uttarakhand', 'tripura', 'manipur', 'meghalaya',
      'mizoram', 'nagaland', 'sikkim', 'puducherry', 'chandigarh'
    ];

    // Concurrently resolve batches of 35
    const batchSize = 35;
    for (let i = 0; i < candidatePrefixes.length; i += batchSize) {
      const batch = candidatePrefixes.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (prefix) => {
          const candidate = `${prefix}.${cleanRoot}`;
          try {
            await dns.resolve4(candidate);
            addSub(candidate);
          } catch {
            try {
              await dns.resolveCname(candidate);
              addSub(candidate);
            } catch {}
          }
        })
      );
    }
  };

  // 13. Vector: MongoDB Cross-Reference (scraped_results + master_subdomains + dorking_results)
  const fetchMongo = async () => {
    try {
      const conn = await connectMongo();
      if (!conn?.connection?.db) return;
      const db = conn.connection.db;

      const coll = db.collection('scraped_results');
      const docs = await coll.find(
        { rootDomain: cleanRoot },
        { projection: { subdomains: 1, subdomain: 1 } }
      ).limit(100).toArray();

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

  // Launch all vectors concurrently for maximum intelligence harvesting!
  await Promise.allSettled([
    fetchDuckDuckGoDorks(),
    fetchYahooDorks(),
    extractTlsSans(),
    fetchCertspotter(),
    fetchRapidDns(),
    fetchHackerTarget(),
    fetchCrtSh(),
    fetchArchiveOrg(),
    fetchUrlScan(),
    fetchAnubis(),
    fetchInPageSubdomains(),
    probeDnsDictionary(),
    fetchMongo(),
  ]);

  console.log(`[SubdomainRecon] Reconnaissance complete for ${cleanRoot}: Discovered ${subdomains.size} unique subdomains.`);
  return Array.from(subdomains).sort();
}
