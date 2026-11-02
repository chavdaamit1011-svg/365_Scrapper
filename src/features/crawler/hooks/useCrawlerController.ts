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

    while (targetsRef.current.length > 0) {
      if (isCancelledRef.current) {
        setStatus('CANCELLED');
        setCurrentTargetName(null);
        return;
      }

      if (isPausedRef.current) {
        setStatus('PAUSED');
        return;
      }

      const currentTarget = targetsRef.current[0];
      setCurrentTargetName(currentTarget.domain);

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
      }

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
        }
      } catch (e) {}

      // Remove the completed target from pending Queue so old targets don't linger
      if (onTargetCompleted) {
        onTargetCompleted(currentTarget.id);
      }

      // Brief delay for state transition
      await new Promise((r) => setTimeout(r, 250));

      if (isPausedRef.current) {
        setStatus('PAUSED');
        return;
      }
    }

    setStatus('COMPLETED');
    setCurrentTargetName(null);
  }, [onTargetCompleted]);

  // START CRAWLER
  const startCrawler = useCallback(() => {
    if (targetsRef.current.length === 0) {
      alert('Target queue is empty. Please enter a domain in Manual Target Scope Entry before starting the crawler.');
      return;
    }

    runCrawlerQueue();
  }, [runCrawlerQueue]);

  // PAUSE / STOP CRAWLER
  const pauseCrawler = useCallback(() => {
    isPausedRef.current = true;
    setStatus('PAUSED');
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
  }, []);

  // CLEAR RESULTS
  const clearResults = useCallback(() => {
    if (status === 'RUNNING') {
      alert('Please pause or cancel the crawler before clearing results.');
      return;
    }

    setScrapedResults([]);
    setElapsedSeconds(0);
    setStatus('IDLE');
    setCurrentTargetName(null);
    try {
      localStorage.removeItem(STORAGE_KEY_RESULTS);
      fetch('/api/crawler/results', { method: 'DELETE' }).catch(() => {});
    } catch (e) {}
  }, [status]);

  // Derived statistics
  const totalTargets = targets.length;
  const subdomainsTotal = scrapedResults.reduce((acc, curr) => acc + (curr.subdomains?.length || 0), 0);
  const emailsTotal = scrapedResults.reduce((acc, curr) => acc + (curr.emails?.length || 0), 0);
  const uniqueCountries = new Set(scrapedResults.map((r) => r.country)).size;

  const stats: CrawlerStats = {
    totalTargets,
    processedTargets: 0,
    subdomainsFound: subdomainsTotal,
    emailsFound: emailsTotal,
    countriesFound: uniqueCountries,
    progressPercent: status === 'RUNNING' ? 50 : status === 'COMPLETED' ? 100 : 0,
    startedAt: null,
    elapsedSeconds,
    currentTargetName,
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
