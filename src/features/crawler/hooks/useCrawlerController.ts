'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TargetItem } from '@/features/targets/types/target.types';
import {
  CrawlerExecutionState,
  CrawlerStats,
  ScrapedDataRecord,
} from '../types/crawler.types';

const STORAGE_KEY_RESULTS = 'the_scrapper_scraped_results';

export function useCrawlerController(targets: TargetItem[]) {
  const [status, setStatus] = useState<CrawlerExecutionState>('IDLE');
  const [scrapedResults, setScrapedResults] = useState<ScrapedDataRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [currentTargetName, setCurrentTargetName] = useState<string | null>(null);

  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate scraped results from MongoDB / backend on mount, with localStorage fallback
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

  // Process next target by calling the real Python Crawler API
  const processNextTarget = useCallback(
    async (index: number) => {
      if (isCancelledRef.current) {
        setStatus('CANCELLED');
        setCurrentTargetName(null);
        return;
      }

      if (isPausedRef.current) {
        setStatus('PAUSED');
        return;
      }

      if (index >= targets.length) {
        // All targets in scope completed
        setStatus('COMPLETED');
        setCurrentTargetName(null);
        return;
      }

      const target = targets[index];
      setCurrentTargetName(target.domain);
      setCurrentIndex(index);

      let discovered: ScrapedDataRecord[] = [];

      try {
        // Execute the Python crawler via Next.js backend API
        const response = await fetch('/api/crawler/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: target.domain,
            maxPages: 5,
            maxDepth: 2,
          }),
        });

        const json = await response.json();

        if (json.success && Array.isArray(json.records) && json.records.length > 0) {
          discovered = json.records;
        } else {
          discovered = [];
        }
      } catch (err) {
        console.warn(`[Crawler] Network error crawling ${target.domain}:`, err);
        discovered = [];
      }

      // Check cancellation/pause again before updating state
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
        } else if (discovered.length > 0) {
          setScrapedResults((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const uniqueNew = discovered.filter((d) => !existingIds.has(d.id));
            return [...uniqueNew, ...prev];
          });
        }
      } catch {
        if (discovered.length > 0) {
          setScrapedResults((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const uniqueNew = discovered.filter((d) => !existingIds.has(d.id));
            return [...uniqueNew, ...prev];
          });
        }
      }

      const nextIndex = index + 1;
      setCurrentIndex(nextIndex);

      if (isPausedRef.current) {
        setStatus('PAUSED');
      } else if (nextIndex < targets.length) {
        processNextTarget(nextIndex);
      } else {
        setStatus('COMPLETED');
        setCurrentTargetName(null);
      }
    },
    [targets]
  );

  // START CRAWLER
  const startCrawler = useCallback(() => {
    if (targets.length === 0) {
      alert('Target queue is empty. Please enter a domain in Manual Target Scope Entry before starting the crawler.');
      return;
    }

    isCancelledRef.current = false;
    isPausedRef.current = false;

    setStatus('RUNNING');
    setCurrentIndex(0);
    setElapsedSeconds(0);
    processNextTarget(0);
  }, [targets, processNextTarget]);

  // PAUSE / STOP CRAWLER
  const pauseCrawler = useCallback(() => {
    isPausedRef.current = true;
    setStatus('PAUSED');
  }, []);

  // RESUME CRAWLER
  const resumeCrawler = useCallback(() => {
    if (currentIndex >= targets.length) {
      setStatus('COMPLETED');
      return;
    }
    isPausedRef.current = false;
    isCancelledRef.current = false;
    setStatus('RUNNING');
    processNextTarget(currentIndex);
  }, [currentIndex, targets.length, processNextTarget]);

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
    const confirmed = confirm('Are you sure you want to clear all scraped intelligence data?');
    if (!confirmed) return;

    setScrapedResults([]);
    setCurrentIndex(0);
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
  const processedTargets = Math.min(currentIndex, totalTargets);
  const progressPercent = totalTargets > 0 ? Math.round((processedTargets / totalTargets) * 100) : 0;

  const uniqueSubdomains = new Set(scrapedResults.map((r) => r.subdomain)).size;
  const uniqueEmails = new Set(scrapedResults.map((r) => r.email)).size;
  const uniqueCountries = new Set(scrapedResults.map((r) => r.country)).size;

  const stats: CrawlerStats = {
    totalTargets,
    processedTargets,
    subdomainsFound: uniqueSubdomains,
    emailsFound: uniqueEmails,
    countriesFound: uniqueCountries,
    progressPercent,
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
