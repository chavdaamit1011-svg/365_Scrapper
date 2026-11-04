/**
 * Google Custom Search JSON API Provider Adapter
 */

import { BaseSearchProvider } from './baseProvider';
import { SearchResultItem } from '../types/dorking.types';

export class GoogleSearchProvider extends BaseSearchProvider {
  readonly name = 'Google';
  readonly supportsPagination = true;
  readonly rateLimitMs = 1000;

  private apiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
  private cx = process.env.GOOGLE_SEARCH_CX || '';

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.cx);
  }

  async search(query: string, page: number = 1): Promise<SearchResultItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const startIndex = Math.max(1, (page - 1) * 10 + 1);
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.cx);
    url.searchParams.set('q', query);
    url.searchParams.set('start', String(startIndex));
    url.searchParams.set('num', '10');

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TheScrapper-DorkingEngine/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Google Search API error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const items: SearchResultItem[] = [];

    if (Array.isArray(data.items)) {
      for (const item of data.items) {
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

