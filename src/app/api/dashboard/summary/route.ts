import { NextResponse } from "next/server";

import { loadDashboardSummary } from "@/lib/analytics/dashboard-summary.server";
import { collectDatabaseErrorText } from "@/lib/db/error-message";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  try {
    const payload = await loadDashboardSummary(session.id);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/dashboard/summary]", collectDatabaseErrorText(error));
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
