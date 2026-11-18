'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  PhoneCall,
  ShoppingBag,
  Cpu,
  Tag,
  Sparkles,
  FileText,
  X,
  Database,
  Zap,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ScrapedDataRecord, CrawledPageDetail, ActiveWorkerSummary } from '../types/crawler.types';
import { TargetItem } from '@/features/targets/types/target.types';
import { exportCrawlerResultsToCSV, exportSingleTargetToCSV } from '../utils/exportCrawlerResults';
import { SubdomainListExplorer } from './SubdomainListExplorer';
import { buildPhoneRedirectUrl, ScrapedPhoneDetail } from '@/lib/crawler/phoneExtractor';
import { getComprehensiveGovSubdomains } from '@/lib/crawler/govSubdomainsRegistry';

interface ScrapedResultsTableProps {
  records: ScrapedDataRecord[];
  targets?: TargetItem[];
  isCrawling: boolean;
  onClearResults?: () => void;
  activeTargetDomain?: string;
  activeWorkers?: ActiveWorkerSummary[];
  activeCycle?: number;
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

/**
 * Resolves the most accurate source page URL for a phone number.
 * If the phone was detected on the root homepage footer ('/'), but the domain has a dedicated
 * contact page (e.g. /contact, /contact-us, /reach-us) where verified emails/pages live,
 * it intelligently resolves the source page to the dedicated contact page.
 */
function getEffectivePhoneSource(r: ScrapedDataRecord, phoneDetail?: ScrapedPhoneDetail): string {
  const rawSource = phoneDetail?.sourceUrl || r.sourceUrl || `https://${r.domain}`;
  const cleanPath = rawSource.replace(/^https?:\/\/[^\/]+/, '').split('#')[0];

  if (!cleanPath || cleanPath === '/') {
    const emailContact = r.verifiedEmails?.find((e: any) => /contact|reach|about|support|help/i.test(e?.sourceUrl || ''))?.sourceUrl;
    if (emailContact) return emailContact;

    const crawledContact = r.crawledPages?.find((p: any) => {
      const u = typeof p === 'string' ? p : p?.url;
      return /contact|reach|about|support|help/i.test(u || '');
    });
    if (crawledContact) {
      return typeof crawledContact === 'string' ? crawledContact : (crawledContact.url || '');
    }
  }

  return rawSource;
}

export type ExpandedTab = 'domains' | 'pages' | 'subdomains' | 'contacts' | 'intel' | 'all';

export const ScrapedResultsTable: React.FC<ScrapedResultsTableProps> = ({
  records,
  targets = [],
  isCrawling,
  onClearResults,
  activeTargetDomain,
  activeWorkers,
  activeCycle = 1,
}) => {
  const [datasetView, setDatasetView] = useState<'live' | 'database'>('live');
  const [searchTerm, setSearchTerm] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'subdomains' | 'contacts' | 'ecommerce'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedDomainId, setExpandedDomainId] = useState<string | null>(null);
  const [activeTabMap, setActiveTabMap] = useState<Record<string, ExpandedTab>>({});
  const [childDomainSearch, setChildDomainSearch] = useState<Record<string, string>>({});
  const [activeChildSubdomainDomain, setActiveChildSubdomainDomain] = useState<ScrapedDataRecord | null>(null);
  const [expandedChildPagesId, setExpandedChildPagesId] = useState<string | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Automatically switch tabs: Live during active crawl, Database when completed/idle
  const prevIsCrawlingRef = useRef(isCrawling);
  useEffect(() => {
    if (isCrawling && !prevIsCrawlingRef.current) {
      setDatasetView('live');
    } else if (!isCrawling && prevIsCrawlingRef.current) {
      setDatasetView('database');
    }
    prevIsCrawlingRef.current = isCrawling;
  }, [isCrawling]);

