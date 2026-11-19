import fs from 'fs';
import path from 'path';
import { TargetItem } from '@/features/targets/types/target.types';
import {
  CrawlerExecutionState,
  ActiveWorkerSummary,
} from '@/features/crawler/types/crawler.types';
import { crawlDomain } from '@/lib/crawler/crawlerEngine';
import { discoverTldRootDomains, normalizeTld } from '@/lib/crawler/tldDiscovery';
import { connectMongo, MongoScrapedResultModel } from '@/lib/mongodb';
import { redisQueue } from '@/lib/redisQueue';

const DAEMON_STATE_FILE = path.join(process.cwd(), '.screpper-daemon-state.json');

export interface DaemonStatusPayload {
  status: CrawlerExecutionState;
  cycleCount: number;
  isContinuous: boolean;
  currentTargetName: string | null;
  activePhase: string;
  targetSubProgress: number;
  elapsedSeconds: number;
  targets: TargetItem[];
  sessionTotal: number;
  processedTargetsCount: number;
  activeWorkersList: ActiveWorkerSummary[];
  activeTargetResult: {
    subdomains: number;
    emails: number;
    phones: number;
    pages: number;
  } | null;
  zoneDiscoveredCount: number;
  zoneScannedCount: number;
  currentCycleProgress: number;
  startedAt: string | null;
  isTldZoneActive: boolean;
  activeZoneRootDomains: number;
  activeZoneScannedDomains: number;
  activeZoneSubdomains: number;
  activeZoneEmails: number;
  activeZonePhones: number;
}

export class CrawlerDaemon {
  private status: CrawlerExecutionState = 'IDLE';
  private cycleCount: number = 1;
  private isContinuous: boolean = true;
  private currentTargetName: string | null = null;
  private activePhase: string = 'Standby';
  private targetSubProgress: number = 0;
  private targets: TargetItem[] = [];
  private sessionTotal: number = 0;
  private processedTargetsCount: number = 0;
  private startedAt: string | null = null;

  // Real Wall-Clock time tracking (Immune to tab freezes, throttling, or sleep)
  private startTimeMs: number | null = null;
  private pausedElapsedSeconds: number = 0;

  private activeWorkers: Map<string, ActiveWorkerSummary> = new Map();
  private activeTargetResult: {
    subdomains: number;
    emails: number;
    phones: number;
    pages: number;
  } | null = null;

  private zoneDiscoveredCount: number = 0;
  private zoneScannedCount: number = 0;
  private currentCycleProgress: number = 1;
  private currentCycleTotalCount: number = 0;

