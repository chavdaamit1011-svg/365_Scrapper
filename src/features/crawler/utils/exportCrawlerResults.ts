import { ScrapedDataRecord } from '../types/crawler.types';

/**
 * Extracts clean domain records for CSV export.
 * If a TLD Zone (.com, .in) is passed, its discovered child domains are exported cleanly.
 * No extra summary tags, meta badges, or artificial prefixes are injected into the domain names.
 */
export function getCleanExportRecords(records: ScrapedDataRecord[]): ScrapedDataRecord[] {
  const result: ScrapedDataRecord[] = [];
  const seenDomains = new Set<string>();

  for (const r of records) {
    if (r.isTldZone && Array.isArray(r.childDomains) && r.childDomains.length > 0) {
      for (const child of r.childDomains) {
        const d = (child.domain || '').toLowerCase().trim();
        if (d && !seenDomains.has(d)) {
          seenDomains.add(d);
          result.push(child);
        }
      }
    } else {
      const d = (r.domain || '').toLowerCase().trim();
      if (d && !seenDomains.has(d)) {
        seenDomains.add(d);
        result.push(r);
      }
    }
  }

  return result;
}

/**
 * Clean & Standard CSV Exporter.
 * Formats every domain with its subdomains, emails, phones, and crawl details cleanly.
 */
export function exportCrawlerResultsToCSV(records: ScrapedDataRecord[], filenamePrefix = 'scraped_data'): void {
  if (!records || records.length === 0) {
    alert('No scraped records available to export.');
    return;
  }

  const exportList = getCleanExportRecords(records);

  const headers = [
    'Domain',
    'Discovered Subdomains',
    'Subdomain Count',
    'Verified Emails',
    'Email Count',
    'Verified Phones',
    'Phone Count',
    'Category',
    'Country',
    'Country Code',
    'Pages Crawled',
    'Status',
    'Discovered At',
  ];

  const rows = exportList.map((r) => {
    const subsStr = Array.isArray(r.subdomains) && r.subdomains.length > 0
      ? r.subdomains.join('; ')
      : (r.subdomain || '');
    const emailsStr = Array.isArray(r.emails) && r.emails.length > 0
      ? r.emails.join('; ')
      : (r.email || '');
    const subCount = r.subdomainCount ?? (r.subdomains ? r.subdomains.length : (r.subdomain ? 1 : 0));
    const emCount = r.emailCount ?? (r.emails ? r.emails.length : (r.email ? 1 : 0));
    const phonesStr = Array.isArray(r.phones) && r.phones.length > 0
      ? r.phones.join('; ')
      : '';
    const phCount = Array.isArray(r.phones) ? r.phones.length : 0;
    const pagesCount = Array.isArray(r.crawledPages) && r.crawledPages.length > 0
      ? r.crawledPages.length
      : (r.pagesCrawled || 0);

    return [
      `"${(r.domain || '').replace(/"/g, '""')}"`,
      `"${subsStr.replace(/"/g, '""')}"`,
      `"${subCount}"`,
      `"${emailsStr.replace(/"/g, '""')}"`,
      `"${emCount}"`,
      `"${phonesStr.replace(/"/g, '""')}"`,
      `"${phCount}"`,
      `"${(r.category || 'Corporate & Business').replace(/"/g, '""')}"`,
      `"${(r.country || '').replace(/"/g, '""')}"`,
      `"${(r.countryCode || '').replace(/"/g, '""')}"`,
      `"${pagesCount}"`,
      `"${(r.status || 'RESOLVED').replace(/"/g, '""')}"`,
      `"${(r.discoveredAt || '').replace(/"/g, '""')}"`,
    ];
  });

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports a single targeted domain or specific TLD scraping (.com, .in, example.com) cleanly.
 */
export function exportSingleTargetToCSV(record: ScrapedDataRecord): void {
  if (!record) return;

  if (record.isTldZone) {
    const cleanTld = record.domain.replace(/^\./, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const recordsToExport = record.childDomains && record.childDomains.length > 0 ? record.childDomains : [record];
    exportCrawlerResultsToCSV(recordsToExport, `${cleanTld}_scraped_data`);
  } else {
    const cleanDomain = record.domain.replace(/[^a-zA-Z0-9_-]/g, '_');
    exportCrawlerResultsToCSV([record], `${cleanDomain}_scraped_data`);
  }
}
