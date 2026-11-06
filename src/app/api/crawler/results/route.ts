import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { connectMongo, MongoScrapedResultModel } from '@/lib/mongodb';
import { redisQueue } from '@/lib/redisQueue';
import { DorkingPersistenceService } from '@/modules/dorking/services/persistence';
import { getSharedBloomFilter } from '@/lib/crawler/bloomFilter';

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
    const docs = await MongoScrapedResultModel.find({})
      .sort({ updatedAt: -1, _id: -1 })
      .limit(1000)
      .lean();

    const results = docs.map((d: any) => {
      const subs = Array.isArray(d.subdomains) ? d.subdomains : (d.subdomain ? [d.subdomain] : []);
      const subCount = typeof d.subdomainCount === 'number' ? d.subdomainCount : subs.length;
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

      const cleanCategory =
        d.category &&
        d.category !== 'Site Inaccessible' &&
        d.category !== 'Discovering Domain Intelligence...' &&
        d.category !== 'Public Domain Scope'
          ? d.category
          : (isOfflineStatus ? (d.errorTitle || 'Site Inaccessible') : 'Corporate & Business Services');

      const cleanCategoryIcon =
        d.categoryIcon &&
        d.categoryIcon !== '⚠️' &&
        d.categoryIcon !== '🔍' &&
        d.categoryIcon !== '🏛️'
          ? d.categoryIcon
          : (isOfflineStatus ? '⚠️' : '🌐');

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
        summary: cleanSummary,
        crawledPages: Array.isArray(d.crawledPages) ? d.crawledPages : [],
        country: d.country || 'Detected',
        countryCode: d.countryCode || 'INT',
        countryFlag: d.countryFlag || '🌐',
        status,
        sourceUrl: d.sourceUrl || '',
        pagesCrawled: d.pagesCrawled && d.pagesCrawled > 0 ? d.pagesCrawled : (hasDiscoveredScope ? 1 : 0),
        discoveredAt: d.discoveredAt || d.createdAt || d.updatedAt || new Date().toISOString(),
      };
    });

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
    // 1. Wipe intelligence collections in MongoDB if connected
    try {
      const mongoose = await connectMongo();
      if (mongoose && mongoose.connection.readyState === 1 && mongoose.connection.db) {
        mongoConnected = true;
        const db = mongoose.connection.db;
        const collections = [
          'scraped_results',
          'raw_crawl_data',
          'master_domains',
          'master_subdomains',
          'master_emails',
          'data_changes',
          'dorking_jobs',
          'dorking_results',
          'crawl_jobs',
        ];

        for (const collName of collections) {
          try {
            const res = await db.collection(collName).deleteMany({});
            if (collName === 'scraped_results') {
              deletedCount += res.deletedCount || 0;
            }
          } catch (e) {
            console.warn(`[API] Failed to clear collection ${collName}:`, e);
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
