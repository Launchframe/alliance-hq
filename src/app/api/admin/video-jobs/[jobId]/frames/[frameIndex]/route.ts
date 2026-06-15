import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { getObject } from "@/lib/storage";

type RouteParams = {
  params: Promise<{ jobId: string; frameIndex: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { jobId, frameIndex: frameIndexParam } = await params;
  const frameIndex = Number(frameIndexParam);
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    return NextResponse.json({ error: "Invalid frame index" }, { status: 400 });
  }

  const db = getDb();
  const [frame] = await db
    .select()
    .from(schema.videoFrames)
    .where(
      and(
        eq(schema.videoFrames.jobId, jobId),
        eq(schema.videoFrames.frameIndex, frameIndex),
      ),
    )
    .limit(1);

  if (!frame) {
    return NextResponse.json({ error: "Frame not found" }, { status: 404 });
  }

  const buffer = await getObject(frame.storageKey);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
