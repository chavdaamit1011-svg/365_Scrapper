/**
 * Dorking Discovery Engine
 * Master orchestrator for query generation, provider execution, result parsing,
 * DNS validation, deduplication, and database persistence.
 */

import { generateDorkQueries } from './dorkGenerator';
import { SearchManager } from './searchManager';
import { ResultParser } from './resultParser';
import { validateHostnameDns } from '../validators/dnsValidator';
import { normalizeHostname } from '../validators/hostnameValidator';
import { DeduplicationService } from '../services/deduplication';
import { DorkingPersistenceService, generateEntityId } from '../services/persistence';
import {
  DorkingJob,
  DorkingRecord,
  DorkingJobStatus,
  SearchResultItem,
} from '../types/dorking.types';

export interface StartDorkingJobOptions {
  domain: string;
  customQueries?: string[];
  providers?: string[];
  concurrency?: number;
  maxPagesPerQuery?: number;
  includeInUrlKeywords?: boolean;
}

export class DorkingDiscoveryEngine {
  private static instance: DorkingDiscoveryEngine;
  private searchManager: SearchManager;
  private activeJobs: Map<string, DorkingJob> = new Map();
  private jobControlSignals: Map<string, DorkingJobStatus> = new Map();

  private constructor() {
    this.searchManager = new SearchManager();
  }

  public static getInstance(): DorkingDiscoveryEngine {
    if (!DorkingDiscoveryEngine.instance) {
      DorkingDiscoveryEngine.instance = new DorkingDiscoveryEngine();
    }
    return DorkingDiscoveryEngine.instance;
  }

  public getSearchManager(): SearchManager {
    return this.searchManager;
  }

