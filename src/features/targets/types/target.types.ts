export type TargetType = 'root_domain' | 'subdomain' | 'ip_address';

export type TargetSource = 'manual' | 'file_csv' | 'file_excel' | 'file_txt';

export interface TargetItem {
  id: string;
  domain: string;
  type: TargetType;
  source: TargetSource;
  fileName?: string;
  addedAt: string;
}

export interface ParseResult {
  targets: TargetItem[];
  duplicatesCount: number;
  invalidCount: number;
  totalParsed: number;
  sourceFileName: string;
}

