import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import {
  buildAuditLogWhere,
  parseAuditLogQueryParams,
} from "@/lib/admin/audit-query";
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
  const parsed = parseAuditLogQueryParams(url.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const where = buildAuditLogWhere(parsed.filters);
  const db = getDb();

  const rows = where
    ? await db
        .select()
        .from(schema.auditLog)
        .where(where)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(parsed.filters.limit)
    : await db
        .select()
        .from(schema.auditLog)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(parsed.filters.limit);

  return NextResponse.json({ entries: rows });
}
