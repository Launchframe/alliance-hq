import { NextResponse } from "next/server";

import { loadTrainsDashboard } from "@/lib/trains/load-dashboard";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const data = await loadTrainsDashboard(session.id);
  return NextResponse.json({
    today: data.today,
    conductorRecord: data.conductorRecord,
    todayDayConfig: data.todayDayConfig,
    conductorStats: data.conductorStats,
  });
}
