/**
 * Bing Web Search API v7 Provider Adapter
 */

import { BaseSearchProvider } from './baseProvider';
import { SearchResultItem } from '../types/dorking.types';

export class BingSearchProvider extends BaseSearchProvider {
  readonly name = 'Bing';
  readonly supportsPagination = true;
  readonly rateLimitMs = 1000;

  private apiKey = process.env.BING_SEARCH_API_KEY || '';
  private endpoint = process.env.BING_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search';

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, page: number = 1): Promise<SearchResultItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const count = 10;
    const offset = Math.max(0, (page - 1) * count);
    const url = new URL(this.endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('responseFilter', 'Webpages');

    const res = await fetch(url.toString(), {
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'User-Agent': 'TheScrapper-DorkingEngine/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Bing Search API error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const items: SearchResultItem[] = [];

    if (data.webPages && Array.isArray(data.webPages.value)) {
      for (const item of data.webPages.value) {
        if (item.url) {
          items.push({
            title: item.name || '',
            url: item.url,
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

