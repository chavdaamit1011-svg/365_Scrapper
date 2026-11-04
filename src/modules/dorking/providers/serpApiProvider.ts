/**
 * SerpApi Provider Adapter (Google / Bing / Yahoo via SerpApi)
 */

import { BaseSearchProvider } from './baseProvider';
import { SearchResultItem } from '../types/dorking.types';

export class SerpApiSearchProvider extends BaseSearchProvider {
  readonly name = 'SerpApi';
  readonly supportsPagination = true;
  readonly rateLimitMs = 1500;

  private apiKey = process.env.SERPAPI_API_KEY || '';

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, page: number = 1): Promise<SearchResultItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const start = Math.max(0, (page - 1) * 10);
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('start', String(start));
    url.searchParams.set('num', '10');
    url.searchParams.set('api_key', this.apiKey);

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TheScrapper-DorkingEngine/1.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`SerpApi error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const items: SearchResultItem[] = [];

    if (Array.isArray(data.organic_results)) {
      for (const item of data.organic_results) {
        if (item.link) {
          items.push({
            title: item.title || '',
            url: item.link,
            snippet: item.snippet || '',
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

