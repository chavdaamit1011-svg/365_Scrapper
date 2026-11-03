'use client';

import React, { useState, useMemo } from 'react';
import {
  Download,
  Search,
  Globe,
  Mail,
  Copy,
  Check,
  Filter,
  Layers,
  ChevronDown,
  ChevronUp,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Network,
  Phone,
  ShoppingBag,
  Cpu,
  Tag,
  Sparkles,
  FileText,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ScrapedDataRecord, CrawledPageDetail } from '../types/crawler.types';
import { exportCrawlerResultsToCSV } from '../utils/exportCrawlerResults';

interface ScrapedResultsTableProps {
  records: ScrapedDataRecord[];
  isCrawling: boolean;
  onClearResults?: () => void;
}

const EXCLUDED_EMAIL_PREFIXES = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'hostmaster', 'webmaster', 'daemon', 'root', 'bounce',
  'privacy', 'legal', 'dpo', 'gdpr', 'compliance', 'disclaimer', 'terms',
  'abuse', 'security', 'notification', 'notifications', 'alert', 'alerts',
  'you', 'yourname', 'username', 'test', 'demo', 'sample', 'example',
  'admin@admin', 'ncr.command', 'command',
]);

const PRIMARY_PREFIX_WEIGHTS: Record<string, number> = {
  contact: 100,
  info: 95,
  support: 90,
  hello: 85,
  sales: 80,
  enquiry: 80,
  enquiries: 80,
  office: 75,
  admin: 70,
  help: 70,
  customercare: 70,
  care: 65,
  connect: 65,
  mail: 60,
  team: 50,
};

function getEmailScore(email: string, targetDomain: string): number {
  if (!email || !email.includes('@')) return -999;
  const lower = email.toLowerCase().trim();
  const [user, domain] = lower.split('@');
  const cleanUser = user.split('+')[0];
  const tokens = cleanUser.split(/[._-]/);

  // Check if excluded
  if (EXCLUDED_EMAIL_PREFIXES.has(cleanUser) || tokens.some((t) => EXCLUDED_EMAIL_PREFIXES.has(t))) {
    return -999;
  }

  let score = 20;
  if (PRIMARY_PREFIX_WEIGHTS[cleanUser]) {
    score += PRIMARY_PREFIX_WEIGHTS[cleanUser];
  } else if (tokens[0] && PRIMARY_PREFIX_WEIGHTS[tokens[0]]) {
    score += PRIMARY_PREFIX_WEIGHTS[tokens[0]] - 5;
  }

  // Exact target domain match
  const cleanTarget = targetDomain.toLowerCase().trim().replace(/^www\./, '');
  if (domain === cleanTarget || domain === `www.${cleanTarget}`) {
    score += 40;
  }

  return score;
}

function rankAndFilterEmails(emails: string[], targetDomain: string): string[] {
  const cleanList = Array.from(new Set(emails.map((e) => e.toLowerCase().trim()))).filter((e) => {
    return getEmailScore(e, targetDomain) > 0;
  });

  return cleanList.sort((a, b) => {
    const scoreA = getEmailScore(a, targetDomain);
    const scoreB = getEmailScore(b, targetDomain);
    return scoreB - scoreA;
  });
}

