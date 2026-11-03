import { NextResponse } from 'next/server';
import { redisQueue } from '@/lib/redisQueue';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await redisQueue.getJob(id);

    if (!job) {
      return NextResponse.json(
        { success: false, message: `Job ${id} not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch job' },
      { status: 500 }
    );
  }
}

