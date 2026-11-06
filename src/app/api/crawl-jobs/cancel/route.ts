import { NextResponse } from 'next/server';
import { redisQueue } from '@/lib/redisQueue';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await redisQueue.setControlState('CANCELLED');
    const jobs = await redisQueue.getAllJobs();
    for (const j of jobs) {
      if (j.status === 'running' || j.status === 'queued') {
        await redisQueue.updateJobStatus(j.id, 'failed', {
          error: 'Cancelled by operator',
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'All active crawl jobs cancelled successfully.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err?.message || 'Failed to cancel crawl jobs' },
      { status: 500 }
    );
  }
}

