import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { parseAuditLogQueryParams } from "@/lib/admin/audit-query";
import { buildAuditLogWhere } from "@/lib/admin/audit-query-server";
import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

async function resolveAllianceMatchIds(
  hqAllianceId: string,
): Promise<string[] | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.alliances.id,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, hqAllianceId))
    .limit(1);

  if (!row) {
    return null;
  }

  const ids = [row.id];
  if (row.ashedAllianceId) {
    ids.push(row.ashedAllianceId);
  }
  return ids;
}

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

  let filters = parsed.filters;
  if (filters.allianceId) {
    const allianceMatchIds = await resolveAllianceMatchIds(filters.allianceId);
    if (!allianceMatchIds) {
      return NextResponse.json(
        { error: "Unknown alliance filter" },
        { status: 400 },
      );
    }
    filters = { ...filters, allianceMatchIds };
  }

  const where = buildAuditLogWhere(filters);
  const db = getDb();

  const rows = where
    ? await db
        .select()
        .from(schema.auditLog)
        .where(where)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(filters.limit)
    : await db
        .select()
        .from(schema.auditLog)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(filters.limit);

  return NextResponse.json({ entries: rows });
}
