/**
 * SearXNG / Open Web Search Provider Adapter
 * Compliant metasearch using official JSON API endpoints (e.g. SearXNG instance).
 */

import { BaseSearchProvider } from './baseProvider';
import { SearchResultItem } from '../types/dorking.types';

export class SearXNGSearchProvider extends BaseSearchProvider {
  readonly name = 'SearXNG';
  readonly supportsPagination = true;
  readonly rateLimitMs = 1500;

  private instanceUrl = process.env.SEARXNG_URL || '';

  isConfigured(): boolean {
    return Boolean(this.instanceUrl);
  }

  async search(query: string, page: number = 1): Promise<SearchResultItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const url = new URL('/search', this.instanceUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageno', String(page));

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'TheScrapper-DorkingEngine/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`SearXNG error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const items: SearchResultItem[] = [];

    if (Array.isArray(data.results)) {
      for (const item of data.results) {
        if (item.url) {
          items.push({
            title: item.title || '',
            url: item.url,
            snippet: item.content || '',
            provider: this.name,
            query,
            discoveredAt: new Date().toISOString(),
          });
        }
      }
    }

    return items;
  }
}

