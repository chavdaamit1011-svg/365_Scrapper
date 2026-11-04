/**
 * Deduplication Service for Dorking Engine
 * Prevents redundant processing of duplicate hostnames in-memory and tracks duplicate statistics.
 */

import { normalizeHostname } from '../validators/hostnameValidator';

export class DeduplicationService {
  private seenHostnames: Set<string> = new Set();
  private duplicatesIgnoredCount: number = 0;

  constructor(initialHostnames: string[] = []) {
    for (const h of initialHostnames) {
      this.seenHostnames.add(normalizeHostname(h));
    }
  }

  /**
   * Checks if a hostname has already been seen.
   * If not seen, registers it and returns false.
   * If already seen, increments duplicates count and returns true.
   */
  checkAndMark(hostname: string): boolean {
    const norm = normalizeHostname(hostname);
    if (!norm) return true;

    if (this.seenHostnames.has(norm)) {
      this.duplicatesIgnoredCount++;
      return true; // Is a duplicate
    }

    this.seenHostnames.add(norm);
    return false; // Not a duplicate
  }

  isSeen(hostname: string): boolean {
    return this.seenHostnames.has(normalizeHostname(hostname));
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

