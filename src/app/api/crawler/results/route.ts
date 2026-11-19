import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { connectMongo, MongoScrapedResultModel } from '@/lib/mongodb';
import { redisQueue } from '@/lib/redisQueue';
import { DorkingPersistenceService } from '@/modules/dorking/services/persistence';
import { DorkingDiscoveryEngine } from '@/modules/dorking/engine/discoveryEngine';
import { getSharedBloomFilter } from '@/lib/crawler/bloomFilter';
import { classifySite } from '@/lib/crawler/siteClassifier';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const mongoose = await connectMongo();
    if (!mongoose || mongoose.connection.readyState !== 1) {
      return NextResponse.json(
        { success: false, message: 'MongoDB service not connected', count: 0, data: [] },
        { status: 503 }
      );
    }

    // Query all records directly from MongoDB the_scraper.scraped_results
    const rawDocs = await MongoScrapedResultModel.find({})
      .sort({ updatedAt: -1, _id: -1 })
      .limit(1000)
      .lean();

    // Auto-consolidate any *.gov.in and *.nic.in child departments under their root umbrella (gov.in / nic.in)
    // Only real discovered subdomains are retained - strictly no hardcoded mock injections
    const govSubsToMerge: string[] = [];
    const nicSubsToMerge: string[] = [];
    const orphanGovIdsToDelete: any[] = [];

    for (const d of rawDocs) {
      const dom = (d.domain || '').toLowerCase().trim();
      const isExplicit = Boolean(d.isExplicitTarget);
      if (!isExplicit) {
        if (dom !== 'gov.in' && dom.endsWith('.gov.in')) {
          orphanGovIdsToDelete.push(d._id);
          govSubsToMerge.push(dom);
          if (Array.isArray(d.subdomains)) {
            for (const s of d.subdomains) if (typeof s === 'string' && s) govSubsToMerge.push(s);
          }
        } else if (dom !== 'nic.in' && dom.endsWith('.nic.in')) {
          orphanGovIdsToDelete.push(d._id);
          nicSubsToMerge.push(dom);
          if (Array.isArray(d.subdomains)) {
            for (const s of d.subdomains) if (typeof s === 'string' && s) nicSubsToMerge.push(s);
          }
        }
      }
    }

    if (orphanGovIdsToDelete.length > 0) {
      MongoScrapedResultModel.deleteMany({ _id: { $in: orphanGovIdsToDelete } }).catch(() => {});
    }

    const orphanIdSet = new Set(orphanGovIdsToDelete.map((id) => String(id)));
    let docs = rawDocs.filter((d: any) => !orphanIdSet.has(String(d._id)));

    // Guarantee strictly single authoritative instance for gov.in and nic.in
    const seenDominant = new Set<string>();
    docs = docs.filter((d: any) => {
      const dom = (d.domain || '').toLowerCase().trim();
      if (dom === 'gov.in' || dom === 'nic.in') {
        if (seenDominant.has(dom)) return false;
        seenDominant.add(dom);
      }
      return true;
    });

    // If gov.in document exists in DB, ensure any discovered government subdomains are merged into it
    let govDoc = docs.find((d: any) => d.domain === 'gov.in');
    const uniqueGovSubs = Array.from(new Set(govSubsToMerge)).filter(Boolean);
    if (govDoc && uniqueGovSubs.length > 0) {
      const merged = Array.from(new Set([...(govDoc.subdomains || []), ...uniqueGovSubs])).filter(Boolean);
      govDoc.subdomains = merged;
      govDoc.subdomainCount = merged.length;
      MongoScrapedResultModel.updateOne(
        { _id: govDoc._id },
        { $addToSet: { subdomains: { $each: uniqueGovSubs } }, $set: { subdomainCount: merged.length } }
      ).catch(() => {});
    }

    // If nic.in document exists in DB, ensure any discovered nic subdomains are merged into it
    let nicDoc = docs.find((d: any) => d.domain === 'nic.in');
    const uniqueNicSubs = Array.from(new Set(nicSubsToMerge)).filter(Boolean);
    if (nicDoc && uniqueNicSubs.length > 0) {
      const merged = Array.from(new Set([...(nicDoc.subdomains || []), ...uniqueNicSubs])).filter(Boolean);
      nicDoc.subdomains = merged;
      nicDoc.subdomainCount = merged.length;
      MongoScrapedResultModel.updateOne(
        { _id: nicDoc._id },
        { $addToSet: { subdomains: { $each: uniqueNicSubs } }, $set: { subdomainCount: merged.length } }
      ).catch(() => {});
    }

    const results = docs.map((d: any) => {
      const rawSubs = Array.isArray(d.subdomains) ? d.subdomains : (d.subdomain ? [d.subdomain] : []);
      const subs = Array.from(
        new Set(
          rawSubs
            .map((s: string) => {
              if (!s || typeof s !== 'string') return '';
              let c = s.trim().toLowerCase();
              try {
                c = decodeURIComponent(c);
              } catch {}
              c = c.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].split('?')[0];
              c = c.replace(/^(?:2f|252f|3a|253a|25|%2f|%3a)+/i, '');
              return c;
            })
            .filter((s: string) => s && s.length > 0 && !s.startsWith('.') && s !== d.domain)
        )
      ).sort();
      const subCount = subs.length;
      let status = d.status || 'RESOLVED';

      // Auto-heal orphaned 'CRAWLING' records if subdomains were already discovered
      if (status === 'CRAWLING' && subCount > 0) {
        const docTime = new Date(d.updatedAt || d.createdAt || 0).getTime();
        const now = Date.now();
        if (now - docTime > 30000) {
          status = 'RESOLVED';
        }
      }

      const hasDiscoveredScope = subCount > 0;
      const isOfflineStatus = ['OFFLINE', 'UNREACHABLE', 'TIMED_OUT', 'DNS_ERROR', 'CONNECTION_REFUSED', 'SSL_ERROR'].includes(status);

      const isPlaceholderSummary =
        !d.summary ||
        d.summary.includes('Analyzing domain scope') ||
        d.summary.includes('No live HTML content could be loaded');

      const cleanSummary = !isPlaceholderSummary
        ? d.summary
        : (isOfflineStatus
          ? (d.errorTitle ? `${d.errorTitle} (${d.errorCode || status}). Server did not respond.` : 'Site Inaccessible. Server did not respond within timeout limits.')
          : (hasDiscoveredScope
            ? `${d.domain} operates an active web presence with ${subCount} discovered subdomains and network infrastructure.`
            : `${d.domain} corporate web services and domain operations.`));

      const fallbackIntel = classifySite('', d.domain || d.rootDomain || d.subdomain || '');
      const cleanCategory =
        d.category &&
        d.category !== 'Site Inaccessible' &&
        d.category !== 'Discovering Domain Intelligence...' &&
        d.category !== 'Public Domain Scope'
          ? d.category
          : (isOfflineStatus ? (d.errorTitle || 'Site Inaccessible') : fallbackIntel.category);

      const cleanCategoryIcon =
        d.categoryIcon &&
        d.categoryIcon !== '⚠️' &&
        d.categoryIcon !== '🔍' &&
        d.category !== 'Public Domain Scope'
          ? d.categoryIcon
          : (isOfflineStatus ? '⚠️' : fallbackIntel.categoryIcon);

      // Identify if this domain was explicitly targeted as its own standalone scrape
      const isExplicitTarget = Boolean(d.isExplicitTarget);

      // If not explicitly targeted, associate with its origin TLD zone (.com, .in, etc.)
      let effectiveTldZone = '';
      if (!isExplicitTarget) {
        if (d.tldZone) {
          effectiveTldZone = d.tldZone;
        } else if (d.domain && d.domain.startsWith('.')) {
          effectiveTldZone = d.domain;
        } else if (d.domain && d.domain.endsWith('.com')) {
          effectiveTldZone = '.com';
        } else if (d.domain && d.domain.endsWith('.in')) {
          effectiveTldZone = '.in';
        } else if (d.domain && d.domain.includes('.')) {
          const parts = d.domain.toLowerCase().split('.');
          effectiveTldZone = `.${parts[parts.length - 1]}`;
        }
      }

      return {
        id: d.id || String(d._id),
        domain: d.domain || '',
        rootDomain: d.rootDomain || d.domain || '',
        subdomain: d.subdomain || d.domain || '',
        subdomains: subs,
        subdomainCount: subCount,
        email: d.email || (Array.isArray(d.emails) && d.emails[0]) || '',
        emails: Array.isArray(d.emails) ? d.emails : (d.email ? [d.email] : []),
        verifiedEmails: Array.isArray(d.verifiedEmails) ? d.verifiedEmails : [],
        emailCount: typeof d.emailCount === 'number' ? d.emailCount : (Array.isArray(d.emails) ? d.emails.length : 0),
        category: cleanCategory,
        categoryIcon: cleanCategoryIcon,
        isEcommerce: Boolean(d.isEcommerce),
        ecommerceSignals: Array.isArray(d.ecommerceSignals) ? d.ecommerceSignals : [],
        technologies: Array.isArray(d.technologies) ? d.technologies : [],
        phones: Array.isArray(d.phones) ? d.phones : [],
        scrapedPhones: Array.isArray(d.scrapedPhones) && d.scrapedPhones.length > 0
          ? d.scrapedPhones
          : (Array.isArray(d.phones)
            ? d.phones.map((p: string, idx: number) => ({
                phone: p,
                sourceUrl: d.sourceUrl || (d.crawledPages && d.crawledPages[0]?.url) || '',
                rawMatch: p,
                isPrimary: idx === 0,
              }))
            : []),
        summary: cleanSummary,
        crawledPages: Array.isArray(d.crawledPages) ? d.crawledPages : [],
        country: d.country || 'Detected',
        countryCode: d.countryCode || 'INT',
        countryFlag: d.countryFlag || '🌐',
        status,
        sourceUrl: d.sourceUrl || '',
        pagesCrawled: d.pagesCrawled && d.pagesCrawled > 0 ? d.pagesCrawled : (hasDiscoveredScope ? 1 : 0),
        discoveredAt: d.discoveredAt || d.createdAt || d.updatedAt || new Date().toISOString(),
        tldZone: effectiveTldZone,
        isTldZone: Boolean(d.isTldZone) || (Boolean(d.domain) && d.domain.startsWith('.')),
        isExplicitTarget,
        childDomainCount: (d as any).childDomainCount || 0,
      };
    });

    // Synthesize Master TLD record for grouped zones if not explicitly saved as a standalone document
    const existingTldSet = new Set(results.filter((r: any) => r.isTldZone || (r.domain && r.domain.startsWith('.'))).map((r: any) => r.domain));
    const tldGroups = new Map<string, any[]>();
    for (const r of results) {
      if (r.tldZone && !r.isTldZone && !r.domain.startsWith('.') && !r.isExplicitTarget) {
        if (!tldGroups.has(r.tldZone)) tldGroups.set(r.tldZone, []);
        tldGroups.get(r.tldZone)!.push(r);
      }
    }

    for (const [tld, childList] of tldGroups.entries()) {
      const totalSubs = childList.reduce((acc, c) => acc + (c.subdomainCount || 0), 0);
      const totalEmails = childList.reduce((acc, c) => acc + (c.emailCount || 0), 0);
      const totalPages = childList.reduce((acc, c) => acc + (c.pagesCrawled || 0), 0);
      const hasCrawling = childList.some((c) => c.status === 'CRAWLING');

      const existingMaster = results.find((r: any) => r.domain === tld);
      if (existingMaster) {
        existingMaster.subdomainCount = totalSubs;
        existingMaster.emailCount = totalEmails;
        existingMaster.pagesCrawled = totalPages;
        existingMaster.status = hasCrawling ? 'CRAWLING' : 'RESOLVED';
        existingMaster.childDomainCount = childList.length;
        existingMaster.summary = `${tld} Top-Level Domain Zone with ${childList.length} discovered root domains and ${totalSubs} aggregate subdomains.`;
      } else if (childList.length > 0) {
        results.unshift({
          id: `tld_zone_${tld.replace(/^\./, '')}`,
          domain: tld,
          rootDomain: tld,
          subdomain: tld,
          subdomains: [],
          subdomainCount: totalSubs,
          email: childList.find((c) => c.email)?.email || '',
          emails: Array.from(new Set(childList.flatMap((c) => c.emails || []))),
          emailCount: totalEmails,
          verifiedEmails: childList.flatMap((c) => c.verifiedEmails || []),
          phones: Array.from(new Set(childList.flatMap((c) => c.phones || []))),
          scrapedPhones: childList.flatMap((c) => c.scrapedPhones || []),
          crawledPages: childList.flatMap((c) => c.crawledPages || []),
          pagesCrawled: totalPages,
          category: 'TLD Zone Scope',
          categoryIcon: '🌐',
          isEcommerce: childList.some((c) => c.isEcommerce),
          ecommerceSignals: Array.from(new Set(childList.flatMap((c) => c.ecommerceSignals || []))),
          technologies: Array.from(new Set(childList.flatMap((c) => c.technologies || []))),
          summary: `${tld} Top-Level Domain Zone with ${childList.length} discovered root domains and ${totalSubs} aggregate subdomains.`,
          country: tld.endsWith('.in') ? 'India' : 'Global',
          countryCode: tld.endsWith('.in') ? 'IN' : 'INT',
          countryFlag: tld.endsWith('.in') ? '🇮🇳' : '🌐',
          status: hasCrawling ? 'CRAWLING' : 'RESOLVED',
          sourceUrl: `https://${tld.replace(/^\./, '')}`,
          isTldZone: true,
          tldZone: tld,
          isExplicitTarget: false,
          childDomainCount: childList.length,
          discoveredAt: childList[0]?.discoveredAt || new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error: any) {
    console.error('[API/Crawler Results] Error querying MongoDB:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch MongoDB results' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  let deletedCount = 0;
  let mongoConnected = false;

  try {
    // 0. Stop all running dorking jobs in memory
    try {
      await DorkingDiscoveryEngine.getInstance().stopAllJobs();
    } catch (e) {
      console.warn('[API] Failed to stop dorking jobs:', e);
    }

    // 1. Authoritative purge of MongoDB collections
    try {
      const mongoose = await connectMongo();
      if (mongoose) {
        mongoConnected = true;

        // Primary: Purge scraped_results collection via Mongoose Model
        try {
          const modelRes = await MongoScrapedResultModel.deleteMany({});
          deletedCount += modelRes.deletedCount || 0;
        } catch (mErr) {
          console.warn('[API] MongoScrapedResultModel.deleteMany error:', mErr);
        }

        // Secondary: Direct purge of all database collections (except users authentication and system)
        const db = mongoose.connection?.db || (mongoose.connection as any)?.client?.db();
        if (db) {
          const allCollections = await db.listCollections().toArray();
          for (const col of allCollections) {
            if (col.name === 'users' || col.name.startsWith('system.')) continue;
            try {
              const res = await db.collection(col.name).deleteMany({});
              if (col.name === 'scraped_results' && deletedCount === 0) {
                deletedCount += res.deletedCount || 0;
              }
            } catch (colErr) {
              console.warn(`[API] Failed to clear collection ${col.name}:`, colErr);
            }
          }
        }
      }
    } catch (mongoErr: any) {
      console.warn('[API/Crawler Results] Mongo clear warning:', mongoErr?.message);
    }

    // 2. Clear Redis Queue & Fallback Queue file
    try {
      await redisQueue.clearQueue();
    } catch (e) {
      console.warn('[API] Failed to clear Redis queue:', e);
    }

    // 3. Clear Dorking engine state and cache
    try {
      await DorkingPersistenceService.clearAll();
    } catch (e) {
      console.warn('[API] Failed to clear Dorking data:', e);
    }

    // 4. Reset in-memory Bloom Filter bit array
    try {
      getSharedBloomFilter().clear();
    } catch (e) {
      console.warn('[API] Failed to clear Bloom Filter:', e);
    }

    // 5. Clear SQLite relational master database
    try {
      const sqlitePath = path.join(process.cwd(), 'crawler_engine', 'storage', 'master_relational.db');
      if (fs.existsSync(sqlitePath)) {
        fs.unlinkSync(sqlitePath);
      }
    } catch (e) {
      console.warn('[API] Failed to unlink sqlite db:', e);
    }

    // 5. Clear local crawler output files (JSON and CSV in output/ directories)
    try {
      const outputDir = path.join(process.cwd(), 'crawler_engine', 'output');
      if (fs.existsSync(outputDir)) {
        for (const sub of ['urls', 'emails', 'subdomains', 'external_links', 'metadata']) {
          const subPath = path.join(outputDir, sub);
          if (fs.existsSync(subPath)) {
            for (const file of fs.readdirSync(subPath)) {
              if (file.endsWith('.json') || file.endsWith('.csv')) {
                try {
                  fs.unlinkSync(path.join(subPath, file));
                } catch {}
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[API] Failed to clean crawler output:', e);
    }

    // 6. Clean all local disk cache files
    const diskCaches = [
      '.screpper-scraped.json',
      '.screpper-redis-queue.json',
      '.screpper-dorking-data.json',
    ];
    for (const fName of diskCaches) {
      try {
        const p = path.join(process.cwd(), fName);
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      message: `Complete purge successful: Deleted ${deletedCount} records and wiped all caches, queues, and history files.${mongoConnected ? ' (MongoDB Cleared)' : ' (Local Storage Cleared)'}`,
    });
  } catch (error: any) {
    console.error('[API/Crawler Results] Error clearing data:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to clear data' },
      { status: 500 }
    );
  }
}
