import { ScrapedDataRecord } from '../types/crawler.types';

export function exportCrawlerResultsToCSV(records: ScrapedDataRecord[], filenamePrefix = 'scraped_intelligence'): void {
  if (!records || records.length === 0) {
    alert('No scraped records available to export.');
    return;
  }

  const headers = [
    'Domain',
    'Discovered Subdomains',
    'Subdomain Count',
    'Extracted Emails',
    'Email Count',
    'Country',
    'Country Code',
    'Pages Crawled Count',
    'Crawled Page URLs',
    'Status',
    'Discovered At',
  ];

  const rows = records.map((r) => {
    const subsStr = r.subdomains && r.subdomains.length > 0 ? r.subdomains.join('; ') : (r.subdomain || '');
    const emailsStr = r.emails && r.emails.length > 0 ? r.emails.join('; ') : (r.email || '');
    const subCount = r.subdomainCount ?? (r.subdomains ? r.subdomains.length : (r.subdomain ? 1 : 0));
    const emCount = r.emailCount ?? (r.emails ? r.emails.length : (r.email ? 1 : 0));
    const pagesList = Array.isArray(r.crawledPages) && r.crawledPages.length > 0
      ? r.crawledPages.map((p) => p.url).join('; ')
      : (r.pagesCrawled ? `${r.pagesCrawled} pages` : '');
    const pagesCount = Array.isArray(r.crawledPages) && r.crawledPages.length > 0
      ? r.crawledPages.length
      : (r.pagesCrawled || 0);

    return [
      `"${(r.domain || '').replace(/"/g, '""')}"`,
      `"${subsStr.replace(/"/g, '""')}"`,
      `"${subCount}"`,
      `"${emailsStr.replace(/"/g, '""')}"`,
      `"${emCount}"`,
      `"${(r.country || '').replace(/"/g, '""')}"`,
      `"${(r.countryCode || '').replace(/"/g, '""')}"`,
      `"${pagesCount}"`,
      `"${pagesList.replace(/"/g, '""')}"`,
      `"${(r.status || '').replace(/"/g, '""')}"`,
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
