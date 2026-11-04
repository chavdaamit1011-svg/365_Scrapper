/**
 * Abstract Base Class for Search Engine Providers
 */

import { SearchResultItem } from '../types/dorking.types';

export abstract class BaseSearchProvider {
  abstract readonly name: string;
  abstract readonly supportsPagination: boolean;
  abstract readonly rateLimitMs: number;

  /**
   * Checks whether the provider has the necessary credentials configured
   */
  abstract isConfigured(): boolean;

  /**
   * Executes a search query for a specific page offset
   */
  abstract search(query: string, page?: number): Promise<SearchResultItem[]>;
}

