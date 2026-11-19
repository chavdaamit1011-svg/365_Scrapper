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
export const MAX_CONCURRENT_WORKERS = 3;

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
  const [zoneScannedCount, setZoneScannedCount] = useState<number>(0);
  const [activeWorkersList, setActiveWorkersList] = useState<ActiveWorkerSummary[]>([]);

  const targetsRef = useRef<TargetItem[]>(targets);
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const statusRef = useRef<CrawlerExecutionState>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cycleCountRef = useRef<number>(cycleCount);
  useEffect(() => {
    cycleCountRef.current = cycleCount;
  }, [cycleCount]);

  const scrapedResultsRef = useRef<ScrapedDataRecord[]>([]);
  useEffect(() => {
    scrapedResultsRef.current = scrapedResults;
  }, [scrapedResults]);

  // Dedicated Web Worker reference for 100% unthrottled timer execution in background tabs
  const tickerWorkerRef = useRef<Worker | null>(null);

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

  // Sync state with Autonomous Backend Crawler Daemon
  const syncWithDaemon = useCallback(async () => {
    try {
      const res = await fetch('/api/crawler/daemon', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.daemon) {
        const d = json.daemon;

        // If daemon is running or paused, adopt its authoritative status
        if (d.status === 'RUNNING' || d.status === 'PAUSED') {
          setStatus(d.status);
          setCycleCount(d.cycleCount || 1);
          setIsContinuousMode(d.isContinuous !== undefined ? d.isContinuous : true);
          setCurrentTargetName(d.currentTargetName);
          setActivePhase(d.activePhase || 'Autonomous Recon Active');
          setTargetSubProgress(d.targetSubProgress || 0);
          setElapsedSeconds(d.elapsedSeconds || 0);
          setSessionTotal(d.sessionTotal || d.targets?.length || 0);
          setProcessedTargetsCount(d.processedTargetsCount || 0);
          setZoneDiscoveredCount(d.zoneDiscoveredCount || 0);
          setZoneScannedCount(d.zoneScannedCount || 0);

          if (Array.isArray(d.activeWorkersList)) {
            setActiveWorkersList(d.activeWorkersList);
          }
          if (d.activeTargetResult) {
            setActiveTargetResult(d.activeTargetResult);
          }

          if (d.currentTargetName) {
            liveSessionDomainsRef.current.add(d.currentTargetName.toLowerCase());
            setLiveSessionDomains(Array.from(liveSessionDomainsRef.current));
          }

          // If daemon has targets and client queue is empty or needs sync, notify parent
          if (Array.isArray(d.targets) && d.targets.length > 0 && onTargetsSync) {
            if (targetsRef.current.length === 0 || targetsRef.current.length !== d.targets.length) {
              onTargetsSync(d.targets);
            }
          }
        } else if (d.status === 'COMPLETED' && statusRef.current === 'RUNNING') {
          setStatus('COMPLETED');
          setActivePhase(d.activePhase || 'Completed');
          setTargetSubProgress(100);
          setActiveWorkersList([]);
        }
      }
    } catch (err) {
      // Ignore background sync transient errors
    }
  }, [onTargetsSync]);

  // Initial Mount: Hydrate from MongoDB & Re-attach to Running Server Daemon
  useEffect(() => {
    fetchMongoResults();
    syncWithDaemon();
  }, [fetchMongoResults, syncWithDaemon]);

  // Unthrottled Web Worker Ticker Management
  // Browsers throttle setInterval in inactive background tabs down to 1-60s.
  // Dedicated Web Workers run on an independent OS thread and are NOT throttled.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Inline worker creation via Blob
    const workerCode = `
      let timer = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(function() {
            self.postMessage('TICK');
          }, 1000);
        } else if (e.data === 'stop') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      };
    `;

    try {
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      worker.onmessage = (e) => {
        if (e.data === 'TICK') {
          if (statusRef.current === 'RUNNING') {
            setElapsedSeconds((prev) => prev + 1);
            // Polling interval: every second, sync telemetry from daemon
            syncWithDaemon();
          }
        }
      };

      tickerWorkerRef.current = worker;

      return () => {
        worker.postMessage('stop');
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        tickerWorkerRef.current = null;
      };
    } catch (workerErr) {
      console.warn('Web Worker ticker not supported, falling back to standard interval:', workerErr);
    }
  }, [syncWithDaemon]);

  // Start or Stop the Worker Ticker based on RUNNING status
  useEffect(() => {
    if (tickerWorkerRef.current) {
      if (status === 'RUNNING') {
        tickerWorkerRef.current.postMessage('start');
      } else {
        tickerWorkerRef.current.postMessage('stop');
      }
    }
  }, [status]);

  // Results Periodic Refresh: Polls MongoDB every 3 seconds while crawling
  useEffect(() => {
    if (status !== 'RUNNING' && status !== 'PAUSED') return;

    const interval = setInterval(() => {
      fetchMongoResults();
    }, 3000);

    return () => clearInterval(interval);
  }, [status, fetchMongoResults]);

  // Page Visibility API: When user switches back to this tab, immediately trigger instant refresh!
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Instant fast sync to reflect all scraping done while in background
        syncWithDaemon();
        fetchMongoResults();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [syncWithDaemon, fetchMongoResults]);

  // START CRAWLER: Starts the server daemon and unthrottled loop
  const startCrawler = useCallback(
    async (overrideTargets?: TargetItem[] | unknown) => {
      let queueToUse = targetsRef.current;
      if (Array.isArray(overrideTargets) && overrideTargets.length > 0) {
        queueToUse = overrideTargets;
        targetsRef.current = overrideTargets;
      }

      if (queueToUse.length === 0) return;

      // Optimistic local state update
      setStatus('RUNNING');
      setSessionTotal(queueToUse.length);
      setProcessedTargetsCount(0);
      setElapsedSeconds(0);
      setTargetSubProgress(1);
      setActivePhase('Initializing Autonomous Daemon...');

      for (const t of queueToUse) {
        t.status = 'pending';
        if (onTargetStatusChange) onTargetStatusChange(t.id, 'pending');
      }

      try {
        const res = await fetch('/api/crawler/daemon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'start',
            targets: queueToUse,
            isContinuous: isContinuousMode,
            cycle: cycleCountRef.current || 1,
          }),
        });
        const json = await res.json();
        if (json.success && json.daemon) {
          const d = json.daemon;
          setStatus(d.status);
          setCycleCount(d.cycleCount || 1);
          setCurrentTargetName(d.currentTargetName);
          setActivePhase(d.activePhase);
        }
      } catch (err) {
        console.error('[useCrawlerController] Error starting daemon:', err);
      }
    },
    [isContinuousMode, onTargetStatusChange]
  );

  // ENQUEUE TARGETS: Adds to running daemon queue
  const enqueueTargets = useCallback(
    async (newItems: TargetItem[]) => {
      if (!newItems || newItems.length === 0) return;
      const existingIds = new Set(targetsRef.current.map((t) => t.id));
      const toAdd = newItems.filter((item) => !existingIds.has(item.id));
      if (toAdd.length === 0) return;

      targetsRef.current = [...targetsRef.current, ...toAdd];
      setSessionTotal((prev) => prev + toAdd.length);

      try {
        await fetch('/api/crawler/daemon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'enqueue',
            targets: toAdd,
          }),
        });
      } catch (e) {}
    },
    []
  );

  // PAUSE CRAWLER
  const pauseCrawler = useCallback(async () => {
    setStatus('PAUSED');
    setActivePhase('Crawler Paused by Operator');
    for (const t of targetsRef.current) {
      if (t.status === 'crawling') {
        t.status = 'paused';
        if (onTargetStatusChange) onTargetStatusChange(t.id, 'paused');
      }
    }

    try {
      await fetch('/api/crawler/daemon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      });
    } catch (e) {}
  }, [onTargetStatusChange]);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(async () => {
    setStatus('RUNNING');
    setActivePhase(`Resuming Crawler • Cycle #${cycleCountRef.current}`);
    for (const t of targetsRef.current) {
      if (t.status === 'paused') {
        t.status = 'pending';
        if (onTargetStatusChange) onTargetStatusChange(t.id, 'pending');
      }
    }

    try {
      await fetch('/api/crawler/daemon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      });
    } catch (e) {}
  }, [onTargetStatusChange]);

  // CANCEL CRAWLER: Operator manual stop
  const cancelCrawler = useCallback(async () => {
    setStatus('COMPLETED');
    setCurrentTargetName(null);
    setActivePhase('Crawler Stopped');
    setTargetSubProgress(100);
    setActiveWorkersList([]);

    for (const t of targetsRef.current) {
      if (t.status === 'crawling' || t.status === 'paused' || t.status === 'pending') {
        t.status = 'completed';
        if (onTargetStatusChange) onTargetStatusChange(t.id, 'completed');
      }
    }

    try {
      await fetch('/api/crawler/daemon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    } catch (e) {}
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
    setZoneDiscoveredCount(0);
    setZoneScannedCount(0);
    setActiveWorkersList([]);
    targetsRef.current = [];

    // 2. Clear browser localStorage
    try {
      const authUser = localStorage.getItem('the_screpper_auth_user');
      localStorage.clear();
      if (authUser) {
        localStorage.setItem('the_screpper_auth_user', authUser);
      }
      sessionStorage.clear();
    } catch (e) {}

    // 3. Trigger permanent purge in MongoDB, Redis, Dorking, and CrawlerDaemon
    try {
      await fetch('/api/crawler/results', { method: 'DELETE' });
    } catch (e) {
      console.warn('Backend purge error:', e);
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

  const isTldZoneActive = Boolean(
    currentTargetName && (currentTargetName.startsWith('.') || currentTargetName.startsWith('*.'))
  );

  // Calculate specific live metrics for active TLD zone scope
  const activeZoneDomains =
    isTldZoneActive && currentTargetName
      ? scrapedResults.filter((r) => {
          if (r.isTldZone) return false;
          if (r.isExplicitTarget) return false;
          const cleanTarget = currentTargetName.replace(/^\*?\./, '').toLowerCase().trim();
          const rTld = r.tldZone ? r.tldZone.replace(/^\*?\./, '').toLowerCase().trim() : '';
          return rTld === cleanTarget || r.domain.toLowerCase().endsWith(`.${cleanTarget}`);
        })
      : [];

  const activeZoneRootDomains = Math.max(activeZoneDomains.length, zoneDiscoveredCount);
  const activeZoneScannedDomains = zoneScannedCount > 0 ? zoneScannedCount : activeZoneDomains.length;

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

  const activeZonePhones = activeZoneDomains.reduce((acc, curr) => acc + (curr.phones?.length || 0), 0);

  // Dynamic progress percentage
  const dynamicProgress = status === 'COMPLETED' ? 100 : Math.min(100, Math.max(status === 'RUNNING' ? 1 : 0, targetSubProgress));

  const stats: CrawlerStats = {
    totalTargets: sessionTotal || targetsRef.current.length,
    processedTargets: status === 'COMPLETED' ? (sessionTotal || targetsRef.current.length) : processedTargetsCount,
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
    activeTargetPages: activeTargetResult ? activeTargetResult.pages : (activeWorkersList?.[0]?.pagesCrawled || null),
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
