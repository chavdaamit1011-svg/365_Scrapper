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
export const MAX_CONCURRENT_WORKERS = 1;

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
  onTargetStatusChange?: (targetId: string, status: NonNullable<TargetItem['status']>) => void
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
  const [liveSessionDomains, setLiveSessionDomains] = useState<string[]>([]);
  const liveSessionDomainsRef = useRef<Set<string>>(new Set());

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

    const currentWorker = workers[0];
    const domain = (currentWorker as any).activeSubTarget || currentWorker.target.domain;
    setCurrentTargetName(domain);

    setTargetSubProgress(currentWorker.progress || 20);

    const totalSubs = currentWorker.subdomainsCount || 0;
    const totalEms = currentWorker.emailsCount || 0;
    setActiveTargetResult({
      subdomains: totalSubs,
      emails: totalEms,
    });

    setActivePhase(
      `⚡ Sequential Engine: ${domain} (Cycle #${cycleCountRef.current}) • ${totalSubs} Subdomains Discovered`
    );
  }, []);

  // Sequential Worker Execution for a single target pass
  const runSingleTargetCycle = async (target: TargetItem) => {
    activeWorkersRef.current.set(target.id, {
      target,
      progress: 20,
      pagesCrawled: 0,
      subdomainsCount: 0,
      emailsCount: 0,
      phase: `⚡ Deep Recon & Subdomain Discovery for ${target.domain}`,
    });

    target.status = 'crawling';
    if (onTargetStatusChange) {
      onTargetStatusChange(target.id, 'crawling');
    }

    liveSessionDomainsRef.current.add(target.domain.toLowerCase());
    setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));

    updateWorkerTelemetry();

    const interactiveMaxPages = 25;
    const interactiveMaxDepth = 3;

    try {
      if (isCancelledRef.current) return;

      while (isPausedRef.current && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(r, 400));
      }
      if (isCancelledRef.current) return;

      // 1. Enqueue job into backend Redis / Queue
      let jobId: string | null = null;
      try {
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
        jobId = jobJson.job_id;
      } catch (postErr) {
        console.warn(`[SequentialWorker] Enqueue failed for ${target.domain}:`, postErr);
      }

      if (activeWorkersRef.current.has(target.id)) {
        const workerData = activeWorkersRef.current.get(target.id)!;
        workerData.jobId = jobId || undefined;
        workerData.progress = 30;
        workerData.phase = `⚡ Deep Recon & Page Scraping for ${target.domain}`;
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
                  Math.round(((j.pagesCrawled || 1) / interactiveMaxPages) * 65) + 30
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

      // Free worker slot
      activeWorkersRef.current.delete(target.id);
      updateWorkerTelemetry();
    } catch (err) {
      console.warn(`[SequentialWorker] Error crawling ${target.domain}:`, err);
      target.status = 'failed';
      if (onTargetStatusChange) onTargetStatusChange(target.id, 'failed');
      activeWorkersRef.current.delete(target.id);
      updateWorkerTelemetry();
    }
  };

  // 24/7 TLD Zone Discovery & Continuous Scraping Execution
  const runTldZoneTargetCycle = async (target: TargetItem) => {
    activeWorkersRef.current.set(target.id, {
      target,
      progress: 15,
      pagesCrawled: 0,
      subdomainsCount: 0,
      emailsCount: 0,
      phase: `🌐 24/7 TLD Zone Discovery: Scanning root domains for ${target.domain} (Cycle #${cycleCountRef.current})...`,
    });

    target.status = 'crawling';
    if (onTargetStatusChange) {
      onTargetStatusChange(target.id, 'crawling');
    }
    liveSessionDomainsRef.current.add(target.domain.toLowerCase());
    setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));
    setCurrentTargetName(target.domain);
    updateWorkerTelemetry();

    try {
      if (isCancelledRef.current) return;

      while (isPausedRef.current && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(r, 400));
      }
      if (isCancelledRef.current) return;

      // 1. Trigger TLD Discovery API (Certificate Transparency, Dorking, Seeds, Cross-Links)
      const discRes = await fetch('/api/crawler/tld-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tld: target.domain,
          cycle: cycleCountRef.current,
          maxPerPass: 35,
        }),
      });

      const discJson = await discRes.json();
      const discoveredList: string[] = Array.isArray(discJson.domains) ? discJson.domains : [];

      if (activeWorkersRef.current.has(target.id)) {
        const workerData = activeWorkersRef.current.get(target.id)!;
        workerData.progress = 25;
        workerData.phase = `🌐 [${target.domain} Zone] Discovered ${discJson.totalDiscovered || discoveredList.length} root domains (Cycle #${cycleCountRef.current})`;
      }
      updateWorkerTelemetry();

      // 2. Sequentially crawl discovered root domains with fast landing/contact reconnaissance
      const interactiveMaxPages = 3;
      const interactiveMaxDepth = 1;

      for (let i = 0; i < discoveredList.length; i++) {
        if (isCancelledRef.current) break;
        while (isPausedRef.current && !isCancelledRef.current) {
          await new Promise((r) => setTimeout(r, 400));
        }
        if (isCancelledRef.current) break;

        const subDomainTarget = discoveredList[i];
        const stepProgress = Math.min(95, Math.round(((i + 1) / discoveredList.length) * 70) + 25);

        liveSessionDomainsRef.current.add(subDomainTarget.toLowerCase());
        setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));

        if (activeWorkersRef.current.has(target.id)) {
          const w = activeWorkersRef.current.get(target.id)!;
          (w as any).activeSubTarget = subDomainTarget;
          w.progress = stepProgress;
          w.phase = `⚡ [${target.domain} Stream] Crawling ${subDomainTarget} (${i + 1}/${discoveredList.length}) [Cycle #${cycleCountRef.current}]`;
        }
        setCurrentTargetName(subDomainTarget);
        updateWorkerTelemetry();

        // Enqueue crawl job for discovered domain
        try {
          const jobRes = await fetch('/api/crawl-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: subDomainTarget,
              max_pages: interactiveMaxPages,
              max_depth: interactiveMaxDepth,
              requests_per_second: 2,
              respect_robots_txt: true,
              tld_zone: target.domain,
            }),
          });
          const jobJson = await jobRes.json();
          const jobId = jobJson.job_id;

          // Poll job status until done
          let isDone = false;
          let pollAttempts = 0;
          while (!isDone && pollAttempts < 45 && !isCancelledRef.current && !isPausedRef.current) {
            await new Promise((r) => setTimeout(r, 600));
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
                  }
                  updateWorkerTelemetry();
                }
              } catch {}
            }
          }
        } catch (subErr) {
          console.warn(`[TldZoneWorker] Crawl job failed for ${subDomainTarget}:`, subErr);
        }

        // Live database sync after each domain completes
        try {
          const liveRes = await fetch('/api/crawler/results', { cache: 'no-store' });
          const liveJson = await liveRes.json();
          if (liveJson.success && Array.isArray(liveJson.data) && liveJson.data.length > 0) {
            setScrapedResults(liveJson.data);
          }
        } catch {}
      }

      if (isCancelledRef.current) return;

      // Mark TLD pass complete for this cycle
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

      activeWorkersRef.current.delete(target.id);
      updateWorkerTelemetry();
    } catch (err) {
      console.warn(`[TldZoneWorker] Error in zone discovery for ${target.domain}:`, err);
      target.status = 'completed';
      if (onTargetStatusChange) onTargetStatusChange(target.id, 'completed');
      activeWorkersRef.current.delete(target.id);
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
          await new Promise((r) => setTimeout(r, 400));
        }
        if (isCancelledRef.current) break;

        const currentTargets = targetsRef.current;
        if (!currentTargets || currentTargets.length === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        // Find next target in queue (status !== 'crawling' && status !== 'completed')
        let target = currentTargets.find((t) => !t.status || t.status === 'pending');

        if (!target) {
          // All targets in queue finished their current pass!
          // Autonomously increment cycle and repeat across the target scope!
          setCycleCount((prev) => {
            const nextCycle = prev + 1;
            console.log(`[ContinuousEngine] All targets processed. Advancing to Cycle #${nextCycle}...`);
            return nextCycle;
          });

          // Reset all targets to pending for the new autonomous cycle
          for (const t of currentTargets) {
            t.status = 'pending';
            if (onTargetStatusChange) onTargetStatusChange(t.id, 'pending');
          }

          setActivePhase(`⚡ Advancing to autonomous Cycle #${cycleCountRef.current + 1}...`);
          // Polite 1.5s interval between full cycles
          await new Promise((r) => setTimeout(r, 1500));
          if (isCancelledRef.current) break;

          target = currentTargets[0];
        }

        if (!target) continue;

        // Execute deep crawl or 24/7 TLD zone discovery for this target
        if (target.type === 'tld_zone') {
          await runTldZoneTargetCycle(target);
        } else {
          await runSingleTargetCycle(target);
        }

        // 1s non-blocking interval before next target
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      isLoopRunningRef.current = false;
    }
  }, [onTargetStatusChange, updateWorkerTelemetry]);

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
      setSessionTotal(queueToUse.length);
      setProcessedTargetsCount(0);
      setElapsedSeconds(0);

      startWorkerLoop();
    },
    [startWorkerLoop, onTargetStatusChange]
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
    setStatus('PAUSED');
    for (const t of targetsRef.current) {
      if (t.status === 'crawling') {
        t.status = 'paused';
        if (onTargetStatusChange) {
          onTargetStatusChange(t.id, 'paused');
        }
      }
    }
    setActivePhase('Crawler Paused by Operator');
  }, [onTargetStatusChange]);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(() => {
    isPausedRef.current = false;
    isCancelledRef.current = false;
    for (const t of targetsRef.current) {
      if (t.status === 'paused') {
        t.status = 'crawling';
        if (onTargetStatusChange) {
          onTargetStatusChange(t.id, 'crawling');
        }
      }
    }
    setStatus('RUNNING');
    if (!isLoopRunningRef.current) {
      startWorkerLoop();
    }
  }, [startWorkerLoop, onTargetStatusChange]);

  // CANCEL CRAWLER
  const cancelCrawler = useCallback(() => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    isLoopRunningRef.current = false;
    activeWorkersRef.current.clear();
    for (const t of targetsRef.current) {
      if (t.status === 'crawling' || t.status === 'paused') {
        t.status = 'cancelled';
        if (onTargetStatusChange) {
          onTargetStatusChange(t.id, 'cancelled');
        }
      }
    }
    setStatus('IDLE');
    setCurrentTargetName(null);
    setActivePhase('Standby');
    setTargetSubProgress(0);

    // Cancel active backend jobs so engine unblocks immediately
    fetch('/api/crawl-jobs/cancel', { method: 'POST' }).catch(() => {});
  }, [onTargetStatusChange]);

  // CLEAR RESULTS: Completely wipes React state, browser localStorage, MongoDB collections, and disk caches
  const clearResults = useCallback(async () => {
    if (status === 'RUNNING') {
      alert('Please pause or cancel the crawler before clearing results.');
      return;
    }

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
    setActivePhase('Purging Database & Caches...');
    activeWorkersRef.current.clear();
    targetsRef.current = [];

    // 2. Clear all browser localStorage and sessionStorage caches
    try {
      localStorage.removeItem(STORAGE_KEY_RESULTS);
      localStorage.removeItem('the_scrapper_targets_queue');
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

  const activeWorkersList: ActiveWorkerSummary[] = Array.from(activeWorkersRef.current.entries()).map(
    ([id, w]) => ({
      id,
      domain: (w as any).activeSubTarget || w.target.domain,
      progress: w.progress,
      pagesCrawled: w.pagesCrawled,
      subdomainsCount: w.subdomainsCount,
      emailsCount: w.emailsCount,
      phase: w.phase,
    })
  );

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
    activeWorkersList,
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
