import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

export interface CrawlJob {
  id: string;
  domain: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  maxPages: number;
  maxDepth: number;
  requestsPerSecond: number;
  respectRobotsTxt: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pagesCrawled?: number;
  subdomainsCount?: number;
  emailsCount?: number;
  error?: string;
}

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_URL = process.env.REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`;

// File fallback path when Redis daemon is not running on localhost
const FALLBACK_FILE = path.join(process.cwd(), '.screpper-redis-queue.json');

class RedisQueueManager {
  private redis: Redis | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  // In-memory queue fallback
  private memoryJobs: Map<string, CrawlJob> = new Map();
  private memoryQueue: string[] = [];
  private memoryControlState: 'RUNNING' | 'PAUSED' | 'CANCELLED' = 'RUNNING';

  constructor() {
    this.loadFallbackFile();
    this.initRedis();
  }

  private initRedis() {
    if (this.connectionAttempted) return;
    this.connectionAttempted = true;

    try {
      this.redis = new Redis(REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null, // Do not spam retries if Redis is not running
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        console.log(`[RedisQueue] Connected to Redis at ${REDIS_URL}`);
      });

      this.redis.on('error', (err) => {
        this.isConnected = false;
        // Suppress repetitive disconnect logs
      });

      this.redis.connect().catch(() => {
        this.isConnected = false;
        // Graceful fallback active
      });
    } catch {
      this.isConnected = false;
    }
  }

  private loadFallbackFile() {
    try {
      if (fs.existsSync(FALLBACK_FILE)) {
        const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.jobs && Array.isArray(parsed.jobs)) {
          for (const j of parsed.jobs) {
            this.memoryJobs.set(j.id, j);
          }
        }
        if (parsed.queue && Array.isArray(parsed.queue)) {
          this.memoryQueue = parsed.queue;
        }
        if (parsed.controlState) {
          this.memoryControlState = parsed.controlState;
        }
      }
    } catch (e) {
      // Ignore fallback read error
    }
  }

  private saveFallbackFile() {
    try {
      const data = {
        jobs: Array.from(this.memoryJobs.values()),
        queue: this.memoryQueue,
        controlState: this.memoryControlState,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // Ignore fallback write error
    }
  }

  public getRedisStatus(): { connected: boolean; url: string } {
    return {
      connected: this.isConnected,
      url: REDIS_URL,
    };
  }

  /**
   * Enqueues a new crawl job into Redis (Component 1 & 2 of PDF Architecture)
   */
  public async enqueueCrawlJob(params: {
    domain: string;
    maxPages?: number;
    maxDepth?: number;
    requestsPerSecond?: number;
    respectRobotsTxt?: boolean;
  }): Promise<CrawlJob> {
    const cleanDomain = params.domain.trim().toLowerCase();
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const job: CrawlJob = {
      id: jobId,
      domain: cleanDomain,
      status: 'queued',
      maxPages: params.maxPages || 50,
      maxDepth: params.maxDepth || 3,
      requestsPerSecond: params.requestsPerSecond || 1,
      respectRobotsTxt: params.respectRobotsTxt !== false,
      createdAt: new Date().toISOString(),
    };

    if (this.isConnected && this.redis) {
      try {
        // 1. Save Job hash in Redis
        await this.redis.hset(`the_scraper:jobs:${jobId}`, {
          id: job.id,
          domain: job.domain,
          status: job.status,
          max_pages: String(job.maxPages),
          max_depth: String(job.maxDepth),
          requests_per_second: String(job.requestsPerSecond),
          respect_robots_txt: String(job.respectRobotsTxt),
          created_at: job.createdAt,
        });

        // 2. Push Job ID to Redis Queue List (RPUSH)
        await this.redis.rpush('the_scraper:crawl_queue', JSON.stringify(job));
      } catch (err) {
        console.warn('[RedisQueue] Redis write failed, falling back to memory queue:', err);
      }
    }

    // Always maintain memory fallback
    this.memoryJobs.set(jobId, job);
    this.memoryQueue.push(jobId);
    this.saveFallbackFile();

    return job;
  }

  /**
   * Retrieves a specific job by ID
   */
  public async getJob(jobId: string): Promise<CrawlJob | null> {
    if (this.isConnected && this.redis) {
      try {
        const raw = await this.redis.hgetall(`the_scraper:jobs:${jobId}`);
        if (raw && raw.id) {
          return {
            id: raw.id,
            domain: raw.domain,
            status: raw.status as any,
            maxPages: Number(raw.max_pages) || 50,
            maxDepth: Number(raw.max_depth) || 3,
            requestsPerSecond: Number(raw.requests_per_second) || 1,
            respectRobotsTxt: raw.respect_robots_txt === 'true',
            createdAt: raw.created_at || new Date().toISOString(),
            startedAt: raw.started_at,
            completedAt: raw.completed_at,
            pagesCrawled: raw.pages_crawled ? Number(raw.pages_crawled) : undefined,
            subdomainsCount: raw.subdomains_count ? Number(raw.subdomains_count) : undefined,
            emailsCount: raw.emails_count ? Number(raw.emails_count) : undefined,
            error: raw.error,
          };
        }
      } catch {}
    }

    this.loadFallbackFile();
    return this.memoryJobs.get(jobId) || null;
  }

  /**
   * Retrieves all jobs (history & active)
   */
  public async getAllJobs(): Promise<CrawlJob[]> {
    this.loadFallbackFile();
    return Array.from(this.memoryJobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Updates job status and metadata in Redis
   */
  public async updateJobStatus(
    jobId: string,
    status: CrawlJob['status'],
    data?: Partial<CrawlJob>
  ): Promise<void> {
    const existing = this.memoryJobs.get(jobId);
    if (existing) {
      const updated: CrawlJob = {
        ...existing,
        ...data,
        status,
      };
      if (status === 'running' && !updated.startedAt) {
        updated.startedAt = new Date().toISOString();
      }
      if ((status === 'completed' || status === 'failed') && !updated.completedAt) {
        updated.completedAt = new Date().toISOString();
      }

      this.memoryJobs.set(jobId, updated);
      this.saveFallbackFile();

      if (this.isConnected && this.redis) {
        try {
          const payload: Record<string, string> = {
            status,
            updated_at: new Date().toISOString(),
          };
          if (updated.startedAt) payload.started_at = updated.startedAt;
          if (updated.completedAt) payload.completed_at = updated.completedAt;
          if (updated.pagesCrawled !== undefined) payload.pages_crawled = String(updated.pagesCrawled);
          if (updated.subdomainsCount !== undefined) payload.subdomains_count = String(updated.subdomainsCount);
          if (updated.emailsCount !== undefined) payload.emails_count = String(updated.emailsCount);
          if (updated.error) payload.error = updated.error;

          await this.redis.hset(`the_scraper:jobs:${jobId}`, payload);
        } catch {}
      }
    }
  }

  /**
   * Sets queue control state (RUNNING / PAUSED / CANCELLED)
   */
  public async setControlState(state: 'RUNNING' | 'PAUSED' | 'CANCELLED'): Promise<void> {
    this.memoryControlState = state;
    this.saveFallbackFile();

    if (this.isConnected && this.redis) {
      try {
        await this.redis.set('the_scraper:crawler_state', state);
      } catch {}
    }
  }

  /**
   * Gets queue control state
   */
  public async getControlState(): Promise<'RUNNING' | 'PAUSED' | 'CANCELLED'> {
    if (this.isConnected && this.redis) {
      try {
        const val = await this.redis.get('the_scraper:crawler_state');
        if (val === 'RUNNING' || val === 'PAUSED' || val === 'CANCELLED') {
          return val;
        }
      } catch {}
    }

    return this.memoryControlState;
  }

  /**
   * Clears queue and jobs history
   */
  public async clearQueue(): Promise<void> {
    this.memoryJobs.clear();
    this.memoryQueue = [];
    this.saveFallbackFile();

    if (this.isConnected && this.redis) {
      try {
        await this.redis.del('the_scraper:crawl_queue');
      } catch {}
    }
  }
}

// Global Singleton Queue instance
const globalForRedisQueue = global as unknown as { redisQueueManager: RedisQueueManager };
export const redisQueue = globalForRedisQueue.redisQueueManager || new RedisQueueManager();
if (process.env.NODE_ENV !== 'production') globalForRedisQueue.redisQueueManager = redisQueue;