  private isLoopRunning: boolean = false;
  private stateSaveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadStateFromFile();
  }

  public getElapsedSeconds(): number {
    if (!this.startTimeMs) return this.pausedElapsedSeconds || 0;
    if (this.status === 'PAUSED' || this.status === 'COMPLETED' || this.status === 'IDLE') {
      return this.pausedElapsedSeconds;
    }
    return this.pausedElapsedSeconds + Math.max(0, Math.floor((Date.now() - this.startTimeMs) / 1000));
  }

  private loadStateFromFile() {
    try {
      if (fs.existsSync(DAEMON_STATE_FILE)) {
        const raw = fs.readFileSync(DAEMON_STATE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.status === 'RUNNING' || data.status === 'PAUSED') {
          this.status = data.status;
          this.cycleCount = data.cycleCount || 1;
          this.isContinuous = data.isContinuous !== undefined ? data.isContinuous : true;
          this.currentTargetName = data.currentTargetName || null;
          this.activePhase = data.activePhase || 'Resuming Crawler Daemon...';
          this.targetSubProgress = data.targetSubProgress || 0;
          this.targets = Array.isArray(data.targets) ? data.targets : [];
          this.sessionTotal = data.sessionTotal || this.targets.length;
          this.processedTargetsCount = data.processedTargetsCount || 0;
          this.startedAt = data.startedAt || new Date().toISOString();
          this.zoneDiscoveredCount = data.zoneDiscoveredCount || 0;
          this.zoneScannedCount = data.zoneScannedCount || 0;
          this.currentCycleProgress = data.currentCycleProgress || 1;

          if (data.startTimeMs && this.status === 'RUNNING') {
            this.startTimeMs = data.startTimeMs;
            this.pausedElapsedSeconds = data.pausedElapsedSeconds || 0;
          } else {
            this.pausedElapsedSeconds = data.elapsedSeconds || 0;
          }

          if (this.status === 'RUNNING') {
            setTimeout(() => {
              if (this.status === 'RUNNING' && !this.isLoopRunning) {
                this.runAutonomousLoop();
              }
            }, 1000);
          }
        }
      }
    } catch (e) {
      // Ignore initial load error
    }
  }

  private saveStateToFile() {
    try {
      const data = {
        status: this.status,
        cycleCount: this.cycleCount,
        isContinuous: this.isContinuous,
        currentTargetName: this.currentTargetName,
        activePhase: this.activePhase,
        targetSubProgress: this.targetSubProgress,
        elapsedSeconds: this.getElapsedSeconds(),
        startTimeMs: this.startTimeMs,
        pausedElapsedSeconds: this.pausedElapsedSeconds,
        targets: this.targets,
        sessionTotal: this.sessionTotal,
        processedTargetsCount: this.processedTargetsCount,
        startedAt: this.startedAt,
        zoneDiscoveredCount: this.zoneDiscoveredCount,
        zoneScannedCount: this.zoneScannedCount,
        currentCycleProgress: this.currentCycleProgress,
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // Ignore write errors
    }
  }

  private debounceSaveState() {
    if (this.stateSaveTimer) clearTimeout(this.stateSaveTimer);
    this.stateSaveTimer = setTimeout(() => {
      this.saveStateToFile();
    }, 1500);
  }

  public getStatus(): DaemonStatusPayload {
    const isTldZoneActive = Boolean(
      this.currentTargetName && (this.currentTargetName.startsWith('.') || this.currentTargetName.startsWith('*.'))
    );

    return {
      status: this.status,
      cycleCount: this.cycleCount,
      isContinuous: this.isContinuous,
      currentTargetName: this.currentTargetName,
      activePhase: this.activePhase,
      targetSubProgress: this.targetSubProgress,
      elapsedSeconds: this.getElapsedSeconds(),
      targets: this.targets,
      sessionTotal: this.sessionTotal,
      processedTargetsCount: this.processedTargetsCount,
      activeWorkersList: Array.from(this.activeWorkers.values()),
      activeTargetResult: this.activeTargetResult,
      zoneDiscoveredCount: this.zoneDiscoveredCount,
      zoneScannedCount: this.zoneScannedCount,
      currentCycleProgress: this.currentCycleProgress,
      startedAt: this.startedAt,
      isTldZoneActive,
      activeZoneRootDomains: this.zoneDiscoveredCount,
      activeZoneScannedDomains: this.zoneScannedCount,
      activeZoneSubdomains: this.activeTargetResult?.subdomains || 0,
      activeZoneEmails: this.activeTargetResult?.emails || 0,
      activeZonePhones: this.activeTargetResult?.phones || 0,
    };
  }

  public async start(targets: TargetItem[], options?: { isContinuous?: boolean; cycle?: number }) {
    if (Array.isArray(targets) && targets.length > 0) {
      // Deduplicate and merge targets
      const existingIds = new Set(this.targets.map((t) => t.id));
      const newItems = targets.filter((t) => !existingIds.has(t.id));
      this.targets = [...this.targets, ...newItems];

      // Mark un-crawled targets as pending
      for (const t of this.targets) {
        if (!t.status || t.status === 'completed' || t.status === 'cancelled') {
          t.status = 'pending';
        }
      }
    }

    if (options?.isContinuous !== undefined) {
      this.isContinuous = options.isContinuous;
    }
    if (options?.cycle !== undefined && options.cycle > 0) {
      this.cycleCount = options.cycle;
    }

    if (this.targets.length === 0) {
      return this.getStatus();
    }

    this.status = 'RUNNING';
    this.startedAt = new Date().toISOString();
    this.startTimeMs = Date.now();
    this.pausedElapsedSeconds = 0;
    this.sessionTotal = this.targets.length;
    this.processedTargetsCount = 0;
    this.targetSubProgress = 1;
    this.currentCycleProgress = 1;
    this.activeWorkers.clear();
    this.activeTargetResult = null;
    this.zoneDiscoveredCount = 0;
    this.zoneScannedCount = 0;
    this.saveStateToFile();

    if (!this.isLoopRunning) {
      this.runAutonomousLoop();
    }

    return this.getStatus();
  }

  public enqueueTargets(newTargets: TargetItem[]) {
    if (!newTargets || newTargets.length === 0) return this.getStatus();
    const existingIds = new Set(this.targets.map((t) => t.id));
    const toAdd = newTargets.filter((t) => !existingIds.has(t.id));
    if (toAdd.length > 0) {
      for (const t of toAdd) {
        t.status = 'pending';
      }
      this.targets = [...this.targets, ...toAdd];
      this.sessionTotal = this.targets.length;
      this.debounceSaveState();

      if (this.status === 'RUNNING' && !this.isLoopRunning) {
        this.runAutonomousLoop();
      }
    }
    return this.getStatus();
  }

  public pause() {
    this.pausedElapsedSeconds = this.getElapsedSeconds();
    this.startTimeMs = null;
    this.status = 'PAUSED';
    this.activePhase = 'Crawler Paused by Operator';
    for (const t of this.targets) {
      if (t.status === 'crawling') {
        t.status = 'paused';
      }
    }
    this.saveStateToFile();
    return this.getStatus();
  }

  public resume() {
    this.status = 'RUNNING';
    this.startTimeMs = Date.now();
    this.activePhase = `Resuming Crawler • Cycle #${this.cycleCount}`;
    for (const t of this.targets) {
      if (t.status === 'paused') {
        t.status = 'pending';
      }
    }
    this.saveStateToFile();

    if (!this.isLoopRunning) {
      this.runAutonomousLoop();
    }
    return this.getStatus();
  }

  public async stop() {
    this.pausedElapsedSeconds = this.getElapsedSeconds();
    this.startTimeMs = null;
    this.status = 'COMPLETED';
    this.activePhase = 'Crawler Stopped';
    this.currentTargetName = null;
    this.targetSubProgress = 100;
    this.currentCycleProgress = 100;
    this.activeWorkers.clear();

    for (const t of this.targets) {
      if (t.status === 'crawling' || t.status === 'paused' || t.status === 'pending') {
        t.status = 'completed';
      }
    }

    this.saveStateToFile();

    try {
      await redisQueue.setControlState('CANCELLED');
    } catch {}

    return this.getStatus();
  }

  public reset() {
    this.status = 'IDLE';
    this.cycleCount = 1;
    this.isContinuous = true;
    this.currentTargetName = null;
    this.activePhase = 'Standby';
    this.targetSubProgress = 0;
    this.targets = [];
    this.sessionTotal = 0;
    this.processedTargetsCount = 0;
    this.startedAt = null;
    this.startTimeMs = null;
    this.pausedElapsedSeconds = 0;
    this.activeWorkers.clear();
    this.activeTargetResult = null;
    this.zoneDiscoveredCount = 0;
    this.zoneScannedCount = 0;
    this.currentCycleProgress = 0;
    this.currentCycleTotalCount = 0;

    try {
      if (fs.existsSync(DAEMON_STATE_FILE)) {
        fs.unlinkSync(DAEMON_STATE_FILE);
      }
    } catch {}

    return this.getStatus();
  }

  /**
   * Continuous Autonomous Server Loop (Runs 24/7 independently in Node.js)
   */
  private async runAutonomousLoop() {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;

    console.log(`[CrawlerDaemon] 🚀 Started autonomous 24/7 background execution loop.`);

    try {
      while (
        (this.status as CrawlerExecutionState) === 'RUNNING' ||
        (this.status as CrawlerExecutionState) === 'PAUSED'
      ) {
        // Handle PAUSED state
        while ((this.status as CrawlerExecutionState) === 'PAUSED') {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (this.status !== 'RUNNING') break;

        if (this.targets.length === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // Find next target in queue
        let target = this.targets.find((t) => !t.status || t.status === 'pending');

        if (!target) {
          if (this.isContinuous) {
            // Milestone: Cycle 100% completed across all targets in queue
            this.currentCycleProgress = 100;
            this.targetSubProgress = 100;
            this.activePhase = `✅ Cycle #${this.cycleCount} Complete (100%) • Continuous 24/7 Engine Active • Advancing to Cycle #${this.cycleCount + 1}...`;
            this.saveStateToFile();

            // Wait 3 seconds so user sees 100% cycle complete milestone clearly
            await new Promise((r) => setTimeout(r, 3000));
            if (this.status !== 'RUNNING') break;

            const nextCycle = this.cycleCount + 1;
            this.cycleCount = nextCycle;
            this.currentCycleProgress = 1;
            this.targetSubProgress = 1;
            this.processedTargetsCount = 0;

            for (const t of this.targets) {
              t.status = 'pending';
            }
            target = this.targets[0];
            this.saveStateToFile();
          } else {
            this.status = 'COMPLETED';
            this.activePhase = 'All targets processed';
            this.targetSubProgress = 100;
            this.currentCycleProgress = 100;
            this.currentTargetName = null;
            this.activeWorkers.clear();
            this.saveStateToFile();
            break;
          }
        }

        if (!target) continue;

        // ONLY strictly dot-prefixed (.in, .com) or type === 'tld_zone' are TLD zones.
        // Specific domains like gov.in or gov.pk are standard single target domains!
        const isTldTarget =
          target.type === 'tld_zone' ||
          target.domain.startsWith('.') ||
          target.domain.startsWith('*.');

        if (isTldTarget) {
          await this.executeTldZonePass(target);
        } else {
          await this.executeSingleDomainPass(target);
        }

        if (this.status !== 'RUNNING' && this.status !== 'PAUSED') break;

        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (loopErr) {
      console.error('[CrawlerDaemon] Unexpected error in autonomous loop:', loopErr);
    } finally {
      this.isLoopRunning = false;
      console.log(`[CrawlerDaemon] Autonomous loop exited. Current status: ${this.status}`);
      this.saveStateToFile();
    }
  }

  /**
   * Single Domain Deep Crawl Execution
   */
  private async executeSingleDomainPass(target: TargetItem) {
    target.status = 'crawling';
    this.currentTargetName = target.domain;
    this.targetSubProgress = 10;
    this.debounceSaveState();

    const cycle = this.cycleCount;
    const w1Id = `${target.id}_worker1`;
    const w2Id = `${target.id}_worker2`;
    const w3Id = `${target.id}_worker3`;

    this.activeWorkers.set(w1Id, {
      id: w1Id,
      domain: target.domain,
      subTarget: 'Active Discovery & Web Crawler',
      progress: 10,
      pagesCrawled: 0,
      subdomainsCount: 0,
      emailsCount: 0,
      phase: `⚡ [Worker #1: Scraper] Crawling ${target.domain} & live web pages (Cycle #${cycle})`,
    });

    this.activeWorkers.set(w2Id, {
      id: w2Id,
      domain: target.domain,
      subTarget: 'Deduplication & Noise Filter',
      progress: 10,
      pagesCrawled: 0,
      subdomainsCount: 0,
      emailsCount: 0,
      phase: `🛡️ [Worker #2: Filter] Deduplicating & Normalizing • Cycle #${cycle}`,
    });

    this.activeWorkers.set(w3Id, {
      id: w3Id,
      domain: target.domain,
      subTarget: 'Live Database Syncer',
      progress: 10,
      pagesCrawled: 0,
      subdomainsCount: 0,
      emailsCount: 0,
      phase: `📡 [Worker #3: Syncer] Live telemetry streaming • Cycle #${cycle} active`,
    });

    this.activePhase = `⚡ Deep Recon & Subdomains: ${target.domain} (Cycle #${cycle})`;

    try {
      const maxPages = 15;
      const maxDepth = 3;

      const result = await crawlDomain(target.domain, {
        cycle,
        maxPages,
        maxDepth,
        delayMs: 200,
        isExplicitTarget: true,
        skipSubdomainRecon: false,
        onProgress: (pages, subdomains, emails) => {
          const w1 = this.activeWorkers.get(w1Id);
          if (w1) {
            w1.pagesCrawled = pages;
            w1.subdomainsCount = subdomains;
            w1.emailsCount = emails;
            w1.progress = Math.min(95, Math.max(15, Math.round((pages / maxPages) * 75) + 15));
            w1.phase = `⚡ [Worker #1: Scraper] Crawling pages (${pages}/${maxPages}) • Extracting links & subdomains`;
          }

          const w2 = this.activeWorkers.get(w2Id);
          if (w2) {
            w2.pagesCrawled = pages;
            w2.subdomainsCount = subdomains;
            w2.emailsCount = emails;
            w2.progress = Math.min(95, Math.max(20, Math.round((pages / maxPages) * 75) + 20));
          }

          const w3 = this.activeWorkers.get(w3Id);
          if (w3) {
            w3.pagesCrawled = pages;
            w3.subdomainsCount = subdomains;
            w3.emailsCount = emails;
            w3.progress = Math.min(95, Math.max(10, Math.round((pages / maxPages) * 70) + 10));
          }

          this.activeTargetResult = {
            subdomains,
            emails,
            phones: 0,
            pages,
          };
          this.targetSubProgress = Math.min(95, Math.round((pages / maxPages) * 80) + 15);
          this.activePhase = `⚡ Deep Recon & Subdomains: ${target.domain} (Cycle #${cycle}) • ${subdomains} Subdomains Discovered`;
          this.debounceSaveState();
        },
      });

      target.status = 'completed';
      this.processedTargetsCount++;
      this.targetSubProgress = 100;
      this.activeWorkers.clear();
      this.activeTargetResult = {
        subdomains: result.subdomainCount || 0,
        emails: result.emailCount || 0,
        phones: result.phones?.length || 0,
        pages: result.pagesCrawled || 0,
      };
      this.activePhase = `✅ Completed crawl for ${target.domain} (${result.subdomainCount} subdomains, ${result.emailCount} emails)`;
      this.saveStateToFile();
    } catch (err: any) {
      console.error(`[CrawlerDaemon] Error crawling ${target.domain}:`, err);
      target.status = 'failed';
      this.activeWorkers.clear();
      this.debounceSaveState();
    }
  }

  /**
   * 24/7 TLD Zone Discovery & Continuous Scraping Execution with Multi-Worker Parallel Pool
   */
  private async executeTldZonePass(target: TargetItem) {
    target.status = 'crawling';
    this.currentTargetName = target.domain;
    this.activePhase = `🌐 [${target.domain} Zone] Discovering root domains (Cycle #${this.cycleCount})`;
    this.debounceSaveState();

    try {
      const cleanTld = normalizeTld(target.domain);
      const discResult = await discoverTldRootDomains(cleanTld, {
        cycle: this.cycleCount,
        maxPerPass: 250,
      });

      const rawDiscoveredList = Array.isArray(discResult.allDomains) ? discResult.allDomains : [];
      const isBroadIndiaTld = target.domain === '.in' || target.domain === '*.in' || target.domain === 'in';
      const discoveredList: string[] = [];
      const seenDom = new Set<string>();

      for (const rawD of rawDiscoveredList) {
        let norm = (rawD || '').toLowerCase().trim();
        if (isBroadIndiaTld) {
          if (norm !== 'gov.in' && norm.endsWith('.gov.in')) norm = 'gov.in';
          else if (norm !== 'nic.in' && norm.endsWith('.nic.in')) norm = 'nic.in';
        }
        if (norm && !seenDom.has(norm)) {
          seenDom.add(norm);
          discoveredList.push(norm);
        }
      }

      this.zoneDiscoveredCount = Math.max(discResult.totalDiscovered || 0, discoveredList.length);
      this.currentCycleTotalCount = Math.max(1, discoveredList.length);
      this.currentCycleProgress = 1;
      this.targetSubProgress = 1;
      this.zoneScannedCount = 0;
      this.saveStateToFile();

      // Parallel Multi-Worker Concurrency Pool (3 Concurrency Slots)
      let queueIndex = 0;
      let completedInCycle = 0;
      const totalInCycle = Math.max(1, discoveredList.length);

      const runWorker = async (slotIdx: number) => {
        const workerKey = `${target.id}_worker_${slotIdx}`;

        while (
          queueIndex < discoveredList.length &&
          ((this.status as CrawlerExecutionState) === 'RUNNING' ||
            (this.status as CrawlerExecutionState) === 'PAUSED')
        ) {
          while ((this.status as CrawlerExecutionState) === 'PAUSED') {
            await new Promise((r) => setTimeout(r, 400));
          }
          if (this.status !== 'RUNNING') break;

          const myIndex = queueIndex++;
          if (myIndex >= discoveredList.length) break;
          const subDomainTarget = discoveredList[myIndex];

          this.activeWorkers.set(workerKey, {
            id: workerKey,
            domain: subDomainTarget,
            subTarget: subDomainTarget,
            subIndex: myIndex + 1,
            totalSubTargets: discoveredList.length,
            progress: 10,
            pagesCrawled: 0,
            subdomainsCount: 0,
            emailsCount: 0,
            phase: `⚡ Verifying Main Domain: ${subDomainTarget} (${myIndex + 1}/${discoveredList.length}) [Cycle #${this.cycleCount}]`,
          });
          this.debounceSaveState();

          try {
            await crawlDomain(subDomainTarget, {
              maxPages: 1,
              maxDepth: 0,
              delayMs: 100,
              tldZone: target.domain,
              isExplicitTarget: false,
              skipSubdomainRecon: true,
            });
          } catch (subErr) {
            // Ignore single domain crawl failure in TLD pass
          }

          completedInCycle++;
          this.zoneScannedCount = completedInCycle;

          const activeWorkersList = Array.from(this.activeWorkers.values());
          const workerSum = activeWorkersList.reduce((acc, w) => acc + (w.progress || 0), 0);
          const workerFraction = activeWorkersList.length > 0 ? workerSum / (activeWorkersList.length * 100) : 0;
          const currentDone = Math.min(totalInCycle, completedInCycle + workerFraction);
          const rawPct = Math.min(99, Math.round((currentDone / totalInCycle) * 100));

          this.currentCycleProgress = Math.max(this.currentCycleProgress, Math.max(1, rawPct));
          this.targetSubProgress = this.currentCycleProgress;
          this.debounceSaveState();
        }

        this.activeWorkers.delete(workerKey);
      };

      // Run 3 workers concurrently on the server!
      await Promise.all([runWorker(0), runWorker(1), runWorker(2)]);

      if (this.status !== 'RUNNING') return;

      // Cycle reached 100% for this target
      target.status = 'completed';
      this.currentCycleProgress = 100;
      this.targetSubProgress = 100;
      this.zoneScannedCount = totalInCycle;
      this.processedTargetsCount++;
      this.activePhase = `✅ Completed TLD pass for ${target.domain} (${totalInCycle} root domains processed)`;
      this.saveStateToFile();
    } catch (err: any) {
      console.error(`[CrawlerDaemon] Error in TLD pass for ${target.domain}:`, err);
      target.status = 'failed';
      this.debounceSaveState();
    }
  }
}

// Global Singleton Instance across Next.js Hot Module Reloads & API calls
declare global {
  var __crawlerDaemonInstance: CrawlerDaemon | undefined;
}

export function getCrawlerDaemon(): CrawlerDaemon {
  if (!global.__crawlerDaemonInstance) {
    global.__crawlerDaemonInstance = new CrawlerDaemon();
  }
  return global.__crawlerDaemonInstance;
}
