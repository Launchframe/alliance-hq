import { NextResponse } from "next/server";

import { loadDashboardSummary } from "@/lib/analytics/dashboard-summary.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  try {
    const payload = await loadDashboardSummary(session.id);
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
