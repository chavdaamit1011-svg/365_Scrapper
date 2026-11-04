/**
 * API Route: /api/dorking/results
 * GET: Filter and list discovered hostnames and subdomains
 */

import { NextRequest, NextResponse } from 'next/server';
import { DorkingPersistenceService } from '@/modules/dorking/services/persistence';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain') || undefined;
    const provider = searchParams.get('provider') || undefined;
    const dnsStatus = searchParams.get('dnsStatus') || undefined;
    const search = searchParams.get('search') || undefined;

    const records = await DorkingPersistenceService.getRecords({
      domain,
      provider,
      dnsStatus,
      search,
    });

    return NextResponse.json({ success: true, count: records.length, records });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch discovered records' },
      { status: 500 }
    );
  }
}

