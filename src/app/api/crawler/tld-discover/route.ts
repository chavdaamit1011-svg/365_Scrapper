import { NextResponse } from 'next/server';
import { discoverTldRootDomains, normalizeTld } from '@/lib/crawler/tldDiscovery';

export const dynamic = 'force-dynamic';

/**
 * POST /api/crawler/tld-discover
 * Autonomous 24/7 TLD Root Domain Discovery API
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawTld = body.tld || body.target || body.domain || '';
    const cycle = Number(body.cycle) || 1;
    const maxPerPass = Number(body.maxPerPass || body.limit) || 20;

    if (!rawTld || typeof rawTld !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Please provide a valid TLD zone (e.g. .in, .com, gov.in)' },
        { status: 400 }
      );
    }

    const cleanTld = normalizeTld(rawTld);
    const result = await discoverTldRootDomains(cleanTld, { cycle, maxPerPass });

    return NextResponse.json({
      success: true,
      tld: `.${cleanTld}`,
      cycle: result.cycle,
      totalDiscovered: result.totalDiscovered,
      newCount: result.newDomains.length,
      existingCount: result.existingDomains.length,
      domains: result.allDomains,
      newDomains: result.newDomains,
      existingDomains: result.existingDomains,
      sources: result.sources,
    });
  } catch (err: any) {
    console.error('[API /api/crawler/tld-discover] Error in discovery:', err);
    return NextResponse.json(
      { success: false, message: err?.message || 'TLD Discovery failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/crawler/tld-discover?tld=.in&cycle=1
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTld = searchParams.get('tld') || '.in';
    const cycle = Number(searchParams.get('cycle')) || 1;
    const maxPerPass = Number(searchParams.get('maxPerPass')) || 20;

    const cleanTld = normalizeTld(rawTld);
    const result = await discoverTldRootDomains(cleanTld, { cycle, maxPerPass });

    return NextResponse.json({
      success: true,
      tld: `.${cleanTld}`,
      cycle: result.cycle,
      totalDiscovered: result.totalDiscovered,
      newCount: result.newDomains.length,
      existingCount: result.existingDomains.length,
      domains: result.allDomains,
      newDomains: result.newDomains,
      existingDomains: result.existingDomains,
      sources: result.sources,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err?.message || 'TLD Discovery failed' },
      { status: 500 }
    );
  }
}
