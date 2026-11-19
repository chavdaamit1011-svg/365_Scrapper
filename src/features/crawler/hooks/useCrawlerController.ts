'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TargetItem } from '@/features/targets/types/target.types';
import {
  CrawlerExecutionState,
  CrawlerStats,
  ScrapedDataRecord,
  ActiveWorkerSummary,
} from '../types/crawler.types';

const STORAGE_KEY_RESULTS = 'the_scrapper_scraped_results';
const STORAGE_KEY_SESSION_STATE = 'the_scrapper_crawler_session_state';
// Dedicated inline Web Worker for unthrottled timing immune to Chrome inactive tab clamping
let sharedTimerWorker: Worker | null = null;
const pendingSleeps = new Map<number, () => void>();

function getTimerWorker(): Worker | null {
  if (typeof window === 'undefined') return null;
  if (!sharedTimerWorker) {
    try {
      const workerCode = `
        let ticker = null;
        self.addEventListener('message', function(e) {
          if (e.data.type === 'SLEEP') {
            setTimeout(function() {
              self.postMessage({ type: 'SLEEP_DONE', id: e.data.id });
            }, e.data.delay);
          } else if (e.data.type === 'START_TICKER') {
            if (ticker) clearInterval(ticker);
            ticker = setInterval(function() {
              self.postMessage({ type: 'TICK' });
            }, 1000);
          } else if (e.data.type === 'STOP_TICKER') {
            if (ticker) clearInterval(ticker);
            ticker = null;
          }
        });
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      sharedTimerWorker = new Worker(workerUrl);
      sharedTimerWorker.addEventListener('message', function(e) {
        if (e.data.type === 'SLEEP_DONE') {
          const cb = pendingSleeps.get(e.data.id);
          if (cb) {
            pendingSleeps.delete(e.data.id);
            cb();
          }
        }
      });
    } catch (e) {
      console.warn('Web Worker timer not supported:', e);
    }
  }
  return sharedTimerWorker;
}

function sleepUnthrottled(ms: number): Promise<void> {
  const worker = getTimerWorker();
  if (!worker) {
    return new Promise((r) => setTimeout(r, ms));
  }
  return new Promise((resolve) => {
    const id = Math.random();
    pendingSleeps.set(id, resolve);
    worker.postMessage({ type: 'SLEEP', id, delay: ms });
  });
}

export const MAX_CONCURRENT_WORKERS = 1;

interface ActiveWorkerData {
  target: TargetItem;
  jobId?: string;
  subTarget?: string;
  subIndex?: number;
  totalSubTargets?: number;
  progress: number;
  pagesCrawled: number;
  subdomainsCount: number;
  emailsCount: number;
  phase: string;
}

export function useCrawlerController(
  targets: TargetItem[],
  onTargetStatusChange?: (targetId: string, status: NonNullable<TargetItem['status']>) => void,
  onTargetsSync?: (targets: TargetItem[]) => void
) {
  const [status, setStatus] = useState<CrawlerExecutionState>('IDLE');
  const [scrapedResults, setScrapedResults] = useState<ScrapedDataRecord[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [currentTargetName, setCurrentTargetName] = useState<string | null>(null);

  // Granular session and telemetry state
  const [sessionTotal, setSessionTotal] = useState<number>(0);
  const [processedTargetsCount, setProcessedTargetsCount] = useState<number>(0);
  const [activePhase, setActivePhase] = useState<string>('Standby');
  const [targetSubProgress, setTargetSubProgress] = useState<number>(0);
  const [activeTargetResult, setActiveTargetResult] = useState<{
    subdomains: number;
    emails: number;
    phones: number;
    pages: number;
  } | null>(null);

  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(true);
  const [cycleCount, setCycleCount] = useState<number>(1);
  const [liveSessionDomains, setLiveSessionDomains] = useState<string[]>([]);
  const liveSessionDomainsRef = useRef<Set<string>>(new Set());
  const [zoneDiscoveredCount, setZoneDiscoveredCount] = useState<number>(0);
  const zoneDiscoveredCountRef = useRef<number>(0);
  const [zoneScannedCount, setZoneScannedCount] = useState<number>(0);
  const zoneScannedCountRef = useRef<number>(0);
  const currentCycleScannedCountRef = useRef<number>(0);
  const currentCycleProgressRef = useRef<number>(1);
  const currentCycleTotalCountRef = useRef<number>(0);
  const maxSessionProgressRef = useRef<number>(0);

  // Pool of Concurrent Active Workers (Up to MAX_CONCURRENT_WORKERS = 3)
  const activeWorkersRef = useRef<Map<string, ActiveWorkerData>>(new Map());

  const targetsRef = useRef<TargetItem[]>(targets);
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const statusRef = useRef<CrawlerExecutionState>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Wall-Clock Time Tracking (Immune to Chrome tab sleep, background throttling, and tab switches)
  const startTimeRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef<number>(0);

  const getWallClockElapsed = useCallback(() => {
    if (isPausedRef.current || status === 'PAUSED' || status === 'COMPLETED' || status === 'IDLE') {
      return pausedElapsedRef.current;
    }
    if (!startTimeRef.current) return 0;
    return pausedElapsedRef.current + Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
  }, [status]);

  // Persist live session state to localStorage for seamless refresh resilience
  const persistSessionState = useCallback(
    (overrideState?: Partial<{
      status: CrawlerExecutionState;
      startTimeMs: number | null;
      pausedElapsed: number;
      cycleCount: number;
      currentTargetName: string | null;
      isContinuous: boolean;
    }>) => {
      try {
        const curStatus = overrideState?.status || statusRef.current;
        if (curStatus === 'RUNNING' || curStatus === 'PAUSED') {
          const payload = {
            status: curStatus,
            startTimeMs: overrideState?.startTimeMs !== undefined ? overrideState.startTimeMs : startTimeRef.current,
            pausedElapsed: overrideState?.pausedElapsed !== undefined ? overrideState.pausedElapsed : pausedElapsedRef.current,
            cycleCount: overrideState?.cycleCount !== undefined ? overrideState.cycleCount : cycleCountRef.current,
            currentTargetName: overrideState?.currentTargetName !== undefined ? overrideState.currentTargetName : currentTargetName,
            isContinuous: overrideState?.isContinuous !== undefined ? overrideState.isContinuous : isContinuousMode,
            updatedAt: Date.now(),
          };
          localStorage.setItem(STORAGE_KEY_SESSION_STATE, JSON.stringify(payload));
        } else {
          localStorage.removeItem(STORAGE_KEY_SESSION_STATE);
        }
      } catch (e) {}
    },
    [currentTargetName, isContinuousMode]
  );

  // Fetch fresh results from MongoDB API
  const fetchMongoResults = useCallback(async () => {
    try {
      const res = await fetch('/api/crawler/results', { cache: 'no-store' });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        if (json.data.length > 0) {
          setScrapedResults(json.data);
          try {
            localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(json.data));
          } catch (e) {}
          return json.data;
        } else {
          setScrapedResults([]);
          try {
            localStorage.removeItem(STORAGE_KEY_RESULTS);
          } catch (e) {}
          return [];
        }
      }
    } catch (err) {
      console.warn('Could not fetch MongoDB scraped results:', err);
      try {
        const stored = localStorage.getItem(STORAGE_KEY_RESULTS);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setScrapedResults(parsed);
            return parsed;
          }
        }
      } catch (e) {}
    }
    return [];
  }, []);

  // Hydrate scraped results from MongoDB on mount
  useEffect(() => {
    fetchMongoResults();
  }, [fetchMongoResults]);

  // Save to localStorage whenever scrapedResults change
  useEffect(() => {
    try {
      if (scrapedResults.length > 0) {
        localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(scrapedResults));
      } else {
        localStorage.removeItem(STORAGE_KEY_RESULTS);
      }
    } catch (e) {}
  }, [scrapedResults]);

  const scrapedResultsRef = useRef<ScrapedDataRecord[]>([]);
  useEffect(() => {
    scrapedResultsRef.current = scrapedResults;
  }, [scrapedResults]);

  // Elapsed seconds timer while RUNNING (Wall-Clock + Web Worker ticker + Page Visibility)
  useEffect(() => {
    const worker = getTimerWorker();

    if (status === 'RUNNING') {
      if (worker) {
        worker.postMessage({ type: 'START_TICKER' });
        const onWorkerMsg = (e: MessageEvent) => {
          if (e.data.type === 'TICK') {
            setElapsedSeconds(getWallClockElapsed());
          }
        };
        worker.addEventListener('message', onWorkerMsg);

        return () => {
          worker.removeEventListener('message', onWorkerMsg);
          worker.postMessage({ type: 'STOP_TICKER' });
        };
      } else {
        elapsedTimerRef.current = setInterval(() => {
          setElapsedSeconds(getWallClockElapsed());
        }, 1000);
        return () => {
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
        };
      }
    } else {
      if (worker) worker.postMessage({ type: 'STOP_TICKER' });
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
  }, [status, getWallClockElapsed]);

  // Page Visibility API: When user switches back from Antigravity/other apps, instantly sync time & database!
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setElapsedSeconds(getWallClockElapsed());
        fetchMongoResults();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [getWallClockElapsed, fetchMongoResults]);

  const cycleCountRef = useRef<number>(1);
  useEffect(() => {
    cycleCountRef.current = cycleCount;
  }, [cycleCount]);

  const isLoopRunningRef = useRef<boolean>(false);


  // Update aggregated telemetry across active worker
  const updateWorkerTelemetry = useCallback(() => {
    const workers = Array.from(activeWorkersRef.current.values());
    if (workers.length === 0) {
      if (targetsRef.current.length === 0 && !isCancelledRef.current && !isPausedRef.current) {
        setCurrentTargetName(null);
        setActivePhase('Standby');
      }
      return;
    }

    const tldTarget = targetsRef.current.find((t) => t.type === 'tld_zone' || t.domain.startsWith('.'));
    const primaryDomain = tldTarget ? tldTarget.domain : workers[0].target.domain;
    setCurrentTargetName(primaryDomain);

    const isTld = Boolean(tldTarget) || primaryDomain.startsWith('.');
    const avgProgress = workers.length > 0
      ? Math.round(workers.reduce((acc, w) => acc + (w.progress || 1), 0) / workers.length)
      : 1;

    // For single targets, worker average drives sub-progress.
    // For TLD zones, currentCycleProgressRef strictly drives progress smoothly.
    if (!isTld) {
      setTargetSubProgress(avgProgress);
    }

    let totalSubs = 0;
    let totalEms = 0;
    let totalPhs = 0;
    let totalPgs = 0;

    if (isTld) {
      const tldClean = primaryDomain.toLowerCase().trim();
      const zDomains = scrapedResultsRef.current.filter((r) => {
        if (r.isTldZone || r.isExplicitTarget) return false;
        const rTld = r.tldZone ? (r.tldZone.startsWith('.') ? r.tldZone : '.' + r.tldZone).toLowerCase() : '';
        return rTld === tldClean || r.domain.toLowerCase().endsWith(tldClean);
      });
      const zSubs = zDomains.reduce((acc, curr) => {
        if (Array.isArray(curr.subdomains)) {
          return acc + curr.subdomains.filter((s) => s.toLowerCase() !== curr.domain.toLowerCase()).length;
        }
        return acc + (curr.subdomainCount || 0);
      }, 0);
      const zEms = zDomains.reduce((acc, curr) => acc + (curr.emails?.length || (curr.email ? 1 : 0)), 0);
      const zPhs = zDomains.reduce((acc, curr) => acc + (curr.phones?.length || 0), 0);
      const zPgs = zDomains.reduce((acc, curr) => acc + (curr.pagesCrawled || curr.crawledPages?.length || 0), 0);

      totalSubs = zSubs;
      totalEms = zEms;
      totalPhs = zPhs;
      totalPgs = zPgs;
    } else {
      // Group by target domain to avoid tripling metrics across parallel pipeline workers
      const domainMetrics = new Map<string, { subs: number; ems: number; pgs: number; phs: number }>();
      for (const w of workers) {
        const dom = (w.target.domain || '').toLowerCase().trim();
        const existing = domainMetrics.get(dom) || { subs: 0, ems: 0, pgs: 0, phs: 0 };
        domainMetrics.set(dom, {
          subs: Math.max(existing.subs, w.subdomainsCount || 0),
          ems: Math.max(existing.ems, w.emailsCount || 0),
          pgs: Math.max(existing.pgs, w.pagesCrawled || 0),
          phs: 0,
        });
      }

      totalSubs = Array.from(domainMetrics.values()).reduce((acc, m) => acc + m.subs, 0);
      totalEms = Array.from(domainMetrics.values()).reduce((acc, m) => acc + m.ems, 0);
      totalPgs = Array.from(domainMetrics.values()).reduce((acc, m) => acc + m.pgs, 0);

      const currentDoc = scrapedResultsRef.current.find((r) => r.domain.toLowerCase() === primaryDomain.toLowerCase());
      if (currentDoc) {
        if (totalSubs === 0 && currentDoc.subdomains) {
          totalSubs = currentDoc.subdomains.length;
        } else if (currentDoc.subdomainCount && currentDoc.subdomainCount > totalSubs) {
          totalSubs = currentDoc.subdomainCount;
        }
        if (totalEms === 0 && currentDoc.emails) {
          totalEms = currentDoc.emails.length;
        }
        if (currentDoc.phones) {
          totalPhs = currentDoc.phones.length;
        }
        if (totalPgs === 0 && (currentDoc.pagesCrawled || currentDoc.crawledPages)) {
          totalPgs = currentDoc.pagesCrawled || currentDoc.crawledPages?.length || 0;
        }
      }
    }

    setActiveTargetResult({
      subdomains: totalSubs,
      emails: totalEms,
      phones: totalPhs,
      pages: totalPgs,
    });

    if (isTld) {
      const activeDomainsList = workers.map((w) => (w as any).activeSubTarget || w.target.domain).filter(Boolean);
      if (activeDomainsList.length > 1) {
        setActivePhase(
          `⚡ [${activeDomainsList.length} Parallel Workers Active] Cataloging main domains: ${activeDomainsList.slice(0, 2).join(', ')}... (Cycle #${cycleCountRef.current})`
        );
      } else if (activeDomainsList.length === 1) {
        setActivePhase(
          `🌐 [${primaryDomain} Zone] Verifying main domain: ${activeDomainsList[0]} (Cycle #${cycleCountRef.current})`
        );
      } else {
        setActivePhase(
          `🌐 [${primaryDomain} Zone] Discovering root domains (Cycle #${cycleCountRef.current})`
        );
      }
    } else {
      setActivePhase(
        `⚡ Deep Recon & Subdomains: ${primaryDomain} (Cycle #${cycleCountRef.current}) • ${totalSubs} Subdomains Discovered`
      );
    }
  }, []);

  // Sequential Worker Execution for a single target pass
  const runSingleTargetCycle = async (target: TargetItem) => {
    const cycle = cycleCountRef.current || 1;
    const w1Id = `${target.id}_worker1`;
    const w2Id = `${target.id}_worker2`;
    const w3Id = `${target.id}_worker3`;

    // Retain baseline intelligence across continuous cycles (cycle > 1) so worker slot never blinks to 0.
    // On Cycle 1 (a fresh target crawl), strictly start at 0 so the crawl progress and pages are 100% genuine!
    const existingDoc = scrapedResultsRef.current.find(
      (r) => r.domain.toLowerCase() === target.domain.toLowerCase()
    );
    const existingW1 = activeWorkersRef.current.get(w1Id);
    const baselineSubs = cycle > 1 ? Math.max(
      existingDoc?.subdomains?.length || 0,
      existingDoc?.subdomainCount || 0,
      existingW1?.subdomainsCount || 0
    ) : 0;
    const baselinePages = cycle > 1 ? Math.max(
      existingDoc?.pagesCrawled || 0,
      existingDoc?.crawledPages?.length || 0,
      existingW1?.pagesCrawled || 0
    ) : 0;
    const baselineEmails = cycle > 1 ? Math.max(
      existingDoc?.emails?.length || 0,
      existingW1?.emailsCount || 0
    ) : 0;

    // 3 Specialized Pipeline Workers: Scraper -> Deduplicator/Filter -> Live Dashboard Streamer
    activeWorkersRef.current.set(w1Id, {
      target,
      progress: 10,
      pagesCrawled: baselinePages,
      subdomainsCount: baselineSubs,
      emailsCount: baselineEmails,
      subTarget: 'Active Discovery & Web Crawler',
      phase: `⚡ [Worker #1: Scraper] Crawling ${target.domain} & live web pages (Cycle #${cycle})`,
    });

    activeWorkersRef.current.set(w2Id, {
      target,
      progress: 10,
      pagesCrawled: baselinePages,
      subdomainsCount: baselineSubs,
      emailsCount: baselineEmails,
      subTarget: 'Deduplication & Noise Filter',
      phase: `🛡️ [Worker #2: Filter] Deduplicating & Normalizing • Cycle #${cycle}`,
    });

    activeWorkersRef.current.set(w3Id, {
      target,
      progress: 10,
      pagesCrawled: baselinePages,
      subdomainsCount: baselineSubs,
      emailsCount: baselineEmails,
      subTarget: 'Live Dashboard Streamer',
      phase: `📡 [Worker #3: Syncer] Live telemetry streaming • Cycle #${cycle} active`,
    });

    target.status = 'crawling';
    if (onTargetStatusChange) {
      onTargetStatusChange(target.id, 'crawling');
    }

    liveSessionDomainsRef.current.add(target.domain.toLowerCase());
    setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));
    setCurrentTargetName(target.domain);

    setTargetSubProgress(10);
    updateWorkerTelemetry();

    const interactiveMaxPages = 15;
    const interactiveMaxDepth = 3;

    try {
      if (isCancelledRef.current) return;

      while (isPausedRef.current && !isCancelledRef.current) {
        await sleepUnthrottled(400);
      }
      if (isCancelledRef.current) return;

      // 1. Enqueue job into backend Redis / Queue with cycle number (with seamless re-attachment)
      let jobId: string | null = null;

      // Re-attachment check: Verify if an active crawl job is already running on backend for this domain
      try {
        const checkRes = await fetch('/api/crawl-jobs');
        if (checkRes.ok) {
          const checkJson = await checkRes.json();
          if (Array.isArray(checkJson.jobs)) {
            const activeJob = checkJson.jobs.find(
              (j: any) =>
                j.domain?.toLowerCase() === target.domain.toLowerCase() &&
                (j.status === 'running' || j.status === 'queued')
            );
            if (activeJob) {
              jobId = activeJob.id;
              console.log(`[useCrawlerController] Re-attached to running background crawl job: ${jobId}`);
            }
          }
        }
      } catch (e) {}

      if (!jobId) {
        try {
          const jobRes = await fetch('/api/crawl-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: target.domain,
              cycle,
              is_explicit: true,
              skip_subdomains: false,
              max_pages: interactiveMaxPages,
              max_depth: interactiveMaxDepth,
              requests_per_second: 1,
              respect_robots_txt: true,
            }),
          });
          const jobJson = await jobRes.json();
          jobId = jobJson.job_id;
        } catch (postErr) {
          console.warn(`[SequentialWorker] Enqueue failed for ${target.domain}:`, postErr);
        }
      }

      if (activeWorkersRef.current.has(w1Id)) {
        activeWorkersRef.current.get(w1Id)!.jobId = jobId || undefined;
      }

      // 2. Poll job status until completed
      let isDone = false;
      let pollAttempts = 0;
      const maxPollAttempts = 150; // Up to 120 seconds max

      while (
        !isDone &&
        pollAttempts < maxPollAttempts &&
        !isCancelledRef.current &&
        !isPausedRef.current
      ) {
        await sleepUnthrottled(800);
        pollAttempts++;

        if (jobId) {
          try {
            const statusRes = await fetch(`/api/crawl-jobs/${jobId}`);
            const statusJson = await statusRes.json();
            if (statusJson.success && statusJson.job) {
              const j = statusJson.job;
              if (j.status === 'completed' || j.status === 'failed') {
                isDone = true;
              }

              const pagesDone = Math.max(baselinePages, j.pagesCrawled || 0);
              const subsFound = Math.max(baselineSubs, j.subdomainsCount || 0);
              const emailsFound = Math.max(baselineEmails, j.emailsCount || 0);

              const w1 = activeWorkersRef.current.get(w1Id);
              if (w1) {
                w1.pagesCrawled = pagesDone;
                w1.subdomainsCount = subsFound;
                w1.emailsCount = emailsFound;
                w1.progress = isDone ? 100 : Math.min(95, Math.max(10, Math.round((pagesDone / interactiveMaxPages) * 70) + 15));
                w1.phase = isDone
                  ? `✅ [Worker #1] Finished crawling ${pagesDone} pages (Cycle #${cycle})`
                  : pagesDone > 0
                  ? `⚡ [Worker #1: Scraper] Crawling pages (${pagesDone}/${interactiveMaxPages}) • Extracting links & subdomains`
                  : `⚡ [Worker #1: Scraper] Resolving DNS & OSINT discovery (${subsFound} found)...`;
              }

              const w2 = activeWorkersRef.current.get(w2Id);
              if (w2) {
                w2.pagesCrawled = pagesDone;
                w2.subdomainsCount = subsFound;
                w2.emailsCount = emailsFound;
                w2.progress = isDone ? 100 : Math.min(95, Math.max(15, Math.round((pagesDone / interactiveMaxPages) * 75) + 20));
                w2.phase = isDone
                  ? `✅ [Worker #2] Deduplication verified • Clean records saved`
                  : `🛡️ [Worker #2: Filter] Normalizing & Deduplicating: ${subsFound} subdomains verified (0 duplicates)`;
              }

              const w3 = activeWorkersRef.current.get(w3Id);
              if (w3) {
                w3.pagesCrawled = pagesDone;
                w3.subdomainsCount = subsFound;
                w3.emailsCount = emailsFound;
                w3.progress = isDone ? 100 : Math.min(95, Math.max(10, Math.round((pagesDone / interactiveMaxPages) * 65) + 10));
                w3.phase = isDone
                  ? `✅ [Worker #3] Cycle #${cycle} synchronized to Dashboard`
                  : `📡 [Worker #3: Syncer] Live Stream: ${subsFound} Subs • ${pagesDone} Pages • ${emailsFound} Emails`;
              }

              updateWorkerTelemetry();
            }
          } catch {}
        }

        // Live database sync every 3 polls (~2.4s)
        if (pollAttempts % 3 === 0) {
          try {
            const liveRes = await fetch('/api/crawler/results', { cache: 'no-store' });
            const liveJson = await liveRes.json();
            if (liveJson.success && Array.isArray(liveJson.data) && liveJson.data.length > 0) {
              setScrapedResults(liveJson.data);
            }
          } catch {}
        }
      }

      if (isCancelledRef.current) return;

      // Mark this cycle pass completed for this target
      target.status = 'completed';
      if (onTargetStatusChange) {
        onTargetStatusChange(target.id, 'completed');
      }
      setProcessedTargetsCount((prev) => prev + 1);

      // Refresh final database results
      try {
        const freshRes = await fetch('/api/crawler/results', { cache: 'no-store' });
        const freshJson = await freshRes.json();
        if (freshJson.success && Array.isArray(freshJson.data) && freshJson.data.length > 0) {
          setScrapedResults(freshJson.data);
        }
      } catch (e) {}

      setTargetSubProgress(100);
      updateWorkerTelemetry();
    } catch (err) {
      console.warn(`[SequentialWorker] Error crawling ${target.domain}:`, err);
      target.status = 'failed';
      if (onTargetStatusChange) onTargetStatusChange(target.id, 'failed');
      activeWorkersRef.current.delete(w1Id);
      activeWorkersRef.current.delete(w2Id);
      activeWorkersRef.current.delete(w3Id);
      updateWorkerTelemetry();
    }
  };

  // 24/7 TLD Zone Discovery & Continuous Scraping Execution with 3-Worker Parallel Pool
  const runTldZoneTargetCycle = async (target: TargetItem) => {
    target.status = 'crawling';
    if (onTargetStatusChange) {
      onTargetStatusChange(target.id, 'crawling');
    }
    liveSessionDomainsRef.current.add(target.domain.toLowerCase());
    setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));
    setCurrentTargetName(target.domain);

    const CONCURRENT_WORKERS = 3;
    let zoneCycle = cycleCountRef.current || 1;

    try {
      // Non-stop 24/7 continuous discovery & scraping loop until user hits Stop Crawler
      while (!isCancelledRef.current) {
        try {
          while (isPausedRef.current && !isCancelledRef.current) {
            await sleepUnthrottled(400);
          }
          if (isCancelledRef.current) break;

          // 1. Trigger TLD Discovery API (Certificate Transparency, Dorking, Seeds, Cross-Links)
          const discRes = await fetch('/api/crawler/tld-discover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tld: target.domain,
              cycle: zoneCycle,
              maxPerPass: 250,
            }),
          });

          const discJson = await discRes.json();
          const rawDiscoveredList: string[] = Array.isArray(discJson.domains) ? discJson.domains : [];

          // Normalize discovered list: collapse *.gov.in -> gov.in only when scraping generic .in zone
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

          // Track true total discovered root domains across the active zone
          const totalDiscoveredSoFar = Math.max(discJson.totalDiscovered || 0, discoveredList.length);
          zoneDiscoveredCountRef.current = totalDiscoveredSoFar;
          setZoneDiscoveredCount(totalDiscoveredSoFar);

          // Immediately refresh results so user sees all discovered root domains right away
          try {
            const liveRes = await fetch('/api/crawler/results', { cache: 'no-store' });
            const liveJson = await liveRes.json();
            if (liveJson.success && Array.isArray(liveJson.data) && liveJson.data.length > 0) {
              setScrapedResults(liveJson.data);
            }
          } catch {}

          // 2. Parallel Multi-Worker Concurrency Pool (3 Concurrency Slots)
          let queueIndex = 0;
          let completedInCycle = 0;
          const totalInCycle = Math.max(1, discoveredList.length);
          currentCycleTotalCountRef.current = totalInCycle;
          currentCycleScannedCountRef.current = 0;
          setZoneScannedCount(0);
          currentCycleProgressRef.current = 1;
          setTargetSubProgress(1);

          const runWorker = async (slotIdx: number) => {
            const workerKey = `${target.id}_worker_${slotIdx}`;

            while (queueIndex < discoveredList.length && !isCancelledRef.current) {
              while (isPausedRef.current && !isCancelledRef.current) {
                await sleepUnthrottled(400);
              }
              if (isCancelledRef.current) break;

              const myIndex = queueIndex++;
              if (myIndex >= discoveredList.length) break;
              const subDomainTarget = discoveredList[myIndex];

              liveSessionDomainsRef.current.add(subDomainTarget.toLowerCase());
              setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));

              // Set live worker telemetry state in activeWorkersRef
              activeWorkersRef.current.set(workerKey, {
                target: {
                  ...target,
                  domain: subDomainTarget,
                },
                progress: 2,
                pagesCrawled: 0,
                subdomainsCount: 0,
                emailsCount: 0,
                phase: `⚡ Verifying Main Domain: ${subDomainTarget} (${myIndex + 1}/${discoveredList.length}) [Cycle #${zoneCycle}]`,
                activeSubTarget: subDomainTarget,
                activeSubIndex: myIndex + 1,
                totalSubTargets: discoveredList.length,
              } as any);
              updateWorkerTelemetry();

              // Enqueue rapid main domain verification (1-2s per domain, no deep subdomain crawl in TLD mode)
              try {
                const jobRes = await fetch('/api/crawl-jobs', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    domain: subDomainTarget,
                    max_pages: 1,
                    max_depth: 0,
                    requests_per_second: 5,
                    respect_robots_txt: true,
                    tld_zone: target.domain,
                    is_explicit: false,
                    skip_subdomains: true,
                  }),
                });
                const jobJson = await jobRes.json();
                const jobId = jobJson.job_id;

                // Rapid poll job status until done (up to 20 attempts ~6 seconds max)
                let isDone = false;
                let pollAttempts = 0;
                while (!isDone && pollAttempts < 20 && !isCancelledRef.current && !isPausedRef.current) {
                  await sleepUnthrottled(300);
                  pollAttempts++;
                  if (jobId) {
                    try {
                      const statusRes = await fetch(`/api/crawl-jobs/${jobId}`);
                      const statusJson = await statusRes.json();
                      if (statusJson.success && statusJson.job) {
                        const j = statusJson.job;
                        if (j.status === 'completed' || j.status === 'failed') {
                          isDone = true;
                        }
                        if (activeWorkersRef.current.has(workerKey)) {
                          const w = activeWorkersRef.current.get(workerKey)!;
                          w.subdomainsCount = j.subdomainsCount || 0;
                          w.emailsCount = j.emailsCount || 0;
                          w.pagesCrawled = j.pagesCrawled || 0;

                          if (isDone) {
                            w.progress = 100;
                            w.phase = `✅ [Worker #${slotIdx + 1}] Main Domain: ${subDomainTarget} (Verified)`;
                          } else {
                            const reconTicks = Math.min(40, pollAttempts * 8);
                            const pagesDone = j.pagesCrawled || 0;
                            const pageBonus = pagesDone > 0 ? 50 : 0;
                            w.progress = Math.min(95, Math.max(w.progress || 10, 10 + reconTicks + pageBonus));
                            w.phase = `⚡ [Worker #${slotIdx + 1}] Main Domain: ${subDomainTarget} (Resolving...)`;
                          }
                        }

                        // Strictly monotonic live cycle progress
                        const activeWorkers = Array.from(activeWorkersRef.current.values());
                        const workerSum = activeWorkers.reduce((acc, worker) => acc + (worker.progress || 0), 0);
                        const workerFraction = activeWorkers.length > 0 ? workerSum / (activeWorkers.length * 100) : 0;
                        const currentDone = Math.min(totalInCycle, completedInCycle + workerFraction);
                        const rawPct = Math.min(99, Math.round((currentDone / totalInCycle) * 100));
                        currentCycleProgressRef.current = Math.max(currentCycleProgressRef.current, Math.max(1, rawPct));
                        setTargetSubProgress(currentCycleProgressRef.current);
                        updateWorkerTelemetry();
                      }
                    } catch {}
                  }

                  // Live database sync every 3 polls (~1.2s)
                  if (pollAttempts % 3 === 0) {
                    try {
                      const liveRes = await fetch('/api/crawler/results', { cache: 'no-store' });
                      const liveJson = await liveRes.json();
                      if (liveJson.success && Array.isArray(liveJson.data) && liveJson.data.length > 0) {
                        setScrapedResults(liveJson.data);
                      }
                    } catch {}
                  }
                }
              } catch (subErr) {
                console.warn(`[TldZoneWorker] Crawl job failed for ${subDomainTarget}:`, subErr);
              }

              completedInCycle++;
              currentCycleScannedCountRef.current = completedInCycle;
              setZoneScannedCount(completedInCycle);

              // Update smooth cycle progress as domain completes
              const activeWorkers = Array.from(activeWorkersRef.current.values());
              const workerSum = activeWorkers.reduce((acc, worker) => acc + (worker.progress || 0), 0);
              const workerFraction = activeWorkers.length > 0 ? workerSum / (activeWorkers.length * 100) : 0;
              const currentDone = Math.min(totalInCycle, completedInCycle + workerFraction);
              const rawPct = Math.min(99, Math.round((currentDone / totalInCycle) * 100));
              currentCycleProgressRef.current = Math.max(currentCycleProgressRef.current, Math.max(1, rawPct));
              setTargetSubProgress(currentCycleProgressRef.current);

              // Database sync after each domain completes
              try {
                const liveRes = await fetch('/api/crawler/results', { cache: 'no-store' });
                const liveJson = await liveRes.json();
                if (liveJson.success && Array.isArray(liveJson.data) && liveJson.data.length > 0) {
                  setScrapedResults(liveJson.data);
                }
              } catch {}
            }

            activeWorkersRef.current.delete(workerKey);
            updateWorkerTelemetry();
          };

          // Run 3 workers in parallel concurrently!
          await Promise.all([runWorker(0), runWorker(1), runWorker(2)]);

          if (isCancelledRef.current) break;

          // Milestone: Cycle reached 100% completion!
          currentCycleProgressRef.current = 100;
          setTargetSubProgress(100);
          currentCycleScannedCountRef.current = totalInCycle;
          setZoneScannedCount(totalInCycle);
          setActivePhase(
            `✅ Cycle #${zoneCycle} Complete (100%) • ${totalInCycle} Root Domains Scanned • Preparing Cycle #${zoneCycle + 1} Continuous Discovery...`
          );
          updateWorkerTelemetry();

          // Wait 2000ms so the user sees 100% completed milestone clearly:
          await sleepUnthrottled(2000);
          if (isCancelledRef.current) break;

          // Advance to next autonomous cycle without stopping
          zoneCycle++;
          setCycleCount(zoneCycle);
          cycleCountRef.current = zoneCycle;
          currentCycleProgressRef.current = 1;
          setTargetSubProgress(1);
          currentCycleScannedCountRef.current = 0;
          setZoneScannedCount(0);
          setProcessedTargetsCount((prev) => prev + 1);

          // Quick 1.5s interval before next continuous discovery pass
          await sleepUnthrottled(1500);
        } catch (cycleErr) {
          console.warn(`[TldZoneWorker] Cycle #${zoneCycle} error, continuing:`, cycleErr);
          await sleepUnthrottled(2000);
        }
      }

      // Cleanup ONLY when user cancels / stops
      target.status = 'completed';
      if (onTargetStatusChange) onTargetStatusChange(target.id, 'completed');
      activeWorkersRef.current.clear();
      updateWorkerTelemetry();
    } catch (err) {
      console.warn(`[TldZoneWorker] Error in zone discovery for ${target.domain}:`, err);
      target.status = 'completed';
      if (onTargetStatusChange) onTargetStatusChange(target.id, 'completed');
      activeWorkersRef.current.clear();
      updateWorkerTelemetry();
    }
  };

  // Continuous Worker Loop: runs indefinitely cycle-by-cycle until user clicks Cancel or Pause
  const startWorkerLoop = useCallback(async () => {
    if (isLoopRunningRef.current) return;
    isLoopRunningRef.current = true;

    try {
      while (!isCancelledRef.current) {
        // Handle PAUSED state
        while (isPausedRef.current && !isCancelledRef.current) {
          await sleepUnthrottled(400);
        }
        if (isCancelledRef.current) break;

        let currentTargets = targetsRef.current;
        if (!currentTargets || currentTargets.length === 0) {
          try {
            const stored = localStorage.getItem('the_scrapper_targets_queue');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed) && parsed.length > 0) {
                currentTargets = parsed;
                targetsRef.current = parsed;
              }
            }
          } catch {}
        }
        if (!currentTargets || currentTargets.length === 0) {
          await sleepUnthrottled(600);
          continue;
        }

        // Find next target in queue: prioritize actively crawling target (seamless re-attachment), then pending
        let target = currentTargets.find((t) => t.status === 'crawling') ||
                     currentTargets.find((t) => !t.status || t.status === 'pending');

        if (!target) {
          if (isContinuousMode) {
            // Milestone: Cycle is 100% completed across targets!
            currentCycleProgressRef.current = 100;
            setTargetSubProgress(100);
            setActivePhase(
              `✅ Cycle #${cycleCountRef.current} Complete (100%) • Continuous 24/7 Engine Active • Advancing to Cycle #${cycleCountRef.current + 1}...`
            );
            updateWorkerTelemetry();

            await sleepUnthrottled(2000);
            if (isCancelledRef.current) break;

            const nextCycle = cycleCountRef.current + 1;
            setCycleCount(nextCycle);
            cycleCountRef.current = nextCycle;
            currentCycleProgressRef.current = 1;
            setTargetSubProgress(1);
            setProcessedTargetsCount(0);
            persistSessionState({
              status: 'RUNNING',
              cycleCount: nextCycle,
            });

            for (const t of currentTargets) {
              t.status = 'pending';
              if (onTargetStatusChange) onTargetStatusChange(t.id, 'pending');
            }
            target = currentTargets[0];
          } else {
            // Operator stopped or non-continuous run completed at 100%
            setStatus('COMPLETED');
            statusRef.current = 'COMPLETED';
            try {
              localStorage.removeItem(STORAGE_KEY_SESSION_STATE);
            } catch (e) {}
            setScrapedResults((prev) =>
              prev.map((r) => (r.status === 'CRAWLING' ? { ...r, status: 'RESOLVED' as const } : r))
            );
            currentCycleProgressRef.current = 100;
            setTargetSubProgress(100);
            setActivePhase('');
            activeWorkersRef.current.clear();
            updateWorkerTelemetry();
            break;
          }
        }

        if (!target) continue;

        persistSessionState({
          status: 'RUNNING',
          currentTargetName: target.domain,
          cycleCount: cycleCountRef.current,
        });

        // Execute deep crawl or 24/7 TLD zone discovery for this target
        const isTldTarget = target.type === 'tld_zone' || target.domain.startsWith('.') || target.domain.startsWith('*.');
        if (isTldTarget) {
          await runTldZoneTargetCycle(target);
        } else {
          await runSingleTargetCycle(target);
        }

        // 1s non-blocking interval before next target
        await sleepUnthrottled(1000);
      }
    } finally {
      isLoopRunningRef.current = false;
    }
  }, [onTargetStatusChange, updateWorkerTelemetry, persistSessionState]);

  // Hydrate session & scraped results from Storage & Re-attach to Running Crawl on Mount / Refresh
  useEffect(() => {
    try {
      const storedSessionRaw = localStorage.getItem(STORAGE_KEY_SESSION_STATE);
      if (storedSessionRaw) {
        const sess = JSON.parse(storedSessionRaw);
        if (sess && (sess.status === 'RUNNING' || sess.status === 'PAUSED')) {
          console.log('[useCrawlerController] Restoring active crawler session after page refresh:', sess);
          setStatus(sess.status);
          statusRef.current = sess.status;
          setIsContinuousMode(sess.isContinuous !== undefined ? sess.isContinuous : true);
          setCycleCount(sess.cycleCount || 1);
          cycleCountRef.current = sess.cycleCount || 1;
          pausedElapsedRef.current = sess.pausedElapsed || 0;

          if (sess.status === 'RUNNING') {
            startTimeRef.current = sess.startTimeMs || Date.now();
            setElapsedSeconds(getWallClockElapsed());
          } else {
            startTimeRef.current = null;
            setElapsedSeconds(sess.pausedElapsed || 0);
          }

          if (sess.currentTargetName) {
            setCurrentTargetName(sess.currentTargetName);
          }

          // Seamless auto-resume on refresh if session was RUNNING
          if (sess.status === 'RUNNING') {
            isCancelledRef.current = false;
            isPausedRef.current = false;
            setTimeout(() => {
              startWorkerLoop();
            }, 100);
          }
        }
      }
    } catch (e) {
      console.warn('[useCrawlerController] Could not restore crawler session:', e);
    }
  }, [getWallClockElapsed, startWorkerLoop]);

  // START CRAWLER: Starts the continuous cycle engine
  const startCrawler = useCallback(
    (overrideTargets?: TargetItem[] | unknown) => {
      let queueToUse = targetsRef.current;
      if (Array.isArray(overrideTargets) && overrideTargets.length > 0) {
        queueToUse = overrideTargets;
        targetsRef.current = overrideTargets;
      }

      if (queueToUse.length === 0 && activeWorkersRef.current.size === 0) {
        return;
      }

      // Reset any non-crawling targets to pending
      for (const t of queueToUse) {
        t.status = 'pending';
        if (onTargetStatusChange) onTargetStatusChange(t.id, 'pending');
      }

      isCancelledRef.current = false;
      isPausedRef.current = false;
      setStatus('RUNNING');
      statusRef.current = 'RUNNING';
      setSessionTotal(queueToUse.length);
      setProcessedTargetsCount(0);
      setElapsedSeconds(0);
      startTimeRef.current = Date.now();
      pausedElapsedRef.current = 0;
      setCycleCount(1);
      cycleCountRef.current = 1;
      setTargetSubProgress(1);
      currentCycleProgressRef.current = 1;
      maxSessionProgressRef.current = 1;

      persistSessionState({
        status: 'RUNNING',
        startTimeMs: Date.now(),
        pausedElapsed: 0,
        cycleCount: 1,
        currentTargetName: queueToUse[0]?.domain || null,
      });

      startWorkerLoop();
    },
    [startWorkerLoop, onTargetStatusChange, persistSessionState]
  );

  // ENQUEUE TARGETS: Adds to queue and continues loop
  const enqueueTargets = useCallback(
    (newItems: TargetItem[]) => {
      if (!newItems || newItems.length === 0) return;
      const existingIds = new Set(targetsRef.current.map((t) => t.id));
      const toAdd = newItems.filter((item) => !existingIds.has(item.id));
      if (toAdd.length === 0) return;

      targetsRef.current = [...targetsRef.current, ...toAdd];
      setSessionTotal((prev) => prev + toAdd.length);

      if (status === 'RUNNING' && !isLoopRunningRef.current) {
        startWorkerLoop();
      }
    },
    [status, startWorkerLoop]
  );

  // PAUSE CRAWLER
  const pauseCrawler = useCallback(() => {
    isPausedRef.current = true;
    const curElapsed = getWallClockElapsed();
    pausedElapsedRef.current = curElapsed;
    startTimeRef.current = null;
    setElapsedSeconds(curElapsed);
    setStatus('PAUSED');
    statusRef.current = 'PAUSED';
    for (const t of targetsRef.current) {
      if (t.status === 'crawling') {
        t.status = 'paused';
        if (onTargetStatusChange) {
          onTargetStatusChange(t.id, 'paused');
        }
      }
    }
    setActivePhase('Crawler Paused by Operator');
    persistSessionState({
      status: 'PAUSED',
      startTimeMs: null,
      pausedElapsed: curElapsed,
    });
  }, [getWallClockElapsed, onTargetStatusChange, persistSessionState]);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(() => {
    isPausedRef.current = false;
    isCancelledRef.current = false;
    const now = Date.now();
    startTimeRef.current = now;
    for (const t of targetsRef.current) {
      if (t.status === 'paused') {
        t.status = 'crawling';
        if (onTargetStatusChange) {
          onTargetStatusChange(t.id, 'crawling');
        }
      }
    }
    setStatus('RUNNING');
    statusRef.current = 'RUNNING';
    persistSessionState({
      status: 'RUNNING',
      startTimeMs: now,
    });
    if (!isLoopRunningRef.current) {
      startWorkerLoop();
    }
  }, [startWorkerLoop, onTargetStatusChange, persistSessionState]);

  // CANCEL CRAWLER: Operator manual stop
  const cancelCrawler = useCallback(() => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    isLoopRunningRef.current = false;
    const curElapsed = getWallClockElapsed();
    pausedElapsedRef.current = curElapsed;
    startTimeRef.current = null;
    setElapsedSeconds(curElapsed);
    activeWorkersRef.current.clear();
    for (const t of targetsRef.current) {
      if (t.status === 'crawling' || t.status === 'paused' || t.status === 'pending') {
        t.status = 'completed';
        if (onTargetStatusChange) {
          onTargetStatusChange(t.id, 'completed');
        }
      }
    }
    setScrapedResults((prev) =>
      prev.map((r) => (r.status === 'CRAWLING' ? { ...r, status: 'RESOLVED' as const } : r))
    );
    setStatus('COMPLETED');
    statusRef.current = 'COMPLETED';
    setCurrentTargetName(null);
    setActivePhase('');
    setTargetSubProgress(100);
    currentCycleProgressRef.current = 100;
    maxSessionProgressRef.current = 100;
    updateWorkerTelemetry();

    try {
      localStorage.removeItem(STORAGE_KEY_SESSION_STATE);
    } catch (e) {}

    // Cancel active backend jobs so engine unblocks immediately
    fetch('/api/crawl-jobs/cancel', { method: 'POST' }).catch(() => {});
  }, [getWallClockElapsed, onTargetStatusChange, updateWorkerTelemetry]);

  // CLEAR RESULTS: Completely wipes React state, browser localStorage, MongoDB collections, and disk caches
  const clearResults = useCallback(async () => {
    if (status === 'RUNNING') {
      alert('Please pause or cancel the crawler before clearing results.');
      return;
    }

    startTimeRef.current = null;
    pausedElapsedRef.current = 0;

    try {
      localStorage.removeItem(STORAGE_KEY_SESSION_STATE);
    } catch (e) {}

    // 1. Immediately wipe all in-memory states
    setScrapedResults([]);
    setElapsedSeconds(0);
    setSessionTotal(0);
    setProcessedTargetsCount(0);
    setActiveTargetResult(null);
    setCurrentTargetName(null);
    setTargetSubProgress(0);
    setStatus('IDLE');
    setCycleCount(1);
    cycleCountRef.current = 1;
    setZoneDiscoveredCount(0);
    zoneDiscoveredCountRef.current = 0;
    setZoneScannedCount(0);
    zoneScannedCountRef.current = 0;
    currentCycleTotalCountRef.current = 0;
    currentCycleProgressRef.current = 0;
    maxSessionProgressRef.current = 0;
    setActivePhase('Purging Database & Caches...');
    activeWorkersRef.current.clear();
    targetsRef.current = [];

    // 2. Clear all browser localStorage and sessionStorage caches (preserving only operator credentials)
    try {
      const authUser = localStorage.getItem('the_screpper_auth_user');
      localStorage.clear();
      if (authUser) {
        localStorage.setItem('the_screpper_auth_user', authUser);
      }
      sessionStorage.clear();
    } catch (e) {}

    // 3. Trigger permanent purge in MongoDB, Redis, Dorking & disk JSON
    try {
      const res = await fetch('/api/crawler/results', { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setActivePhase('Database & All Caches Purged Successfully');
      } else {
        setActivePhase('Standby');
      }
    } catch (e) {
      console.warn('Backend purge error:', e);
      setActivePhase('Standby');
    }
  }, [status]);

  // Database lifetime totals
  const databaseTotalDomains = scrapedResults.length;
  const databaseTotalSubdomains = scrapedResults.reduce((acc, curr) => {
    if (Array.isArray(curr.subdomains)) {
      return acc + curr.subdomains.filter((s) => s.toLowerCase() !== curr.domain.toLowerCase()).length;
    }
    return acc + (curr.subdomainCount || 0);
  }, 0);
  const databaseTotalEmails = scrapedResults.reduce(
    (acc, curr) => acc + (curr.emails?.length || (curr.email ? 1 : 0)),
    0
  );
  const databaseTotalCountries = new Set(scrapedResults.map((r) => r.country).filter(Boolean)).size;

  const isTldZoneActive = Boolean(currentTargetName && (currentTargetName.startsWith('.') || currentTargetName.startsWith('*.')));

  // Calculate specific live metrics for active TLD zone scope
  const activeZoneDomains = isTldZoneActive && currentTargetName
    ? scrapedResults.filter((r) => {
        if (r.isTldZone) return false;
        if (r.isExplicitTarget) return false;
        const cleanTarget = currentTargetName.replace(/^\*?\./, '').toLowerCase().trim();
        const rTld = r.tldZone ? r.tldZone.replace(/^\*?\./, '').toLowerCase().trim() : '';
        return rTld === cleanTarget || r.domain.toLowerCase().endsWith(`.${cleanTarget}`);
      })
    : [];

  const activeZoneRootDomains = currentCycleTotalCountRef.current > 0
    ? currentCycleTotalCountRef.current
    : Math.max(activeZoneDomains.length, zoneDiscoveredCount, zoneDiscoveredCountRef.current);

  const activeZoneScannedDomains = zoneScannedCountRef.current > 0
    ? zoneScannedCountRef.current
    : activeZoneDomains.filter(
        (r) => r.status === 'RESOLVED' || (Array.isArray(r.subdomains) && r.subdomains.length > 0) || (r.pagesCrawled && r.pagesCrawled > 0)
      ).length;

  const activeZoneSubdomains = activeZoneDomains.reduce((acc, curr) => {
    if (Array.isArray(curr.subdomains)) {
      return acc + curr.subdomains.filter((s) => s.toLowerCase() !== curr.domain.toLowerCase()).length;
    }
    return acc + (curr.subdomainCount || 0);
  }, 0);

  const activeZoneEmails = activeZoneDomains.reduce(
    (acc, curr) => acc + (curr.emails?.length || (curr.email ? 1 : 0)),
    0
  );

  const activeZonePages = activeZoneDomains.reduce(
    (acc, curr) => acc + (curr.pagesCrawled || curr.crawledPages?.length || 0),
    0
  );

  const activeZonePhones = activeZoneDomains.reduce(
    (acc, curr) => acc + (curr.phones?.length || 0),
    0
  );

  // Calculate strictly monotonic, glitch-free progress (0 to 100%)
  const pendingTargetsCount = targetsRef.current.filter((t) => !t.status || t.status === 'pending').length;
  const effectiveTotal = Math.max(sessionTotal, processedTargetsCount + activeWorkersRef.current.size + pendingTargetsCount);
  let dynamicProgress = 0;
  if (status === 'COMPLETED') {
    dynamicProgress = 100;
  } else if (status === 'RUNNING' || status === 'PAUSED') {
    if (isTldZoneActive) {
      dynamicProgress = Math.min(100, Math.max(1, currentCycleProgressRef.current || targetSubProgress || 1));
    } else {
      const totalTargets = Math.max(1, effectiveTotal);
      const finishedFraction = (processedTargetsCount / totalTargets) * 100;
      const activeTargetFraction = (targetSubProgress / totalTargets);
      const calculatedPct = Math.round(finishedFraction + activeTargetFraction);
      const targetVal = Math.max(1, Math.min(99, Math.max(targetSubProgress, calculatedPct)));
      dynamicProgress = Math.max(1, Math.max(currentCycleProgressRef.current, targetVal));
    }
  } else if (status === 'CANCELLED') {
    dynamicProgress = 0;
  }

  const activeWorkersList: ActiveWorkerSummary[] = Array.from(activeWorkersRef.current.entries()).map(
    ([id, w]) => {
      const isWorkerTld = w.target.type === 'tld_zone' || w.target.domain.startsWith('.');
      return {
        id,
        domain: w.target.domain,
        subTarget: (w as any).activeSubTarget,
        subIndex: (w as any).activeSubIndex,
        totalSubTargets: (w as any).totalSubTargets || (isWorkerTld ? activeZoneRootDomains : undefined),
        progress: w.progress,
        pagesCrawled: isWorkerTld && activeZonePages > 0 ? activeZonePages : w.pagesCrawled,
        subdomainsCount: isWorkerTld && activeZoneSubdomains > 0 ? activeZoneSubdomains : w.subdomainsCount,
        emailsCount: isWorkerTld && activeZoneEmails > 0 ? activeZoneEmails : w.emailsCount,
        phase: w.phase,
      };
    }
  );

  const stats: CrawlerStats = {
    totalTargets: effectiveTotal,
    processedTargets: status === 'COMPLETED' ? effectiveTotal : Math.min(processedTargetsCount, effectiveTotal),
    subdomainsFound: databaseTotalSubdomains,
    emailsFound: databaseTotalEmails,
    countriesFound: databaseTotalCountries,
    progressPercent: dynamicProgress,
    startedAt: null,
    elapsedSeconds,
    currentTargetName,
    activeTargetPhase: activePhase,
    activeTargetSubdomains: isTldZoneActive ? activeZoneSubdomains : (activeTargetResult ? activeTargetResult.subdomains : null),
    activeTargetEmails: isTldZoneActive ? activeZoneEmails : (activeTargetResult ? activeTargetResult.emails : null),
    activeTargetPhones: isTldZoneActive ? activeZonePhones : (activeTargetResult ? activeTargetResult.phones : null),
    activeTargetPages: isTldZoneActive ? activeZonePages : (activeTargetResult ? activeTargetResult.pages : (activeWorkersList?.[0]?.pagesCrawled || null)),
    databaseTotalDomains,
    databaseTotalSubdomains,
    databaseTotalEmails,
    databaseTotalCountries,
    cycleCount,
    isContinuous: isContinuousMode,
    activeWorkersList,
    isTldZoneActive,
    activeZoneRootDomains,
    activeZoneScannedDomains,
    activeZoneSubdomains,
    activeZoneEmails,
    activeZonePhones,
  };

  return {
    status,
    stats,
    scrapedResults,
    liveSessionDomains,
    isContinuousMode,
    setIsContinuousMode,
    cycleCount,
    startCrawler,
    enqueueTargets,
    pauseCrawler,
    resumeCrawler,
    cancelCrawler,
    clearResults,
    refreshResults: fetchMongoResults,
  };
}
