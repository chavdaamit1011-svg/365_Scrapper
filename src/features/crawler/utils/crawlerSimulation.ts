import { ScrapedDataRecord } from '../types/crawler.types';
import { TargetItem } from '@/features/targets/types/target.types';

interface CountryMeta {
  country: string;
  countryCode: string;
  countryFlag: string;
}

const COUNTRY_POOL: CountryMeta[] = [
  { country: 'United States', countryCode: 'US', countryFlag: '🇺🇸' },
  { country: 'Germany', countryCode: 'DE', countryFlag: '🇩🇪' },
  { country: 'United Kingdom', countryCode: 'GB', countryFlag: '🇬🇧' },
  { country: 'India', countryCode: 'IN', countryFlag: '🇮🇳' },
  { country: 'Canada', countryCode: 'CA', countryFlag: '🇨🇦' },
  { country: 'Netherlands', countryCode: 'NL', countryFlag: '🇳🇱' },
  { country: 'Singapore', countryCode: 'SG', countryFlag: '🇸🇬' },
  { country: 'France', countryCode: 'FR', countryFlag: '🇫🇷' },
  { country: 'Australia', countryCode: 'AU', countryFlag: '🇦🇺' },
  { country: 'Japan', countryCode: 'JP', countryFlag: '🇯🇵' },
  { country: 'Switzerland', countryCode: 'CH', countryFlag: '🇨🇭' },
  { country: 'Sweden', countryCode: 'SE', countryFlag: '🇸🇪' },
];

const COMMON_PREFIXES = ['api', 'mail', 'auth', 'portal', 'app', 'secure', 'admin', 'cdn'];
const COMMON_ROLES = ['contact', 'support', 'info', 'security', 'hello', 'admin', 'compliance'];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Simulates OSINT extraction of domain, subdomain, email, and country
 * for a given target item. Designed as an interim client engine until
 * the backend crawler pipeline is connected.
 */
export function simulateCrawlForTarget(target: TargetItem): ScrapedDataRecord[] {
  const rawDomain = target.domain.toLowerCase().trim();
  const hash = hashString(rawDomain);

  // Determine root domain and subdomains
  let rootDomain = rawDomain;
  const parts = rawDomain.split('.');
  if (parts.length > 2 && !target.domain.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    rootDomain = parts.slice(-2).join('.');
  }

  // Country based on domain TLD or deterministic hash
  let country = COUNTRY_POOL[hash % COUNTRY_POOL.length];
  if (rawDomain.endsWith('.in')) country = { country: 'India', countryCode: 'IN', countryFlag: '🇮🇳' };
  else if (rawDomain.endsWith('.de')) country = { country: 'Germany', countryCode: 'DE', countryFlag: '🇩🇪' };
  else if (rawDomain.endsWith('.uk')) country = { country: 'United Kingdom', countryCode: 'GB', countryFlag: '🇬🇧' };
  else if (rawDomain.endsWith('.ca')) country = { country: 'Canada', countryCode: 'CA', countryFlag: '🇨🇦' };
  else if (rawDomain.endsWith('.sg')) country = { country: 'Singapore', countryCode: 'SG', countryFlag: '🇸🇬' };
  else if (rawDomain.endsWith('.us')) country = { country: 'United States', countryCode: 'US', countryFlag: '🇺🇸' };
  else if (rawDomain.endsWith('.jp')) country = { country: 'Japan', countryCode: 'JP', countryFlag: '🇯🇵' };

  // Generate 1 to 3 records per crawled target
  const recordCount = (hash % 3) + 1;
  const records: ScrapedDataRecord[] = [];

  for (let i = 0; i < recordCount; i++) {
    const subPrefix = COMMON_PREFIXES[(hash + i * 3) % COMMON_PREFIXES.length];
    const role = COMMON_ROLES[(hash + i * 2) % COMMON_ROLES.length];

    const subdomain = target.type === 'subdomain' && i === 0
      ? rawDomain
      : `${subPrefix}.${rootDomain}`;

    const email = `${role}@${rootDomain}`;

    records.push({
      id: `scrape_${target.id}_${i}_${Date.now()}`,
      targetId: target.id,
      domain: rootDomain,
      subdomain,
      email,
      country: country.country,
      countryCode: country.countryCode,
      countryFlag: country.countryFlag,
      status: i % 2 === 0 ? 'RESOLVED' : 'ACTIVE',
      discoveredAt: new Date().toISOString(),
    });
  }

  return records;
}

