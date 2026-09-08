import { NextResponse } from "next/server";
import { complianceApiContext, complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { loadComplianceDashboard } from "@/lib/vs-compliance/service.server";
import { loadComplianceHistory } from "@/lib/vs-compliance/history.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  try {
    const context = await complianceApiContext();
    if (context instanceof NextResponse) return context;
    const params = new URL(request.url).searchParams;
    const eventId = params.get("eventId");
    if (eventId !== null) return NextResponse.json(await loadComplianceHistory(context.sessionId, context.allianceId, eventId));
    const ending = params.get("weekEnding") ?? undefined;
    return NextResponse.json(await loadComplianceDashboard(context.sessionId, context.allianceId, ending));
  } catch (error) { return complianceErrorResponse(error); }
}
