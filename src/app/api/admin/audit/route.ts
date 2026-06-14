import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const allianceId = url.searchParams.get("allianceId");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const db = getDb();
  const rows = allianceId
    ? await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.allianceId, allianceId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(schema.auditLog)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit);

  return NextResponse.json({ entries: rows });
}
