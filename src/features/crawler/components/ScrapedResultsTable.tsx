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
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ScrapedDataRecord } from '../types/crawler.types';
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
  const [expandedDomainIds, setExpandedDomainIds] = useState<Set<string>>(new Set());
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

      if (!existing) {
        map.set(domainKey, {
          ...r,
          id: r.id || `dom_${domainKey}`,
          domain: domainKey,
          subdomains: Array.from(new Set(subList)),
          subdomainCount: subList.length,
          email: rankedEmails[0] || '',
          emails: rankedEmails,
          emailCount: rankedEmails.length,
          pagesCrawled: r.pagesCrawled || 1,
        });
      } else {
        // Merge subdomains and emails
        const mergedSubs = Array.from(new Set([...(existing.subdomains || []), ...subList]));
        const mergedEmails = rankAndFilterEmails([...(existing.emails || []), ...rawEmailList], domainKey);

        existing.subdomains = mergedSubs;
        existing.subdomainCount = mergedSubs.length;
        existing.emails = mergedEmails;
        existing.emailCount = mergedEmails.length;
        existing.email = mergedEmails[0] || existing.email;
        existing.pagesCrawled = Math.max(existing.pagesCrawled || 1, r.pagesCrawled || 1);
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
    setExpandedDomainIds((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) {
        next.delete(domainId);
      } else {
        next.add(domainId);
      }
      return next;
    });
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
                const isExpanded = expandedDomainIds.has(r.id);
                const subdomains = r.subdomains || [];
                const emails = r.emails || [];

                return (
                  <React.Fragment key={r.id || idx}>
                    <tr
                      style={{
                        borderBottom: isExpanded ? 'none' : idx < filteredGroups.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: isExpanded ? '#f8fafc' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = '#fcfdfe';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {/* Column 1: Target Domain */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Globe size={16} color="#0284c7" style={{ flexShrink: 0 }} />
                          <div>
                            <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '13.5px' }}>
                              {r.domain}
                            </span>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {r.pagesCrawled ? `${r.pagesCrawled} pages crawled` : 'Scope Target'}
                            </div>
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
                        <Badge variant={r.status === 'RESOLVED' ? 'success' : 'primary'}>
                          {r.status}
                        </Badge>
                      </td>

                      {/* Column 6: Toggle Details */}
                      <td style={{ padding: '14px 16px', textAlign: 'right', verticalAlign: 'top' }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(r.id)}
                          rightIcon={isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </Button>
                      </td>
                    </tr>

                    {/* Expandable Details Row */}
                    {isExpanded && (
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <td colSpan={6} style={{ padding: '16px 20px' }}>
                          <div
                            style={{
                              background: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '8px',
                              padding: '16px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '14px',
                            }}
                          >
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
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                  {emails.map((email, idx) => {
                                    const isPrimary = idx === 0;
                                    return (
                                      <div
                                        key={email}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                          padding: '4px 10px',
                                          borderRadius: '6px',
                                          background: isPrimary ? '#ecfdf5' : '#fef3c7',
                                          border: `1px solid ${isPrimary ? '#a7f3d0' : '#fde68a'}`,
                                          fontSize: '12px',
                                          color: isPrimary ? '#065f46' : '#92400e',
                                          fontWeight: 600,
                                        }}
                                      >
                                        <span>{email}</span>
                                        {isPrimary && (
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
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(email, `${r.id}_em_${email}`)}
                                          title="Copy email"
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                            color: copiedId === `${r.id}_em_${email}` ? '#10b981' : (isPrimary ? '#059669' : '#b45309'),
                                          }}
                                        >
                                          {copiedId === `${r.id}_em_${email}` ? <Check size={12} /> : <Copy size={12} />}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
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