export const ScrapedResultsTable: React.FC<ScrapedResultsTableProps> = ({
  records,
  isCrawling,
  onClearResults,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedDomainId, setExpandedDomainId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // Group and normalize records by root domain so every domain is an organized master entity
  const domainGroups = useMemo(() => {
    const map = new Map<string, ScrapedDataRecord>();

    for (const r of records) {
      const domainKey = (r.domain || r.rootDomain || r.subdomain || 'unknown').toLowerCase().trim();
      const existing = map.get(domainKey);

      // Collect all valid subdomains (excluding the root domain itself)
      const subList: string[] = [];
      if (Array.isArray(r.subdomains) && r.subdomains.length > 0) {
        subList.push(...r.subdomains.filter((s) => s && s.toLowerCase() !== domainKey));
      } else if (r.subdomain && r.subdomain.toLowerCase() !== domainKey) {
        subList.push(r.subdomain);
      }

      // Collect and rank all emails with corporate priority
      const rawEmailList: string[] = [];
      if (Array.isArray(r.emails) && r.emails.length > 0) {
        rawEmailList.push(...r.emails);
      } else if (r.email) {
        rawEmailList.push(r.email);
      }
      const rankedEmails = rankAndFilterEmails(rawEmailList, domainKey);

      // Check if this record represents an offline, timed out, or inaccessible target
      const isRecordOffline =
        r.status === 'OFFLINE' ||
        r.status === 'UNREACHABLE' ||
        (r.pagesCrawled === 0 && (!r.emails || r.emails.length === 0)) ||
        (Array.isArray(r.crawledPages) && r.crawledPages.some((p) => (p.statusCode && p.statusCode >= 500) || p.title?.includes('Unreachable')));

      // Collect crawled pages
      const rawPageList: CrawledPageDetail[] = [];
      if (Array.isArray(r.crawledPages) && r.crawledPages.length > 0) {
        rawPageList.push(...r.crawledPages);
      } else if (r.sourceUrl && !isRecordOffline) {
        rawPageList.push({
          url: r.sourceUrl,
          title: 'Root Scope Page',
          statusCode: 200,
          depth: 0,
          timestamp: r.discoveredAt,
        });
      }

      if (!existing) {
        map.set(domainKey, {
          ...r,
          id: r.id || `dom_${domainKey}`,
          domain: domainKey,
          status: isRecordOffline ? 'OFFLINE' : (r.status || 'RESOLVED'),
          category: isRecordOffline ? 'Site Inaccessible / Offline' : (r.category || 'Corporate & Business Services'),
          categoryIcon: isRecordOffline ? '⚠️' : (r.categoryIcon || '🌐'),
          summary: isRecordOffline
            ? (r.summary || 'Website server took too long to respond (ERR_CONNECTION_TIMED_OUT). No live HTML pages could be reached.')
            : (r.summary || ''),
          subdomains: Array.from(new Set(subList)),
          subdomainCount: subList.length,
          email: rankedEmails[0] || '',
          emails: rankedEmails,
          emailCount: rankedEmails.length,
          crawledPages: rawPageList,
          pagesCrawled: isRecordOffline ? 0 : Math.max(r.pagesCrawled || 1, rawPageList.length || 1),
        });
      } else {
        // Merge subdomains, emails, and crawled pages
        const mergedSubs = Array.from(new Set([...(existing.subdomains || []), ...subList]));
        const mergedEmails = rankAndFilterEmails([...(existing.emails || []), ...rawEmailList], domainKey);

        if (isRecordOffline) {
          existing.status = 'OFFLINE';
          existing.category = 'Site Inaccessible / Offline';
          existing.categoryIcon = '⚠️';
          if (r.summary) existing.summary = r.summary;
          existing.pagesCrawled = 0;
        }

        if (rawPageList.length > 0) {
          const seenUrls = new Set((existing.crawledPages || []).map((p) => p.url));
          const mergedPages = [...(existing.crawledPages || [])];
          for (const p of rawPageList) {
            if (!seenUrls.has(p.url)) {
              mergedPages.push(p);
              seenUrls.add(p.url);
            }
          }
          existing.crawledPages = mergedPages;
          if (!isRecordOffline) {
            existing.pagesCrawled = Math.max(existing.pagesCrawled || 1, mergedPages.length);
          }
        }

        existing.subdomains = mergedSubs;
        existing.subdomainCount = mergedSubs.length;
        existing.emails = mergedEmails;
        existing.emailCount = mergedEmails.length;
        existing.email = mergedEmails[0] || existing.email;
        existing.pagesCrawled = Math.max(existing.pagesCrawled || 1, r.pagesCrawled || 1);
        if (r.category && r.category !== 'Corporate & Business Services') {
          existing.category = r.category;
          existing.categoryIcon = r.categoryIcon;
        }
        if (r.isEcommerce) {
          existing.isEcommerce = true;
        }
        if (Array.isArray(r.ecommerceSignals) && r.ecommerceSignals.length > 0) {
          existing.ecommerceSignals = Array.from(new Set([...(existing.ecommerceSignals || []), ...r.ecommerceSignals]));
        }
        if (Array.isArray(r.technologies) && r.technologies.length > 0) {
          existing.technologies = Array.from(new Set([...(existing.technologies || []), ...r.technologies]));
        }
        if (Array.isArray(r.phones) && r.phones.length > 0) {
          existing.phones = Array.from(new Set([...(existing.phones || []), ...r.phones]));
        }
        if (r.summary && !existing.summary) {
          existing.summary = r.summary;
        }
        if (r.country && r.country !== 'Detected') {
          existing.country = r.country;
          existing.countryCode = r.countryCode;
          existing.countryFlag = r.countryFlag;
        }
      }
    }

    return Array.from(map.values());
  }, [records]);

  // Distinct countries for filter dropdown
  const uniqueCountries = useMemo(() => {
    const set = new Set(domainGroups.map((r) => r.country).filter(Boolean));
    return Array.from(set).sort();
  }, [domainGroups]);

  // Filtered dataset
  const filteredGroups = useMemo(() => {
    return domainGroups.filter((r) => {
      const q = searchTerm.toLowerCase().trim();
      const subs = (r.subdomains || []).join(' ').toLowerCase();
      const ems = (r.emails || []).join(' ').toLowerCase();

      const matchesSearch =
        !q ||
        r.domain.toLowerCase().includes(q) ||
        subs.includes(q) ||
        ems.includes(q) ||
        r.country.toLowerCase().includes(q) ||
        r.countryCode.toLowerCase().includes(q);

      const matchesCountry = countryFilter === 'ALL' || r.country === countryFilter;

      return matchesSearch && matchesCountry;
    });
  }, [domainGroups, searchTerm, countryFilter]);

  const toggleExpand = (domainId: string) => {
    setExpandedDomainId((prev) => (prev === domainId ? null : domainId));
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 1500);
  };

  const handleExport = () => {
    exportCrawlerResultsToCSV(filteredGroups, 'domain_intelligence_export');
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all scraped database records?')) {
      return;
    }
    try {
      setIsClearing(true);
      setExpandedDomainId(null);
      const res = await fetch('/api/crawler/results', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        if (onClearResults) {
          onClearResults();
        } else {
          window.location.reload();
        }
      } else {
        alert(data.message || 'Could not clear database records.');
      }
    } catch (err) {
      alert('Network error while clearing database.');
    } finally {
      setIsClearing(false);
    }
  };

  const totalSubdomainsFound = useMemo(() => {
    return domainGroups.reduce((acc, curr) => acc + (curr.subdomains?.length || 0), 0);
  }, [domainGroups]);

  const totalEmailsFound = useMemo(() => {
    return domainGroups.reduce((acc, curr) => acc + (curr.emails?.length || 0), 0);
  }, [domainGroups]);

  return (
    <Card style={{ padding: '24px' }}>
      {/* Header and Controls Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.3px', margin: 0 }}>
              Structured Domain Intelligence
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '9999px',
                background: '#e0f2fe',
                color: '#0369a1',
              }}
            >
              {domainGroups.length} Domain{domainGroups.length === 1 ? '' : 's'} Organized
            </span>
            {totalSubdomainsFound > 0 && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  background: '#f0fdf4',
                  color: '#15803d',
                }}
              >
                {totalSubdomainsFound} Subdomains
              </span>
            )}
            {totalEmailsFound > 0 && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  background: '#fef3c7',
                  color: '#b45309',
                }}
              >
                {totalEmailsFound} Verified Emails
              </span>
            )}
            {isCrawling && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className="pulse-dot" /> Live Ingesting
              </span>
            )}
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
            Hierarchical breakdown of target domains, verified subdomains, and legitimate emails.
          </p>
        </div>

        {/* Action Controls: Search, Filter, Export, Clear */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Real-time search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Filter domain, subdomain, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '7px 12px 7px 30px',
                fontSize: '12.5px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                background: '#ffffff',
                outline: 'none',
                width: '230px',
              }}
            />
          </div>

          {/* Country Filter dropdown */}
          {uniqueCountries.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Filter size={13} color="var(--text-muted)" />
              <select
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                style={{
                  padding: '7px 10px',
                  fontSize: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: '#ffffff',
                  color: 'var(--text-main)',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="ALL">All Countries ({domainGroups.length})</option>
                {uniqueCountries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Export CSV button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            disabled={filteredGroups.length === 0}
            leftIcon={<Download size={13} />}
          >
            Export CSV ({filteredGroups.length})
          </Button>

          {/* Clear All Results button */}
          {domainGroups.length > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleClearAll}
              disabled={isClearing}
              leftIcon={<Trash2 size={13} />}
            >
              {isClearing ? 'Clearing...' : 'Clear Database'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Table */}
      {filteredGroups.length === 0 ? (
        <div
          style={{
            padding: '50px 20px',
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: '10px',
            border: '1px dashed #cbd5e1',
          }}
        >
          <Layers size={36} color="#94a3b8" style={{ margin: '0 auto 12px' }} />
          <h4 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 6px' }}>
            {domainGroups.length === 0 ? 'No Scraped Intelligence in Database' : 'No Matching Domains Found'}
          </h4>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 auto', maxWidth: '440px' }}>
            {domainGroups.length === 0
              ? 'Add domain targets above and click "Add & Crawl Now" to automatically discover its subdomains, verified emails, and geo intelligence.'
              : 'Try adjusting your search keyword or country filter to view matching domain records.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Target Domain
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Discovered Subdomains
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Verified Emails
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Country / Geo
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Status
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((r, idx) => {
                const isExpanded = expandedDomainId === r.id;
                const subdomains = r.subdomains || [];
                const emails = r.emails || [];
                const crawledPages = r.crawledPages || [];
                const isOffline =
                  r.status === 'OFFLINE' ||
                  r.status === 'UNREACHABLE' ||
                  r.pagesCrawled === 0 ||
                  (Array.isArray(crawledPages) && crawledPages.some((p) => (p.statusCode && p.statusCode >= 500) || p.title?.includes('Unreachable')));

                return (
                  <React.Fragment key={r.id || idx}>
                    <tr
                      style={{
                        borderBottom: isExpanded ? 'none' : idx < filteredGroups.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: isExpanded ? (isOffline ? '#fff8f8' : '#f8fafc') : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = isOffline ? '#fff5f5' : '#fcfdfe';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {/* Column 1: Target Domain & Content Intelligence */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <Globe size={16} color={isOffline ? '#dc2626' : '#0284c7'} style={{ flexShrink: 0, marginTop: '2px' }} />
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '13.5px' }}>
                                {r.domain}
                              </span>
                              {isOffline ? (
                                <span
                                  style={{
                                    fontSize: '10.5px',
                                    fontWeight: 700,
                                    color: '#b91c1c',
                                    background: '#fee2e2',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid #fecaca',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title="Website is offline or server timed out"
                                >
                                  ⚠️ Offline / Band He
                                </span>
                              ) : r.isEcommerce ? (
                                <span
                                  style={{
                                    fontSize: '10.5px',
                                    fontWeight: 700,
                                    color: '#065f46',
                                    background: '#d1fae5',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid #a7f3d0',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title="E-Commerce & Online Store Detected"
                                >
                                  🛒 E-Commerce
                                </span>
                              ) : null}
                            </div>
                            {isOffline ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginTop: '3px' }}>
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                  ⚠️ Site Inaccessible (Server Timed Out)
                                </span>
                                <span>•</span>
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(r.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    color: '#b91c1c',
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    fontSize: '11px',
                                  }}
                                  title="Click to view offline error diagnostics"
                                >
                                  0 pages crawled
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                                <span style={{ color: '#0369a1', fontWeight: 600 }}>
                                  {r.categoryIcon || '🌐'} {r.category || 'Corporate'}
                                </span>
                                <span>•</span>
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(r.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    color: isExpanded ? '#0284c7' : 'var(--text-muted)',
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    textUnderlineOffset: '2px',
                                    fontSize: '11px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                  title="Click to view all crawled pages"
                                >
                                  <FileText size={11} color={isExpanded ? '#0284c7' : '#64748b'} />
                                  <span>{crawledPages.length > 0 ? `${crawledPages.length} pages` : (r.pagesCrawled ? `${r.pagesCrawled} pages` : '1 page')}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Subdomains Preview / Count */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        {subdomains.length === 0 ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                        ) : (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  background: '#e0f2fe',
                                  color: '#0369a1',
                                  border: '1px solid #bae6fd',
                                }}
                              >
                                {subdomains.length} Subdomains
                              </span>
                              {subdomains.slice(0, 2).map((sub) => {
                                const targetUrl = sub.startsWith('http://') || sub.startsWith('https://') ? sub : `https://${sub}`;
                                return (
                                  <a
                                    key={sub}
                                    href={targetUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Open ${targetUrl} in new tab`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '11.5px',
                                      fontWeight: 500,
                                      padding: '2px 7px',
                                      borderRadius: '5px',
                                      background: '#f1f5f9',
                                      color: '#0369a1',
                                      border: '1px solid #e2e8f0',
                                      textDecoration: 'none',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = '#e0f2fe';
                                      e.currentTarget.style.borderColor = '#bae6fd';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = '#f1f5f9';
                                      e.currentTarget.style.borderColor = '#e2e8f0';
                                    }}
                                  >
                                    <span>{sub}</span>
                                    <ExternalLink size={10} style={{ flexShrink: 0 }} />
                                  </a>
                                );
                              })}
                              {subdomains.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(r.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#0284c7',
                                    fontSize: '11.5px',
                                    fontWeight: 600,
                                    padding: '2px 4px',
                                  }}
                                >
                                  +{subdomains.length - 2} more
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Column 3: Verified Emails */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        {emails.length === 0 ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
                            None detected
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {emails.slice(0, 2).map((email, idx) => {
                              const isPrimary = idx === 0;
                              return (
                                <div key={email} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Mail size={13} color="#0284c7" style={{ flexShrink: 0 }} />
                                  <span style={{ color: 'var(--text-main)', fontWeight: isPrimary ? 600 : 500, fontSize: '12.5px' }}>
                                    {email}
                                  </span>
                                  {isPrimary && (
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        color: '#059669',
                                        background: '#ecfdf5',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        border: '1px solid #a7f3d0',
                                      }}
                                    >
                                      Primary
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(email, `${r.id}_${email}`)}
                                    title="Copy email"
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: '2px',
                                      color: copiedId === `${r.id}_${email}` ? '#10b981' : '#94a3b8',
                                    }}
                                  >
                                    {copiedId === `${r.id}_${email}` ? <Check size={12} /> : <Copy size={12} />}
                                  </button>
                                </div>
                              );
                            })}
                            {emails.length > 2 && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(r.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: '#0284c7',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  textAlign: 'left',
                                  padding: 0,
                                }}
                              >
                                +{emails.length - 2} more emails
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Column 4: Country / Geo */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <span style={{ fontSize: '16px' }}>{r.countryFlag || '🌐'}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '12.5px' }}>
                            {r.country}
                          </span>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#f1f5f9',
                              color: '#64748b',
                            }}
                          >
                            {r.countryCode}
                          </span>
                        </div>
                      </td>

                      {/* Column 5: Status */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <Badge
                          variant={
                            isOffline || r.status === 'OFFLINE' || r.status === 'UNREACHABLE'
                              ? 'danger'
                              : r.status === 'RESOLVED'
                              ? 'success'
                              : 'primary'
                          }
                        >
                          {isOffline || r.status === 'OFFLINE' ? 'OFFLINE' : r.status}
                        </Badge>
                      </td>

                      {/* Column 6: Toggle Details */}
                      <td style={{ padding: '14px 16px', textAlign: 'right', verticalAlign: 'top' }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(r.id)}
                          rightIcon={
                            <ChevronDown
                              size={13}
                              style={{
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
                              }}
                            />
                          }
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </Button>
                      </td>
                    </tr>

                    {/* Expandable Details Row with Smooth Accordion Animation */}
                    <tr
                      style={{
                        background: isExpanded ? '#f8fafc' : 'transparent',
                        borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none',
                        transition: 'background 0.25s ease',
                      }}
                    >
                      <td
                        colSpan={6}
                        style={{
                          padding: 0,
                          border: 'none',
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateRows: isExpanded ? '1fr' : '0fr',
                            transition: 'grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
                          }}
                        >
                          <div
                            style={{
                              overflow: 'hidden',
                              minHeight: 0,
                              visibility: isExpanded ? 'visible' : 'hidden',
                              transition: isExpanded
                                ? 'visibility 0s linear 0s'
                                : 'visibility 0s linear 0.32s',
                            }}
                          >
                            <div
                              style={{
                                padding: '6px 20px 20px 20px',
                                opacity: isExpanded ? 1 : 0,
                                transform: isExpanded ? 'translateY(0)' : 'translateY(-6px)',
                                transition: 'opacity 0.22s ease 0.05s, transform 0.22s ease 0.05s',
                              }}
                            >
                              <div
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '8px',
                                  padding: '16px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '14px',
                                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
                                }}
                              >
                            {/* Website Intelligence & Content Classification OR Offline Alert */}
                            {isOffline ? (
                              <div
                                style={{
                                  background: '#fff1f2',
                                  border: '1px solid #fecdd3',
                                  borderRadius: '8px',
                                  padding: '14px 16px',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '12px',
                                }}
                              >
                                <div
                                  style={{
                                    width: '38px',
                                    height: '38px',
                                    borderRadius: '8px',
                                    background: '#ffe4e6',
                                    color: '#e11d48',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    fontSize: '20px',
                                    fontWeight: 'bold',
                                    border: '1px solid #fecdd3',
                                  }}
                                >
                                  ⚠️
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#9f1239' }}>
                                      Website Band He / Site Can't Be Reached
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        background: '#e11d48',
                                        color: '#ffffff',
                                        letterSpacing: '0.5px',
                                      }}
                                    >
                                      OFFLINE (TIMED OUT)
                                    </span>
                                  </div>
                                  <p style={{ fontSize: '12.5px', color: '#be123c', margin: '0 0 6px 0', lineHeight: 1.45 }}>
                                    {r.summary || 'Target website server respond nahi kar raha (ERR_CONNECTION_TIMED_OUT). Server band ya unreachable hone ki wajah se koi bhi live page content, email ya phone number scrap nahi ho paya.'}
                                  </p>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: '#881337', flexWrap: 'wrap' }}>
                                    <span>• Server Status: <strong>Connection Timed Out / Server Offline</strong></span>
                                    <span>• Target Scope: <code style={{ background: '#ffe4e6', padding: '1px 5px', borderRadius: '3px' }}>{r.domain}</code></span>
                                    <span>• Live Pages Crawled: <strong>0 (Inaccessible)</strong></span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div
                                style={{
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '8px',
                                  padding: '12px 14px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '8px',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '18px' }}>{r.categoryIcon || '🌐'}</span>
                                    <div>
                                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                                        {r.category || 'Corporate & Business Services'}
                                      </span>
                                      {r.isEcommerce && (
                                        <span
                                          style={{
                                            marginLeft: '8px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#065f46',
                                            background: '#d1fae5',
                                            padding: '2px 7px',
                                            borderRadius: '4px',
                                            border: '1px solid #a7f3d0',
                                          }}
                                        >
                                          🛒 E-Commerce Store
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {Array.isArray(r.technologies) && r.technologies.length > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                                      <Cpu size={12} color="#64748b" />
                                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>Tech:</span>
                                      {r.technologies.map((t) => (
                                        <span
                                          key={t}
                                          style={{
                                            fontSize: '10.5px',
                                            fontWeight: 600,
                                            color: '#475569',
                                            background: '#f1f5f9',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            border: '1px solid #e2e8f0',
                                          }}
                                        >
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {r.summary && (
                                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4, fontStyle: 'italic' }}>
                                    "{r.summary}"
                                  </p>
                                )}

                                {Array.isArray(r.ecommerceSignals) && r.ecommerceSignals.length > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingTop: '2px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#047857' }}>Store Signals:</span>
                                    {r.ecommerceSignals.map((sig) => (
                                      <span
                                        key={sig}
                                        style={{
                                          fontSize: '10.5px',
                                          fontWeight: 600,
                                          color: '#065f46',
                                          background: '#ecfdf5',
                                          padding: '1px 6px',
                                          borderRadius: '4px',
                                          border: '1px solid #a7f3d0',
                                        }}
                                      >
                                        ✓ {sig}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {Array.isArray(r.phones) && r.phones.length > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingTop: '2px' }}>
                                    <Phone size={12} color="#0284c7" />
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)' }}>Contact Phone:</span>
                                    {r.phones.map((phone, pIdx) => {
                                      const isPrimaryPhone = pIdx === 0;
                                      return (
                                        <a
                                          key={phone}
                                          href={`tel:${phone.replace(/\s+/g, '')}`}
                                          style={{
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            color: isPrimaryPhone ? '#065f46' : '#0369a1',
                                            textDecoration: 'none',
                                            background: isPrimaryPhone ? '#ecfdf5' : '#e0f2fe',
                                            border: `1px solid ${isPrimaryPhone ? '#a7f3d0' : '#bae6fd'}`,
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                          }}
                                          title={isPrimaryPhone ? 'Primary Contact Phone' : 'Alternate Contact Phone'}
                                        >
                                          <span>{phone}</span>
                                          {isPrimaryPhone && (
                                            <span
                                              style={{
                                                fontSize: '9.5px',
                                                background: '#059669',
                                                color: '#fff',
                                                padding: '1px 5px',
                                                borderRadius: '3px',
                                                fontWeight: 700,
                                              }}
                                            >
                                              Primary
                                            </span>
                                          )}
                                        </a>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Crawled Pages Section */}
                            <div style={{ background: isOffline ? '#fff8f8' : '#f8fafc', border: `1px solid ${isOffline ? '#fecaca' : '#e2e8f0'}`, borderRadius: '8px', padding: '12px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <FileText size={14} color={isOffline ? '#dc2626' : '#0284c7'} />
                                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: isOffline ? '#991b1b' : 'var(--text-main)' }}>
                                    Crawled Pages ({isOffline ? 0 : (crawledPages.length > 0 ? crawledPages.length : (r.pagesCrawled || 1))})
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      background: isOffline ? '#fee2e2' : '#e0f2fe',
                                      color: isOffline ? '#dc2626' : '#0369a1',
                                      border: `1px solid ${isOffline ? '#fecaca' : '#bae6fd'}`,
                                    }}
                                  >
                                    {isOffline ? 'Server Inaccessible' : 'Crawl Scope History'}
                                  </span>
                                </div>
                                <span style={{ fontSize: '11px', color: isOffline ? '#b91c1c' : '#64748b' }}>
                                  {isOffline
                                    ? 'Host server timed out. 0 live pages could be fetched'
                                    : (crawledPages.length > 1
                                      ? 'Direct internal paths, contact routes & navigation pages analyzed'
                                      : 'Target root landing page analyzed')}
                                </span>
                              </div>

                              {crawledPages.length === 0 || isOffline ? (
                                isOffline ? (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '8px 12px', borderRadius: '6px', background: '#ffffff', border: '1px solid #fecdd3', fontSize: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'monospace', padding: '1px 6px', borderRadius: '4px', background: '#dc2626', color: '#ffffff' }}>
                                        ERR_TIMEOUT
                                      </span>
                                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#991b1b', background: '#ffe4e6', padding: '1px 5px', borderRadius: '3px' }}>
                                        depth 0
                                      </span>
                                      <a
                                        href={r.sourceUrl || `https://${r.domain}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#be123c', fontWeight: 600, fontSize: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                      >
                                        <span>{r.sourceUrl || `https://${r.domain}`}</span>
                                        <ExternalLink size={10} />
                                      </a>
                                      <span style={{ fontSize: '11.5px', color: '#9f1239', fontStyle: 'italic' }}>
                                        — Website Band He / Server Timed Out (0 pages accessible)
                                      </span>
                                    </div>
                                    <span style={{ fontSize: '11px', color: '#e11d48', fontWeight: 700 }}>
                                      Host Unreachable
                                    </span>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: '6px', background: '#ffffff', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'monospace', padding: '1px 5px', borderRadius: '3px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                                        200 OK
                                      </span>
                                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>
                                        depth 0
                                      </span>
                                      <a
                                        href={r.sourceUrl || `https://${r.domain}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#0369a1', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                      >
                                        <span>{r.sourceUrl || `https://${r.domain}`}</span>
                                        <ExternalLink size={10} />
                                      </a>
                                    </div>
                                    <span style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
                                      Target Root Scope
                                    </span>
                                  </div>
                                )
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {crawledPages.map((page, pIdx) => {
                                    const pUrl = typeof page === 'string' ? page : page.url;
                                    const pTitle = typeof page === 'object' ? page.title : '';
                                    const pStatus = typeof page === 'object' ? (page.statusCode || 200) : 200;
                                    const pDepth = typeof page === 'object' ? (page.depth ?? 0) : 0;
                                    const isPageFailed = pStatus >= 400 || pTitle?.includes('Unreachable') || isOffline;

                                    let pathDisplay = pUrl;
                                    try {
                                      const u = new URL(pUrl);
                                      pathDisplay = u.pathname + (u.search || '');
                                      if (!pathDisplay) pathDisplay = '/';
                                    } catch {}

                                    return (
                                      <div
                                        key={pUrl + pIdx}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          flexWrap: 'wrap',
                                          gap: '8px',
                                          padding: '7px 12px',
                                          borderRadius: '6px',
                                          background: isPageFailed ? '#fff5f5' : '#ffffff',
                                          border: `1px solid ${isPageFailed ? '#fecaca' : '#e2e8f0'}`,
                                          fontSize: '12px',
                                        }}
                                      >
                                        {/* Left: Status, Depth, Link, Title */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
                                          <span
                                            style={{
                                              fontSize: '10px',
                                              fontWeight: 700,
                                              fontFamily: 'monospace',
                                              padding: '1px 6px',
                                              borderRadius: '4px',
                                              background: isPageFailed ? '#fef2f2' : '#ecfdf5',
                                              color: isPageFailed ? '#b91c1c' : '#047857',
                                              border: `1px solid ${isPageFailed ? '#fecaca' : '#a7f3d0'}`,
                                            }}
                                          >
                                            {pStatus}
                                          </span>
                                          <span
                                            style={{
                                              fontSize: '10px',
                                              fontWeight: 600,
                                              color: isPageFailed ? '#b91c1c' : '#64748b',
                                              background: isPageFailed ? '#fee2e2' : '#f1f5f9',
                                              padding: '1px 5px',
                                              borderRadius: '3px',
                                            }}
                                          >
                                            depth {pDepth}
                                          </span>
                                          <a
                                            href={pUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={`Open ${pUrl} in new tab`}
                                            style={{
                                              color: isPageFailed ? '#b91c1c' : '#0369a1',
                                              fontWeight: 600,
                                              fontSize: '12px',
                                              textDecoration: 'none',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                                          >
                                            <span>{pathDisplay}</span>
                                            <ExternalLink size={10} style={{ flexShrink: 0 }} />
                                          </a>
                                          {pTitle && (
                                            <span
                                              style={{
                                                fontSize: '11px',
                                                color: isPageFailed ? '#dc2626' : '#64748b',
                                                fontStyle: 'italic',
                                                maxWidth: '280px',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                              }}
                                              title={pTitle}
                                            >
                                              — {pTitle}
                                            </span>
                                          )}
                                        </div>

                                        {/* Right: Full Host / Copy URL */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span
                                            style={{
                                              fontSize: '10.5px',
                                              color: isPageFailed ? '#ef4444' : '#94a3b8',
                                              fontFamily: 'monospace',
                                              maxWidth: '240px',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {pUrl.replace(/^https?:\/\//, '')}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => handleCopy(pUrl, `page_${r.id}_${pIdx}`)}
                                            title="Copy page URL"
                                            style={{
                                              background: 'none',
                                              border: 'none',
                                              cursor: 'pointer',
                                              padding: '2px',
                                              color: copiedId === `page_${r.id}_${pIdx}` ? '#10b981' : '#94a3b8',
                                            }}
                                          >
                                            {copiedId === `page_${r.id}_${pIdx}` ? <Check size={12} /> : <Copy size={12} />}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Subdomains section */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                <Network size={14} color="#0284c7" />
                                <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                                  Discovered Subdomains ({subdomains.length})
                                </span>
                              </div>
                              {subdomains.length === 0 ? (
                                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                                  No subdomains discovered for this domain.
                                </p>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                  {subdomains.map((sub) => {
                                    const targetUrl = sub.startsWith('http://') || sub.startsWith('https://') ? sub : `https://${sub}`;
                                    return (
                                      <a
                                        key={sub}
                                        href={targetUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`Open ${targetUrl} in new tab`}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                          padding: '5px 12px',
                                          borderRadius: '6px',
                                          background: '#f8fafc',
                                          border: '1px solid #cbd5e1',
                                          fontSize: '12px',
                                          color: '#0369a1',
                                          fontWeight: 500,
                                          textDecoration: 'none',
                                          cursor: 'pointer',
                                          transition: 'all 0.15s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.background = '#e0f2fe';
                                          e.currentTarget.style.borderColor = '#7dd3fc';
                                          e.currentTarget.style.color = '#0284c7';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = '#f8fafc';
                                          e.currentTarget.style.borderColor = '#cbd5e1';
                                          e.currentTarget.style.color = '#0369a1';
                                        }}
                                      >
                                        <span>{sub}</span>
                                        <ExternalLink size={12} color="#0284c7" style={{ flexShrink: 0 }} />
                                      </a>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Emails section */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                <Mail size={14} color="#0284c7" />
                                <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                                  Verified Extracted Emails ({emails.length})
                                </span>
                              </div>
                              {emails.length === 0 ? (
                                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                                  No public emails found on crawled pages.
                                </p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {emails.map((email, idx) => {
                                    const isPrimary = idx === 0;
                                    const detail = Array.isArray(r.verifiedEmails)
                                      ? r.verifiedEmails.find((v) => v.email?.toLowerCase() === email.toLowerCase())
                                      : undefined;
                                    const sourceUrl = detail?.sourceUrl;
                                    const discoveryMethod = detail?.discoveryMethod;
                                    const mxVerified = detail?.mxVerified;
                                    const mxRecords = detail?.mxRecords;

                                    return (
                                      <div
                                        key={email}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          flexWrap: 'wrap',
                                          gap: '8px',
                                          padding: '8px 12px',
                                          borderRadius: '8px',
                                          background: isPrimary ? '#f0fdf4' : '#f8fafc',
                                          border: `1px solid ${isPrimary ? '#bbf7d0' : '#e2e8f0'}`,
                                        }}
                                      >
                                        {/* Left: Email + Badges */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                          <Mail size={14} color={isPrimary ? '#16a34a' : '#0284c7'} />
                                          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)' }}>
                                            {email}
                                          </span>

                                          {isPrimary && (
                                            <span
                                              style={{
                                                fontSize: '10px',
                                                background: '#059669',
                                                color: '#fff',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontWeight: 700,
                                              }}
                                            >
                                              Primary
                                            </span>
                                          )}

                                          {/* MX Record Verification Badge */}
                                          {mxVerified !== undefined && (
                                            <span
                                              style={{
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                background: mxVerified ? '#ecfdf5' : '#fef2f2',
                                                color: mxVerified ? '#065f46' : '#991b1b',
                                                border: `1px solid ${mxVerified ? '#a7f3d0' : '#fecaca'}`,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '3px',
                                              }}
                                              title={mxRecords && mxRecords.length > 0 ? `Mail Exchange Server: ${mxRecords.join(', ')}` : (mxVerified ? 'MX Records Verified' : 'No MX Records Found')}
                                            >
                                              <ShieldCheck size={11} color={mxVerified ? '#059669' : '#dc2626'} />
                                              {mxVerified ? 'MX Verified' : 'No MX'}
                                            </span>
                                          )}

                                          {/* Discovery Method Badge */}
                                          {discoveryMethod && (
                                            <span
                                              style={{
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                background: discoveryMethod === 'playwright_dom' ? '#f5f3ff' : discoveryMethod === 'cloudflare_decode' ? '#ecfeff' : discoveryMethod === 'mailto_link' ? '#eff6ff' : '#f1f5f9',
                                                color: discoveryMethod === 'playwright_dom' ? '#6d28d9' : discoveryMethod === 'cloudflare_decode' ? '#0e7490' : discoveryMethod === 'mailto_link' ? '#1d4ed8' : '#475569',
                                                border: `1px solid ${discoveryMethod === 'playwright_dom' ? '#ddd6fe' : discoveryMethod === 'cloudflare_decode' ? '#a5f3fc' : discoveryMethod === 'mailto_link' ? '#bfdbfe' : '#e2e8f0'}`,
                                              }}
                                              title={`Discovered via: ${discoveryMethod}`}
                                            >
                                              {discoveryMethod === 'playwright_dom' && '⚡ Playwright DOM'}
                                              {discoveryMethod === 'cloudflare_decode' && '🛡️ Cloudflare Decoded'}
                                              {discoveryMethod === 'mailto_link' && '🔗 mailto:'}
                                              {discoveryMethod === 'semantic_contact_section' && '📄 Contact Section'}
                                              {discoveryMethod === 'visible_text' && '🔍 Body Text'}
                                              {!['playwright_dom', 'cloudflare_decode', 'mailto_link', 'semantic_contact_section', 'visible_text'].includes(discoveryMethod) && discoveryMethod}
                                            </span>
                                          )}

                                          {/* Source URL badge */}
                                          {sourceUrl && (
                                            <a
                                              href={sourceUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title={`Extracted from: ${sourceUrl}`}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '10.5px',
                                                fontWeight: 500,
                                                color: '#0284c7',
                                                textDecoration: 'none',
                                                background: '#f0f9ff',
                                                border: '1px solid #bae6fd',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                              }}
                                              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                                              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                                            >
                                              <span>📍 {sourceUrl.replace(/^https?:\/\/[^\/]+/, '') || '/'}</span>
                                              <ExternalLink size={10} />
                                            </a>
                                          )}
                                        </div>

                                        {/* Right: Copy Button */}
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(email, `${r.id}_em_${email}`)}
                                          title="Copy email"
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            background: '#ffffff',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '5px',
                                            cursor: 'pointer',
                                            padding: '3px 8px',
                                            fontSize: '11px',
                                            fontWeight: 500,
                                            color: copiedId === `${r.id}_em_${email}` ? '#10b981' : '#475569',
                                            transition: 'all 0.15s ease',
                                          }}
                                        >
                                          {copiedId === `${r.id}_em_${email}` ? (
                                            <>
                                              <Check size={12} color="#10b981" />
                                              <span>Copied</span>
                                            </>
                                          ) : (
                                            <>
                                              <Copy size={12} />
                                              <span>Copy</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </React.Fragment>
              );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
