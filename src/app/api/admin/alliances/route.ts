import { NextResponse } from "next/server";

import { loadAdminAlliances } from "@/lib/admin/system-stats";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const alliances = await loadAdminAlliances();
  return NextResponse.json({
    alliances: alliances.map((alliance) => ({
      ...alliance,
      rolesSyncedAt: alliance.rolesSyncedAt?.toISOString() ?? null,
      createdAt: alliance.createdAt.toISOString(),
      updatedAt: alliance.updatedAt.toISOString(),
    })),
  });
}
