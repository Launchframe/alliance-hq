import { NextResponse } from "next/server";
import { complianceApiContext, complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { loadVsMemberDetail, loadVsMemberHistory } from "@/lib/vs-performance/member-performance.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ memberId: string }> }) {
  try {
    const actor = await complianceApiContext();
    if (actor instanceof NextResponse) return actor;
    const { memberId } = await context.params;
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const result = query.beforeWeek
      ? await loadVsMemberHistory(actor.sessionId, actor.allianceId, memberId, query)
      : await loadVsMemberDetail(actor.sessionId, actor.allianceId, memberId, query);
    return NextResponse.json(result);
  } catch (error) {
    return complianceErrorResponse(error);
  }
}
