/**
 * The Scrapper - Dorking Engine Type Definitions
 */

export type DorkPatternType =
  | 'site'
  | 'wildcard'
  | 'without_www'
  | 'inurl'
  | 'filetype'
  | 'custom';

export type DnsResolutionStatus = 'RESOLVED' | 'UNRESOLVED' | 'CNAME_ONLY';

export type DorkingJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED';

export interface DorkQuery {
  id: string;
  query: string;
  patternType: DorkPatternType;
  targetDomain: string;
  provider: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  resultsCount: number;
  error?: string;
  executedAt?: string;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet?: string;
  provider: string;
  query: string;
  discoveredAt: string;
}

export interface ParsedHostname {
  rawUrl: string;
  rawHostname: string;
  normalizedHostname: string;
  rootDomain: string;
  isSubdomain: boolean;
  subdomainLevel: number;
  isWithinTargetScope: boolean;
  provider: string;
  query: string;
}

export interface DnsValidationResult {
  hostname: string;
  status: DnsResolutionStatus;
  aRecords: string[];
  aaaaRecords: string[];
  cnameRecords: string[];
  validatedAt: string;
  error?: string;
}

export interface DorkingRecord {
  id: string;
  hostname: string;
  rootDomain: string;
  subdomain: string;
  subdomainLevel: number;
  dnsStatus: DnsResolutionStatus;
  ipAddresses: string[];
  cnames: string[];
  sourceUrl: string;
  searchProvider: string;
  discoveredByQuery: string;
  firstSeen: string;
  lastSeen: string;
}

export interface ProviderStats {
  queriesCount: number;
  resultsCount: number;
  errorsCount: number;
}

export interface DorkingJob {
  id: string;
  domain: string;
  status: DorkingJobStatus;
  queries: DorkQuery[];
  providersUsed: string[];
  totalQueries: number;
  completedQueries: number;
  failedQueries: number;
  totalResultsCollected: number;
  uniqueDomainsDiscovered: number;
  uniqueSubdomainsDiscovered: number;
  dnsResolvedCount: number;
  unresolvedCount: number;
  duplicatesIgnored: number;
  providerStats: Record<string, ProviderStats>;
  startedAt?: string;
  completedAt?: string;
  logs: string[];
  error?: string;
}

export interface DorkingOverviewStats {
  totalJobs: number;
  totalQueriesGenerated: number;
  totalResultsCollected: number;
  uniqueDomainsDiscovered: number;
  uniqueSubdomainsDiscovered: number;
  dnsResolvedCount: number;
  unresolvedCount: number;
  duplicatesIgnored: number;
  failedQueriesCount: number;
  providerStats: Record<string, ProviderStats>;
}

