/**
 * API Route: /api/dorking/jobs
 * POST: Start a new Dorking Job
 * GET: List all Dorking Jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { DorkingDiscoveryEngine } from '@/modules/dorking/engine/discoveryEngine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { domain, customQueries, providers, concurrency, maxPagesPerQuery } = body;

    if (!domain || typeof domain !== 'string') {
      return NextResponse.json(
        { error: 'Target domain is required' },
        { status: 400 }
      );
    }

    const engine = DorkingDiscoveryEngine.getInstance();
    const job = await engine.startJob({
      domain,
      customQueries: Array.isArray(customQueries) ? customQueries : undefined,
      providers: Array.isArray(providers) ? providers : undefined,
      concurrency: typeof concurrency === 'number' ? concurrency : undefined,
      maxPagesPerQuery: typeof maxPagesPerQuery === 'number' ? maxPagesPerQuery : undefined,
    });

    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to start Dorking job' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const engine = DorkingDiscoveryEngine.getInstance();
    const jobs = await engine.getAllJobs();
    return NextResponse.json({ success: true, jobs });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

