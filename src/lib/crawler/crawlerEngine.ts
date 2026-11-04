/**
 * Native Next.js / TypeScript Crawler Engine Orchestrator
 * High-performance, asynchronous web crawler and multi-level subdomain intelligence extractor.
 */

import { URL } from 'url';
import {
  CrawlOptions,
  ScrapedDomainRecord,
  CrawledPageDetail,
  VerifiedEmailDetail,
} from './types';
import { extractRootDomain, discoverAllSubdomains, isValidSubdomain } from './subdomainRecon';
import { fetchUniversal } from './universalFetcher';
import { extractLinksAndSubdomains, getUrlPriority } from './linkExtractor';
import { extractAndVerifyEmails } from './emailExtractor';
import { extractPhoneNumbers } from './phoneExtractor';
import { classifySite } from './siteClassifier';
import { reconcileAndStoreResult } from './pipeline/reconciliation';
import { connectMongo } from '../mongodb';

/**
 * Detects country name, ISO code, and emoji flag based on hostname
 */
export function detectCountry(hostname: string): { country: string; countryCode: string; countryFlag: string } {
  const host = hostname.toLowerCase();

  if (host.endsWith('.in') || host.endsWith('.gov.in') || host.endsWith('.nic.in')) {
    return { country: 'India', countryCode: 'IN', countryFlag: '🇮🇳' };
  }
  if (host.endsWith('.uk') || host.endsWith('.co.uk')) {
    return { country: 'United Kingdom', countryCode: 'GB', countryFlag: '🇬🇧' };
  }
  if (host.endsWith('.ca')) {
    return { country: 'Canada', countryCode: 'CA', countryFlag: '🇨🇦' };
  }
  if (host.endsWith('.au') || host.endsWith('.com.au')) {
    return { country: 'Australia', countryCode: 'AU', countryFlag: '🇦🇺' };
  }
  if (host.endsWith('.de')) {
    return { country: 'Germany', countryCode: 'DE', countryFlag: '🇩🇪' };
  }
  if (host.endsWith('.fr')) {
    return { country: 'France', countryCode: 'FR', countryFlag: '🇫🇷' };
  }
  if (host.endsWith('.jp') || host.endsWith('.co.jp')) {
    return { country: 'Japan', countryCode: 'JP', countryFlag: '🇯🇵' };
  }
  if (host.endsWith('.us')) {
    return { country: 'United States', countryCode: 'US', countryFlag: '🇺🇸' };
  }

  return { country: 'Global', countryCode: 'INT', countryFlag: '🌐' };
}

/**
 * Main crawl execution function
 */
