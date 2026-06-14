import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const db = getDb();
  const [events, series, boards] = await Promise.all([
    db
      .select()
      .from(schema.hqEvents)
      .orderBy(desc(schema.hqEvents.createdAt))
      .limit(500),
    db.select().from(schema.hqEventSeries).limit(500),
    db.select().from(schema.hqEventBoards).limit(500),
  ]);

  return NextResponse.json({ events, series, boards });
}
