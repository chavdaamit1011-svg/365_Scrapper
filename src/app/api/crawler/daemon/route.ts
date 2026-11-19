import { NextResponse } from 'next/server';
import { getCrawlerDaemon } from '@/lib/crawler/crawlerDaemon';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const daemon = getCrawlerDaemon();
    const status = daemon.getStatus();

    return NextResponse.json({
      success: true,
      daemon: status,
    });
  } catch (err: any) {
    console.error('[API /api/crawler/daemon GET] Error:', err);
    return NextResponse.json(
      { success: false, message: err?.message || 'Failed to fetch crawler daemon status' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action || 'start';
    const daemon = getCrawlerDaemon();

    let updatedStatus;

    switch (action) {
      case 'start': {
        const targets = Array.isArray(body.targets) ? body.targets : [];
        const isContinuous = body.isContinuous !== undefined ? Boolean(body.isContinuous) : true;
        const cycle = Number(body.cycle) || 1;
        updatedStatus = await daemon.start(targets, { isContinuous, cycle });
        break;
      }

      case 'pause': {
        updatedStatus = daemon.pause();
        break;
      }

      case 'resume': {
        updatedStatus = daemon.resume();
        break;
      }

      case 'stop': {
        updatedStatus = await daemon.stop();
        break;
      }

      case 'enqueue': {
        const targets = Array.isArray(body.targets) ? body.targets : [];
        updatedStatus = daemon.enqueueTargets(targets);
        break;
      }

      case 'reset': {
        updatedStatus = daemon.reset();
        break;
      }

      default: {
        return NextResponse.json(
          { success: false, message: `Unknown action: ${action}` },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      action,
      daemon: updatedStatus,
    });
  } catch (err: any) {
    console.error('[API /api/crawler/daemon POST] Error:', err);
    return NextResponse.json(
      { success: false, message: err?.message || 'Failed to process crawler daemon action' },
      { status: 500 }
    );
  }
}
