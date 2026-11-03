export type CrawlerExecutionState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';

export type CrawlRecordStatus = 'RESOLVED' | 'ACTIVE' | 'PENDING' | 'ERROR';

export interface ScrapedDataRecord {
  id: string;
  targetId?: string;
  domain: string;
  rootDomain?: string;
  subdomain: string;
  subdomains?: string[];
  subdomainCount?: number;
  email: string;
  emails?: string[];
  emailCount?: number;
  category?: string;
  categoryIcon?: string;
  isEcommerce?: boolean;
  ecommerceSignals?: string[];
  technologies?: string[];
  phones?: string[];
  summary?: string;
  country: string;
  countryCode: string;
  countryFlag: string;
  status: CrawlRecordStatus;
  pagesCrawled?: number;
  discoveredAt: string;
}

export interface CrawlerStats {
  totalTargets: number;
  processedTargets: number;
  subdomainsFound: number;
  emailsFound: number;
  countriesFound: number;
  progressPercent: number;
  startedAt: string | null;
  elapsedSeconds: number;
  currentTargetName: string | null;
  activeTargetPhase?: string;
  activeTargetSubdomains?: number | null;
  activeTargetEmails?: number | null;
  databaseTotalDomains?: number;
  databaseTotalSubdomains?: number;
  databaseTotalEmails?: number;
  databaseTotalCountries?: number;
}

