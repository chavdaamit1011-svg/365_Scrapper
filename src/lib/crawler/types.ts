/**
 * The Scrapper - Native TypeScript Crawler Engine Types
 */

export interface CrawledPageDetail {
  url: string;
  title?: string;
  statusCode: number;
  depth: number;
  errorCode?: string;
  timestamp: string;
}

export interface VerifiedEmailDetail {
  email: string;
  status: 'ACTIVE' | 'BOUNCED' | 'INVALID' | 'DISPOSABLE';
  mxVerified: boolean;
  priorityScore: number;
  sourceUrl?: string;
  section?: string;
  isPrimary?: boolean;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  delayMs?: number;
  timeoutMs?: number;
  respectRobotsTxt?: boolean;
  onProgress?: (pagesCrawled: number, subdomainsCount: number, emailsCount: number) => void;
}

export interface SiteIntelligence {
  title: string;
  metaDescription: string;
  category: string;
  categoryIcon: string;
  summary: string;
  technologies: string[];
  isEcommerce: boolean;
  ecommerceSignals: string[];
  phones: string[];
}

export interface ReconciliationStats {
  domain_action: 'NEW' | 'EXISTING_UPDATED';
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

export interface ScrapedDomainRecord {
  id: string;
  domain: string;
  rootDomain: string;
  subdomain: string;
  subdomains: string[];
  subdomainDetails?: SubdomainItemDetail[];
  subdomainCount: number;
  email: string;
  emails: string[];
  verifiedEmails: VerifiedEmailDetail[];
  emailCount: number;
  category: string;
  categoryIcon: string;
  isEcommerce: boolean;
  ecommerceSignals: string[];
  technologies: string[];
  phones: string[];
  summary: string;
  country: string;
  countryCode: string;
  countryFlag: string;
  status: string;
  errorCode?: string | null;
  errorTitle?: string | null;
  sourceUrl: string;
  pagesCrawled: number;
  crawledPages: CrawledPageDetail[];
  reconciliation?: ReconciliationStats;
  discoveredAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  contentType: string;
  error?: string;
  errorCode?: string;
  errorTitle?: string;
}

