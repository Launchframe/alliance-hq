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

  const name = req.nextUrl.searchParams.get("name")?.trim();
  const take = Math.min(
    parseInt(req.nextUrl.searchParams.get("take") ?? "20", 10) || 20,
    100,
  );

  const db = getDb();
  const runs = name
    ? await db
        .select()
        .from(schema.cronRuns)
        .where(eq(schema.cronRuns.name, name))
        .orderBy(desc(schema.cronRuns.startedAt))
        .limit(take)
    : await db
        .select()
        .from(schema.cronRuns)
        .orderBy(desc(schema.cronRuns.startedAt))
        .limit(take);

  return NextResponse.json(runs);
}

export const GET = withApiErrorHandler(getHandler);
