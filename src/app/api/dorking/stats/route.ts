/**
 * API Route: /api/dorking/stats
 * GET: Aggregated overview metrics and provider statistics
 */

import { NextResponse } from 'next/server';
import { DorkingPersistenceService } from '@/modules/dorking/services/persistence';
import { DorkingDiscoveryEngine } from '@/modules/dorking/engine/discoveryEngine';

export async function GET() {
  try {
    const stats = await DorkingPersistenceService.getOverviewStats();
    const engine = DorkingDiscoveryEngine.getInstance();
    const availableProviders = engine.getSearchManager().getAvailableProviders();

    return NextResponse.json({
      success: true,
      stats,
      availableProviders,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch dorking stats' },
      { status: 500 }
    );
  }
}

