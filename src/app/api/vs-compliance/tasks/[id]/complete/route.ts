import { NextResponse } from "next/server";
import { performComplianceAction } from "@/lib/vs-compliance/actions.server";
import { complianceApiContext, complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { syncComplianceAction } from "@/lib/vs-compliance/sync.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await complianceApiContext();
    if (actor instanceof NextResponse) return actor;
    let body: unknown;
    try { body = await request.json(); } catch { throw new VsComplianceError("changed", 409); }
    const { id } = await context.params;
    const result = await performComplianceAction(actor.sessionId, actor.allianceId, id, body, false);
    const syncStatus = await syncComplianceAction(actor.allianceId, result.actionId);
    return NextResponse.json({ ...result, syncStatus });
  } catch (error) { return complianceErrorResponse(error); }
}
