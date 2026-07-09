import { NextResponse } from "next/server";

import { loadBattlePlanDashboard } from "@/lib/battle-plan/load-dashboard.server";
import {
  requireBattlePlanAllianceContext,
  requireBattlePlanRead,
} from "@/lib/battle-plan/route-helpers.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId } = context;
  const denied = await requireBattlePlanRead(sessionId);
  if (denied) return denied;

  const dashboard = await loadBattlePlanDashboard(sessionId);
  if (!dashboard) {
    return NextResponse.json({ error: "No alliance context" }, { status: 400 });
  }
  if ("forbidden" in dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(dashboard);
}
