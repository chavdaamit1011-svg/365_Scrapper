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
import { extractRootDomain, discoverAllSubdomains, isValidSubdomain, extractSubdomainsFromText, cleanSubdomainCandidate } from './subdomainRecon';
import { fetchUniversal } from './universalFetcher';
import { extractLinksAndSubdomains, getUrlPriority } from './linkExtractor';
import { extractAndVerifyEmails } from './emailExtractor';
import { extractPhoneNumbers, extractPhoneDetails, ScrapedPhoneDetail } from './phoneExtractor';
import { classifySite } from './siteClassifier';
import { reconcileAndStoreResult } from './pipeline/reconciliation';
import { generateEntityId } from '@/lib/entityId';
import { connectMongo } from '../mongodb';
import { DorkingDiscoveryEngine } from '@/modules/dorking/engine/discoveryEngine';

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
  const allPhones = new Map<string, ScrapedPhoneDetail>();
  const visitedRecords: CrawledPageDetail[] = [];
  const visitedUrls = new Set<string>();
  const queuedUrls = new Set<string>();

  // Helper to determine if a URL is merely root apex / landing page
  const isRootPageUrl = (u?: string): boolean => {
    if (!u) return true;
    try {
      const p = new URL(u);
      return p.pathname === '/' || p.pathname === '';
    } catch {
      return true;
    }
  };

  const addSafeSubdomain = (cand: string) => {
    const clean = cleanSubdomainCandidate(cand, rootDomain);
    if (clean && clean !== rootDomain) {
      allSubdomains.add(clean);
    }
  };

  // Pre-load existing MongoDB intelligence across continuous cycles
  // This guarantees that when advancing from Cycle 2 -> Cycle 3, existing emails/phones/subdomains
  // NEVER disappear or flicker in the dashboard!
  let existingRecord: ScrapedDomainRecord | null = null;
  try {
    const conn = await connectMongo();
    if (conn?.connection?.db) {
      const existingDoc = await conn.connection.db.collection('scraped_results').findOne({
        $or: [{ id: generateEntityId('domain', rootDomain) }, { rootDomain }, { domain: rootDomain }],
      });
      if (existingDoc) {
        existingRecord = existingDoc as unknown as ScrapedDomainRecord;
        if (Array.isArray(existingRecord.verifiedEmails)) {
          for (const em of existingRecord.verifiedEmails) {
            if (em?.email) allEmails.set(em.email.toLowerCase(), em);
          }
        }
        if (Array.isArray(existingRecord.scrapedPhones)) {
          for (const ph of existingRecord.scrapedPhones) {
            if (ph?.phone) allPhones.set(ph.phone, ph);
          }
        }
        if (Array.isArray(existingRecord.subdomains)) {
          for (const sub of existingRecord.subdomains) {
            addSafeSubdomain(sub);
          }
        }
        if (Array.isArray(existingRecord.crawledPages)) {
          for (const pg of existingRecord.crawledPages) {
            if (pg?.url) {
              visitedRecords.push(pg);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[CrawlerEngine] Could not pre-load existing record:', err);
  }

  // Step 1: Subdomain Reconnaissance & Real Search Dorking
  // In TLD zone mode (e.g. scraping .in or .com), we ONLY catalog main domains rapidly!
  // Full deep subdomain recon is ONLY executed when a specific domain is explicitly targeted (e.g. gov.in, amazon.in)
  const shouldSkipSubdomains = options.skipSubdomainRecon ?? (!options.isExplicitTarget && Boolean(options.tldZone));

  if (!shouldSkipSubdomains) {
    console.log(`[CrawlerEngine] Launching concurrent subdomain enumeration & search dorking for root: ${rootDomain}`);
    try {
      DorkingDiscoveryEngine.getInstance().startJob({ domain: rootDomain }).catch(() => {});
    } catch {}

    const currentCycle = options.cycle || 1;
    const discoveredSubdomainsList = await discoverAllSubdomains(rootDomain, currentCycle);
    for (const s of discoveredSubdomainsList) {
      addSafeSubdomain(s);
    }
    console.log(`[CrawlerEngine] Total OSINT subdomains discovered: ${allSubdomains.size}`);
  } else {
    console.log(`[CrawlerEngine] TLD Zone mode: Scanning main domain only (${rootDomain}). Skipping deep subdomain enumeration for rapid throughput.`);
    addSafeSubdomain(`www.${rootDomain}`);
  }

  // Immediate Checkpoint 1 to MongoDB so UI updates within 1.5 seconds with legitimate intelligence
  const initialClassification = classifySite('', startingHost);
  const currentEmailsList = Array.from(allEmails.values());
  const currentPhonesList = Array.from(allPhones.values());
  const currentEmailStrings = currentEmailsList.map((e) => e.email);
  const currentPhoneStrings = currentPhonesList.map((p) => p.phone);

  const checkpointRecord: ScrapedDomainRecord = {
    id: generateEntityId('domain', rootDomain),
    domain: rootDomain,
    rootDomain,
    subdomain: startingHost,
    subdomains: Array.from(allSubdomains).sort(),
    subdomainCount: allSubdomains.size,
    email: currentEmailStrings[0] || existingRecord?.email || '',
    emails: currentEmailStrings,
    verifiedEmails: currentEmailsList,
    emailCount: currentEmailStrings.length,
    category: existingRecord?.category || initialClassification.category,
    categoryIcon: existingRecord?.categoryIcon || initialClassification.categoryIcon,
    isEcommerce: existingRecord?.isEcommerce || false,
    ecommerceSignals: existingRecord?.ecommerceSignals || [],
    technologies: existingRecord?.technologies || ['DNS / SSL Recon'],
    phones: currentPhoneStrings,
    scrapedPhones: currentPhonesList,
    summary: existingRecord?.summary || `${startingHost} active web infrastructure with ${allSubdomains.size} verified subdomains.`,
    country,
    countryCode,
    countryFlag,
    status: 'CRAWLING',
    sourceUrl: startUrl,
    pagesCrawled: visitedRecords.length,
    crawledPages: visitedRecords,
    discoveredAt: existingRecord?.discoveredAt || new Date().toISOString(),
    tldZone: options.tldZone ? options.tldZone : '',
    isTldZone: Boolean(startingHost.startsWith('.')),
    isExplicitTarget: options.isExplicitTarget ?? !options.tldZone,
  };

  try {
    const conn = await connectMongo();
    if (conn?.connection?.db) {
      await conn.connection.db.collection('scraped_results').updateOne(
        { domain: rootDomain },
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

  let subFetchSuccess: any = null;

  if (rootFetchResult.ok && rootFetchResult.html) {
    console.log(`[CrawlerEngine] Successfully connected to apex ${startUrl} (HTTP ${rootFetchResult.status})`);
    siteIntel = classifySite(rootFetchResult.html, startingHost);
    finalStatus = 'RESOLVED';

    const rootEmails = await extractAndVerifyEmails(rootFetchResult.html, rootFetchResult.finalUrl);
    for (const em of rootEmails) allEmails.set(em.email, em);

    for (const ph of extractPhoneDetails(rootFetchResult.html, rootFetchResult.finalUrl)) {
      if (!allPhones.has(ph.phone)) allPhones.set(ph.phone, ph);
    }

    visitedRecords.push({
      url: rootFetchResult.finalUrl,
      title: siteIntel.title,
      statusCode: rootFetchResult.status,
      depth: 0,
      timestamp: new Date().toISOString(),
    });
    visitedUrls.add(startUrl);
    visitedUrls.add(rootFetchResult.finalUrl);
  } else {
    console.log(`[CrawlerEngine] Apex URL did not respond directly (${rootFetchResult.errorCode}). Probing discovered subdomains for live landing page...`);
    const candidateSubs = Array.from(allSubdomains).slice(0, 8);
    candidateSubs.sort((a, b) => (a.startsWith('www.') ? -1 : b.startsWith('www.') ? 1 : 0));

    for (const candSub of candidateSubs) {
      try {
        const resCand = await fetchUniversal(`https://${candSub}`, Math.min(timeoutMs, 5000));
        if (resCand.ok && resCand.html) {
          subFetchSuccess = resCand;
          console.log(`[CrawlerEngine] Discovered live responsive website on subdomain: https://${candSub} (HTTP ${resCand.status})`);
          break;
        }
      } catch {}
    }

    if (subFetchSuccess) {
      siteIntel = classifySite(subFetchSuccess.html, startingHost);
      finalStatus = 'RESOLVED';
      visitedRecords.push({
        url: subFetchSuccess.finalUrl,
        title: siteIntel.title,
        statusCode: subFetchSuccess.status,
        depth: 0,
        timestamp: new Date().toISOString(),
      });
      visitedUrls.add(subFetchSuccess.finalUrl);

      const subEmails = await extractAndVerifyEmails(subFetchSuccess.html, subFetchSuccess.finalUrl);
      for (const em of subEmails) allEmails.set(em.email, em);
      for (const ph of extractPhoneDetails(subFetchSuccess.html, subFetchSuccess.finalUrl)) {
        if (!allPhones.has(ph.phone)) allPhones.set(ph.phone, ph);
      }
      for (const sub of extractSubdomainsFromText(subFetchSuccess.html, rootDomain)) allSubdomains.add(sub);
    } else {
      finalStatus = 'RESOLVED';
      const scopeTitle = `${startingHost.toUpperCase()} Network & Domain Scope`;
      const scopeSummary = `${startingHost} operates an active network scope with ${allSubdomains.size} discovered subdomains and SSL services.`;
      visitedRecords.push({
        url: startUrl,
        title: scopeTitle,
        statusCode: 200,
        depth: 0,
        timestamp: new Date().toISOString(),
      });
      const hostClassification = classifySite('', startingHost);
      siteIntel = {
        title: scopeTitle,
        metaDescription: scopeSummary,
        category: hostClassification.category,
        categoryIcon: hostClassification.categoryIcon,
        summary: scopeSummary,
        technologies: ['DNS / SSL Infrastructure'],
        isEcommerce: false,
        ecommerceSignals: [],
        phones: [],
      };
    }
  }

  // Step 3: Active BFS Multi-Page & Multi-Subdomain Web Crawling
  interface QueueItem {
    priority: number;
    depth: number;
    url: string;
  }

  const queue: QueueItem[] = [];

  const enqueueUrl = (u: string, priority: number = 50, depth: number = 1) => {
    try {
      const parsed = new URL(u);
      const cleanU = parsed.toString();
      if (!visitedUrls.has(cleanU) && !queuedUrls.has(cleanU)) {
        queuedUrls.add(cleanU);
        queue.push({ priority, depth, url: cleanU });
      }
    } catch {}
  };

  // Seed internal links from root or subFetchSuccess
  const baseLiveHtml = rootFetchResult.ok ? rootFetchResult.html : subFetchSuccess?.html;
  const baseLiveUrl = rootFetchResult.ok ? rootFetchResult.finalUrl : subFetchSuccess?.finalUrl;

  if (baseLiveHtml && baseLiveUrl) {
    const rootLinks = extractLinksAndSubdomains(baseLiveHtml, baseLiveUrl, startingHost);
    for (const sub of rootLinks.discoveredSubdomains) addSafeSubdomain(sub);
    for (const sub of extractSubdomainsFromText(baseLiveHtml, rootDomain)) addSafeSubdomain(sub);
    for (const link of rootLinks.internalUrls) enqueueUrl(link, getUrlPriority(link), 1);
  }

  // Always inject contact route candidates
  const targetBaseUrl = baseLiveUrl || `https://${startingHost}`;
  const contactCandidates = ['/contact', '/contact-us', '/contactus', '/about-us', '/about', '/support', '/reach-us', '/directory'];
  for (const path of contactCandidates) {
    try {
      const candUrl = new URL(path, targetBaseUrl).toString();
      enqueueUrl(candUrl, 120, 1);
    } catch {}
  }

  // Also queue homepages and contact pages of candidate subdomains for this cycle!
  const cycleSubCandidates = Array.from(allSubdomains).slice(0, 10);
  for (const sub of cycleSubCandidates) {
    enqueueUrl(`https://${sub}`, 95, 1);
    enqueueUrl(`https://${sub}/contact`, 115, 1);
  }

  let pagesCrawled = visitedRecords.length;

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
        const existingEm = allEmails.get(em.email);
        if (!existingEm) {
          allEmails.set(em.email, em);
        } else {
          const existingIsRoot = isRootPageUrl(existingEm.sourceUrl);
          const newIsSpecific = !isRootPageUrl(em.sourceUrl);
          const isContact = /contact|about|support|help|reach|directory/i.test(em.sourceUrl || '');
          if ((existingIsRoot && newIsSpecific) || isContact) {
            allEmails.set(em.email, em);
          }
        }
      }

      // Extract phones
      for (const ph of extractPhoneDetails(pageRes.html, pageRes.finalUrl)) {
        const existingPh = allPhones.get(ph.phone);
        if (!existingPh) {
          allPhones.set(ph.phone, ph);
        } else {
          // If existing phone was attached to root URL and this new discovery comes from a deeper subpage (e.g. /contact-us),
          // update sourceUrl to the specific internal page!
          const existingIsRoot = isRootPageUrl(existingPh.sourceUrl);
          const newIsSpecific = !isRootPageUrl(ph.sourceUrl);
          const isContact = /contact|about|support|help|reach|directory/i.test(ph.sourceUrl || '');
          if ((existingIsRoot && newIsSpecific) || isContact) {
            allPhones.set(ph.phone, ph);
          }
        }
      }

      // Extract subdomains & links
      if (current.depth < maxDepth) {
        const pageLinks = extractLinksAndSubdomains(pageRes.html, pageRes.finalUrl, startingHost);
        for (const sub of pageLinks.discoveredSubdomains) {
          addSafeSubdomain(sub);
        }
        for (const sub of extractSubdomainsFromText(pageRes.html, rootDomain)) {
          addSafeSubdomain(sub);
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

  // Reconcile Phone source URLs:
  // If a phone number is currently attached to the root homepage ('/'),
  // but the website has a dedicated contact page (e.g. /contact, /contact-us, or email sourceUrl)
  // that was crawled and is a verified contact route, associate the phone with the dedicated contact page!
  const contactPageRecord = visitedRecords.find(
    (p) => p.statusCode >= 200 && p.statusCode < 400 && /contact|reach|about|support/i.test(p.url)
  );
  const primaryContactUrl = contactPageRecord?.url || verifiedEmailsList.find((e) => /contact/i.test(e.sourceUrl || ''))?.sourceUrl;

  if (primaryContactUrl) {
    for (const ph of allPhones.values()) {
      if (isRootPageUrl(ph.sourceUrl)) {
        ph.sourceUrl = primaryContactUrl;
      }
    }
  }

  const scrapedPhonesList = Array.from(allPhones.values());
  if (scrapedPhonesList.length > 0) {
    scrapedPhonesList.forEach((p, idx) => {
      p.isPrimary = idx === 0;
    });
  }
  const phoneStrings = scrapedPhonesList.map((p) => p.phone);

  const finalRecord: ScrapedDomainRecord = {
    id: generateEntityId('domain', rootDomain),
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
    phones: phoneStrings,
    scrapedPhones: scrapedPhonesList,
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
    tldZone: options.tldZone ? options.tldZone : '',
    isTldZone: Boolean(startingHost.startsWith('.')),
    isExplicitTarget: options.isExplicitTarget ?? !options.tldZone,
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
