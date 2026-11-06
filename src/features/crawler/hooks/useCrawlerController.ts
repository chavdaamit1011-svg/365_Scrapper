'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TargetItem } from '@/features/targets/types/target.types';
import {
  CrawlerExecutionState,
  CrawlerStats,
  ScrapedDataRecord,
} from '../types/crawler.types';

const STORAGE_KEY_RESULTS = 'the_scrapper_scraped_results';
export const MAX_CONCURRENT_WORKERS = 3;

interface ActiveWorkerData {
  target: TargetItem;
  jobId?: string;
  progress: number;
  pagesCrawled: number;
  subdomainsCount: number;
  emailsCount: number;
  phase: string;
}

export function useCrawlerController(
  targets: TargetItem[],
  onTargetCompleted?: (targetId: string) => void
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
  } | null>(null);

  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(true);
  const [cycleCount, setCycleCount] = useState<number>(1);

  // Pool of Concurrent Active Workers (Up to MAX_CONCURRENT_WORKERS = 3)
  const activeWorkersRef = useRef<Map<string, ActiveWorkerData>>(new Map());

  const targetsRef = useRef<TargetItem[]>(targets);
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Elapsed seconds timer while RUNNING
  useEffect(() => {
    if (status === 'RUNNING') {
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }

    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
      }
    };
  }, [status]);

  // Update aggregated telemetry across active workers
  const updateWorkerTelemetry = useCallback(() => {
    const workers = Array.from(activeWorkersRef.current.values());
    if (workers.length === 0) {
      if (targetsRef.current.length === 0 && !isCancelledRef.current && !isPausedRef.current) {
        setCurrentTargetName(null);
        setActivePhase('All Domains Crawled Successfully');
      }
      return;
    }

    const domains = workers.map((w) => w.target.domain);
    const label =
      domains.length === 1
        ? domains[0]
        : `${domains.join(', ')} (${domains.length}/${MAX_CONCURRENT_WORKERS} Active Workers)`;
    setCurrentTargetName(label);

    const avgProgress = Math.round(
      workers.reduce((acc, curr) => acc + (curr.progress || 20), 0) / workers.length
    );
    setTargetSubProgress(avgProgress);

    const totalSubs = workers.reduce((acc, curr) => acc + (curr.subdomainsCount || 0), 0);
    const totalEms = workers.reduce((acc, curr) => acc + (curr.emailsCount || 0), 0);
    setActiveTargetResult({
      subdomains: totalSubs,
      emails: totalEms,
    });

    setActivePhase(
      `⚡ Running ${domains.length} Crawlers in Parallel: [${domains.join(', ')}]`
    );
  }, []);

  // Forward declaration of worker loop runner
  const runWorker = useRef<(target: TargetItem) => Promise<void>>(async () => {});

  // Master Dispatcher: fills up to MAX_CONCURRENT_WORKERS slots from queue
  const dispatchWorkers = useCallback(() => {
    if (isCancelledRef.current || isPausedRef.current) return;

    const currentRunning = activeWorkersRef.current.size;
    const availableSlots = MAX_CONCURRENT_WORKERS - currentRunning;

    if (availableSlots <= 0) return;

    if (targetsRef.current.length === 0) {
      if (currentRunning === 0) {
        setStatus('COMPLETED');
        setActivePhase('All Domains Crawled Successfully');
        setCurrentTargetName(null);
        setTargetSubProgress(100);
      }
      return;
    }

    // Dequeue availableSlots targets
    const toLaunch = targetsRef.current.slice(0, availableSlots);
    targetsRef.current = targetsRef.current.slice(availableSlots);

    // Notify queue table to remove these targets from the waiting list
    for (const t of toLaunch) {
      if (onTargetCompleted) {
        onTargetCompleted(t.id);
      }
    }

    setStatus('RUNNING');

    // Launch each worker asynchronously
    for (const target of toLaunch) {
      runWorker.current(target);
    }
  }, [onTargetCompleted]);

  // Worker Execution Loop for a single target
  runWorker.current = async (target: TargetItem) => {
    activeWorkersRef.current.set(target.id, {
      target,
      progress: 15,
      pagesCrawled: 0,
      subdomainsCount: 0,
      emailsCount: 0,
      phase: `Reconnaissance for ${target.domain}`,
    });

    updateWorkerTelemetry();

    const interactiveMaxPages = 25;
    const interactiveMaxDepth = 3;

    try {
      // 1. Enqueue job into backend Redis / Queue
      const jobRes = await fetch('/api/crawl-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: target.domain,
          max_pages: interactiveMaxPages,
          max_depth: interactiveMaxDepth,
          requests_per_second: 1,
          respect_robots_txt: true,
        }),
      });

      const jobJson = await jobRes.json();
      const jobId = jobJson.job_id;

      if (activeWorkersRef.current.has(target.id)) {
        const workerData = activeWorkersRef.current.get(target.id)!;
        workerData.jobId = jobId;
        workerData.progress = 25;
      }
      updateWorkerTelemetry();

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
        await new Promise((r) => setTimeout(r, 800));
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

              if (activeWorkersRef.current.has(target.id)) {
                const w = activeWorkersRef.current.get(target.id)!;
                w.subdomainsCount = j.subdomainsCount || 0;
                w.emailsCount = j.emailsCount || 0;
                w.pagesCrawled = j.pagesCrawled || 0;
                w.progress = Math.min(
                  95,
                  Math.round(((j.pagesCrawled || 1) / interactiveMaxPages) * 70) + 25
                );
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
    } catch (err) {
      console.warn(`[MultiWorker] Error crawling ${target.domain}:`, err);
    }

    // 3. Worker finished crawling this target
    activeWorkersRef.current.delete(target.id);
    setProcessedTargetsCount((prev) => prev + 1);

    // Refresh final database results
    try {
      const freshRes = await fetch('/api/crawler/results', { cache: 'no-store' });
      const freshJson = await freshRes.json();
      if (freshJson.success && Array.isArray(freshJson.data) && freshJson.data.length > 0) {
        setScrapedResults(freshJson.data);
      }
    } catch (e) {}

    updateWorkerTelemetry();

    // 4. Autonomously dispatch next queued domain into this freed worker slot!
    if (!isCancelledRef.current && !isPausedRef.current) {
      dispatchWorkers();
    }
  };

  // START CRAWLER: Launches up to MAX_CONCURRENT_WORKERS = 3 immediately
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

      isCancelledRef.current = false;
      isPausedRef.current = false;
      setSessionTotal(activeWorkersRef.current.size + queueToUse.length);
      setProcessedTargetsCount(0);
      setElapsedSeconds(0);

      dispatchWorkers();
    },
    [dispatchWorkers]
  );

  // ENQUEUE TARGETS: Adds to queue and immediately dispatches if worker slots are free!
  const enqueueTargets = useCallback(
    (newItems: TargetItem[]) => {
      if (!newItems || newItems.length === 0) return;
      const existingIds = new Set(targetsRef.current.map((t) => t.id));
      const activeIds = new Set(Array.from(activeWorkersRef.current.keys()));
      const toAdd = newItems.filter((item) => !existingIds.has(item.id) && !activeIds.has(item.id));
      if (toAdd.length === 0) return;

      targetsRef.current = [...targetsRef.current, ...toAdd];
      setSessionTotal((prev) => prev + toAdd.length);

      // If crawler is active and has free worker slots (< 3), immediately dispatch!
      if (status === 'RUNNING') {
        dispatchWorkers();
      }
    },
    [status, dispatchWorkers]
  );

  // PAUSE CRAWLER
  const pauseCrawler = useCallback(() => {
    isPausedRef.current = true;
    setStatus('PAUSED');
    setActivePhase(`Crawler Paused (${activeWorkersRef.current.size} Workers Suspended)`);
  }, []);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(() => {
    isPausedRef.current = false;
    isCancelledRef.current = false;
    setStatus('RUNNING');
    dispatchWorkers();
  }, [dispatchWorkers]);

  // CANCEL CRAWLER
  const cancelCrawler = useCallback(() => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    activeWorkersRef.current.clear();
    targetsRef.current = [];
    setStatus('CANCELLED');
    setCurrentTargetName(null);
    setActivePhase('All Active Crawls Cancelled by User');
    setTargetSubProgress(0);
  }, []);

  // CLEAR RESULTS
  const clearResults = useCallback(() => {
    if (status === 'RUNNING') {
      alert('Please pause or cancel the crawler before clearing results.');
      return;
    }

    setScrapedResults([]);
    setElapsedSeconds(0);
    setSessionTotal(0);
    setProcessedTargetsCount(0);
    setActiveTargetResult(null);
    setActivePhase('Standby');
    try {
      localStorage.removeItem(STORAGE_KEY_RESULTS);
    } catch (e) {}
  }, [status]);

  // Calculate dynamic progress
  const effectiveTotal = Math.max(sessionTotal, processedTargetsCount + activeWorkersRef.current.size + targetsRef.current.length);
  let dynamicProgress = 0;
  if (status === 'COMPLETED') {
    dynamicProgress = 100;
  } else if (status === 'RUNNING' || status === 'PAUSED') {
    dynamicProgress = Math.min(99, Math.max(10, targetSubProgress));
  } else if (status === 'CANCELLED') {
    dynamicProgress = 0;
  }

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

  const stats: CrawlerStats = {
    totalTargets: effectiveTotal,
    processedTargets: status === 'COMPLETED' ? effectiveTotal : processedTargetsCount,
    subdomainsFound: databaseTotalSubdomains,
    emailsFound: databaseTotalEmails,
    countriesFound: databaseTotalCountries,
    progressPercent: dynamicProgress,
    startedAt: null,
    elapsedSeconds,
    currentTargetName,
    activeTargetPhase: activePhase,
    activeTargetSubdomains: activeTargetResult ? activeTargetResult.subdomains : null,
    activeTargetEmails: activeTargetResult ? activeTargetResult.emails : null,
    databaseTotalDomains,
    databaseTotalSubdomains,
    databaseTotalEmails,
    databaseTotalCountries,
    cycleCount,
    isContinuous: isContinuousMode,
  };

  return {
    status,
    stats,
    scrapedResults,
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
