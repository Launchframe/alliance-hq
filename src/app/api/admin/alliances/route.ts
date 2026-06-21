import { NextResponse } from "next/server";

import { parseAdminAlliancesQueryParams } from "@/lib/admin/admin-alliances-query";
import { loadAdminAlliances } from "@/lib/admin/system-stats";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const parsed = parseAdminAlliancesQueryParams(
    new URL(request.url).searchParams,
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await loadAdminAlliances(parsed.params);

  return NextResponse.json({
    alliances: result.alliances.map((alliance) => ({
      ...alliance,
      operatingMode: alliance.operatingMode,
      rolesSyncedAt: alliance.rolesSyncedAt?.toISOString() ?? null,
      createdAt: alliance.createdAt.toISOString(),
      updatedAt: alliance.updatedAt.toISOString(),
    })),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
}
