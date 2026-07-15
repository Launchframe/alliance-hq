import { NextResponse } from "next/server";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { getOrCreateSession } from "@/lib/session";
import {
  finalizeVideoUploadEnqueue,
  newVideoUploadIds,
} from "@/lib/video/finalize-video-upload";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getOrCreateSession();

  const body = (await request.json()) as {
    fixtureId: string;
    fixtureDayIndex?: number | null;
    scoreTarget?: string;
  };

  if (!body.fixtureId) {
    return NextResponse.json(
      { error: "fixtureId is required" },
      { status: 400 },
    );
  }

  const { jobId, groupId } = newVideoUploadIds();
  const scoreTarget = body.scoreTarget ?? "vs-performance";

  await finalizeVideoUploadEnqueue({
    sessionId: session.id,
    jobId,
    groupId,
    storageKey: `fixture-only/${jobId}`,
    fileName: `fixture-${body.fixtureId}.json`,
    fileSizeBytes: 0,
    scoreTarget,
    boardKey: null,
    hqEventId: null,
    allianceId: session.allianceId ?? null,
    enqueuedByHqUserId: session.hqUserId ?? null,
    fixtureId: body.fixtureId,
    fixtureDayIndex: body.fixtureDayIndex ?? null,
  });

  return NextResponse.json({
    ok: true,
    jobId,
    message: "Fixture-only job created.",
    status: "pending_approval",
  });
}
