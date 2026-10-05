import { NextResponse } from "next/server";
import { complianceApiContext, complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { loadVsMemberScoreRevisions } from "@/lib/vs-performance/member-performance.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ memberId: string }> }) {
  try {
    const actor = await complianceApiContext();
    if (actor instanceof NextResponse) return actor;
    const { memberId } = await context.params;
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    return NextResponse.json(await loadVsMemberScoreRevisions(actor.sessionId, actor.allianceId, memberId, query));
  } catch (error) {
    return complianceErrorResponse(error);
  }
}
