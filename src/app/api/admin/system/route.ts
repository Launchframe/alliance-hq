import { NextResponse } from "next/server";

import {
  loadAdminRolesWithPermissions,
  loadSystemStats,
} from "@/lib/admin/system-stats";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const [stats, roles] = await Promise.all([
    loadSystemStats(),
    loadAdminRolesWithPermissions(),
  ]);

  return NextResponse.json({
    stats: {
      ...stats,
      recentQueuedJobs: stats.recentQueuedJobs.map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
      })),
    },
    roles,
  });
}
