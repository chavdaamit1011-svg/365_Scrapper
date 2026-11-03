import { NextResponse } from 'next/server';
import { redisQueue } from '@/lib/redisQueue';
import { spawn } from 'child_process';
import path from 'path';
import { getPythonExecutable } from '@/lib/pythonCrawler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/crawl-jobs
 * Enqueues a domain crawl job into Redis (Component 1 & 2 of PDF Architecture)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const domain = body.domain || body.target || body.url;

    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      return NextResponse.json(
        { success: false, message: 'Please provide a valid domain to crawl.' },
        { status: 400 }
      );
    }

    const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].trim().toLowerCase();
    const maxPages = Number(body.max_pages || body.maxPages) || 15;
    const maxDepth = Number(body.max_depth || body.maxDepth) || 2;
    const requestsPerSecond = Number(body.requests_per_second || body.requestsPerSecond) || 1;
    const respectRobotsTxt = body.respect_robots_txt !== undefined ? Boolean(body.respect_robots_txt) : true;

    // 1. Enqueue job into Redis
    const job = await redisQueue.enqueueCrawlJob({
      domain: cleanDomain,
      maxPages,
      maxDepth,
      requestsPerSecond,
      respectRobotsTxt,
    });

    // 2. Trigger Python worker asynchronously in background (Non-blocking Next.js API)
    const pythonBin = getPythonExecutable();
    const workerScript = path.join(process.cwd(), 'crawler_engine', 'worker.py');

    const workerArgs = [
      workerScript,
      '--job-id', job.id,
      '--domain', cleanDomain,
      '--max-pages', String(maxPages),
      '--max-depth', String(maxDepth),
    ];

    console.log(`[API /api/crawl-jobs] Enqueued ${job.id} for ${cleanDomain}. Spawning worker...`);

    const workerProcess = spawn(pythonBin, workerArgs, {
      cwd: path.join(process.cwd(), 'crawler_engine'),
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    workerProcess.unref();

    const redisStatus = redisQueue.getRedisStatus();

    // 3. Respond immediately with job_id and status (Component 1 of PDF)
    return NextResponse.json({
      success: true,
      job_id: job.id,
      status: 'queued',
      domain: cleanDomain,
      redis_connected: redisStatus.connected,
      redis_url: redisStatus.url,
      created_at: job.createdAt,
    });
  } catch (err: any) {
    console.error('[API /api/crawl-jobs] Error enqueuing crawl job:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to enqueue crawl job' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/crawl-jobs
 * Lists all jobs and current Redis queue status
 */
export async function GET() {
  try {
    const jobs = await redisQueue.getAllJobs();
    const controlState = await redisQueue.getControlState();
    const redisStatus = redisQueue.getRedisStatus();

    return NextResponse.json({
      success: true,
      control_state: controlState,
      redis_status: redisStatus,
      total_jobs: jobs.length,
      jobs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch crawl jobs' },
      { status: 500 }
    );
  }
}

