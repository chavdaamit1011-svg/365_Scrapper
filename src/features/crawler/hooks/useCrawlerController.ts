'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TargetItem } from '@/features/targets/types/target.types';
import {
  CrawlerExecutionState,
  CrawlerStats,
  ScrapedDataRecord,
} from '../types/crawler.types';

const STORAGE_KEY_RESULTS = 'the_scrapper_scraped_results';

export function useCrawlerController(
  targets: TargetItem[],
  onTargetCompleted?: (targetId: string) => void
) {
  const [status, setStatus] = useState<CrawlerExecutionState>('IDLE');
  const [scrapedResults, setScrapedResults] = useState<ScrapedDataRecord[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [currentTargetName, setCurrentTargetName] = useState<string | null>(null);

  // Granular session and active target telemetry state
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
  const activeTargetRef = useRef<TargetItem | null>(null);

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
          // DATABASE HAS BEEN CLEARED! Explicitly wipe in-memory and browser localStorage!
          setScrapedResults([]);
          try {
            localStorage.removeItem(STORAGE_KEY_RESULTS);
          } catch (e) {}
          return [];
        }
      }
    } catch (err) {
      console.warn('Could not fetch MongoDB scraped results:', err);
      // ONLY on real network/API failure, fallback to localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY_RESULTS);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setScrapedResults(parsed);
            return parsed;
          }
        }
      } catch (e) {
        console.warn('Could not read cached scraped results:', e);
      }
    }

    return [];
  }, []);

  // Hydrate scraped results from MongoDB on mount
  useEffect(() => {
    fetchMongoResults();
  }, [fetchMongoResults]);

  // Save to localStorage whenever scrapedResults change, or clear if empty
  useEffect(() => {
    try {
      if (scrapedResults.length > 0) {
        localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(scrapedResults));
      } else {
        localStorage.removeItem(STORAGE_KEY_RESULTS);
      }
    } catch (e) {
      console.warn('Could not cache scraped results:', e);
    }
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

  // Single active target execution loop with continuous monitoring
  const runTargetLoop = useCallback(
    async (target: TargetItem) => {
      activeTargetRef.current = target;
      setCurrentTargetName(target.domain);
      setStatus('RUNNING');
      isCancelledRef.current = false;
      isPausedRef.current = false;

      let currentCycle = 1;

      while (!isCancelledRef.current) {
        if (isPausedRef.current) {
          setStatus('PAUSED');
          setActivePhase('Crawler Paused');
          return;
        }

        setCycleCount(currentCycle);
        setActivePhase(`[Cycle #${currentCycle}] Reconnaissance & Subdomain Discovery for ${target.domain}`);
        setTargetSubProgress(20);
        setActiveTargetResult(null);

        // Simulated phases for smooth live telemetry
        const phaseTimer1 = setTimeout(() => {
          if (!isCancelledRef.current && !isPausedRef.current) {
            setActivePhase(`[Cycle #${currentCycle}] Deep Web Crawling & Link Traversal for ${target.domain}`);
            setTargetSubProgress(55);
          }
        }, 2500);

        const phaseTimer2 = setTimeout(() => {
          if (!isCancelledRef.current && !isPausedRef.current) {
            setActivePhase(`[Cycle #${currentCycle}] Delta Validation & MongoDB Sync`);
            setTargetSubProgress(85);
          }
        }, 7000);

        const interactiveMaxPages = 25;
        const interactiveMaxDepth = 3;

        try {
          // Enqueue job via Redis API route /api/crawl-jobs
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

          // Poll Redis job status until completed or generous timeout
          let isDone = false;
          let pollAttempts = 0;
          const maxPollAttempts = 120; // Up to 96 seconds maximum

          while (!isDone && pollAttempts < maxPollAttempts && !isCancelledRef.current && !isPausedRef.current) {
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

                  // Live Redis telemetry to UI cards
                  if (typeof j.subdomainsCount === 'number' || typeof j.emailsCount === 'number') {
                    setActiveTargetResult({
                      subdomains: j.subdomainsCount || 0,
                      emails: j.emailsCount || 0,
                    });
                  }
                  if (j.pagesCrawled && j.pagesCrawled > 0) {
                    setActivePhase(`[Cycle #${currentCycle}] Crawling Page ${j.pagesCrawled}/${interactiveMaxPages}`);
                    setTargetSubProgress(Math.min(95, Math.round((j.pagesCrawled / interactiveMaxPages) * 70) + 25));
                  }
                }
              } catch {}
            }

            // Live database streaming: sync table every 3 polls (~2.4s)
            if (pollAttempts % 3 === 0) {
              try {
                const liveRes = await fetch('/api/crawler/results');
                const liveJson = await liveRes.json();
                if (liveJson.success && Array.isArray(liveJson.data) && liveJson.data.length > 0) {
                  setScrapedResults(liveJson.data);
                }
              } catch {}
            }
          }
        } catch (err) {
          console.warn(`[Crawler] Network error crawling ${target.domain}:`, err);
        } finally {
          clearTimeout(phaseTimer1);
          clearTimeout(phaseTimer2);
        }

        // If user paused/stopped crawler, immediately freeze and keep target active!
        if (isPausedRef.current) {
          setStatus('PAUSED');
          setActivePhase(`Crawler Stopped / Paused on [${target.domain}]`);
          return;
        }

        if (isCancelledRef.current) {
          break;
        }

        setTargetSubProgress(100);
        setActivePhase(`[Cycle #${currentCycle}] Target Pass Completed for ${target.domain}`);

        // Fetch fresh consolidated state directly from MongoDB
        try {
          const freshRes = await fetch('/api/crawler/results');
          const freshJson = await freshRes.json();
          if (freshJson.success && Array.isArray(freshJson.data) && freshJson.data.length > 0) {
            setScrapedResults(freshJson.data);

            const matched = freshJson.data.find((r: ScrapedDataRecord) => {
              const d1 = (r.domain || r.rootDomain || '').toLowerCase().trim();
              const d2 = target.domain.toLowerCase().trim();
              return d1 === d2 || d1.includes(d2) || d2.includes(d1);
            });

            if (matched) {
              const subs = Array.isArray(matched.subdomains)
                ? matched.subdomains.filter((s: string) => s.toLowerCase() !== matched.domain.toLowerCase())
                : [];
              const ems = Array.isArray(matched.emails)
                ? matched.emails
                : (matched.email ? [matched.email] : []);

              setActiveTargetResult({
                subdomains: subs.length,
                emails: ems.length,
              });
            }
          }
        } catch (e) {}

        // Increment processed targets count
        setProcessedTargetsCount((prev) => prev + 1);

        if (isPausedRef.current) {
          setStatus('PAUSED');
          setActivePhase(`Crawler Stopped / Paused on [${target.domain}]`);
          return;
        }

        if (isCancelledRef.current) {
          break;
        }

        if (!isContinuousMode) {
          break;
        }

        currentCycle++;

        // Cooldown timer (10s) between continuous monitoring passes
        for (let cd = 10; cd > 0; cd--) {
          if (isCancelledRef.current || isPausedRef.current) break;
          setActivePhase(`Live Monitoring: [${target.domain}] active. Next refresh pass (Cycle #${currentCycle}) in ${cd}s...`);
          await new Promise((r) => setTimeout(r, 1000));
        }

        if (isPausedRef.current) {
          setStatus('PAUSED');
          setActivePhase(`Crawler Stopped / Paused on [${target.domain}]`);
          return;
        }

        if (isCancelledRef.current) break;
      }

      // If user paused/stopped crawler, DO NOT ADVANCE TO NEXT QUEUE ITEM!
      if (isPausedRef.current) {
        setStatus('PAUSED');
        setActivePhase(`Crawler Stopped / Paused on [${target.domain}]`);
        return;
      }

      // Target execution stopped (either completed naturally or cancelled by user)
      const wasCancelled = isCancelledRef.current;
      activeTargetRef.current = null;

      // ONLY advance to next target if domain finished naturally OR user explicitly cancelled it!
      if (targetsRef.current.length > 0) {
        const nextTarget = targetsRef.current[0];
        const remaining = targetsRef.current.slice(1);
        targetsRef.current = remaining;
        if (onTargetCompleted) {
          onTargetCompleted(nextTarget.id);
        }

        isCancelledRef.current = false;
        isPausedRef.current = false;
        setActivePhase(`[Queue Handover] Starting next queued target: [${nextTarget.domain}]...`);
        setTimeout(() => {
          runTargetLoop(nextTarget);
        }, 300);
        return;
      }

      // No more items in queue:
      if (wasCancelled) {
        setStatus('CANCELLED');
        setCurrentTargetName(null);
        setActivePhase('Crawl Stopped by User');
      } else {
        setStatus('COMPLETED');
        setCurrentTargetName(null);
        setActivePhase('All Domains Crawled Successfully');
      }
    },
    [isContinuousMode, onTargetCompleted]
  );

  // START CRAWLER
  const startCrawler = useCallback(
    (overrideTargets?: TargetItem[] | unknown) => {
      let queueToUse = targetsRef.current;
      if (Array.isArray(overrideTargets) && overrideTargets.length > 0) {
        queueToUse = overrideTargets;
        targetsRef.current = overrideTargets;
      }

      if (queueToUse.length === 0) {
        return;
      }

      // Dequeue first target as active, remaining targets stay in queue
      const firstTarget = queueToUse[0];
      const remaining = queueToUse.slice(1);
      targetsRef.current = remaining;
      if (onTargetCompleted) {
        onTargetCompleted(firstTarget.id);
      }

      isCancelledRef.current = false;
      isPausedRef.current = false;
      setSessionTotal(1 + remaining.length);
      setProcessedTargetsCount(0);
      setActiveTargetResult(null);
      runTargetLoop(firstTarget);
    },
    [onTargetCompleted, runTargetLoop]
  );

  // DYNAMICALLY ENQUEUE TARGETS WHILE RUNNING (Keeps them in queue)
  const enqueueTargets = useCallback((newItems: TargetItem[]) => {
    if (!newItems || newItems.length === 0) return;
    const existingIds = new Set(targetsRef.current.map((t) => t.id));
    const toAdd = newItems.filter((item) => !existingIds.has(item.id));
    if (toAdd.length === 0) return;

    targetsRef.current = [...targetsRef.current, ...toAdd];
    setSessionTotal((prev) => prev + toAdd.length);
  }, []);

  // PAUSE / STOP CRAWLER
  const pauseCrawler = useCallback(() => {
    isPausedRef.current = true;
    setStatus('PAUSED');
    setActivePhase('Crawler Paused');
  }, []);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(() => {
    if (activeTargetRef.current) {
      isPausedRef.current = false;
      isCancelledRef.current = false;
      runTargetLoop(activeTargetRef.current);
    } else if (targetsRef.current.length > 0) {
      startCrawler();
    }
  }, [runTargetLoop, startCrawler]);

  // CANCEL CRAWLER (Cancels active domain; if items in queue, advances to next queued domain)
  const cancelCrawler = useCallback(() => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    activeTargetRef.current = null;
    setActivePhase('Cancelling active crawl...');

    // If currently paused, immediately trigger handover to next queued target:
    if (status === 'PAUSED') {
      if (targetsRef.current.length > 0) {
        const nextTarget = targetsRef.current[0];
        const remaining = targetsRef.current.slice(1);
        targetsRef.current = remaining;
        if (onTargetCompleted) {
          onTargetCompleted(nextTarget.id);
        }
        isCancelledRef.current = false;
        isPausedRef.current = false;
        setActivePhase(`[Queue Handover] Starting next queued target: [${nextTarget.domain}]...`);
        setTimeout(() => {
          runTargetLoop(nextTarget);
        }, 300);
      } else {
        setStatus('CANCELLED');
        setCurrentTargetName(null);
        setActivePhase('Crawl Stopped by User');
      }
    }
  }, [status, onTargetCompleted, runTargetLoop]);

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
    setTargetSubProgress(0);
    setStatus('IDLE');
    setCurrentTargetName(null);
    try {
      localStorage.removeItem(STORAGE_KEY_RESULTS);
      localStorage.removeItem('the_scrapper_targets_queue');
      sessionStorage.clear();
      fetch('/api/crawler/results', { method: 'DELETE' }).catch(() => {});
    } catch (e) {}
  }, [status]);

  // Derived statistics with realistic dynamic progress & separated metrics
  const effectiveTotal = Math.max(sessionTotal, targets.length, processedTargetsCount, 1);
  const targetWeight = 100 / effectiveTotal;
  const baseProgress = (processedTargetsCount / effectiveTotal) * 100;
  const activeContribution = (targetSubProgress / 100) * targetWeight;

  let dynamicProgress = 0;
  if (status === 'COMPLETED') {
    dynamicProgress = 100;
  } else if (status === 'RUNNING') {
    dynamicProgress = Math.min(99, Math.max(12, Math.round(baseProgress + activeContribution)));
  } else if (status === 'PAUSED') {
    dynamicProgress = Math.round(baseProgress);
  }

  // Database lifetime totals (across all domains)
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