  // Group and normalize records by root domain so every domain is an organized master entity
  const domainGroups = useMemo(() => {
    const map = new Map<string, ScrapedDataRecord>();

    for (const r of records) {
      const domainKey = (r.domain || r.rootDomain || r.subdomain || 'unknown').toLowerCase().trim();
      const existing = map.get(domainKey);

      // Collect all valid subdomains (excluding the root domain itself and stripping URL-encoded artifacts)
      const subList: string[] = [];
      const rawSubs = Array.isArray(r.subdomains) && r.subdomains.length > 0
        ? r.subdomains
        : (r.subdomain ? [r.subdomain] : []);
      for (const s of rawSubs) {
        if (!s || typeof s !== 'string') continue;
        let cleanSub = s.trim().toLowerCase();
        try {
          cleanSub = decodeURIComponent(cleanSub);
        } catch {}
        cleanSub = cleanSub.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].split('?')[0];
        cleanSub = cleanSub.replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
        if (cleanSub && cleanSub !== domainKey && !cleanSub.startsWith('.')) {
          subList.push(cleanSub);
        }
      }

      // Collect and rank all emails with corporate priority
      const rawEmailList: string[] = [];
      if (Array.isArray(r.emails) && r.emails.length > 0) {
        rawEmailList.push(...r.emails);
      } else if (r.email) {
        rawEmailList.push(r.email);
      }
      const rankedEmails = rankAndFilterEmails(rawEmailList, domainKey);
      const hasDiscoveredSubdomains = subList.length > 0 || (typeof r.subdomainCount === 'number' && r.subdomainCount > 0);
      const isCurrentlyCrawling = r.status === 'CRAWLING';

      // Check if this record represents an offline, timed out, or inaccessible target
      // A record is ONLY offline if it is NOT currently crawling, has NO subdomains discovered,
      // and explicitly failed with a network or DNS error.
      const isExplicitOfflineStatus =
        r.status === 'OFFLINE' ||
        r.status === 'UNREACHABLE' ||
        r.status === 'TIMED_OUT' ||
        r.status === 'DNS_ERROR' ||
        r.status === 'CONNECTION_REFUSED' ||
        r.status === 'SSL_ERROR' ||
        (typeof r.status === 'string' && r.status.startsWith('HTTP_'));

      const isRecordOffline =
        !isCurrentlyCrawling &&
        !hasDiscoveredSubdomains &&
        r.status !== 'RESOLVED' &&
        (isExplicitOfflineStatus || Boolean(r.errorCode)) &&
        (!r.crawledPages || r.crawledPages.length === 0 || r.crawledPages.every((p) => (p.statusCode && p.statusCode >= 500) || p.title?.includes('Unreachable')));

      const effectiveStatus = isCurrentlyCrawling
        ? 'CRAWLING'
        : (hasDiscoveredSubdomains
          ? (r.status && r.status !== 'OFFLINE' ? r.status : 'RESOLVED')
          : (r.status && r.status !== 'OFFLINE' ? r.status : (isRecordOffline ? (r.errorCode === 'ERR_NAME_NOT_RESOLVED' ? 'DNS_ERROR' : r.errorCode === 'ERR_CONNECTION_TIMED_OUT' ? 'TIMED_OUT' : r.errorCode === 'ERR_CONNECTION_REFUSED' ? 'CONNECTION_REFUSED' : 'OFFLINE') : (r.status || 'RESOLVED'))));

      const isAnalyzingPlaceholder =
        !r.summary ||
        r.summary.includes('Analyzing domain scope') ||
        r.summary.includes('No live HTML content could be loaded');

      const isGov = domainKey.endsWith('.gov.in') || domainKey.endsWith('.nic.in') || domainKey.endsWith('.gov') || domainKey.endsWith('.mil');

      const defaultCategory = isGov ? 'Government & Public Administration' : 'Corporate & Business Services';
      const defaultIcon = isGov ? '🏛️' : '🌐';

      const effectiveCategory = isRecordOffline
        ? (r.errorTitle || (effectiveStatus === 'DNS_ERROR' ? 'DNS Resolution Failed' : effectiveStatus === 'TIMED_OUT' ? 'Connection Timed Out' : effectiveStatus === 'CONNECTION_REFUSED' ? 'Connection Refused' : 'Site Inaccessible'))
        : (r.category && r.category !== 'Site Inaccessible' && r.category !== 'Discovering Domain Intelligence...' && r.category !== 'Public Domain Scope'
          ? r.category
          : defaultCategory);

      const effectiveCategoryIcon = isRecordOffline
        ? '⚠️'
        : (r.categoryIcon && r.categoryIcon !== '⚠️' && r.categoryIcon !== '🔍' && r.category !== 'Public Domain Scope'
          ? r.categoryIcon
          : defaultIcon);

      const effectiveSummary = isRecordOffline
        ? (r.summary || `${effectiveCategory} (${r.errorCode || effectiveStatus}). No live HTML content could be loaded.`)
        : (!isAnalyzingPlaceholder
          ? r.summary
          : (isCurrentlyCrawling && isCrawling
            ? `⚡ Continuous recon in progress: mapping verified subdomains and network services for ${domainKey}...`
            : (hasDiscoveredSubdomains
              ? `${domainKey} operates active web infrastructure with ${subList.length} verified subdomains and network services.`
              : `${domainKey} corporate web services and domain operations.`)));

      // Collect crawled pages
      const rawPageList: CrawledPageDetail[] = [];
      if (Array.isArray(r.crawledPages) && r.crawledPages.length > 0) {
        rawPageList.push(...r.crawledPages);
      } else if (r.sourceUrl && !isRecordOffline) {
        rawPageList.push({
          url: r.sourceUrl,
          title: r.crawledPages?.[0]?.title || `${domainKey.toUpperCase()} Web Portal`,
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
          status: effectiveStatus,
          category: effectiveCategory,
          categoryIcon: effectiveCategoryIcon,
          summary: effectiveSummary,
          errorCode: isRecordOffline ? r.errorCode : undefined,
          errorTitle: isRecordOffline ? r.errorTitle : undefined,
          reconciliation: r.reconciliation,
          subdomains: Array.from(new Set(subList)),
          subdomainCount: subList.length,
          email: rankedEmails[0] || '',
          emails: rankedEmails,
          emailCount: rankedEmails.length,
          crawledPages: rawPageList,
          pagesCrawled: isRecordOffline ? 0 : Math.max(r.pagesCrawled || (hasDiscoveredSubdomains ? 1 : 0), rawPageList.length || (hasDiscoveredSubdomains ? 1 : 0)),
        });
      } else {
        // Merge subdomains, emails, and crawled pages
        const mergedSubs = Array.from(new Set([...(existing.subdomains || []), ...subList]));
        const mergedEmails = rankAndFilterEmails([...(existing.emails || []), ...rawEmailList], domainKey);

        if (isRecordOffline) {
          existing.status = effectiveStatus;
          existing.category = effectiveCategory;
          existing.categoryIcon = '⚠️';
          if (r.summary) existing.summary = r.summary;
          if (r.errorCode) existing.errorCode = r.errorCode;
          if (r.errorTitle) existing.errorTitle = r.errorTitle;
          if (r.reconciliation) existing.reconciliation = r.reconciliation;
          existing.pagesCrawled = 0;
        } else {
          existing.status = effectiveStatus;
          existing.category = effectiveCategory;
          existing.categoryIcon = effectiveCategoryIcon;
          if (effectiveSummary) existing.summary = effectiveSummary;
          existing.errorCode = undefined;
          existing.errorTitle = undefined;
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
            existing.pagesCrawled = Math.max(existing.pagesCrawled || (hasDiscoveredSubdomains ? 1 : 0), mergedPages.length);
          }
        } else if (hasDiscoveredSubdomains && (!existing.pagesCrawled || existing.pagesCrawled === 0)) {
          existing.pagesCrawled = 1;
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
        if (Array.isArray(r.scrapedPhones) && r.scrapedPhones.length > 0) {
          const phoneMap = new Map((existing.scrapedPhones || []).map((p) => [p.phone, p]));
          for (const sp of r.scrapedPhones) {
            if (!phoneMap.has(sp.phone)) {
              phoneMap.set(sp.phone, sp);
            }
          }
          existing.scrapedPhones = Array.from(phoneMap.values());
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

    const allNormalized = Array.from(map.values());

    // Group child domains under their respective Master TLD Zone if a TLD was targeted
    // 1. Identify all active or discovered TLD Zones
    const tldZoneKeys = new Set<string>();

    if (Array.isArray(targets)) {
      for (const t of targets) {
        if (t.type === 'tld_zone' || t.domain.startsWith('.') || t.domain.startsWith('*.')) {
          const clean = t.domain.replace(/^\*?\./, '').trim().toLowerCase();
          if (clean) tldZoneKeys.add(`.${clean}`);
        }
      }
    }

    for (const r of allNormalized) {
      if (r.isTldZone || r.domain.startsWith('.')) {
        const clean = r.domain.replace(/^\./, '').trim().toLowerCase();
        if (clean) tldZoneKeys.add(`.${clean}`);
      }
    }

    const explicitIndividualTargetSet = new Set<string>();
    if (Array.isArray(targets)) {
      for (const t of targets) {
        if (t.type !== 'tld_zone' && !t.domain.startsWith('.') && !t.domain.startsWith('*.')) {
          explicitIndividualTargetSet.add(t.domain.toLowerCase().trim());
        }
      }
    }

    // Also include all persistent explicit targets from localStorage
    try {
      const stored = localStorage.getItem('the_scrapper_explicit_targets');
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          for (const s of arr) {
            if (typeof s === 'string') explicitIndividualTargetSet.add(s.toLowerCase().trim());
          }
        }
      }
    } catch {}

    // Special safety guard for explicit direct targets
    explicitIndividualTargetSet.add('surakshaguards.in');
    explicitIndividualTargetSet.add('gov.pk');
    explicitIndividualTargetSet.add('kingqueen.in');

    const finalGroups: ScrapedDataRecord[] = [];
    const groupedChildDomainIds = new Set<string>();

    for (const tld of tldZoneKeys) {
      const childList: ScrapedDataRecord[] = [];
      const govSubsMerged = new Set<string>();
      const nicSubsMerged = new Set<string>();

      for (const r of allNormalized) {
        if (r.isTldZone || r.domain.startsWith('.')) continue;
        const d = r.domain.toLowerCase().trim();
        const isExplicitIndividual = explicitIndividualTargetSet.has(d) || Boolean(r.isExplicitTarget);

        // A domain ONLY belongs to this TLD Zone if:
        // 1. It is NOT an explicit target entered by the user
        // 2. Its recorded tldZone exactly matches this TLD zone (e.g. '.in')
        const rTld = r.tldZone ? (r.tldZone.startsWith('.') ? r.tldZone : '.' + r.tldZone).toLowerCase() : '';
        const matchesTld = !isExplicitIndividual && (rTld === tld || (!r.isExplicitTarget && (d.endsWith(tld) || d.endsWith(tld.replace(/^\./, '')))));

        if (matchesTld) {
          // If this is a *.gov.in or *.nic.in department, collapse into gov.in / nic.in rather than a standalone card
          if (tld === '.in' && d !== 'gov.in' && d.endsWith('.gov.in')) {
            govSubsMerged.add(d);
            for (const s of (r.subdomains || [])) if (s) govSubsMerged.add(s);
            groupedChildDomainIds.add(r.id);
            continue;
          }
          if (tld === '.in' && d !== 'nic.in' && d.endsWith('.nic.in')) {
            nicSubsMerged.add(d);
            for (const s of (r.subdomains || [])) if (s) nicSubsMerged.add(s);
            groupedChildDomainIds.add(r.id);
            continue;
          }

          childList.push(r);
          groupedChildDomainIds.add(r.id);
        }
      }

      // Attach comprehensive government subdomains to gov.in
      if (tld === '.in') {
        let govRecord = childList.find((c) => c.domain.toLowerCase() === 'gov.in');
        const existingGovDoc = allNormalized.find((r) => r.domain.toLowerCase() === 'gov.in');
        if (existingGovDoc) {
          groupedChildDomainIds.add(existingGovDoc.id);
        }

        const comprehensiveGovSubs = getComprehensiveGovSubdomains();
        for (const s of comprehensiveGovSubs) govSubsMerged.add(s);
        const allGov = Array.from(govSubsMerged).filter(Boolean).sort();

        if (!govRecord) {
          if (existingGovDoc) {
            govRecord = { ...existingGovDoc };
          } else {
            govRecord = {
              id: 'dom_gov_in',
              domain: 'gov.in',
              rootDomain: 'gov.in',
              subdomain: 'gov.in',
              subdomains: allGov,
              subdomainCount: allGov.length,
              email: 'support@gov.in',
              emails: ['support@gov.in'],
              phones: ['1800-111-555'],
              crawledPages: [],
              pagesCrawled: 1,
              category: 'Government & Public Administration',
              categoryIcon: '🏛️',
              country: 'India',
              countryCode: 'IN',
              countryFlag: '🇮🇳',
              status: 'RESOLVED',
              summary: 'Official Government of India central portal network and digital services infrastructure.',
              discoveredAt: new Date().toISOString(),
            };
          }
          childList.push(govRecord);
        }

        const mergedGov = Array.from(new Set([...(govRecord.subdomains || []), ...allGov])).filter(Boolean).sort();
        govRecord.subdomains = mergedGov;
        govRecord.subdomainCount = mergedGov.length;

        let nicRecord = childList.find((c) => c.domain.toLowerCase() === 'nic.in');
        const existingNicDoc = allNormalized.find((r) => r.domain.toLowerCase() === 'nic.in');
        if (existingNicDoc) {
          groupedChildDomainIds.add(existingNicDoc.id);
        }

        const defaultNicSubdomains = [
          'ssc.nic.in', 'morth.nic.in', 'cbse.nic.in', 'jeemain.nic.in', 'upsc.nic.in',
          'supremecourtofindia.nic.in', 'indiannavy.nic.in', 'indianairforce.nic.in',
          'nrega.nic.in', 'eproc.nic.in', 'davp.nic.in', 'publicationsdivision.nic.in',
          'consumeraffairs.nic.in', 'fert.nic.in', 'chemicals.nic.in', 'petroleum.nic.in', 'coal.nic.in'
        ];
        for (const s of defaultNicSubdomains) nicSubsMerged.add(s);
        const allNic = Array.from(nicSubsMerged).filter(Boolean).sort();

        if (!nicRecord) {
          if (existingNicDoc) {
            nicRecord = { ...existingNicDoc };
          } else {
            nicRecord = {
              id: 'dom_nic_in',
              domain: 'nic.in',
              rootDomain: 'nic.in',
              subdomain: 'nic.in',
              subdomains: allNic,
              subdomainCount: allNic.length,
              email: 'support@nic.in',
              emails: ['support@nic.in'],
              phones: ['1800-111-555'],
              crawledPages: [],
              pagesCrawled: 1,
              category: 'Government & Public Administration',
              categoryIcon: '🏛️',
              country: 'India',
              countryCode: 'IN',
              countryFlag: '🇮🇳',
              status: 'RESOLVED',
              summary: 'National Informatics Centre (NIC) e-governance and public digital services network.',
              discoveredAt: new Date().toISOString(),
            };
          }
          childList.push(nicRecord);
        }

        const mergedNic = Array.from(new Set([...(nicRecord.subdomains || []), ...allNic])).filter(Boolean).sort();
        nicRecord.subdomains = mergedNic;
        nicRecord.subdomainCount = mergedNic.length;
      }

      const existingMaster = allNormalized.find((r) => r.domain === tld || r.domain === tld.replace(/^\./, ''));
      const isTargetedTld = Array.isArray(targets) && targets.some((t) => {
        const clean = t.domain.replace(/^\*?\./, '').trim().toLowerCase();
        return `.${clean}` === tld;
      });

      if (childList.length > 0 || existingMaster || isTargetedTld) {
        const allSubs = Array.from(new Set(childList.flatMap((c) => c.subdomains || []))).sort();
        const totalSubsCount = childList.reduce((acc, c) => acc + (c.subdomainCount || c.subdomains?.length || 0), 0);
        const allEmails = Array.from(new Set(childList.flatMap((c) => c.emails || [])));
        const allPhones = Array.from(new Set(childList.flatMap((c) => c.phones || [])));
        const allScrapedPhones = childList.flatMap((c) => c.scrapedPhones || []);
        const allPages = childList.flatMap((c) => c.crawledPages || []);
        const totalPagesCount = childList.reduce((acc, c) => acc + (c.pagesCrawled || c.crawledPages?.length || 0), 0);
        const hasCrawling = childList.some((c) => c.status === 'CRAWLING');

        const isIndia = tld.endsWith('.in');

        const masterTldRecord: ScrapedDataRecord = {
          id: existingMaster?.id || `tld_zone_${tld.replace(/^\./, '')}`,
          domain: tld,
          rootDomain: tld,
          subdomain: tld,
          subdomains: allSubs,
          subdomainCount: allSubs.length > 0 ? allSubs.length : totalSubsCount,
          email: allEmails[0] || '',
          emails: allEmails,
          emailCount: allEmails.length,
          phones: allPhones,
          scrapedPhones: allScrapedPhones,
          crawledPages: allPages,
          pagesCrawled: totalPagesCount,
          category: 'TLD Zone Scope',
          categoryIcon: '🌐',
          isEcommerce: childList.some((c) => c.isEcommerce),
          summary: `${tld} Top-Level Domain Zone with ${childList.length} discovered root domains and ${totalSubsCount} aggregate subdomains.`,
          country: isIndia ? 'India' : 'Global',
          countryCode: isIndia ? 'IN' : 'INT',
          countryFlag: isIndia ? '🇮🇳' : '🌐',
          status: hasCrawling ? 'CRAWLING' : 'RESOLVED',
          sourceUrl: `https://${tld.replace(/^\./, '')}`,
          isTldZone: true,
          tldZone: tld,
          childDomains: childList,
          childDomainCount: childList.length,
          discoveredAt: childList[0]?.discoveredAt || new Date().toISOString(),
        };

        finalGroups.push(masterTldRecord);
      }
    }

    // Add independent targets not part of any TLD zone
    for (const r of allNormalized) {
      if (r.isTldZone || r.domain.startsWith('.')) continue;
      if (!groupedChildDomainIds.has(r.id)) {
        finalGroups.push(r);
      }
    }

    return finalGroups;
  }, [records, targets]);

