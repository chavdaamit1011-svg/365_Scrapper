/**
 * API Route: /api/dorking/jobs/[id]/control
 * POST: Execute control actions on a Dorking Job (pause, resume, stop, retry)
 */

import { NextRequest, NextResponse } from 'next/server';
import { DorkingDiscoveryEngine } from '@/modules/dorking/engine/discoveryEngine';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    const engine = DorkingDiscoveryEngine.getInstance();

    switch (action) {
      case 'pause': {
        const ok = await engine.pauseJob(id);
        return NextResponse.json({ success: ok, action: 'pause' });
      }
      case 'resume': {
        const ok = await engine.resumeJob(id);
        return NextResponse.json({ success: ok, action: 'resume' });
      }
      case 'stop': {
        const ok = await engine.stopJob(id);
        return NextResponse.json({ success: ok, action: 'stop' });
      }
      case 'retry': {
        const job = await engine.retryFailedQueries(id);
        return NextResponse.json({ success: Boolean(job), job, action: 'retry' });
      }
      default:
        return NextResponse.json(
          { error: `Invalid action: '${action}'. Expected 'pause', 'resume', 'stop', or 'retry'.` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Control operation failed' },
      { status: 500 }
    );
  }
}
