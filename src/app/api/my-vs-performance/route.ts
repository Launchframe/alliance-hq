import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadMyVsPerformance, loadMyVsPerformanceHistory } from "@/lib/vs-performance/my-performance.server";
import { complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const denied = await requireSessionPermission(session.id, "members:read");
    if (denied) return denied;
    const allianceId = session.currentAllianceId ?? session.allianceId;
    if (!allianceId || !session.hqUserId) throw new VsComplianceError("not_found", 404);
    const query = Object.fromEntries(new URL(request.url).searchParams.entries());
    const result = query.beforeWeek !== undefined
      ? await loadMyVsPerformanceHistory(session.hqUserId, allianceId, query)
      : await loadMyVsPerformance(session.id, session.hqUserId, allianceId, query);
    return NextResponse.json(result);
  } catch (error) {
    return complianceErrorResponse(error);
  }
}
