import { NextResponse } from 'next/server';
import { crawlDomain } from '@/lib/crawler/crawlerEngine';

export const dynamic = 'force-dynamic';
// Allow Next.js route up to 120s for deep multi-source OSINT & crawl
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const domain = body.domain || body.url || body.target;

    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      return NextResponse.json(
        { success: false, message: 'Please provide a valid domain or URL to crawl.' },
        { status: 400 }
      );
    }

    const maxPages = Number(body.maxPages) || 5;
    const maxDepth = Number(body.maxDepth) || 2;

    console.log(`[API /api/crawler/run] Executing native TS crawler on: ${domain} (pages: ${maxPages}, depth: ${maxDepth})`);

    const result = await crawlDomain(domain, {
      maxPages,
      maxDepth,
      delayMs: 250,
      timeoutMs: 12000,
    });

    return NextResponse.json({
      success: true,
      domain: result.domain,
      records: [result],
      count: 1,
      logs: [
        `Native TS crawler completed for ${result.domain}`,
        `Discovered ${result.subdomainCount} subdomains across 2nd, 3rd, and 4th levels`,
        `Verified ${result.emailCount} emails`,
        `Status: ${result.status}`,
      ],
    });
  } catch (err: any) {
    console.error('[API /api/crawler/run] Unexpected crawler error:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Crawl execution failed' },
      { status: 500 }
    );
  }
}
