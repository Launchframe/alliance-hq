import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDb, schema } from "@/lib/db";
import { withApiErrorHandler } from "@/lib/ops/api-error";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

async function getHandler(req: NextRequest) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const severity = req.nextUrl.searchParams.get("severity")?.trim();
  const take = Math.min(
    parseInt(req.nextUrl.searchParams.get("take") ?? "50", 10) || 50,
    100,
  );

  const db = getDb();
  const events = severity
    ? await db
        .select()
        .from(schema.opsEvents)
        .where(eq(schema.opsEvents.severity, severity))
        .orderBy(desc(schema.opsEvents.createdAt))
        .limit(take)
    : await db
        .select()
        .from(schema.opsEvents)
        .orderBy(desc(schema.opsEvents.createdAt))
        .limit(take);

  return NextResponse.json(events);
}

export const GET = withApiErrorHandler(getHandler);
