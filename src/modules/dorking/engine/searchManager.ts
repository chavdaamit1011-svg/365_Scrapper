/**
 * Search Provider Manager
 * Coordinates provider execution, rate-limiting, error handling, and stats aggregation.
 */

import { BaseSearchProvider } from '../providers/baseProvider';
import { GoogleSearchProvider } from '../providers/googleProvider';
import { BingSearchProvider } from '../providers/bingProvider';
import { SerpApiSearchProvider } from '../providers/serpApiProvider';
import { SearXNGSearchProvider } from '../providers/duckduckgoProvider';
import { MockSearchProvider } from '../providers/mockProvider';
import { SearchResultItem, ProviderStats } from '../types/dorking.types';

export interface SearchManagerConfig {
  concurrency?: number;
  maxPagesPerQuery?: number;
  enabledProviders?: string[];
}

export class SearchManager {
  private providers: Map<string, BaseSearchProvider> = new Map();
  private providerStats: Map<string, ProviderStats> = new Map();
  private concurrency: number;
  private maxPagesPerQuery: number;

  constructor(config: SearchManagerConfig = {}) {
    this.concurrency = config.concurrency || 2;
    this.maxPagesPerQuery = config.maxPagesPerQuery || 2;

    // Register built-in providers
    this.registerProvider(new GoogleSearchProvider());
    this.registerProvider(new BingSearchProvider());
    this.registerProvider(new SerpApiSearchProvider());
    this.registerProvider(new SearXNGSearchProvider());
    this.registerProvider(new MockSearchProvider());
  }

  registerProvider(provider: BaseSearchProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
    if (!this.providerStats.has(provider.name)) {
      this.providerStats.set(provider.name, {
        queriesCount: 0,
        resultsCount: 0,
        errorsCount: 0,
      });
    }
  }

  getAvailableProviders(): { name: string; isConfigured: boolean }[] {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      isConfigured: p.isConfigured(),
    }));
  }

  getActiveProviders(requestedProviders?: string[]): BaseSearchProvider[] {
    const list: BaseSearchProvider[] = [];

    for (const provider of this.providers.values()) {
      if (requestedProviders && requestedProviders.length > 0) {
        const matches = requestedProviders.some(
          (name) => name.toLowerCase() === provider.name.toLowerCase()
        );
        if (matches && provider.isConfigured()) {
          list.push(provider);
        }
      } else if (provider.isConfigured()) {
        // If no providers specifically requested, use all configured real providers.
        // MockDev is only included if no real providers are configured, or explicitly requested.
        if (provider.name !== 'MockDev') {
          list.push(provider);
        }
      }
    }

    // Fallback: If no real provider is configured, fallback to MockDev
    if (list.length === 0) {
      const mock = this.providers.get('mockdev');
      if (mock) list.push(mock);
    }

    return list;
  }

  async executeQuery(
    providerName: string,
    query: string,
    maxPages: number = this.maxPagesPerQuery
  ): Promise<SearchResultItem[]> {
    const provider = this.providers.get(providerName.toLowerCase());
    if (!provider || !provider.isConfigured()) {
      return [];
    }

    const stats = this.providerStats.get(provider.name) || {
      queriesCount: 0,
      resultsCount: 0,
      errorsCount: 0,
    };
    stats.queriesCount++;

    const allResults: SearchResultItem[] = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const pageResults = await provider.search(query, page);
        allResults.push(...pageResults);

        if (!provider.supportsPagination || pageResults.length === 0) {
          break;
        }

        // Respect provider rate limit
        if (page < maxPages && provider.rateLimitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, provider.rateLimitMs));
        }
      } catch (err: any) {
        stats.errorsCount++;
        this.providerStats.set(provider.name, stats);
        console.warn(`[SearchManager] Error executing query '${query}' on ${provider.name}: ${err?.message || err}`);
        break;
      }
    }

    stats.resultsCount += allResults.length;
    this.providerStats.set(provider.name, stats);
    return allResults;
  }

  getStats(): Record<string, ProviderStats> {
    const output: Record<string, ProviderStats> = {};
    for (const [name, stat] of this.providerStats.entries()) {
      output[name] = { ...stat };
    }
    return output;
  }
}

