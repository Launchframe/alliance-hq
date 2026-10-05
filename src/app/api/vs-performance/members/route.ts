import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { vsActorForSession } from "@/lib/vs-performance/api-helpers.server";
import { loadVsMemberWeek } from "@/lib/vs-performance/member-performance.server";
import { complianceErrorResponse } from "@/lib/vs-compliance/routes.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const actor = vsActorForSession(session);
    if (actor instanceof NextResponse) return actor;
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    return NextResponse.json(await loadVsMemberWeek(actor.sessionId, actor.allianceId, query));
  } catch (error) {
    return complianceErrorResponse(error);
  }
}
