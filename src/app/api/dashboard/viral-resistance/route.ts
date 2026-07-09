import { NextResponse } from "next/server";

import { loadViralResistanceDashboard } from "@/lib/analytics/dashboard-summary.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  try {
    const payload = await loadViralResistanceDashboard(session.id);
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Failed to load VR analytics" }, { status: 500 });
  }
}
