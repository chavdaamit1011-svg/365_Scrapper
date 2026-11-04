/**
 * API Route: /api/dorking/jobs/[id]
 * GET: Retrieve specific Dorking Job status and execution logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { DorkingDiscoveryEngine } from '@/modules/dorking/engine/discoveryEngine';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const engine = DorkingDiscoveryEngine.getInstance();
    const job = await engine.getJob(id);

    if (!job) {
      return NextResponse.json(
        { error: `Job with ID '${id}' not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch job details' },
      { status: 500 }
    );
  }
}
