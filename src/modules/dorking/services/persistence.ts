/**
 * Database & Deduplication Persistence Service for Dorking Engine
 * Connects to MongoDB, manages upserts to master_domains, master_subdomains,
 * dorking_jobs, and dorking_results, while maintaining local disk fallback.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { connectMongo } from '@/lib/mongodb';
import {
  DorkingJob,
  DorkingRecord,
  DorkingOverviewStats,
  ProviderStats,
} from '../types/dorking.types';

const DORKING_STORAGE_FILE = path.join(process.cwd(), '.screpper-dorking-data.json');

import { generateEntityId } from '@/lib/entityId';

export { generateEntityId };

interface FallbackStorageSchema {
  jobs: DorkingJob[];
  records: DorkingRecord[];
}

export class DorkingPersistenceService {
  private static fallbackData: FallbackStorageSchema = {
    jobs: [],
    records: [],
  };
  private static isInitialized = false;

  private static initFallback(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    try {
      if (fs.existsSync(DORKING_STORAGE_FILE)) {
        const raw = fs.readFileSync(DORKING_STORAGE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.jobs)) {
          this.fallbackData.jobs = parsed.jobs;
        }
        if (parsed && Array.isArray(parsed.records)) {
          this.fallbackData.records = parsed.records;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  private static saveFallback(): void {
    try {
      fs.writeFileSync(
        DORKING_STORAGE_FILE,
        JSON.stringify(this.fallbackData, null, 2),
        'utf-8'
      );
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Upserts a discovered dorking record into MongoDB and fallback
   */
  static async upsertRecord(record: DorkingRecord): Promise<void> {
    this.initFallback();

    // 1. Memory / File Fallback upsert
    const existingIdx = this.fallbackData.records.findIndex(
      (r) => r.hostname.toLowerCase() === record.hostname.toLowerCase()
    );
    if (existingIdx >= 0) {
      this.fallbackData.records[existingIdx] = {
        ...this.fallbackData.records[existingIdx],
        ...record,
        firstSeen: this.fallbackData.records[existingIdx].firstSeen,
        lastSeen: new Date().toISOString(),
      };
    } else {
      this.fallbackData.records.push(record);
    }
    this.saveFallback();

    // 2. MongoDB Upsert
    try {
      const conn = await connectMongo();
      if (!conn?.connection?.db) return;
      const db = conn.connection.db;

      const domainId = generateEntityId('domain', record.rootDomain);
      const subId = generateEntityId('subdomain', record.hostname);
      const now = new Date().toISOString();

      // Upsert master_domains
      await db.collection('master_domains').updateOne(
        { id: domainId },
        {
          $set: {
            domain: record.rootDomain,
            last_seen: now,
            status: 'ACTIVE',
          },
          $setOnInsert: {
            id: domainId,
            first_seen: now,
            created_at: now,
          },
        },
        { upsert: true }
      );

      // Upsert master_subdomains
      await db.collection('master_subdomains').updateOne(
        { id: subId },
        {
          $set: {
            domain_id: domainId,
            domain: record.rootDomain,
            subdomain: record.hostname,
            dns_status: record.dnsStatus,
            ip_addresses: record.ipAddresses,
            cnames: record.cnames,
            source: 'dorking',
            search_provider: record.searchProvider,
            discovered_by_query: record.discoveredByQuery,
            source_url: record.sourceUrl,
            last_seen: now,
            status: record.dnsStatus === 'UNRESOLVED' ? 'UNRESOLVED' : 'ACTIVE',
          },
          $setOnInsert: {
            id: subId,
            first_seen: now,
          },
        },
        { upsert: true }
      );

      // Upsert dorking_results collection
      await db.collection('dorking_results').updateOne(
        { hostname: record.hostname },
        {
          $set: {
            ...record,
            lastSeen: now,
          },
          $setOnInsert: {
            id: record.id,
            firstSeen: now,
          },
        },
        { upsert: true }
      );

      // Sync into scraped_results so that main dashboard sees this domain and its subdomains
      await db.collection('scraped_results').updateOne(
        { domain: record.rootDomain },
        {
          $addToSet: { subdomains: record.hostname },
          $set: {
            lastUpdated: now,
            rootDomain: record.rootDomain,
          },
          $setOnInsert: {
            id: `res_${domainId}`,
            domain: record.rootDomain,
            subdomainCount: 0,
            emails: [],
            emailCount: 0,
            status: 'RESOLVED',
            discoveredAt: now,
          },
        },
        { upsert: true }
      );

      // Update subdomainCount
      const scrapedDoc = await db.collection('scraped_results').findOne({ domain: record.rootDomain });
      if (scrapedDoc && Array.isArray(scrapedDoc.subdomains)) {
        await db.collection('scraped_results').updateOne(
          { domain: record.rootDomain },
          { $set: { subdomainCount: scrapedDoc.subdomains.length } }
        );
      }
    } catch (err: any) {
      console.warn('[DorkingPersistence] Mongo save warning:', err?.message || err);
    }
  }

  /**
   * Saves or updates a Dorking Job in MongoDB and fallback
   */
  static async saveJob(job: DorkingJob): Promise<void> {
    this.initFallback();

    const idx = this.fallbackData.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) {
      this.fallbackData.jobs[idx] = { ...job };
    } else {
      this.fallbackData.jobs.unshift(job);
    }
    this.saveFallback();

    try {
      const conn = await connectMongo();
      if (!conn?.connection?.db) return;
      const db = conn.connection.db;

      await db.collection('dorking_jobs').updateOne(
        { id: job.id },
        { $set: { ...job } },
        { upsert: true }
      );
    } catch (err: any) {
      console.warn('[DorkingPersistence] Mongo saveJob warning:', err?.message || err);
    }
  }

  /**
   * Retrieves a job by ID
   */
  static async getJob(jobId: string): Promise<DorkingJob | null> {
    this.initFallback();

    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        const doc = await conn.connection.db.collection('dorking_jobs').findOne({ id: jobId });
        if (doc) return doc as unknown as DorkingJob;
      }
    } catch {}

    const job = this.fallbackData.jobs.find((j) => j.id === jobId);
    return job || null;
  }

  /**
   * Retrieves all jobs ordered by start date
   */
  static async getAllJobs(): Promise<DorkingJob[]> {
    this.initFallback();

    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        const docs = await conn.connection.db
          .collection('dorking_jobs')
          .find({})
          .sort({ startedAt: -1 })
          .toArray();
        if (docs && docs.length > 0) {
          return docs as unknown as DorkingJob[];
        }
      }
    } catch {}

    return [...this.fallbackData.jobs].sort((a, b) =>
      (b.startedAt || '').localeCompare(a.startedAt || '')
    );
  }

  /**
   * Retrieves discovered records with filtering
   */
  static async getRecords(filter?: {
    domain?: string;
    provider?: string;
    dnsStatus?: string;
    search?: string;
  }): Promise<DorkingRecord[]> {
    this.initFallback();

    let records: DorkingRecord[] = [];

    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        const query: any = {};
        if (filter?.domain) query.rootDomain = filter.domain.toLowerCase();
        if (filter?.provider) query.searchProvider = filter.provider;
        if (filter?.dnsStatus) query.dnsStatus = filter.dnsStatus;
        if (filter?.search) {
          query.hostname = { $regex: filter.search, $options: 'i' };
        }

        const docs = await conn.connection.db
          .collection('dorking_results')
          .find(query)
          .sort({ lastSeen: -1 })
          .limit(500)
          .toArray();

        if (docs && docs.length > 0) {
          return docs as unknown as DorkingRecord[];
        }
      }
    } catch {}

    // Fallback filtering
    records = [...this.fallbackData.records];
    if (filter?.domain) {
      const d = filter.domain.toLowerCase();
      records = records.filter((r) => r.rootDomain === d);
    }
    if (filter?.provider) {
      records = records.filter((r) => r.searchProvider.toLowerCase() === filter.provider?.toLowerCase());
    }
    if (filter?.dnsStatus) {
      records = records.filter((r) => r.dnsStatus === filter.dnsStatus);
    }
    if (filter?.search) {
      const s = filter.search.toLowerCase();
      records = records.filter((r) => r.hostname.toLowerCase().includes(s));
    }

    return records.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  /**
   * Aggregates overview metrics
   */
  static async getOverviewStats(): Promise<DorkingOverviewStats> {
    this.initFallback();
    const jobs = await this.getAllJobs();
    const records = await this.getRecords();

    let totalQueriesGenerated = 0;
    let totalResultsCollected = 0;
    let duplicatesIgnored = 0;
    let failedQueriesCount = 0;
    const providerStats: Record<string, ProviderStats> = {};

    for (const job of jobs) {
      totalQueriesGenerated += job.totalQueries || 0;
      totalResultsCollected += job.totalResultsCollected || 0;
      duplicatesIgnored += job.duplicatesIgnored || 0;
      failedQueriesCount += job.failedQueries || 0;

      if (job.providerStats) {
        for (const [pName, pStat] of Object.entries(job.providerStats)) {
          if (!providerStats[pName]) {
            providerStats[pName] = { queriesCount: 0, resultsCount: 0, errorsCount: 0 };
          }
          providerStats[pName].queriesCount += pStat.queriesCount || 0;
          providerStats[pName].resultsCount += pStat.resultsCount || 0;
          providerStats[pName].errorsCount += pStat.errorsCount || 0;
        }
      }
    }

    const uniqueDomains = new Set<string>();
    const uniqueSubdomains = new Set<string>();
    let dnsResolvedCount = 0;
    let unresolvedCount = 0;

    for (const rec of records) {
      uniqueDomains.add(rec.rootDomain);
      uniqueSubdomains.add(rec.hostname);
      if (rec.dnsStatus === 'RESOLVED' || rec.dnsStatus === 'CNAME_ONLY') {
        dnsResolvedCount++;
      } else {
        unresolvedCount++;
      }
    }

    return {
      totalJobs: jobs.length,
      totalQueriesGenerated,
      totalResultsCollected,
      uniqueDomainsDiscovered: uniqueDomains.size,
      uniqueSubdomainsDiscovered: uniqueSubdomains.size,
      dnsResolvedCount,
      unresolvedCount,
      duplicatesIgnored,
      failedQueriesCount,
      providerStats,
    };
  }

  /**
   * Complete wipe of all dorking jobs, records, and cache files
   */
  static async clearAll(): Promise<void> {
    this.fallbackData = { jobs: [], records: [] };
    this.saveFallback();
    try {
      if (fs.existsSync(DORKING_STORAGE_FILE)) {
        fs.unlinkSync(DORKING_STORAGE_FILE);
      }
    } catch {}

    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        await conn.connection.db.collection('dorking_jobs').deleteMany({});
        await conn.connection.db.collection('dorking_results').deleteMany({});
      }
    } catch {}
  }
}

