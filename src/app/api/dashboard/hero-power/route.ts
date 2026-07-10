import { NextRequest, NextResponse } from "next/server";

import { loadHeroPowerDashboard } from "@/lib/analytics/dashboard-summary.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const range = request.nextUrl.searchParams.get("range");

  try {
    const payload = await loadHeroPowerDashboard(session.id, range);
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Failed to load hero power" }, { status: 500 });
  }
}
