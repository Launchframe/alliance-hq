import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { loadTeamWorkDashboard } from "@/lib/support-teams/work-service.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requireSupportAccess();
    const params = new URL(request.url).searchParams;
    return privateJson(await loadTeamWorkDashboard({ sessionId: access.sessionId, hqUserId: access.actor.principalId, allianceId: access.actor.allianceId }, { personal: params.get("scope") !== "all", teamId: params.get("team") ?? undefined, kind: params.get("kind") ?? undefined }));
  } catch (error) { return supportErrorResponse(error); }
}