  /**
   * Starts a new Dorking Job
   */
  public async startJob(options: StartDorkingJobOptions): Promise<DorkingJob> {
    const cleanDomain = normalizeHostname(options.domain);
    const jobId = `dork_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Generate Queries
    const queries = generateDorkQueries(cleanDomain, {
      customQueries: options.customQueries,
      includeInUrlKeywords: options.includeInUrlKeywords !== false,
      provider: options.providers && options.providers.length === 1 ? options.providers[0] : 'all',
    });

    // 2. Identify active providers
    const activeProviders = this.searchManager.getActiveProviders(options.providers);
    const providerNames = activeProviders.map((p) => p.name);

    // 3. Initialize Job Record
    const job: DorkingJob = {
      id: jobId,
      domain: cleanDomain,
      status: 'RUNNING',
      queries,
      providersUsed: providerNames,
      totalQueries: queries.length,
      completedQueries: 0,
      failedQueries: 0,
      totalResultsCollected: 0,
      uniqueDomainsDiscovered: 1, // Target root domain
      uniqueSubdomainsDiscovered: 0,
      dnsResolvedCount: 0,
      unresolvedCount: 0,
      duplicatesIgnored: 0,
      providerStats: {},
      startedAt: new Date().toISOString(),
      logs: [`[${new Date().toISOString()}] Job created with ${queries.length} dork queries across providers: ${providerNames.join(', ')}`],
    };

    for (const p of providerNames) {
      job.providerStats[p] = { queriesCount: 0, resultsCount: 0, errorsCount: 0 };
    }

    this.activeJobs.set(jobId, job);
    this.jobControlSignals.set(jobId, 'RUNNING');
    await DorkingPersistenceService.saveJob(job);

    // 4. Run async discovery pipeline without blocking caller
    this.runPipeline(job, activeProviders, options.maxPagesPerQuery || 1).catch((err) => {
      console.error(`[DiscoveryEngine] Unhandled job error for ${jobId}:`, err);
    });

    return job;
  }

  /**
   * Asynchronous discovery execution loop
   */
  private async runPipeline(
    job: DorkingJob,
    activeProviders: ReturnType<SearchManager['getActiveProviders']>,
    maxPages: number
  ): Promise<void> {
    const dedup = new DeduplicationService();

    // Load any existing subdomains from DB to avoid double counting
    try {
      const existingRecords = await DorkingPersistenceService.getRecords({ domain: job.domain });
      for (const rec of existingRecords) {
        dedup.checkAndMark(rec.hostname);
      }
    } catch {}

    job.logs.push(`[${new Date().toISOString()}] Starting query execution queue...`);

    for (let i = 0; i < job.queries.length; i++) {
      const q = job.queries[i];

      // Check control signal (Pause / Stop)
      while (this.jobControlSignals.get(job.id) === 'PAUSED') {
        job.status = 'PAUSED';
        await DorkingPersistenceService.saveJob(job);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (this.jobControlSignals.get(job.id) === 'STOPPED') {
        job.status = 'STOPPED';
        job.completedAt = new Date().toISOString();
        job.logs.push(`[${new Date().toISOString()}] Job stopped by user.`);
        await DorkingPersistenceService.saveJob(job);
        return;
      }

      job.status = 'RUNNING';
      q.status = 'running';
      q.executedAt = new Date().toISOString();

      try {
        const rawResults: SearchResultItem[] = [];

        // Execute query against all selected providers
        for (const provider of activeProviders) {
          const results = await this.searchManager.executeQuery(provider.name, q.query, maxPages);
          rawResults.push(...results);

          // Update provider stats in job
          if (!job.providerStats[provider.name]) {
            job.providerStats[provider.name] = { queriesCount: 0, resultsCount: 0, errorsCount: 0 };
          }
          job.providerStats[provider.name].queriesCount++;
          job.providerStats[provider.name].resultsCount += results.length;
        }

        q.resultsCount = rawResults.length;
        job.totalResultsCollected += rawResults.length;

        // Parse and validate scope
        const parsedHostnames = ResultParser.parseBatch(rawResults, job.domain);

        for (const parsed of parsedHostnames) {
          const isDuplicate = dedup.checkAndMark(parsed.normalizedHostname);
          if (isDuplicate) {
            job.duplicatesIgnored++;
            continue;
          }

          // Strict DNS lookup (A, AAAA, CNAME)
          const dnsResult = await validateHostnameDns(parsed.normalizedHostname);

          if (dnsResult.status === 'RESOLVED' || dnsResult.status === 'CNAME_ONLY') {
            job.dnsResolvedCount++;
          } else {
            // Unresolved hostnames are preserved, never deleted!
            job.unresolvedCount++;
          }

          const recordId = generateEntityId('subdomain', parsed.normalizedHostname);
          const now = new Date().toISOString();

          const record: DorkingRecord = {
            id: recordId,
            hostname: parsed.normalizedHostname,
            rootDomain: job.domain,
            subdomain: parsed.isSubdomain ? parsed.normalizedHostname : '',
            subdomainLevel: parsed.subdomainLevel,
            dnsStatus: dnsResult.status,
            ipAddresses: [...dnsResult.aRecords, ...dnsResult.aaaaRecords],
            cnames: dnsResult.cnameRecords,
            sourceUrl: parsed.rawUrl,
            searchProvider: parsed.provider,
            discoveredByQuery: q.query,
            firstSeen: now,
            lastSeen: now,
          };

          // Save partial result to database immediately
          await DorkingPersistenceService.upsertRecord(record);
          job.uniqueSubdomainsDiscovered = dedup.getUniqueCount();
        }

        q.status = 'completed';
        job.completedQueries++;
        job.duplicatesIgnored = dedup.getDuplicatesCount();
        job.logs.push(
          `[${new Date().toISOString()}] Query ${i + 1}/${job.queries.length} ('${q.query}') completed: ${rawResults.length} hits, ${parsedHostnames.length} valid scope.`
        );
      } catch (err: any) {
        q.status = 'failed';
        q.error = err?.message || 'Query execution failed';
        job.failedQueries++;
        job.logs.push(`[${new Date().toISOString()}] Query '${q.query}' failed: ${q.error}`);
      }

      // Persist partial job state periodically
      await DorkingPersistenceService.saveJob(job);

      // Minor rate limit delay between queries
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    job.status = 'COMPLETED';
    job.completedAt = new Date().toISOString();
    job.logs.push(
      `[${new Date().toISOString()}] Dorking Job completed successfully. Discovered ${job.uniqueSubdomainsDiscovered} unique subdomains (${job.dnsResolvedCount} resolved, ${job.unresolvedCount} unresolved).`
    );

    await DorkingPersistenceService.saveJob(job);
    this.activeJobs.delete(job.id);
  }

  /**
   * Pause an ongoing job
   */
  public async pauseJob(jobId: string): Promise<boolean> {
    this.jobControlSignals.set(jobId, 'PAUSED');
    const job = this.activeJobs.get(jobId) || (await DorkingPersistenceService.getJob(jobId));
    if (job) {
      job.status = 'PAUSED';
      job.logs.push(`[${new Date().toISOString()}] Pause command received.`);
      await DorkingPersistenceService.saveJob(job);
      return true;
    }
    return false;
  }

  /**
   * Resume a paused job
   */
  public async resumeJob(jobId: string): Promise<boolean> {
    this.jobControlSignals.set(jobId, 'RUNNING');
    const job = this.activeJobs.get(jobId) || (await DorkingPersistenceService.getJob(jobId));
    if (job) {
      job.status = 'RUNNING';
      job.logs.push(`[${new Date().toISOString()}] Resume command received.`);
      await DorkingPersistenceService.saveJob(job);
      return true;
    }
    return false;
  }

  /**
   * Stop an ongoing job
   */
  public async stopJob(jobId: string): Promise<boolean> {
    this.jobControlSignals.set(jobId, 'STOPPED');
    const job = this.activeJobs.get(jobId) || (await DorkingPersistenceService.getJob(jobId));
    if (job) {
      job.status = 'STOPPED';
      job.completedAt = new Date().toISOString();
      job.logs.push(`[${new Date().toISOString()}] Stop command received.`);
      await DorkingPersistenceService.saveJob(job);
      this.activeJobs.delete(jobId);
      return true;
    }
    return false;
  }

  /**
   * Retry failed queries for a job
   */
  public async retryFailedQueries(jobId: string): Promise<DorkingJob | null> {
    const job = await DorkingPersistenceService.getJob(jobId);
    if (!job) return null;

    const failed = job.queries.filter((q) => q.status === 'failed');
    if (failed.length === 0) return job;

    for (const q of failed) {
      q.status = 'pending';
      q.error = undefined;
    }

    job.failedQueries = 0;
    job.status = 'RUNNING';
    this.activeJobs.set(jobId, job);
    this.jobControlSignals.set(jobId, 'RUNNING');

    const activeProviders = this.searchManager.getActiveProviders(job.providersUsed);
    this.runPipeline(job, activeProviders, 1).catch(console.error);

    return job;
  }

  public async getJob(jobId: string): Promise<DorkingJob | null> {
    return this.activeJobs.get(jobId) || (await DorkingPersistenceService.getJob(jobId));
  }

  public async getAllJobs(): Promise<DorkingJob[]> {
    return DorkingPersistenceService.getAllJobs();
  }
}

