import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

    console.log(`[API /api/crawler/run] Received crawl request for: ${domain} (pages: ${maxPages}, depth: ${maxDepth})`);

    return NextResponse.json({
      success: true,
      domain,
      records: [],
      count: 0,
      logs: ['Ready for JS/TS crawler engine.'],
    });
  } catch (err: any) {
    console.error('[API /api/crawler/run] Unexpected error:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Crawl execution failed' },
      { status: 500 }
    );
  }
}

