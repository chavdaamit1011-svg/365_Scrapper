/**
 * DuckDuckGo Direct Web Search Provider Adapter
 * Performs real web dorking via DuckDuckGo HTML search without requiring third-party API keys.
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from './baseProvider';
import { SearchResultItem } from '../types/dorking.types';

export class DuckDuckGoSearchProvider extends BaseSearchProvider {
  readonly name = 'DuckDuckGo';
  readonly supportsPagination = true;
  readonly rateLimitMs = 1200;

  isConfigured(): boolean {
    return true; // Always configured and ready to execute real searches out of the box
  }

  async search(query: string, page: number = 1): Promise<SearchResultItem[]> {
    const items: SearchResultItem[] = [];

    try {
      const offset = Math.max(0, (page - 1) * 30);
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `q=${encodeURIComponent(query)}&b=&kl=wt-wt`,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        // Fallback to GET request
        const getRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (getRes.ok) {
          const html = await getRes.text();
          return this.parseHtml(html, query);
        }
        return [];
      }

      const html = await res.text();
      return this.parseHtml(html, query);
    } catch (err: any) {
      console.warn(`[DuckDuckGoProvider] Search failed for query "${query}":`, err?.message || err);
      return [];
    }
  }

  private parseHtml(html: string, query: string): SearchResultItem[] {
    const items: SearchResultItem[] = [];
    const $ = cheerio.load(html);

    $('.result').each((_, el) => {
      const titleEl = $(el).find('.result__title .result__a');
      const snippetEl = $(el).find('.result__snippet');
      const rawUrl = titleEl.attr('href') || '';

      let cleanUrl = rawUrl;
      // DuckDuckGo redirects often look like /l/?kh=-1&uddg=https%3A%2F%2Fexample.com
      if (cleanUrl.includes('uddg=')) {
        try {
          const match = cleanUrl.match(/uddg=([^&]+)/);
          if (match && match[1]) {
            cleanUrl = decodeURIComponent(match[1]);
          }
        } catch {}
      }

      if (cleanUrl && cleanUrl.startsWith('http')) {
        items.push({
          title: titleEl.text().trim() || cleanUrl,
          url: cleanUrl,
          snippet: snippetEl.text().trim(),
          provider: this.name,
          query,
          discoveredAt: new Date().toISOString(),
        });
      }
    });

    return items;
  }
}
