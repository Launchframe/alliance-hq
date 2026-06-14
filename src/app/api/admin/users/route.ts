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
  const users = await db
    .select()
    .from(schema.hqUsers)
    .orderBy(desc(schema.hqUsers.createdAt))
    .limit(500);

  return NextResponse.json({ users });
}