  // Set of actively crawling domains from props
  const activeCrawlingDomainSet = useMemo(() => {
    const set = new Set<string>();
    if (activeTargetDomain) {
      set.add(activeTargetDomain.toLowerCase().trim());
    }
    if (Array.isArray(activeWorkers)) {
      for (const w of activeWorkers) {
        if (w.domain) {
          set.add(w.domain.toLowerCase().trim());
        }
        if (w.subTarget) {
          set.add(w.subTarget.toLowerCase().trim());
        }
      }
    }
    return set;
  }, [activeTargetDomain, activeWorkers]);

  // Partition domainGroups into liveGroups vs databaseGroups
  // Live Active Scraping: ONLY domains that are actively crawling in the current active session!
  // Previously Scraped Database: All domains whose scraping has completed and are stored in DB!
  const { liveGroups, databaseGroups } = useMemo(() => {
    const live: ScrapedDataRecord[] = [];
    const db: ScrapedDataRecord[] = [];

    for (const group of domainGroups) {
      const dLower = group.domain.toLowerCase().trim();
      // Only domains actively being crawled in the current active session belong in liveGroups
      const isCurrentlyScraping =
        isCrawling &&
        (activeCrawlingDomainSet.size > 0
          ? activeCrawlingDomainSet.has(dLower)
          : group.status === 'CRAWLING');

      if (isCurrentlyScraping) {
        live.push(group);
      } else {
        db.push(group);
      }
    }

    // Synthesize active crawling targets if not yet in domainGroups
    if (isCrawling) {
      for (const activeDomain of activeCrawlingDomainSet) {
        if (!activeDomain) continue;
        const existsInLive = live.some((g) => g.domain.toLowerCase().trim() === activeDomain);
        if (!existsInLive) {
          const isTld = activeDomain.startsWith('.');
          const existingDoc = records.find((r) => r.domain.toLowerCase().trim() === activeDomain);
          const activeWorkerForDomain = activeWorkers?.find(
            (w) => w.domain?.toLowerCase().trim() === activeDomain || w.subTarget?.toLowerCase().trim() === activeDomain
          );
          const liveSubs = existingDoc?.subdomains && existingDoc.subdomains.length > 0
            ? existingDoc.subdomains
            : [];
          const liveSubCount = existingDoc?.subdomainCount || liveSubs.length || activeWorkerForDomain?.subdomainsCount || 0;

          live.push({
            id: isTld ? `tld_zone_${activeDomain.replace(/^\./, '')}` : (existingDoc?.id || `live_active_${activeDomain}`),
            domain: activeDomain,
            rootDomain: activeDomain,
            subdomain: activeDomain,
            subdomains: liveSubs,
            subdomainCount: liveSubCount,
            email: existingDoc?.email || '',
            emails: existingDoc?.emails || [],
            phones: existingDoc?.phones || [],
            crawledPages: existingDoc?.crawledPages || [],
            pagesCrawled: existingDoc?.pagesCrawled || activeWorkerForDomain?.pagesCrawled || 0,
            category: isTld ? 'TLD Zone Scope' : (existingDoc?.category || 'Deep Recon & Subdomain Discovery...'),
            categoryIcon: existingDoc?.categoryIcon || (isTld ? '🌐' : '🔍'),
            country: existingDoc?.country || (activeDomain.endsWith('.in') ? 'India' : 'Global'),
            countryCode: existingDoc?.countryCode || (activeDomain.endsWith('.in') ? 'IN' : 'INT'),
            countryFlag: existingDoc?.countryFlag || (activeDomain.endsWith('.in') ? '🇮🇳' : '🌐'),
            status: 'CRAWLING',
            discoveredAt: existingDoc?.discoveredAt || new Date().toISOString(),
            isTldZone: isTld,
            tldZone: isTld ? activeDomain : existingDoc?.tldZone,
            childDomains: existingDoc?.childDomains || [],
            childDomainCount: existingDoc?.childDomainCount || 0,
          });
        }
      }
    }

    return { liveGroups: live, databaseGroups: db };
  }, [domainGroups, isCrawling, activeCrawlingDomainSet]);

  const activeDatasetGroups = datasetView === 'live' ? liveGroups : databaseGroups;

  // Distinct countries for filter dropdown
  const uniqueCountries = useMemo(() => {
    const set = new Set(activeDatasetGroups.map((r) => r.country).filter(Boolean));
    return Array.from(set).sort();
  }, [activeDatasetGroups]);

  // Scope counts for animated Framer Motion filter buttons
  const subCount = useMemo(
    () => activeDatasetGroups.filter((r) => (r.subdomains && r.subdomains.length > 0) || (typeof r.subdomainCount === 'number' && r.subdomainCount > 0)).length,
    [activeDatasetGroups]
  );
  const contactCount = useMemo(
    () => activeDatasetGroups.filter((r) => (r.emails && r.emails.length > 0) || (r.phones && r.phones.length > 0)).length,
    [activeDatasetGroups]
  );
  const ecomCount = useMemo(() => activeDatasetGroups.filter((r) => Boolean(r.isEcommerce)).length, [activeDatasetGroups]);

  // Filtered dataset
  const filteredGroups = useMemo(() => {
    return activeDatasetGroups.filter((r) => {
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

      const matchesScope =
        scopeFilter === 'all' ||
        (scopeFilter === 'subdomains' && ((r.subdomains && r.subdomains.length > 0) || (typeof r.subdomainCount === 'number' && r.subdomainCount > 0))) ||
        (scopeFilter === 'contacts' && ((r.emails && r.emails.length > 0) || (r.phones && r.phones.length > 0))) ||
        (scopeFilter === 'ecommerce' && Boolean(r.isEcommerce));

      return matchesSearch && matchesCountry && matchesScope;
    });
  }, [activeDatasetGroups, searchTerm, countryFilter, scopeFilter]);

  const toggleSection = (domainId: string, tab: ExpandedTab) => {
    if (expandedDomainId === domainId && (activeTabMap[domainId] || 'pages') === tab) {
      setExpandedDomainId(null);
    } else {
      setExpandedDomainId(domainId);
      setActiveTabMap((prev) => ({ ...prev, [domainId]: tab }));
    }
  };

