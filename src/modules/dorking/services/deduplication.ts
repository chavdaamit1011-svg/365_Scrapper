/**
 * Deduplication Service for Dorking Engine
 * Prevents redundant processing of duplicate hostnames with Bloom Filter memory pre-check.
 */

import { normalizeHostname } from '../validators/hostnameValidator';
import { getSharedBloomFilter } from '@/lib/crawler/bloomFilter';

export class DeduplicationService {
  private seenHostnames: Set<string> = new Set();
  private duplicatesIgnoredCount: number = 0;

  constructor(initialHostnames: string[] = []) {
    const bloom = getSharedBloomFilter();
    for (const h of initialHostnames) {
      const norm = normalizeHostname(h);
      if (norm) {
        this.seenHostnames.add(norm);
        bloom.add(norm);
      }
    }
  }

  /**
   * Checks if a hostname has already been seen using 2-tier memory pre-check:
   * 1. Bloom Filter fast pre-check (DEFINITELY_NEW vs PROBABLY_EXISTS)
   * 2. Exact set lookup on probably exists
   */
  checkAndMark(hostname: string): boolean {
    const norm = normalizeHostname(hostname);
    if (!norm) return true;

    const bloom = getSharedBloomFilter();
    const checkResult = bloom.check(norm);

    if (checkResult === 'DEFINITELY_NEW') {
      // 100% guarantee it's not seen yet
      this.seenHostnames.add(norm);
      bloom.add(norm);
      return false; // Not a duplicate
    }

    // PROBABLY_EXISTS: Verify with exact set
    if (this.seenHostnames.has(norm)) {
      this.duplicatesIgnoredCount++;
      return true; // Is a duplicate
    }

    // False positive from bloom filter: record as new
    this.seenHostnames.add(norm);
    bloom.add(norm);
    return false; // Not a duplicate
  }

  isSeen(hostname: string): boolean {
    const norm = normalizeHostname(hostname);
    if (!norm) return false;
    const bloom = getSharedBloomFilter();
    if (bloom.check(norm) === 'DEFINITELY_NEW') {
      return false;
    }
    return this.seenHostnames.has(norm);
  }

  getDuplicatesCount(): number {
    return this.duplicatesIgnoredCount;
  }

  getUniqueCount(): number {
    return this.seenHostnames.size;
  }

  clear(): void {
    this.seenHostnames.clear();
    this.duplicatesIgnoredCount = 0;
  }
}
