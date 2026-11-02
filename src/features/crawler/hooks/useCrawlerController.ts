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

  const targetsRef = useRef<TargetItem[]>(targets);
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate scraped results from MongoDB on mount
  useEffect(() => {
    const fetchMongoResults = async () => {
      try {
        const res = await fetch('/api/crawler/results');
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          setScrapedResults(json.data);
          return;
        }
      } catch (err) {
        console.warn('Could not fetch MongoDB scraped results:', err);
      }

      // Local storage fallback
      try {
        const stored = localStorage.getItem(STORAGE_KEY_RESULTS);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setScrapedResults(parsed);
          }
        }
      } catch (e) {
        console.warn('Could not read cached scraped results:', e);
      }
    };

    fetchMongoResults();
  }, []);

  // Save to localStorage whenever scrapedResults change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(scrapedResults));
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

  // Process targets in the pending queue
  const runCrawlerQueue = useCallback(async () => {
    if (targetsRef.current.length === 0) {
      setStatus('COMPLETED');
      setCurrentTargetName(null);
      return;
    }

    isCancelledRef.current = false;
    isPausedRef.current = false;
    setStatus('RUNNING');

    // Record session batch total if not set
    const initialBatchCount = targetsRef.current.length;
    setSessionTotal((prev) => (prev > 0 ? prev : initialBatchCount));

    while (targetsRef.current.length > 0) {
      if (isCancelledRef.current) {
        setStatus('CANCELLED');
        setCurrentTargetName(null);
        setActivePhase('Crawl Cancelled');
        return;
      }

      if (isPausedRef.current) {
        setStatus('PAUSED');
        setActivePhase('Crawler Paused');
        return;
      }

      const currentTarget = targetsRef.current[0];
      setCurrentTargetName(currentTarget.domain);
      setActivePhase('OSINT Recon & Certificate Discovery');
      setTargetSubProgress(20);
      setActiveTargetResult(null);

      // Simulated phases for smooth live telemetry while backend executes
      const phaseTimer1 = setTimeout(() => {
        if (!isCancelledRef.current && !isPausedRef.current) {
          setActivePhase('Deep Web Crawling & Link Traversal');
          setTargetSubProgress(55);
        }
      }, 2500);

      const phaseTimer2 = setTimeout(() => {
        if (!isCancelledRef.current && !isPausedRef.current) {
          setActivePhase('Data Validation & MongoDB Sync');
          setTargetSubProgress(85);
        }
      }, 7000);

      try {
        await fetch('/api/crawler/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: currentTarget.domain,
            maxPages: 5,
            maxDepth: 2,
          }),
        });
      } catch (err) {
        console.warn(`[Crawler] Network error crawling ${currentTarget.domain}:`, err);
      } finally {
        clearTimeout(phaseTimer1);
        clearTimeout(phaseTimer2);
      }

      setTargetSubProgress(100);
      setActivePhase('Target Scrape Completed');

      if (isCancelledRef.current) {
        setStatus('CANCELLED');
        setCurrentTargetName(null);
        return;
      }

      // Fetch fresh consolidated state directly from MongoDB
      try {
        const freshRes = await fetch('/api/crawler/results');
        const freshJson = await freshRes.json();
        if (freshJson.success && Array.isArray(freshJson.data)) {
          setScrapedResults(freshJson.data);

          // Find this specific target record to get its exact subdomains and emails
          const matched = freshJson.data.find((r: ScrapedDataRecord) => {
            const d1 = (r.domain || r.rootDomain || '').toLowerCase().trim();
            const d2 = currentTarget.domain.toLowerCase().trim();
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

      // Remove the completed target from pending Queue immediately
      targetsRef.current = targetsRef.current.filter((t) => t.id !== currentTarget.id);
      if (onTargetCompleted) {
        onTargetCompleted(currentTarget.id);
      }

      // Brief delay for state transition
      await new Promise((r) => setTimeout(r, 300));

      if (isPausedRef.current) {
        setStatus('PAUSED');
        return;
      }
    }

    setStatus('COMPLETED');
    setActivePhase('All Targets Crawled Successfully');
  }, [onTargetCompleted]);

  // START CRAWLER
  const startCrawler = useCallback(() => {
    if (targetsRef.current.length === 0) {
      alert('Target queue is empty. Please enter a domain in Manual Target Scope Entry before starting the crawler.');
      return;
    }

    setSessionTotal(targetsRef.current.length);
    setProcessedTargetsCount(0);
    setActiveTargetResult(null);
    runCrawlerQueue();
  }, [runCrawlerQueue]);

  // PAUSE / STOP CRAWLER
  const pauseCrawler = useCallback(() => {
    isPausedRef.current = true;
    setStatus('PAUSED');
    setActivePhase('Crawler Paused');
  }, []);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(() => {
    if (targetsRef.current.length === 0) {
      setStatus('COMPLETED');
      return;
    }
    isPausedRef.current = false;
    isCancelledRef.current = false;
    runCrawlerQueue();
  }, [runCrawlerQueue]);

  // CANCEL CRAWLER
  const cancelCrawler = useCallback(() => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    setStatus('CANCELLED');
    setCurrentTargetName(null);
    setActivePhase('Crawl Cancelled');
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
    setTargetSubProgress(0);
    setStatus('IDLE');
    setCurrentTargetName(null);
    try {
      localStorage.removeItem(STORAGE_KEY_RESULTS);
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
  };

  return {
    status,
    stats,
    scrapedResults,
    startCrawler,
    pauseCrawler,
    resumeCrawler,
    cancelCrawler,
    clearResults,
  };
}