export async function crawlDomain(
  target: string,
  options: CrawlOptions = {}
): Promise<ScrapedDomainRecord> {
  const maxPages = options.maxPages || 5;
  const maxDepth = options.maxDepth || 2;
  const timeoutMs = options.timeoutMs || 10000;
  const delayMs = options.delayMs || 300;

  // 1. Normalize target URL and calculate domain scopes
  let rawUrl = target.trim();
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    rawUrl = `https://${rawUrl}`;
  }

  let startUrl = rawUrl;
  let startingHost = '';
  try {
    startingHost = new URL(startUrl).hostname.toLowerCase();
  } catch {
    startingHost = rawUrl.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
    startUrl = `https://${startingHost}`;
  }

  const rootDomain = extractRootDomain(startingHost);
  const { country, countryCode, countryFlag } = detectCountry(startingHost);

  console.log(`[CrawlerEngine] Starting native TS crawl for: ${startUrl} (Host: ${startingHost}, Root: ${rootDomain})`);

  const allSubdomains = new Set<string>();
  const allEmails = new Map<string, VerifiedEmailDetail>();
  const allPhones = new Set<string>();
  const visitedRecords: CrawledPageDetail[] = [];
  const visitedUrls = new Set<string>();
  const queuedUrls = new Set<string>();

  // Step 1: Multi-Source Subdomain Reconnaissance (crt.sh, urlscan, archive.org, DNS dictionary)
  console.log(`[CrawlerEngine] Launching concurrent subdomain enumeration for root: ${rootDomain}`);
  const discoveredSubdomainsList = await discoverAllSubdomains(rootDomain);
  for (const s of discoveredSubdomainsList) {
    allSubdomains.add(s);
  }
  console.log(`[CrawlerEngine] Total OSINT subdomains discovered: ${allSubdomains.size}`);

  // Immediate Checkpoint 1 to MongoDB so UI updates within 1.5 seconds
  const checkpointRecord: ScrapedDomainRecord = {
    id: `domain_${rootDomain}`,
    domain: rootDomain,
    rootDomain,
    subdomain: startingHost,
    subdomains: Array.from(allSubdomains).sort(),
    subdomainCount: allSubdomains.size,
    email: '',
    emails: [],
    verifiedEmails: [],
    emailCount: 0,
    category: 'Discovering Domain Intelligence...',
    categoryIcon: '🔍',
    isEcommerce: false,
    ecommerceSignals: [],
    technologies: [],
    phones: [],
    summary: 'Analyzing domain scope, SSL certificates and discovered subdomains...',
    country,
    countryCode,
    countryFlag,
    status: 'CRAWLING',
    sourceUrl: startUrl,
    pagesCrawled: 0,
    crawledPages: [],
    discoveredAt: new Date().toISOString(),
  };

  try {
    const conn = await connectMongo();
    if (conn?.connection?.db) {
      await conn.connection.db.collection('scraped_results').updateOne(
        { id: checkpointRecord.id },
        { $set: checkpointRecord, $setOnInsert: { createdAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
  } catch (e) {
    // Non-blocking
  }

  if (options.onProgress) {
    options.onProgress(0, allSubdomains.size, 0);
  }

  // Step 2: Test accessibility & fetch root landing page
  console.log(`[CrawlerEngine] Testing connectivity on ${startUrl}...`);
  const rootFetchResult = await fetchUniversal(startUrl, timeoutMs);

  let finalStatus = 'RESOLVED';
  let errorCode: string | null = null;
  let errorTitle: string | null = null;
  let siteIntel = classifySite('', startingHost);

  if (!rootFetchResult.ok) {
    if (allSubdomains.size > 0) {
      // Apex host has no web server (e.g. gov.in, registry scope), BUT active subdomains were verified!
      console.log(`[CrawlerEngine] Apex has no web server (${rootFetchResult.errorCode}), but discovered ${allSubdomains.size} active subdomains! Classifying as DOMAIN_SCOPE.`);
      finalStatus = 'RESOLVED';
      errorCode = null;
      errorTitle = null;

      const scopeTitle = `${startingHost.toUpperCase()} Public Domain Scope`;
      const scopeSummary = `Apex host has no direct web server, but ${allSubdomains.size} live subdomains were discovered and mapped in this scope.`;

      visitedRecords.push({
        url: startUrl,
        title: scopeTitle,
        statusCode: 200,
        depth: 0,
        timestamp: new Date().toISOString(),
      });

      siteIntel = {
        title: scopeTitle,
        metaDescription: scopeSummary,
        category: 'Public Domain Scope',
        categoryIcon: '🏛️',
        summary: scopeSummary,
        technologies: ['DNS Subdomain Registry'],
        isEcommerce: false,
        ecommerceSignals: [],
        phones: [],
      };
    } else {
      // Site is truly offline or unreachable on root URL with 0 subdomains
      console.log(`[CrawlerEngine] Root URL unreachable (${rootFetchResult.errorCode}): ${rootFetchResult.error}`);

      finalStatus = rootFetchResult.errorCode === 'ERR_NAME_NOT_RESOLVED' ? 'DNS_ERROR' : 'TIMED_OUT';
      errorCode = rootFetchResult.errorCode || 'ERR_CONNECTION_TIMED_OUT';
      errorTitle = rootFetchResult.errorTitle || 'Connection Timed Out';

      const errorSummary = `Target website server took too long to respond (${errorCode}). Server did not respond within timeout limits.`;

      visitedRecords.push({
        url: startUrl,
        title: errorTitle,
        statusCode: rootFetchResult.status || 504,
        depth: 0,
        errorCode,
        timestamp: new Date().toISOString(),
      });

      siteIntel = {
        title: errorTitle,
        metaDescription: '',
        category: errorTitle,
        categoryIcon: '⚠️',
        summary: errorSummary,
        technologies: [],
        isEcommerce: false,
        ecommerceSignals: [],
        phones: [],
      };
    }
  } else {
    // Root URL is live! Extract metadata & crawl pages
    console.log(`[CrawlerEngine] Successfully connected to ${startUrl} (HTTP ${rootFetchResult.status})`);

    siteIntel = classifySite(rootFetchResult.html, startingHost);

    // Extract emails from root page
    const rootEmails = await extractAndVerifyEmails(rootFetchResult.html, rootFetchResult.finalUrl);
    for (const em of rootEmails) {
      allEmails.set(em.email, em);
    }

    // Extract phones from root page
    for (const ph of extractPhoneNumbers(rootFetchResult.html)) {
      allPhones.add(ph);
    }

    // Record root page
    visitedRecords.push({
      url: rootFetchResult.finalUrl,
      title: siteIntel.title,
      statusCode: rootFetchResult.status,
      depth: 0,
      timestamp: new Date().toISOString(),
    });
    visitedUrls.add(startUrl);
    visitedUrls.add(rootFetchResult.finalUrl);

    // Queue BFS crawl
    interface QueueItem {
      priority: number;
      depth: number;
      url: string;
    }

    const queue: QueueItem[] = [];

    // Extract initial links
    const rootLinks = extractLinksAndSubdomains(rootFetchResult.html, rootFetchResult.finalUrl, startingHost);
    for (const sub of rootLinks.discoveredSubdomains) {
      allSubdomains.add(sub);
    }

    for (const link of rootLinks.internalUrls) {
      if (!visitedUrls.has(link) && !queuedUrls.has(link)) {
        queuedUrls.add(link);
        queue.push({ priority: getUrlPriority(link), depth: 1, url: link });
      }
    }

    // Proactive contact candidate injection if no contact links were in internalUrls
    const hasContact = rootLinks.internalUrls.some((l) => /contact|about|support/i.test(l));
    if (!hasContact) {
      const candidates = ['/contact', '/contact-us', '/about-us', '/support'];
      for (const path of candidates) {
        try {
          const candUrl = new URL(path, startUrl).toString();
          if (!visitedUrls.has(candUrl) && !queuedUrls.has(candUrl)) {
            queuedUrls.add(candUrl);
            queue.push({ priority: 90, depth: 1, url: candUrl });
          }
        } catch {}
      }
    }

    let pagesCrawled = 1;

    while (queue.length > 0 && pagesCrawled < maxPages) {
      // Sort queue by priority descending
      queue.sort((a, b) => b.priority - a.priority);
      const current = queue.shift()!;

      if (visitedUrls.has(current.url)) continue;
      visitedUrls.add(current.url);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      console.log(`[CrawlerEngine] Crawling page [${pagesCrawled + 1}/${maxPages}]: ${current.url}`);
      const pageRes = await fetchUniversal(current.url, timeoutMs);

      if (!pageRes.ok || !pageRes.html) {
        visitedRecords.push({
          url: current.url,
          title: pageRes.errorTitle || 'Page Inaccessible',
          statusCode: pageRes.status,
          depth: current.depth,
          errorCode: pageRes.errorCode,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      pagesCrawled++;
      const pageIntel = classifySite(pageRes.html, startingHost);

      visitedRecords.push({
        url: pageRes.finalUrl,
        title: pageIntel.title,
        statusCode: pageRes.status,
        depth: current.depth,
        timestamp: new Date().toISOString(),
      });

      // Extract emails
      const pageEmails = await extractAndVerifyEmails(pageRes.html, pageRes.finalUrl);
      for (const em of pageEmails) {
        if (!allEmails.has(em.email)) {
          allEmails.set(em.email, em);
        }
      }

      // Extract phones
      for (const ph of extractPhoneNumbers(pageRes.html)) {
        allPhones.add(ph);
      }

      // Extract subdomains & links
      if (current.depth < maxDepth) {
        const pageLinks = extractLinksAndSubdomains(pageRes.html, pageRes.finalUrl, startingHost);
        for (const sub of pageLinks.discoveredSubdomains) {
          allSubdomains.add(sub);
        }

        for (const nextLink of pageLinks.internalUrls) {
          if (!visitedUrls.has(nextLink) && !queuedUrls.has(nextLink)) {
            queuedUrls.add(nextLink);
            queue.push({ priority: getUrlPriority(nextLink), depth: current.depth + 1, url: nextLink });
          }
        }
      }

      if (options.onProgress) {
        options.onProgress(pagesCrawled, allSubdomains.size, allEmails.size);
      }
    }
  }

  // Rank verified emails and mark primary
  const verifiedEmailsList = Array.from(allEmails.values()).sort(
    (a, b) => b.priorityScore - a.priorityScore || a.email.localeCompare(b.email)
  );
  if (verifiedEmailsList.length > 0) {
    verifiedEmailsList.forEach((e, idx) => {
      e.isPrimary = idx === 0;
    });
  }

  const sortedSubdomains = Array.from(allSubdomains).sort();
  const rankedEmailStrings = verifiedEmailsList.map((e) => e.email);

  const finalRecord: ScrapedDomainRecord = {
    id: `domain_${rootDomain}`,
    domain: rootDomain,
    rootDomain,
    subdomain: startingHost,
    subdomains: sortedSubdomains,
    subdomainCount: sortedSubdomains.length,
    email: rankedEmailStrings[0] || '',
    emails: rankedEmailStrings,
    verifiedEmails: verifiedEmailsList,
    emailCount: rankedEmailStrings.length,
    category: siteIntel.category,
    categoryIcon: siteIntel.categoryIcon,
    isEcommerce: siteIntel.isEcommerce,
    ecommerceSignals: siteIntel.ecommerceSignals,
    technologies: siteIntel.technologies,
    phones: Array.from(allPhones),
    summary: siteIntel.summary,
    country,
    countryCode,
    countryFlag,
    status: finalStatus,
    errorCode,
    errorTitle,
    sourceUrl: startUrl,
    pagesCrawled: visitedRecords.filter((p) => p.statusCode >= 200 && p.statusCode < 400).length,
    crawledPages: visitedRecords,
    discoveredAt: new Date().toISOString(),
  };

  // Step 3: Phase 2 Reconciliation & Master Storage (UPSERT to MongoDB)
  console.log(`[CrawlerEngine] Reconciling and storing final results into MongoDB master collections...`);
  const reconciliationStats = await reconcileAndStoreResult(finalRecord);
  finalRecord.reconciliation = reconciliationStats;

  console.log(
    `[CrawlerEngine] Crawl completed for ${rootDomain}: ${finalRecord.subdomainCount} subdomains, ${finalRecord.emailCount} emails, status=${finalStatus}`
  );

  return finalRecord;
}
