/**
 * Mock & Local Testing Provider Adapter
 * Simulates real search engine responses for local testing and offline verification.
 * Always active in non-production or when explicitly requested.
 */

import { BaseSearchProvider } from './baseProvider';
import { SearchResultItem } from '../types/dorking.types';

export class MockSearchProvider extends BaseSearchProvider {
  readonly name = 'MockDev';
  readonly supportsPagination = true;
  readonly rateLimitMs = 200;

  isConfigured(): boolean {
    return true; // Always available for developer testing
  }

  async search(query: string, page: number = 1): Promise<SearchResultItem[]> {
    // Artificial small delay to simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Extract target domain from query (e.g., site:gov.in or site:*.gov.in)
    const match = query.match(/site:(\*\.)?([a-zA-Z0-9.-]+)/i);
    const domain = match ? match[2] : 'example.com';

    const samplePrefixes = [
      'portal',
      'api',
      'auth',
      'admin',
      'dev',
      'staging',
      'test',
      'vpn',
      'mail',
      'secure',
      'app',
      'dashboard',
      'internal',
      'services',
      'cloud',
      'cdn',
      'gateway',
      'sso',
      'm',
      'billing',
    ];

    const startIndex = (page - 1) * 5;
    const selected = samplePrefixes.slice(startIndex, startIndex + 5);

    const items: SearchResultItem[] = selected.map((prefix) => ({
      title: `${prefix.toUpperCase()} Portal - ${domain}`,
      url: `https://${prefix}.${domain}/index.html?ref=dorking`,
      snippet: `Official ${prefix} service endpoint and portal documentation for ${domain}.`,
      provider: this.name,
      query,
      discoveredAt: new Date().toISOString(),
    }));

    // Add multi-level subdomains on page 1
    if (page === 1) {
      items.push(
        {
          title: `API Dev Gateway - ${domain}`,
          url: `https://dev.api.${domain}/v1/health`,
          snippet: `Development API Gateway for ${domain}`,
          provider: this.name,
          query,
          discoveredAt: new Date().toISOString(),
        },
        {
          title: `Beta Dashboard - ${domain}`,
          url: `https://beta.dashboard.${domain}/login`,
          snippet: `Beta staging authentication portal for ${domain}`,
          provider: this.name,
          query,
          discoveredAt: new Date().toISOString(),
        }
      );
    }

    return items;
  }
}

