import { NextResponse } from "next/server";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { resolveAllianceMemberPortrait } from "@/lib/trains/portrait-resolution.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tag: string; memberId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await getOrCreateSession();
    const { tag, memberId } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "scores:read",
    );
    if (denied) return denied;

    const portrait = await resolveAllianceMemberPortrait({
      allianceId: alliance.allianceId,
      ashedMemberId: memberId,
    });

    return NextResponse.json({
      url: portrait.url,
      source: portrait.source,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