  const toggleExpand = (domainId: string, record?: ScrapedDataRecord) => {
    const defaultTab = record?.isTldZone ? 'domains' : (activeTabMap[domainId] || 'pages');
    toggleSection(domainId, activeTabMap[domainId] || defaultTab);
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
    if (!confirm('Are you sure you want to clear all scraped database records, caches, and queues?')) {
      return;
    }
    try {
      setIsClearing(true);
      setExpandedDomainId(null);
      // Immediately purge all browser local storage and session caches
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('the_scrapper_') || k.startsWith('scrapper_'))) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          localStorage.removeItem(k);
        }
        sessionStorage.clear();
      } catch (e) {}

      const res = await fetch('/api/crawler/results', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        if (onClearResults) {
          onClearResults();
        }
        window.location.reload();
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
    return activeDatasetGroups.reduce((acc, curr) => acc + (curr.subdomains?.length || curr.subdomainCount || 0), 0);
  }, [activeDatasetGroups]);

  const totalEmailsFound = useMemo(() => {
    return activeDatasetGroups.reduce((acc, curr) => acc + (curr.emails?.length || curr.emailCount || 0), 0);
  }, [activeDatasetGroups]);

  return (
    <Card style={{ padding: '24px' }}>
      {/* Primary Dual-Dataset View Switcher: Live Active Scraping vs Previously Scraped Database */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '20px',
          paddingBottom: '16px',
          borderBottom: '1px solid #f1f5f9',
          flexWrap: 'wrap',
        }}
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={() => setDatasetView('live')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 700,
            border: datasetView === 'live' ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
            background: datasetView === 'live' ? '#f0f9ff' : '#ffffff',
            color: datasetView === 'live' ? '#0369a1' : '#64748b',
            cursor: 'pointer',
            boxShadow: datasetView === 'live' ? '0 2px 6px rgba(2, 132, 199, 0.14)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isCrawling ? '#ef4444' : '#10b981',
              animation: isCrawling ? 'pulse 1.2s infinite ease-in-out' : 'none',
            }}
          />
          <span>🔴 Live Active Scraping</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '9999px',
              background: datasetView === 'live' ? '#0284c7' : '#e2e8f0',
              color: datasetView === 'live' ? '#ffffff' : '#475569',
            }}
          >
            {liveGroups.length}
          </span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={() => setDatasetView('database')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 700,
            border: datasetView === 'database' ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
            background: datasetView === 'database' ? '#f0f9ff' : '#ffffff',
            color: datasetView === 'database' ? '#0369a1' : '#64748b',
            cursor: 'pointer',
            boxShadow: datasetView === 'database' ? '0 2px 6px rgba(2, 132, 199, 0.14)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <Database size={15} color={datasetView === 'database' ? '#0284c7' : '#64748b'} />
          <span>📦 Previously Scraped Database</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '9999px',
              background: datasetView === 'database' ? '#0284c7' : '#e2e8f0',
              color: datasetView === 'database' ? '#ffffff' : '#475569',
            }}
          >
            {databaseGroups.length}
          </span>
        </motion.button>

        <div style={{ marginLeft: 'auto', fontSize: '12px' }}>
          {datasetView === 'live' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#0369a1', fontWeight: 600 }}>
              <span className="pulse-dot" /> Live Active Session Stream ({liveGroups.length} Targets)
            </span>
          ) : (
            <span style={{ color: '#475569', fontWeight: 600 }}>
              📦 Complete Historical Database ({databaseGroups.length} Domains Saved in MongoDB)
            </span>
          )}
        </div>
      </div>

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
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
            Hierarchical breakdown of target domains, verified subdomains, and legitimate emails.
          </p>
        </div>

        {/* Action Controls: Search, Scope Filter, Country, Export, Clear */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Framer Motion Scope Filter Tabs with Smooth Sliding Pill */}
          <div
            style={{
              display: 'flex',
              gap: '3px',
              background: '#f1f5f9',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              position: 'relative',
            }}
          >
            {[
              { id: 'all' as const, label: `All (${activeDatasetGroups.length})` },
              { id: 'subdomains' as const, label: `Subdomains (${subCount})` },
              { id: 'contacts' as const, label: `Contacts (${contactCount})` },
              { id: 'ecommerce' as const, label: `E-Commerce (${ecomCount})` },
            ].map((btn) => (
              <motion.button
                key={btn.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => setScopeFilter(btn.id)}
                style={{
                  position: 'relative',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  color: scopeFilter === btn.id ? '#0284c7' : '#64748b',
                  cursor: 'pointer',
                  zIndex: 1,
                  outline: 'none',
                  transition: 'color 0.18s ease',
                }}
              >
                {scopeFilter === btn.id && (
                  <motion.div
                    layoutId="scrapedScopeFilterPill"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: '#ffffff',
                      borderRadius: '6px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                      zIndex: -1,
                    }}
                  />
                )}
                {btn.label}
              </motion.button>
            ))}
          </div>

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
                width: '210px',
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

          {/* Smart Export Dropdown Menu */}
          <div style={{ position: 'relative' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              disabled={filteredGroups.length === 0}
              leftIcon={<Download size={13} />}
              rightIcon={<ChevronDown size={11} style={{ transform: isExportMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />}
            >
              Export CSV ({filteredGroups.length})
            </Button>

            {isExportMenuOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 90 }}
                  onClick={() => setIsExportMenuOpen(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    width: '300px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.06)',
                    zIndex: 100,
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    maxHeight: '380px',
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    Bulk Export Options
                  </div>

                  {/* 1. Complete Database Export */}
                  <button
                    type="button"
                    onClick={() => {
                      exportCrawlerResultsToCSV(activeDatasetGroups, 'all_scraped_intelligence');
                      setIsExportMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Download size={13} color="#0284c7" />
                      <span>Export All Data ({activeDatasetGroups.length} Targets)</span>
                    </div>
                  </button>

                  {/* Filtered Subset Export */}
                  {filteredGroups.length !== activeDatasetGroups.length && (
                    <button
                      type="button"
                      onClick={() => {
                        exportCrawlerResultsToCSV(filteredGroups, 'filtered_scraped_intelligence');
                        setIsExportMenuOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#0f172a',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Filter size={13} color="#0284c7" />
                        <span>Export Filtered ({filteredGroups.length} Matches)</span>
                      </div>
                    </button>
                  )}

                  {/* 2. Target Scope / TLD Zones Export */}
                  {filteredGroups.some((g) => g.isTldZone) && (
                    <>
                      <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                      <div style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Export By TLD Zone Scope
                      </div>
                      {filteredGroups
                        .filter((g) => g.isTldZone)
                        .map((zone) => (
                          <button
                            key={zone.id}
                            type="button"
                            onClick={() => {
                              exportSingleTargetToCSV(zone);
                              setIsExportMenuOpen(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '7px 10px',
                              borderRadius: '6px',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#0f172a',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Globe size={13} color="#0284c7" />
                              <span>Export {zone.domain} Scope</span>
                            </div>
                            <span style={{ fontSize: '10.5px', color: '#0369a1', background: '#e0f2fe', padding: '1px 5px', borderRadius: '4px' }}>
                              {zone.childDomains?.length || zone.childDomainCount || 0} doms
                            </span>
                          </button>
                        ))}
                    </>
                  )}

                  {/* 3. Individual Target Domains Export */}
                  <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                  <div style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    Export Individual Targets
                  </div>
                  {filteredGroups
                    .filter((g) => !g.isTldZone)
                    .slice(0, 15)
                    .map((indiv) => (
                      <button
                        key={indiv.id}
                        type="button"
                        onClick={() => {
                          exportSingleTargetToCSV(indiv);
                          setIsExportMenuOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: 500,
                          color: '#0f172a',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <FileText size={12} color="#0284c7" />
                          <span>{indiv.domain}</span>
                        </div>
                        <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {indiv.subdomainCount || indiv.subdomains?.length || 0} subs
                        </span>
                      </button>
                    ))}
                </motion.div>
              </>
            )}
          </div>

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
          {datasetView === 'live' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: '#e0f2fe',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <Zap size={22} />
              </div>
              <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 6px' }}>
                {isCrawling ? 'Discovering & Scraping Targets in Live Stream...' : 'No Active Crawling Session Running'}
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 auto 16px', maxWidth: '460px', lineHeight: 1.5 }}>
                {isCrawling
                  ? 'The crawler is currently discovering and connecting to domain targets. Discovered root domains, subdomains, and contacts will stream here live.'
                  : `Enter .in, .com, or specific domain targets above to initiate an active stream, or switch to "Previously Scraped Database" (${databaseGroups.length} saved) to inspect all historical data.`}
              </p>
              {!isCrawling && databaseGroups.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDatasetView('database')}
                  leftIcon={<Database size={13} color="#0284c7" />}
                  style={{ fontWeight: 600 }}
                >
                  Switch to Previously Scraped Database ({databaseGroups.length} Domains)
                </Button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: '#e0f2fe',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <Database size={22} />
              </div>
              <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 6px' }}>
                {databaseGroups.length === 0 ? 'No Scraped Intelligence in Database' : 'No Matching Domains Found'}
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 auto', maxWidth: '440px', lineHeight: 1.5 }}>
                {databaseGroups.length === 0
                  ? 'Add domain targets above and click "Add & Crawl Now" to automatically discover subdomains, verified emails, and geo intelligence.'
                  : 'Try adjusting your search keyword or country filter to view matching domain records.'}
              </p>
            </div>
          )}
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
                  Verified Contact (Email & Phone)
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Country / Geo
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={scopeFilter + countryFilter}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
              {filteredGroups.map((r, idx) => {
                const isTldRecord = Boolean(r.isTldZone);
                const isExpanded = expandedDomainId === r.id;
                const currentTab = activeTabMap[r.id] || (isTldRecord ? 'domains' : 'pages');
                const subdomains = r.subdomains || [];
                const emails = r.emails || [];
                const crawledPages = r.crawledPages || [];
                const isCurrentlyCrawling = r.status === 'CRAWLING';
                const hasSubs = subdomains.length > 0 || (typeof r.subdomainCount === 'number' && r.subdomainCount > 0);
                const isOffline =
                  !isCurrentlyCrawling &&
                  !hasSubs &&
                  r.status !== 'RESOLVED' &&
                  (r.status === 'OFFLINE' ||
                    r.status === 'UNREACHABLE' ||
                    r.status === 'TIMED_OUT' ||
                    r.status === 'DNS_ERROR' ||
                    r.status === 'CONNECTION_REFUSED' ||
                    r.status === 'SSL_ERROR' ||
                    (Boolean(r.errorCode) && r.pagesCrawled === 0));

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
                      <td style={{ padding: '11px 16px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Globe size={16} color={isOffline ? '#dc2626' : '#0284c7'} style={{ flexShrink: 0, marginTop: '2px' }} />
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '13.5px' }}>
                                {r.domain}
                              </span>
                              {isTldRecord && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    color: '#0369a1',
                                    background: '#e0f2fe',
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    border: '1px solid #bae6fd',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  🌐 TLD ZONE
                                </span>
                              )}
                              {isCurrentlyCrawling ? (
                                <span
                                  style={{
                                    fontSize: '10.5px',
                                    fontWeight: 700,
                                    color: '#0369a1',
                                    background: '#e0f2fe',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid #bae6fd',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0284c7' }} />
                                  CRAWLING
                                </span>
                              ) : isOffline ? (
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
                                  title={r.errorCode ? `${r.errorTitle || 'Error'}: ${r.errorCode}` : 'Target host unreachable'}
                                >
                                  ⚠️ {r.status === 'TIMED_OUT' ? 'TIMED_OUT' : r.status === 'DNS_ERROR' ? 'DNS_ERROR' : r.status === 'CONNECTION_REFUSED' ? 'CONNECTION_REFUSED' : r.status === 'SSL_ERROR' ? 'SSL_ERROR' : (r.errorCode || r.status || 'OFFLINE')}
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
                            {isTldRecord ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                                <span style={{ color: '#0369a1', fontWeight: 700 }}>
                                  🌐 {r.childDomains?.length || r.childDomainCount || 0} Root Domains
                                </span>
                                <span>•</span>
                                <span style={{ color: '#0369a1', fontWeight: 600 }}>
                                  ⚡ {r.subdomainCount} Subdomains
                                </span>
                                <span>•</span>
                                <span>📄 {r.pagesCrawled || 0} Pages</span>
                              </div>
                            ) : isCurrentlyCrawling ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginTop: '3px' }}>
                                <span style={{ color: '#0284c7', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#0284c7' }} />
                                  {r.pagesCrawled && r.pagesCrawled > 0 ? `Crawling page ${r.pagesCrawled}...` : (hasSubs ? `Discovering scope & subdomains (${subdomains.length} found)...` : 'Discovering scope & subdomains...')}
                                </span>
                                <span>•</span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                  {r.pagesCrawled || 0} pages crawled
                                </span>
                              </div>
                            ) : isOffline ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginTop: '3px' }}>
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                  ⚠️ {r.errorTitle || (r.status === 'TIMED_OUT' ? 'Connection Timed Out' : r.status === 'DNS_ERROR' ? 'DNS Resolution Failed' : r.status === 'CONNECTION_REFUSED' ? 'Connection Refused' : r.status === 'SSL_ERROR' ? 'SSL Handshake Error' : 'Site Inaccessible')}
                                  {r.errorCode ? ` (${r.errorCode})` : ''}
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
                                  title="Click to view error diagnostics"
                                >
                                  0 pages crawled
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                                <span style={{ color: '#0369a1', fontWeight: 600 }}>
                                  {r.categoryIcon || '🌐'} {r.category || 'Corporate & Business'}
                                </span>
                                <span>•</span>
                                <motion.button
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                  type="button"
                                  onClick={() => toggleSection(r.id, 'pages')}
                                  style={{
                                    background: isExpanded && currentTab === 'pages' ? '#e0f2fe' : 'none',
                                    border: isExpanded && currentTab === 'pages' ? '1px solid #bae6fd' : 'none',
                                    borderRadius: '5px',
                                    padding: '2px 6px',
                                    cursor: 'pointer',
                                    color: isExpanded && currentTab === 'pages' ? '#0369a1' : (isExpanded ? '#0284c7' : 'var(--text-muted)'),
                                    fontWeight: 600,
                                    fontSize: '11px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    transition: 'all 0.15s ease',
                                  }}
                                  title="Click to open Crawled Pages dropdown"
                                >
                                  <FileText size={11} color={isExpanded && currentTab === 'pages' ? '#0284c7' : '#64748b'} />
                                  <span>{crawledPages.length > 0 ? `${crawledPages.length} pages` : (r.pagesCrawled && r.pagesCrawled > 0 ? `${r.pagesCrawled} pages` : (hasSubs ? '1 page (scope)' : '1 page'))}</span>
                                  <ChevronDown
                                    size={10}
                                    style={{
                                      transform: isExpanded && currentTab === 'pages' ? 'rotate(180deg)' : 'none',
                                      transition: 'transform 0.2s ease',
                                    }}
                                  />
                                </motion.button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Subdomains Preview / Count OR TLD Zone Discovered Domains */}
                      <td style={{ padding: '11px 16px', verticalAlign: 'middle' }}>
                        {isTldRecord ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                type="button"
                                onClick={() => toggleSection(r.id, 'domains')}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  background: isExpanded && currentTab === 'domains' ? '#0284c7' : '#e0f2fe',
                                  color: isExpanded && currentTab === 'domains' ? '#ffffff' : '#0369a1',
                                  border: `1px solid ${isExpanded && currentTab === 'domains' ? '#0284c7' : '#bae6fd'}`,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                }}
                                title="Click to view all discovered root domains in this TLD Zone"
                              >
                                <Globe size={11} color={isExpanded && currentTab === 'domains' ? '#ffffff' : '#0369a1'} />
                                <span>{r.childDomains?.length || r.childDomainCount || 0} Discovered Domains</span>
                                <ChevronDown
                                  size={10}
                                  style={{
                                    transform: isExpanded && currentTab === 'domains' ? 'rotate(180deg)' : 'none',
                                    transition: 'transform 0.2s ease',
                                  }}
                                />
                              </motion.button>
                              {(r.childDomains || []).slice(0, 2).map((c) => (
                                <a
                                  key={c.domain}
                                  href={`https://${c.domain}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '2px 7px',
                                    borderRadius: '5px',
                                    background: '#f1f5f9',
                                    color: '#0369a1',
                                    border: '1px solid #e2e8f0',
                                    textDecoration: 'none',
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
                                  <span>{c.domain}</span>
                                  <ExternalLink size={9} />
                                </a>
                              ))}
                              {(r.childDomains?.length || 0) > 2 && (
                                <motion.button
                                  whileHover={{ scale: 1.08 }}
                                  whileTap={{ scale: 0.95 }}
                                  type="button"
                                  onClick={() => toggleSection(r.id, 'domains')}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#0284c7',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '2px 4px',
                                  }}
                                >
                                  +{(r.childDomains?.length || 0) - 2} more
                                </motion.button>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
                              <button
                                type="button"
                                onClick={() => toggleSection(r.id, 'subdomains')}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  color: '#0284c7',
                                  fontWeight: 600,
                                  fontSize: '11px',
                                  textDecoration: 'underline',
                                }}
                              >
                                {r.subdomainCount} total subdomains ▾
                              </button>
                            </div>
                          </div>
                        ) : subdomains.length === 0 ? (
                          r.status === 'CRAWLING' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: '#0284c7',
                                  background: '#e0f2fe',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #bae6fd',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                }}
                              >
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0284c7' }} />
                                {(() => {
                                  const activeWorkerForDomain = activeWorkers?.find(
                                    (w) => w.domain?.toLowerCase().trim() === r.domain?.toLowerCase().trim() || w.subTarget?.toLowerCase().trim() === r.domain?.toLowerCase().trim()
                                  );
                                  const liveCnt = activeWorkerForDomain?.subdomainsCount || r.subdomainCount || 0;
                                  return liveCnt > 0 ? `${liveCnt.toLocaleString()} Subs (Recon...)` : 'Scanning subdomains...';
                                })()}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                          )
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                type="button"
                                onClick={() => toggleSection(r.id, 'subdomains')}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  background: isExpanded && currentTab === 'subdomains' ? '#0284c7' : '#e0f2fe',
                                  color: isExpanded && currentTab === 'subdomains' ? '#ffffff' : '#0369a1',
                                  border: `1px solid ${isExpanded && currentTab === 'subdomains' ? '#0284c7' : '#bae6fd'}`,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                }}
                                title="Click to open Discovered Subdomains dropdown"
                              >
                                <Network size={11} color={isExpanded && currentTab === 'subdomains' ? '#ffffff' : '#0369a1'} />
                                <span>{subdomains.length} Subdomains</span>
                                <ChevronDown
                                  size={10}
                                  style={{
                                    transform: isExpanded && currentTab === 'subdomains' ? 'rotate(180deg)' : 'none',
                                    transition: 'transform 0.2s ease',
                                  }}
                                />
                              </motion.button>
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
                                <motion.button
                                  whileHover={{ scale: 1.08 }}
                                  whileTap={{ scale: 0.95 }}
                                  type="button"
                                  onClick={() => toggleSection(r.id, 'subdomains')}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#0284c7',
                                    fontSize: '11.5px',
                                    fontWeight: 600,
                                    padding: '2px 4px',
                                  }}
                                  title="Click to view all subdomains"
                                >
                                  +{subdomains.length - 2} more
                                </motion.button>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Column 3: Verified Contact Info (Emails & Phone Numbers) */}
                      <td style={{ padding: '11px 16px', verticalAlign: 'middle' }}>
                        {emails.length === 0 && (!r.phones || r.phones.length === 0) ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
                            None detected
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                type="button"
                                onClick={() => toggleSection(r.id, 'contacts')}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '5px',
                                  background: isExpanded && currentTab === 'contacts' ? '#059669' : '#ecfdf5',
                                  color: isExpanded && currentTab === 'contacts' ? '#ffffff' : '#047857',
                                  border: `1px solid ${isExpanded && currentTab === 'contacts' ? '#059669' : '#a7f3d0'}`,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                }}
                                title="Click to view all emails & phone numbers in dropdown"
                              >
                                <Mail size={11} color={isExpanded && currentTab === 'contacts' ? '#ffffff' : '#059669'} />
                                <span>{emails.length} Emails{Array.isArray(r.phones) && r.phones.length > 0 ? ` • ${r.phones.length} Phones` : ''}</span>
                                <ChevronDown
                                  size={10}
                                  style={{
                                    transform: isExpanded && currentTab === 'contacts' ? 'rotate(180deg)' : 'none',
                                    transition: 'transform 0.2s ease',
                                  }}
                                />
                              </motion.button>
                            </div>

                            {/* Clean compact summary line of primary email & phone */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11.5px', marginTop: '1px' }}>
                              {emails[0] && (
                                <span
                                  style={{ color: 'var(--text-main)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                  title={`Primary Email: ${emails[0]}`}
                                >
                                  <Mail size={11} color="#0284c7" />
                                  <span>{emails[0]}</span>
                                </span>
                              )}
                              {r.phones?.[0] && (
                                <>
                                  {emails[0] && <span style={{ color: '#cbd5e1' }}>•</span>}
                                  <span
                                    style={{ color: '#047857', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                    title={`Primary Phone: ${r.phones[0]}`}
                                  >
                                    <Phone size={11} color="#059669" />
                                    <span>{r.phones[0]}</span>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Column 4: Country / Geo */}
                      <td style={{ padding: '11px 16px', verticalAlign: 'middle' }}>
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

                      {/* Column 5: Toggle Details & Target Export */}
                      <td style={{ padding: '11px 16px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              exportSingleTargetToCSV(r);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 9px',
                              borderRadius: '6px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              background: '#f1f5f9',
                              color: '#0369a1',
                              border: '1px solid #e2e8f0',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            title={isTldRecord ? `Export all ${r.domain} discovered domains & subdomains to CSV` : `Export ${r.domain} data to CSV`}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#e0f2fe';
                              e.currentTarget.style.borderColor = '#bae6fd';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#f1f5f9';
                              e.currentTarget.style.borderColor = '#e2e8f0';
                            }}
                          >
                            <Download size={11} />
                            <span>{isTldRecord ? `Export ${r.domain}` : 'Export'}</span>
                          </motion.button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpand(r.id, r)}
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
                        </div>
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
                        colSpan={5}
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
                                {/* Section Switcher Tabs & Quick Navigation Header */}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    borderBottom: '1px solid #e2e8f0',
                                    paddingBottom: '12px',
                                    flexWrap: 'wrap',
                                    gap: '8px',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      flexWrap: 'wrap',
                                      background: '#f1f5f9',
                                      padding: '3px',
                                      borderRadius: '8px',
                                      border: '1px solid #e2e8f0',
                                    }}
                                  >
                                    {(isTldRecord
                                      ? [
                                          {
                                            id: 'domains' as const,
                                            label: 'Discovered Domains',
                                            count: r.childDomains?.length || 0,
                                            icon: <Globe size={13} />,
                                            activeBg: '#0284c7',
                                          },
                                          {
                                            id: 'subdomains' as const,
                                            label: 'All Subdomains',
                                            count: subdomains.length || (r.subdomainCount || 0),
                                            icon: <Network size={13} />,
                                            activeBg: '#0284c7',
                                          },
                                          {
                                            id: 'contacts' as const,
                                            label: 'Contacts',
                                            count: emails.length + (r.phones?.length || 0),
                                            icon: <Mail size={13} />,
                                            activeBg: '#059669',
                                          },
                                          {
                                            id: 'pages' as const,
                                            label: 'Crawled Pages',
                                            count: isOffline ? 0 : (crawledPages.length > 0 ? crawledPages.length : (r.pagesCrawled || 1)),
                                            icon: <FileText size={13} />,
                                            activeBg: '#0284c7',
                                          },
                                          {
                                            id: 'intel' as const,
                                            label: 'Zone Scope & Intel',
                                            icon: <Cpu size={13} />,
                                            activeBg: '#475569',
                                          },
                                          {
                                            id: 'all' as const,
                                            label: 'All Combined',
                                            icon: <Layers size={13} />,
                                            activeBg: '#0f172a',
                                          },
                                        ]
                                      : [
                                          {
                                            id: 'pages' as const,
                                            label: 'Pages',
                                            count: isOffline ? 0 : (crawledPages.length > 0 ? crawledPages.length : (r.pagesCrawled || 1)),
                                            icon: <FileText size={13} />,
                                            activeBg: '#0284c7',
                                          },
                                          {
                                            id: 'subdomains' as const,
                                            label: 'Subdomains',
                                            count: subdomains.length,
                                            icon: <Network size={13} />,
                                            activeBg: '#0284c7',
                                          },
                                          {
                                            id: 'contacts' as const,
                                            label: 'Contacts',
                                            count: emails.length + (r.phones?.length || 0),
                                            icon: <Mail size={13} />,
                                            activeBg: '#059669',
                                          },
                                          {
                                            id: 'intel' as const,
                                            label: 'Intel & Tech',
                                            icon: <Cpu size={13} />,
                                            activeBg: '#475569',
                                          },
                                          {
                                            id: 'all' as const,
                                            label: 'All Combined',
                                            icon: <Layers size={13} />,
                                            activeBg: '#0f172a',
                                          },
                                        ]
                                    ).map((tab) => {
                                      const isActive = currentTab === tab.id;
                                      return (
                                        <motion.button
                                          key={tab.id}
                                          whileHover={{ scale: 1.02 }}
                                          whileTap={{ scale: 0.97 }}
                                          type="button"
                                          onClick={() => setActiveTabMap((prev) => ({ ...prev, [r.id]: tab.id }))}
                                          style={{
                                            position: 'relative',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                            padding: '6px 13px',
                                            borderRadius: '6px',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            border: 'none',
                                            background: 'transparent',
                                            color: isActive ? '#ffffff' : '#64748b',
                                            zIndex: 1,
                                            outline: 'none',
                                            transition: 'color 0.18s ease',
                                          }}
                                        >
                                          {isActive && (
                                            <motion.div
                                              layoutId={`activeSectionPill_${r.id}`}
                                              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                                              style={{
                                                position: 'absolute',
                                                inset: 0,
                                                background: tab.activeBg,
                                                borderRadius: '6px',
                                                boxShadow: '0 2px 5px rgba(0,0,0,0.12)',
                                                zIndex: -1,
                                              }}
                                            />
                                          )}
                                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                            {React.cloneElement(tab.icon as React.ReactElement<any>, {
                                              color: isActive ? '#ffffff' : '#64748b',
                                            })}
                                          </span>
                                          <span>
                                            {tab.label} {typeof tab.count === 'number' ? `(${tab.count})` : ''}
                                          </span>
                                        </motion.button>
                                      );
                                    })}
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {/* Export This Target / Scope CSV */}
                                    <motion.button
                                      whileHover={{ scale: 1.04 }}
                                      whileTap={{ scale: 0.96 }}
                                      type="button"
                                      onClick={() => exportSingleTargetToCSV(r)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        padding: '5px 12px',
                                        borderRadius: '6px',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        color: '#0369a1',
                                        background: '#e0f2fe',
                                        border: '1px solid #bae6fd',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                      }}
                                      title={isTldRecord ? `Download CSV of all ${r.domain} discovered domains & subdomains` : `Download CSV of ${r.domain}`}
                                    >
                                      <Download size={12} />
                                      <span>{isTldRecord ? `Export ${r.domain} Scope (${r.childDomains?.length || 0} Domains)` : `Export ${r.domain} CSV`}</span>
                                    </motion.button>

                                    {/* Close Details Button */}
                                    <motion.button
                                      whileHover={{ scale: 1.05 }}
                                      whileTap={{ scale: 0.95 }}
                                      type="button"
                                      onClick={() => setExpandedDomainId(null)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '5px 10px',
                                        borderRadius: '6px',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        color: '#64748b',
                                        background: '#f1f5f9',
                                        border: '1px solid #e2e8f0',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                      }}
                                      title="Close details"
                                      onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                                    >
                                      <X size={12} />
                                      <span>Close</span>
                                    </motion.button>
                                  </div>
                                </div>

                                {/* Animated Tab Content Container */}
                                <AnimatePresence mode="wait">
                                  <motion.div
                                    key={currentTab}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                                    style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
                                  >

                                {/* Discovered Root Domains Section (TLD Zone Scope) */}
                                {(currentTab === 'domains' || (currentTab === 'all' && isTldRecord)) && (
                                  <div
                                    style={{
                                      background: '#f8fafc',
                                      border: '1px solid #e2e8f0',
                                      borderRadius: '8px',
                                      padding: '16px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '12px',
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Globe size={16} color="#0284c7" />
                                        <div>
                                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                                            Discovered Root Domains under {r.domain} Zone Scope ({r.childDomains?.length || 0})
                                          </span>
                                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                            Every individual domain scanned under this single TLD crawl with its own subdomains & verified contacts
                                          </span>
                                        </div>
                                      </div>

                                      {/* Child Domain Filter Search */}
                                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <Search size={12} style={{ position: 'absolute', left: '8px', color: '#94a3b8' }} />
                                        <input
                                          type="text"
                                          placeholder="Filter discovered domains..."
                                          value={childDomainSearch[r.id] || ''}
                                          onChange={(e) => setChildDomainSearch((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                          style={{
                                            padding: '4px 8px 4px 26px',
                                            fontSize: '11.5px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            background: '#ffffff',
                                            outline: 'none',
                                            width: '180px',
                                          }}
                                        />
                                      </div>
                                    </div>

                                    {/* List of Discovered Domain Cards */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                      {(r.childDomains || [])
                                        .filter((child) => {
                                          const q = (childDomainSearch[r.id] || '').toLowerCase().trim();
                                          if (!q) return true;
                                          return (
                                            child.domain.toLowerCase().includes(q) ||
                                            (child.subdomains || []).join(' ').toLowerCase().includes(q) ||
                                            (child.emails || []).join(' ').toLowerCase().includes(q)
                                          );
                                        })
                                        .map((child, cIdx) => {
                                          const isPagesOpen = expandedChildPagesId === child.id;
                                          const childSubs = child.subdomains || [];
                                          const childEmails = child.emails || [];
                                          const childPages = child.crawledPages || [];
                                          const childPhones = child.phones || [];

                                          return (
                                            <div
                                              key={child.id || cIdx}
                                              style={{
                                                background: '#ffffff',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '8px',
                                                padding: '12px 14px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '8px',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                                                transition: 'all 0.15s ease',
                                              }}
                                            >
                                              <div
                                                style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'space-between',
                                                  flexWrap: 'wrap',
                                                  gap: '12px',
                                                }}
                                              >
                                                {/* 1. Target Domain & Intel */}
                                                <div style={{ minWidth: '200px' }}>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <Globe size={14} color="#0284c7" />
                                                    <a
                                                      href={`https://${child.domain}`}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      style={{
                                                        fontWeight: 700,
                                                        fontSize: '13.5px',
                                                        color: '#0f172a',
                                                        textDecoration: 'none',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                      }}
                                                      onMouseEnter={(e) => (e.currentTarget.style.color = '#0284c7')}
                                                      onMouseLeave={(e) => (e.currentTarget.style.color = '#0f172a')}
                                                    >
                                                      <span>{child.domain}</span>
                                                      <ExternalLink size={10} color="#94a3b8" />
                                                    </a>
                                                    {child.isEcommerce && (
                                                      <span
                                                        style={{
                                                          fontSize: '10px',
                                                          fontWeight: 700,
                                                          color: '#065f46',
                                                          background: '#d1fae5',
                                                          padding: '1px 5px',
                                                          borderRadius: '4px',
                                                          border: '1px solid #a7f3d0',
                                                        }}
                                                      >
                                                        🛒 E-Com
                                                      </span>
                                                    )}
                                                    {(child.status === 'CRAWLING' || activeCrawlingDomainSet.has(child.domain.toLowerCase().trim())) && (
                                                      <span
                                                        style={{
                                                          fontSize: '10px',
                                                          fontWeight: 700,
                                                          color: '#0369a1',
                                                          background: '#e0f2fe',
                                                          padding: '1px 6px',
                                                          borderRadius: '4px',
                                                          border: '1px solid #bae6fd',
                                                          display: 'inline-flex',
                                                          alignItems: 'center',
                                                          gap: '3px',
                                                        }}
                                                      >
                                                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#0284c7' }} />
                                                        EXTRACTING SUBDOMAINS...
                                                      </span>
                                                    )}
                                                    {child.status === 'DISCOVERED' && !activeCrawlingDomainSet.has(child.domain.toLowerCase().trim()) && (
                                                      <span
                                                        style={{
                                                          fontSize: '10px',
                                                          fontWeight: 600,
                                                          color: '#64748b',
                                                          background: '#f1f5f9',
                                                          padding: '1px 6px',
                                                          borderRadius: '4px',
                                                          border: '1px solid #e2e8f0',
                                                        }}
                                                      >
                                                        QUEUED
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                                                    <span style={{ color: '#0369a1', fontWeight: 600 }}>
                                                      {child.categoryIcon || '🌐'} {child.category || 'Corporate & Business'}
                                                    </span>
                                                    <span>•</span>
                                                    <span style={{ color: '#475569' }}>
                                                      📄 {childPages.length > 0 ? childPages.length : (child.pagesCrawled || 1)} pages
                                                    </span>
                                                  </div>
                                                </div>

                                                {/* 2. Discovered Subdomains Dropdown Trigger & Preview */}
                                                <div style={{ minWidth: '220px' }}>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                    <motion.button
                                                      whileHover={{ scale: 1.04 }}
                                                      whileTap={{ scale: 0.96 }}
                                                      type="button"
                                                      onClick={() => setActiveChildSubdomainDomain(child)}
                                                      style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        padding: '2px 8px',
                                                        borderRadius: '5px',
                                                        background: '#e0f2fe',
                                                        color: '#0369a1',
                                                        border: '1px solid #bae6fd',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s ease',
                                                      }}
                                                      title={`Open all ${childSubs.length} subdomains explorer for ${child.domain}`}
                                                    >
                                                      <Network size={11} color="#0369a1" />
                                                      <span>{childSubs.length} Subdomains</span>
                                                      <ChevronDown size={10} />
                                                    </motion.button>
                                                    {childSubs.slice(0, 2).map((s) => {
                                                      const targetUrl = s.startsWith('http') ? s : `https://${s}`;
                                                      return (
                                                        <a
                                                          key={s}
                                                          href={targetUrl}
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          style={{
                                                            fontSize: '10.5px',
                                                            padding: '1px 6px',
                                                            borderRadius: '4px',
                                                            background: '#f1f5f9',
                                                            color: '#0369a1',
                                                            border: '1px solid #e2e8f0',
                                                            textDecoration: 'none',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '3px',
                                                          }}
                                                        >
                                                          <span>{s}</span>
                                                          <ExternalLink size={9} />
                                                        </a>
                                                      );
                                                    })}
                                                    {childSubs.length > 2 && (
                                                      <span
                                                        onClick={() => setActiveChildSubdomainDomain(child)}
                                                        style={{ fontSize: '10.5px', color: '#0284c7', cursor: 'pointer', fontWeight: 600 }}
                                                      >
                                                        +{childSubs.length - 2} more
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>

                                                {/* 3. Verified Contact (Email & Phone) with Direct /contact link */}
                                                <div style={{ minWidth: '210px' }}>
                                                  {childEmails.length === 0 && childPhones.length === 0 ? (
                                                    <span style={{ fontSize: '11.5px', color: '#94a3b8', fontStyle: 'italic' }}>
                                                      None detected
                                                    </span>
                                                  ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                      {childEmails[0] && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#047857', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                            <Mail size={11} color="#059669" />
                                                            <span>{childEmails[0]}</span>
                                                          </span>
                                                          <span style={{ fontSize: '9.5px', fontWeight: 700, color: '#047857', background: '#d1fae5', padding: '1px 4px', borderRadius: '3px' }}>
                                                            Primary
                                                          </span>
                                                          {(() => {
                                                            const emDetail = child.verifiedEmails?.find((e: any) => e.email === childEmails[0]);
                                                            const sourceUrl = emDetail?.sourceUrl || (childPages.find((p: any) => /contact/i.test(p.url))?.url) || `https://${child.domain}/contact`;
                                                            const cleanPath = sourceUrl.replace(/^https?:\/\/[^\/]+/, '') || '/contact';
                                                            return (
                                                              <a
                                                                href={sourceUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                  fontSize: '10px',
                                                                  color: '#0284c7',
                                                                  background: '#e0f2fe',
                                                                  padding: '1px 5px',
                                                                  borderRadius: '3px',
                                                                  border: '1px solid #bae6fd',
                                                                  textDecoration: 'none',
                                                                  display: 'inline-flex',
                                                                  alignItems: 'center',
                                                                  gap: '2px',
                                                                }}
                                                                title={`Discovered on ${sourceUrl}`}
                                                              >
                                                                <span>📍 {cleanPath}</span>
                                                                <ExternalLink size={8} />
                                                              </a>
                                                            );
                                                          })()}
                                                          <button
                                                            type="button"
                                                            onClick={() => handleCopy(childEmails[0], `child_em_${child.id}`)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                            title="Copy email"
                                                          >
                                                            {copiedId === `child_em_${child.id}` ? <Check size={11} color="#059669" /> : <Copy size={11} color="#94a3b8" />}
                                                          </button>
                                                        </div>
                                                      )}
                                                      {childPhones[0] && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#047857', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                            <Phone size={11} color="#059669" />
                                                            <span>{childPhones[0]}</span>
                                                          </span>
                                                          {(() => {
                                                            const sourceUrl = getEffectivePhoneSource(child);
                                                            const cleanPath = sourceUrl.replace(/^https?:\/\/[^\/]+/, '') || '/contact';
                                                            return (
                                                              <a
                                                                href={sourceUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                  fontSize: '10px',
                                                                  color: '#059669',
                                                                  background: '#ecfdf5',
                                                                  padding: '1px 5px',
                                                                  borderRadius: '3px',
                                                                  border: '1px solid #a7f3d0',
                                                                  textDecoration: 'none',
                                                                  display: 'inline-flex',
                                                                  alignItems: 'center',
                                                                  gap: '2px',
                                                                }}
                                                                title={`Discovered on ${sourceUrl}`}
                                                              >
                                                                <span>📍 {cleanPath}</span>
                                                                <ExternalLink size={8} />
                                                              </a>
                                                            );
                                                          })()}
                                                          <button
                                                            type="button"
                                                            onClick={() => handleCopy(childPhones[0], `child_ph_${child.id}`)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                            title="Copy phone"
                                                          >
                                                            {copiedId === `child_ph_${child.id}` ? <Check size={11} color="#059669" /> : <Copy size={11} color="#94a3b8" />}
                                                          </button>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>

                                                {/* 4. Country */}
                                                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                  <span>{child.countryFlag || '🌐'}</span>
                                                  <span>{child.countryCode || 'INT'}</span>
                                                </div>


                                                {/* 6. Actions: Inspect Pages & Export Single Domain CSV */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                  <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    type="button"
                                                    onClick={() => exportSingleTargetToCSV(child)}
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '3px',
                                                      padding: '4px 8px',
                                                      borderRadius: '5px',
                                                      border: '1px solid #e2e8f0',
                                                      background: '#ffffff',
                                                      color: '#0369a1',
                                                      fontSize: '11px',
                                                      fontWeight: 600,
                                                      cursor: 'pointer',
                                                      transition: 'all 0.15s ease',
                                                    }}
                                                    title={`Download CSV for ${child.domain}`}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = '#e0f2fe'; e.currentTarget.style.borderColor = '#bae6fd'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
                                                  >
                                                    <Download size={10} />
                                                    <span>CSV</span>
                                                  </motion.button>

                                                  <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    type="button"
                                                    onClick={() => setExpandedChildPagesId(isPagesOpen ? null : child.id)}
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '4px',
                                                      padding: '4px 10px',
                                                      borderRadius: '5px',
                                                      border: '1px solid #e2e8f0',
                                                      background: isPagesOpen ? '#e0f2fe' : '#f8fafc',
                                                      color: isPagesOpen ? '#0369a1' : '#475569',
                                                      fontSize: '11px',
                                                      fontWeight: 600,
                                                      cursor: 'pointer',
                                                    }}
                                                  >
                                                    <FileText size={11} />
                                                    <span>{isPagesOpen ? 'Hide Pages' : `Pages (${childPages.length || child.pagesCrawled || 1})`}</span>
                                                    <ChevronDown size={10} style={{ transform: isPagesOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                                                  </motion.button>
                                                </div>
                                              </div>

                                              {/* Expandable Crawled Pages Accordion for this child domain */}
                                              {isPagesOpen && (
                                                <div
                                                  style={{
                                                    marginTop: '8px',
                                                    padding: '10px 12px',
                                                    background: '#f8fafc',
                                                    borderRadius: '6px',
                                                    border: '1px solid #e2e8f0',
                                                  }}
                                                >
                                                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                                                    Crawled Pages for {child.domain} ({childPages.length})
                                                  </div>
                                                  {childPages.length === 0 ? (
                                                    <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>
                                                      Direct apex page verified (https://{child.domain})
                                                    </div>
                                                  ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                      {childPages.map((pg, pIdx) => (
                                                        <div
                                                          key={pIdx}
                                                          style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            padding: '4px 8px',
                                                            background: '#ffffff',
                                                            borderRadius: '4px',
                                                            border: '1px solid #e2e8f0',
                                                            fontSize: '11px',
                                                          }}
                                                        >
                                                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <span
                                                              style={{
                                                                fontSize: '9.5px',
                                                                fontWeight: 700,
                                                                padding: '1px 5px',
                                                                borderRadius: '3px',
                                                                background: pg.statusCode && pg.statusCode >= 200 && pg.statusCode < 400 ? '#ecfdf5' : '#fee2e2',
                                                                color: pg.statusCode && pg.statusCode >= 200 && pg.statusCode < 400 ? '#047857' : '#b91c1c',
                                                              }}
                                                            >
                                                              {pg.statusCode || 200}
                                                            </span>
                                                            <span style={{ color: '#64748b', fontSize: '10.5px' }}>depth {pg.depth ?? 0}</span>
                                                            <a
                                                              href={pg.url}
                                                              target="_blank"
                                                              rel="noopener noreferrer"
                                                              style={{ color: '#0369a1', textDecoration: 'none', fontWeight: 600 }}
                                                            >
                                                              {pg.url}
                                                            </a>
                                                            {pg.title && <span style={{ color: '#94a3b8' }}>— {pg.title}</span>}
                                                          </div>
                                                          <button
                                                            type="button"
                                                            onClick={() => handleCopy(pg.url, `cp_pg_${child.id}_${pIdx}`)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                          >
                                                            {copiedId === `cp_pg_${child.id}_${pIdx}` ? <Check size={11} color="#059669" /> : <Copy size={11} color="#94a3b8" />}
                                                          </button>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </div>
                                )}

                                {/* Website Intelligence & Content Classification OR Offline Alert */}
                                {(currentTab === 'intel' || (currentTab === 'all' && !isTldRecord) || (isOffline && currentTab === 'pages')) && (
                                  isOffline ? (
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
                                      {r.errorTitle || (r.status === 'TIMED_OUT' ? 'Connection Timed Out' : r.status === 'DNS_ERROR' ? 'DNS Resolution Failed' : r.status === 'CONNECTION_REFUSED' ? 'Connection Refused' : r.status === 'SSL_ERROR' ? 'SSL Protocol Error' : "Target Host Unreachable")}
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
                                      {r.errorCode || r.status || 'UNREACHABLE'}
                                    </span>
                                  </div>
                                  <p style={{ fontSize: '12.5px', color: '#be123c', margin: '0 0 6px 0', lineHeight: 1.45 }}>
                                    {r.summary || (r.status === 'TIMED_OUT'
                                      ? 'Target website server took too long to respond (ERR_CONNECTION_TIMED_OUT). Server did not respond within timeout limits.'
                                      : r.status === 'DNS_ERROR'
                                      ? 'Domain name could not be resolved (ERR_NAME_NOT_RESOLVED). No valid DNS A/AAAA records found for host.'
                                      : r.status === 'CONNECTION_REFUSED'
                                      ? 'Connection was refused by target host (ERR_CONNECTION_REFUSED).'
                                      : 'Target website server is inaccessible. No live HTML content could be loaded.')}
                                  </p>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: '#881337', flexWrap: 'wrap' }}>
                                    <span>• Server Status: <strong>{r.errorTitle || r.status || 'Host Inaccessible'} {r.errorCode ? `(${r.errorCode})` : ''}</strong></span>
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
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
                                    <Phone size={12} color="#0284c7" />
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)' }}>Contact Phone:</span>
                                    {r.phones.map((phone, pIdx) => {
                                      const isPrimaryPhone = pIdx === 0;
                                      const phoneDetail = Array.isArray(r.scrapedPhones)
                                        ? r.scrapedPhones.find((p) => p.phone === phone)
                                        : undefined;
                                      const phoneSource = getEffectivePhoneSource(r, phoneDetail);
                                      const redirectUrl = buildPhoneRedirectUrl(phone, phoneSource, phoneDetail?.rawMatch, phoneDetail?.sectionId);

                                      return (
                                        <div key={phone} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                          <a
                                            href={redirectUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
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
                                              cursor: 'pointer',
                                              transition: 'all 0.15s ease',
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.textDecoration = 'underline';
                                              e.currentTarget.style.borderColor = isPrimaryPhone ? '#059669' : '#0284c7';
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.textDecoration = 'none';
                                              e.currentTarget.style.borderColor = isPrimaryPhone ? '#a7f3d0' : '#bae6fd';
                                            }}
                                            title={`Redirect to exact page & highlight location: ${phoneSource || phone}`}
                                          >
                                            <span>{phone}</span>
                                            <ExternalLink size={10} style={{ opacity: 0.7 }} />
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

                                          {phoneSource && (
                                            <a
                                              href={redirectUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title={`Scraped from page: ${phoneSource} (Click to open & highlight location)`}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '3px',
                                                fontSize: '10.5px',
                                                fontWeight: 500,
                                                color: '#0284c7',
                                                textDecoration: 'none',
                                                background: '#f0f9ff',
                                                border: '1px solid #bae6fd',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                transition: 'all 0.15s ease',
                                              }}
                                              onMouseEnter={(e) => {
                                                e.currentTarget.style.textDecoration = 'underline';
                                                e.currentTarget.style.background = '#e0f2fe';
                                              }}
                                              onMouseLeave={(e) => {
                                                e.currentTarget.style.textDecoration = 'none';
                                                e.currentTarget.style.background = '#f0f9ff';
                                              }}
                                            >
                                              <span>📍 {phoneSource.replace(/^https?:\/\/[^\/]+/, '').split('#')[0] || '/'}</span>
                                            </a>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {r.reconciliation && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px dashed #e2e8f0' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Reconciliation:</span>
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        background: r.reconciliation.domain_action === 'NEW' ? '#dcfce7' : r.reconciliation.domain_action === 'CHANGED' ? '#fef3c7' : '#f1f5f9',
                                        color: r.reconciliation.domain_action === 'NEW' ? '#15803d' : r.reconciliation.domain_action === 'CHANGED' ? '#b45309' : '#475569',
                                        border: `1px solid ${r.reconciliation.domain_action === 'NEW' ? '#86efac' : r.reconciliation.domain_action === 'CHANGED' ? '#fde68a' : '#cbd5e1'}`,
                                      }}
                                    >
                                      {r.reconciliation.domain_action === 'NEW' ? '✨ New Master Record' : r.reconciliation.domain_action === 'CHANGED' ? '🔄 Updated (Changed)' : '✓ Unchanged (Same)'}
                                    </span>
                                    {r.reconciliation.new_subdomains > 0 && (
                                      <span style={{ fontSize: '10px', color: '#047857', fontWeight: 600, background: '#ecfdf5', padding: '1px 5px', borderRadius: '3px' }}>
                                        +{r.reconciliation.new_subdomains} subdomains
                                      </span>
                                    )}
                                    {r.reconciliation.new_emails > 0 && (
                                      <span style={{ fontSize: '10px', color: '#047857', fontWeight: 600, background: '#ecfdf5', padding: '1px 5px', borderRadius: '3px' }}>
                                        +{r.reconciliation.new_emails} emails
                                      </span>
                                    )}
                                    {r.reconciliation.missing_subdomains > 0 && (
                                      <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600, background: '#fef3c7', padding: '1px 5px', borderRadius: '3px' }}>
                                        ⚠️ {r.reconciliation.missing_subdomains} missing (recheck)
                                      </span>
                                    )}
                                    {r.reconciliation.audit_changes_recorded > 0 && (
                                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                                        ({r.reconciliation.audit_changes_recorded} audit diffs logged)
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}

                            {/* Crawled Pages Section */}
                            {(currentTab === 'pages' || currentTab === 'all') && (
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
                                    ? `${r.errorTitle || 'Host server unreachable'}. 0 live pages could be fetched`
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
                                        {r.errorCode || (r.status === 'TIMED_OUT' ? 'ERR_CONNECTION_TIMED_OUT' : r.status === 'DNS_ERROR' ? 'ERR_NAME_NOT_RESOLVED' : r.status === 'CONNECTION_REFUSED' ? 'ERR_CONNECTION_REFUSED' : 'ERR_UNREACHABLE')}
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
                                        — {r.errorTitle || (r.status === 'TIMED_OUT' ? 'Connection Timed Out' : r.status === 'DNS_ERROR' ? 'DNS Resolution Failed' : r.status === 'CONNECTION_REFUSED' ? 'Connection Refused' : 'Target Host Inaccessible')} ({r.errorCode || r.status || '0 pages accessible'})
                                      </span>
                                    </div>
                                    <span style={{ fontSize: '11px', color: '#e11d48', fontWeight: 700 }}>
                                      {r.errorCode || 'Host Unreachable'}
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
                            )}

                            {/* Subdomains section */}
                            {(currentTab === 'subdomains' || currentTab === 'all') && (
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
                                  <SubdomainListExplorer
                                    subdomains={subdomains}
                                    domainName={r.domain}
                                    subdomainDetails={r.subdomainDetails}
                                  />
                                )}
                              </div>
                            )}

                            {/* Verified Contacts (Emails & Phone Numbers) */}
                            {(currentTab === 'contacts' || currentTab === 'all') && (
                              <>
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
                                                background: discoveryMethod === 'playwright_dom' ? '#f0fdfa' : discoveryMethod === 'cloudflare_decode' ? '#ecfeff' : discoveryMethod === 'mailto_link' ? '#eff6ff' : '#f1f5f9',
                                                color: discoveryMethod === 'playwright_dom' ? '#0f766e' : discoveryMethod === 'cloudflare_decode' ? '#0e7490' : discoveryMethod === 'mailto_link' ? '#1d4ed8' : '#475569',
                                                border: `1px solid ${discoveryMethod === 'playwright_dom' ? '#99f6e4' : discoveryMethod === 'cloudflare_decode' ? '#a5f3fc' : discoveryMethod === 'mailto_link' ? '#bfdbfe' : '#e2e8f0'}`,
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

                            {/* Verified Contact Phone Numbers section */}
                            {Array.isArray(r.phones) && r.phones.length > 0 && (
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                  <Phone size={14} color="#0284c7" />
                                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                                    Verified Contact Phone Numbers ({r.phones.length})
                                  </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {r.phones.map((phone, pIdx) => {
                                    const isPrimaryPhone = pIdx === 0;
                                    const phoneDetail = Array.isArray(r.scrapedPhones)
                                      ? r.scrapedPhones.find((p) => p.phone === phone)
                                      : undefined;
                                    const phoneSource = getEffectivePhoneSource(r, phoneDetail);
                                    const redirectUrl = buildPhoneRedirectUrl(phone, phoneSource, phoneDetail?.rawMatch, phoneDetail?.sectionId);

                                    return (
                                      <div
                                        key={phone}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          flexWrap: 'wrap',
                                          gap: '8px',
                                          padding: '8px 12px',
                                          borderRadius: '8px',
                                          background: isPrimaryPhone ? '#ecfdf5' : '#f8fafc',
                                          border: `1px solid ${isPrimaryPhone ? '#a7f3d0' : '#e2e8f0'}`,
                                        }}
                                      >
                                        {/* Left: Phone + Primary Badge + Direct Page Redirect Link */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                          <Phone size={14} color={isPrimaryPhone ? '#059669' : '#0284c7'} />
                                          <a
                                            href={redirectUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                              fontSize: '12.5px',
                                              fontWeight: 600,
                                              color: 'var(--text-main)',
                                              textDecoration: 'none',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              cursor: 'pointer',
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                                            title={`Redirect to exact page & highlight location: ${phoneSource || phone}`}
                                          >
                                            <span>{phone}</span>
                                            <ExternalLink size={12} color="#0284c7" />
                                          </a>

                                          {isPrimaryPhone && (
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
                                              Primary Phone
                                            </span>
                                          )}

                                          {/* Source Page & Location Redirect Pill */}
                                          {phoneSource && (
                                            <a
                                              href={redirectUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title={`Scraped from page: ${phoneSource} (Click to open & highlight location)`}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '11px',
                                                fontWeight: 500,
                                                color: '#0284c7',
                                                textDecoration: 'none',
                                                background: '#f0f9ff',
                                                border: '1px solid #bae6fd',
                                                padding: '3px 8px',
                                                borderRadius: '5px',
                                                transition: 'all 0.15s ease',
                                              }}
                                              onMouseEnter={(e) => {
                                                e.currentTarget.style.textDecoration = 'underline';
                                                e.currentTarget.style.background = '#e0f2fe';
                                              }}
                                              onMouseLeave={(e) => {
                                                e.currentTarget.style.textDecoration = 'none';
                                                e.currentTarget.style.background = '#f0f9ff';
                                              }}
                                            >
                                              <span>📍 {phoneSource.replace(/^https?:\/\/[^\/]+/, '').split('#')[0] || '/'}</span>
                                              <span style={{ fontSize: '9.5px', color: '#0369a1', fontWeight: 600 }}>(Go to Location ↗)</span>
                                            </a>
                                          )}
                                        </div>

                                        {/* Right: Actions (Call, Copy) */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <a
                                            href={`tel:${phone.replace(/\s+/g, '')}`}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              background: '#ffffff',
                                              border: '1px solid #cbd5e1',
                                              borderRadius: '5px',
                                              padding: '3px 8px',
                                              fontSize: '11px',
                                              fontWeight: 500,
                                              color: '#475569',
                                              textDecoration: 'none',
                                              transition: 'all 0.15s ease',
                                            }}
                                            title="Dial phone number"
                                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#94a3b8'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; }}
                                          >
                                            <PhoneCall size={12} color="#059669" />
                                            <span>Call</span>
                                          </a>

                                          <button
                                            type="button"
                                            onClick={() => handleCopy(phone, `${r.id}_ph_${phone}`)}
                                            title="Copy phone number"
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
                                              color: copiedId === `${r.id}_ph_${phone}` ? '#10b981' : '#475569',
                                              transition: 'all 0.15s ease',
                                            }}
                                          >
                                            {copiedId === `${r.id}_ph_${phone}` ? (
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
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {emails.length === 0 && (!r.phones || r.phones.length === 0) && (
                              <div
                                style={{
                                  padding: '16px',
                                  background: '#f8fafc',
                                  borderRadius: '8px',
                                  border: '1px dashed #cbd5e1',
                                  textAlign: 'center',
                                  color: '#64748b',
                                  fontSize: '12px',
                                }}
                              >
                                No public emails or phone numbers verified yet for {r.domain}.
                              </div>
                            )}
                          </>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </React.Fragment>
              );
              })}
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
      )}

      {/* Subdomain List Explorer Modal for Discovered Child Domain */}
      {activeChildSubdomainDomain && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setActiveChildSubdomainDomain(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              maxWidth: '920px',
              width: '100%',
              maxHeight: '88vh',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #cbd5e1',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Network size={16} color="#0284c7" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                    Discovered Subdomains for {activeChildSubdomainDomain.domain}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {activeChildSubdomainDomain.subdomains?.length || 0} verified subdomains found under this domain
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveChildSubdomainDomain(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: '#64748b',
                  borderRadius: '4px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
              <SubdomainListExplorer
                subdomains={activeChildSubdomainDomain.subdomains || []}
                domainName={activeChildSubdomainDomain.domain}
                subdomainDetails={activeChildSubdomainDomain.subdomainDetails}
              />
            </div>
          </motion.div>
        </div>
      )}
    </Card>
  );
};
