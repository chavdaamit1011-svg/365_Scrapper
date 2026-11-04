import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { connectMongo, MongoScrapedResultModel } from '@/lib/mongodb';
import { redisQueue } from '@/lib/redisQueue';

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
        category: (d.category && d.category !== 'Site Inaccessible' && d.category !== 'Discovering Domain Intelligence...')
          ? d.category
          : (hasDiscoveredScope ? 'Public Domain Scope' : (isOfflineStatus ? (d.errorTitle || 'Site Inaccessible') : 'Corporate & Business Services')),
        categoryIcon: (d.categoryIcon && d.categoryIcon !== '⚠️' && d.categoryIcon !== '🔍')
          ? d.categoryIcon
          : (hasDiscoveredScope ? '🏛️' : (isOfflineStatus ? '⚠️' : '🌐')),
        isEcommerce: Boolean(d.isEcommerce),
        ecommerceSignals: Array.isArray(d.ecommerceSignals) ? d.ecommerceSignals : [],
        technologies: Array.isArray(d.technologies) ? d.technologies : [],
        phones: Array.isArray(d.phones) ? d.phones : [],
        summary: (d.summary && !d.summary.includes('No live HTML content could be loaded'))
          ? d.summary
          : (hasDiscoveredScope ? `Public domain scope with ${subCount} verified subdomains.` : (d.summary || '')),
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
  try {
    const mongoose = await connectMongo();
    if (!mongoose || mongoose.connection.readyState !== 1) {
      return NextResponse.json(
        { success: false, message: 'MongoDB service not connected' },
        { status: 503 }
      );
    }

    // 1. Wipe all collections in MongoDB (Component 5 & Phase 2 tables)
    const db = mongoose.connection.db;
    let deletedCount = 0;
    if (db) {
      const collections = [
        'scraped_results',
        'raw_crawl_data',
        'master_domains',
        'master_subdomains',
        'master_emails',
        'data_changes',
      ];
      for (const collName of collections) {
        try {
          const res = await db.collection(collName).deleteMany({});
          if (collName === 'scraped_results') {
            deletedCount = res.deletedCount || 0;
          }
        } catch (e) {
          console.warn(`[API] Failed to clear collection ${collName}:`, e);
        }
      }
    }

    // 2. Clear Redis Queue & Fallback Queue file (Component 2)
    try {
      await redisQueue.clearQueue();
    } catch (e) {
      console.warn('[API] Failed to clear Redis queue:', e);
    }

    // 3. Clear SQLite relational master database (Phase 2 Master)
    try {
      const sqlitePath = path.join(process.cwd(), 'crawler_engine', 'storage', 'master_relational.db');
      if (fs.existsSync(sqlitePath)) {
        fs.unlinkSync(sqlitePath);
      }
    } catch (e) {
      console.warn('[API] Failed to unlink sqlite db:', e);
    }

    // 4. Clear local crawler output files (JSON and CSV in output/ directories)
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

    // 5. Clean local disk cache files
    for (const fName of ['.screpper-scraped.json', '.screpper-redis-queue.json']) {
      try {
        const p = path.join(process.cwd(), fName);
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      message: `Complete purge successful: Deleted ${deletedCount} records and wiped all caches, queues, and history files.`,
    });
  } catch (error: any) {
    console.error('[API/Crawler Results] Error clearing MongoDB:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to clear MongoDB results' },
      { status: 500 }
    );
  }
}
