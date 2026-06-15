import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { getObject } from "@/lib/storage";

type Props = {
  params: Promise<{ id: string; screenshotId: string }>;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forbidden = await requirePlatformMaintainer(sessionId);
    if (forbidden) return forbidden;

    const { id, screenshotId } = await params;
    const db = getDb();
    const [shot] = await db
      .select({
        storageKey: schema.bugReportScreenshot.storageKey,
      })
      .from(schema.bugReportScreenshot)
      .where(
        and(
          eq(schema.bugReportScreenshot.id, screenshotId),
          eq(schema.bugReportScreenshot.reportId, id),
        ),
      )
      .limit(1);

    if (!shot) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const buffer = await getObject(shot.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return feedbackErrorResponse("Screenshot unavailable");
  }
}
