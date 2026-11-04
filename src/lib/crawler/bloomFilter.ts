/**
 * High-Performance In-Memory Bloom Filter for Subdomain & Domain Deduplication
 *
 * Probabilistic pre-check layer:
 * - "DEFINITELY_NEW": 100% guarantee the item has never been seen.
 *   Skips expensive database read query and proceeds directly to insert.
 * - "PROBABLY_EXISTS": Item is likely already recorded, OR a rare false-positive (< 1%).
 *   Triggers an actual MongoDB database verification query.
 *
 * Mathematical Design:
 * - Bit array representation backed by Node.js Buffer for low memory footprint (~300 KB for 250,000 items).
 * - Double-Hashing (Kirsch-Mitzenmacher FNV-1a unsigned variant) for O(1) nanosecond checks.
 * - Pre-warmed from MongoDB collections (master_domains, master_subdomains, scraped_results).
 */

import { Db } from 'mongodb';
import { connectMongo } from '../mongodb';

export type BloomCheckResult = 'DEFINITELY_NEW' | 'PROBABLY_EXISTS';

export interface BloomFilterStats {
  capacity: number;
  sizeBits: number;
  sizeBytes: number;
  hashFunctionsCount: number;
  itemCount: number;
  estimatedFpRate: number;
  prewarmed: boolean;
}

export class BloomFilter {
  private n: number; // Expected items
  private p: number; // False positive probability
  private m: number; // Optimal bit count
  private k: number; // Optimal number of hash functions
  private buffer: Buffer;
  private count: number = 0;
  private isPrewarmed: boolean = false;

  constructor(expectedItems: number = 250000, targetFpRate: number = 0.01) {
    this.n = Math.max(1000, expectedItems);
    this.p = Math.min(0.1, Math.max(0.0001, targetFpRate));

    // Optimal bit array size m = - (n * ln(p)) / (ln(2)^2)
    this.m = Math.ceil(- (this.n * Math.log(this.p)) / (Math.LN2 * Math.LN2));

    // Optimal hash functions count k = (m / n) * ln(2)
    this.k = Math.max(2, Math.round((this.m / this.n) * Math.LN2));

    // Allocate memory buffer (1 byte = 8 bits)
    this.buffer = Buffer.alloc(Math.ceil(this.m / 8));
  }

  /**
   * Generates k independent bit indexes using Kirsch-Mitzenmacher double hashing
   */
  private getHashes(value: string): number[] {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;

    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 ^ code, 0x85ebca6b);
    }

    const indexes: number[] = [];
    const unsignedM = this.m;

    for (let i = 0; i < this.k; i++) {
      const combined = ((h1 >>> 0) + Math.imul(i, (h2 >>> 0))) >>> 0;
      indexes.push(combined % unsignedM);
    }

    return indexes;
  }

  /**
   * Normalizes string identity before hashing
   */
  private normalize(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/\.+$/, '');
  }

  /**
   * Adds an item to the Bloom Filter
   */
  public add(item: string): void {
    const norm = this.normalize(item);
    if (!norm) return;

    for (const bitIdx of this.getHashes(norm)) {
      this.buffer[bitIdx >> 3] |= (1 << (bitIdx & 7));
    }
    this.count++;
  }

  /**
   * Fast In-Memory Check:
   * Returns 'DEFINITELY_NEW' or 'PROBABLY_EXISTS'
   */
  public check(item: string): BloomCheckResult {
    const norm = this.normalize(item);
    if (!norm) return 'PROBABLY_EXISTS';

    for (const bitIdx of this.getHashes(norm)) {
      if ((this.buffer[bitIdx >> 3] & (1 << (bitIdx & 7))) === 0) {
        return 'DEFINITELY_NEW';
      }
    }

    return 'PROBABLY_EXISTS';
  }

  /**
   * Convenient boolean helper: returns true if probably exists, false if definitely new
   */
  public has(item: string): boolean {
    return this.check(item) === 'PROBABLY_EXISTS';
  }

  /**
   * Pre-warms the Bloom Filter from existing MongoDB records on boot / crawl initialization
   */
  public async prewarmFromMongo(customDb?: Db): Promise<number> {
    if (this.isPrewarmed) {
      return this.count;
    }

    try {
      let db = customDb;
      if (!db) {
        const conn = await connectMongo();
        db = conn?.connection?.db;
      }
      if (!db) return this.count;

      console.log('[BloomFilter] Pre-warming in-memory bit array from MongoDB collections...');

      // 1. Prewarm master_domains
      const domains = await db.collection('master_domains').find({}, { projection: { domain: 1 } }).limit(50000).toArray();
      for (const d of domains) {
        if (d.domain) this.add(d.domain);
      }

      // 2. Prewarm master_subdomains
      const subdomains = await db.collection('master_subdomains').find({}, { projection: { subdomain: 1 } }).limit(200000).toArray();
      for (const s of subdomains) {
        if (s.subdomain) this.add(s.subdomain);
      }

      // 3. Prewarm scraped_results
      const scraped = await db.collection('scraped_results').find({}, { projection: { domain: 1, subdomains: 1, emails: 1 } }).limit(50000).toArray();
      for (const sc of scraped) {
        if (sc.domain) this.add(sc.domain);
        if (Array.isArray(sc.subdomains)) {
          for (const sub of sc.subdomains) {
            this.add(sub);
          }
        }
        if (Array.isArray(sc.emails)) {
          for (const em of sc.emails) {
            this.add(em);
          }
        }
      }

      // 4. Prewarm master_emails
      const emails = await db.collection('master_emails').find({}, { projection: { email: 1 } }).limit(100000).toArray();
      for (const e of emails) {
        if (e.email) this.add(e.email);
      }

      this.isPrewarmed = true;
      console.log(`[BloomFilter] Pre-warmed ${this.count} unique identities into Bloom Filter (${(this.buffer.length / 1024).toFixed(1)} KB RAM)`);
      return this.count;
    } catch (err: any) {
      console.warn('[BloomFilter] MongoDB prewarm warning (continuing with fresh filter):', err?.message || err);
      return this.count;
    }
  }

  /**
   * Returns live diagnostic statistics
   */
  public getStats(): BloomFilterStats {
    // Current estimated false-positive rate: (1 - e^(-k * count / m))^k
    const exponent = - (this.k * this.count) / this.m;
    const estimatedFpRate = Math.pow(1 - Math.exp(exponent), this.k);

    return {
      capacity: this.n,
      sizeBits: this.m,
      sizeBytes: this.buffer.length,
      hashFunctionsCount: this.k,
      itemCount: this.count,
      estimatedFpRate: Number(estimatedFpRate.toFixed(4)),
      prewarmed: this.isPrewarmed,
    };
  }

  /**
   * Resets the filter bit array
   */
  public clear(): void {
    this.buffer.fill(0);
    this.count = 0;
    this.isPrewarmed = false;
  }
}

// Global Singleton Instance across Node.js runtime
let sharedBloomFilterInstance: BloomFilter | null = null;

export function getSharedBloomFilter(): BloomFilter {
  if (!sharedBloomFilterInstance) {
    sharedBloomFilterInstance = new BloomFilter(300000, 0.01);
  }
  return sharedBloomFilterInstance;
}
