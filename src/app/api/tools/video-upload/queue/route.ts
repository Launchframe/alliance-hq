import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import {
  isAllianceHqOcrOnlyLockedOnDeploy,
  loadEffectiveAllianceHqOcrOnly,
} from "@/lib/video/alliance-ocr-settings.server";
import { videoOcrRequiresAshedConnection } from "@/lib/video/ocr-provider.shared";
import {
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";
import {
  listAllianceActiveVideoJobs,
  listAlliancePendingVideoJobs,
  listVideoQueueJobsForSession,
  type AllianceQueueJob,
} from "@/lib/video/video-queue.server";

export const dynamic = "force-dynamic";

export type { AllianceQueueJob };

export async function GET() {
  try {
    const session = await getOrCreateSession();

    if (!(await sessionCanReadAllianceVideoQueue(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allianceId = resolveSessionAllianceId(session);
    const [jobs, canProcess, connection, hqOcrOnly] = await Promise.all([
      listVideoQueueJobsForSession(session.id),
      sessionCanProcessVideo(session.id),
      getAshedConnection(session.id),
      allianceId ? loadEffectiveAllianceHqOcrOnly(allianceId) : Promise.resolve(false),
    ]);

    const ocrContext = { allianceHqOcrOnly: hqOcrOnly };

    return NextResponse.json({
      jobs,
      canProcess,
      ashedConnected: Boolean(connection),
      ashedRequired: videoOcrRequiresAshedConnection(ocrContext),
      hqOcrOnly,
      hqOcrOnlyLocked: isAllianceHqOcrOnlyLockedOnDeploy(),
      connectUrl: `/connect?next=${encodeURIComponent("/tools/video-upload/queue")}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load queue",
      },
      { status: 500 },
    );
  }
}

export {
  listAllianceActiveVideoJobs,
  listAlliancePendingVideoJobs,
  listVideoQueueJobsForSession,
};
