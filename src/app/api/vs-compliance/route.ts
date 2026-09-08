import { NextResponse } from "next/server";
import { complianceApiContext, complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { loadComplianceDashboard } from "@/lib/vs-compliance/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  try {
    const context = await complianceApiContext();
    if (context instanceof NextResponse) return context;
    const ending = new URL(request.url).searchParams.get("weekEnding") ?? undefined;
    return NextResponse.json(await loadComplianceDashboard(context.sessionId, context.allianceId, ending));
  } catch (error) { return complianceErrorResponse(error); }
}
