export type TargetType = 'root_domain' | 'subdomain' | 'ip_address' | 'tld_zone';

export type TargetSource = 'manual' | 'file_csv' | 'file_excel' | 'file_txt';

export interface TargetItem {
  id: string;
  domain: string;
  type: TargetType;
  source: TargetSource;
  fileName?: string;
  addedAt: string;
  status?: 'pending' | 'crawling' | 'completed' | 'failed' | 'cancelled' | 'paused';
  discoveredDomainsCount?: number;
  tldZone?: string;
}

export interface ParseResult {
  targets: TargetItem[];
  duplicatesCount: number;
  invalidCount: number;
  totalParsed: number;
  sourceFileName: string;
}

