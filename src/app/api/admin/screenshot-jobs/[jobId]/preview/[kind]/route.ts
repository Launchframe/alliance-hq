import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  isScreenshotPreviewKind,
} from "@/lib/admin/screenshot-ocr-jobs.shared";
import { resolveScreenshotOcrPreviewStorageKey } from "@/lib/admin/screenshot-ocr-jobs.server";
import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { getObject } from "@/lib/storage";

type RouteParams = {
  params: Promise<{ jobId: string; kind: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const denied = await requirePlatformMaintainer(sessionId);
    if (denied) return denied;

    const { jobId, kind: kindParam } = await params;
    if (!isScreenshotPreviewKind(kindParam)) {
      return NextResponse.json({ error: "Invalid preview kind" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .select({ id: schema.screenshotOcrJobs.id })
      .from(schema.screenshotOcrJobs)
      .where(eq(schema.screenshotOcrJobs.id, jobId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const storageKey = resolveScreenshotOcrPreviewStorageKey(jobId, kindParam);
    const buffer = await getObject(storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Preview unavailable" }, { status: 404 });
  }
}
