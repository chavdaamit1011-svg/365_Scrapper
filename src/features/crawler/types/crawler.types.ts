export type CrawlerExecutionState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';

export type CrawlRecordStatus =
  | 'RESOLVED'
  | 'ACTIVE'
  | 'PENDING'
  | 'ERROR'
  | 'OFFLINE'
  | 'UNREACHABLE'
  | 'DISCOVERING'
  | 'TIMED_OUT'
  | 'DNS_ERROR'
  | 'CONNECTION_REFUSED'
  | 'SSL_ERROR'
  | string;

export interface VerifiedEmailDetail {
  email: string;
  sourceUrl?: string;
  discoveryMethod?: string;
  mxVerified?: boolean;
  mxRecords?: string[];
  priorityScore?: number;
  isPrimary?: boolean;
}

export interface CrawledPageDetail {
  url: string;
  title?: string;
  statusCode?: number;
  errorCode?: string;
  depth?: number;
  timestamp?: string;
}

export interface ReconciliationStats {
  domain: string;
  domain_action: 'NEW' | 'CHANGED' | 'SAME';
  new_subdomains: number;
  existing_subdomains: number;
  missing_subdomains: number;
  new_emails: number;
  existing_emails: number;
  missing_emails: number;
  audit_changes_recorded: number;
}

export interface SubdomainItemDetail {
  subdomain: string;
  status: 'NEW' | 'ACTIVE' | 'REMOVED';
  firstSeen?: string;
  lastSeen?: string;
}

export interface ScrapedDataRecord {
  id: string;
  targetId?: string;
  domain: string;
  rootDomain?: string;
  subdomain: string;
  subdomains?: string[];
  subdomainDetails?: SubdomainItemDetail[];
  subdomainCount?: number;
  email: string;
  emails?: string[];
  verifiedEmails?: VerifiedEmailDetail[];
  emailCount?: number;
  crawledPages?: CrawledPageDetail[];
  sourceUrl?: string;
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
  errorCode?: string;
  errorTitle?: string;
  reconciliation?: ReconciliationStats;
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
  cycleCount?: number;
  isContinuous?: boolean;
}

