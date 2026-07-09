import "server-only";

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { loadCommanderIndex } from "@/lib/commanders/index.server";
import type { DashboardViewerContext } from "@/lib/analytics/dashboard-summary.shared";

export type { DashboardViewerContext };

export async function loadDashboardViewerContext(
  sessionId: string,
  hqUserId: string | null,
  allianceId: string,
): Promise<DashboardViewerContext> {
  const empty: DashboardViewerContext = {
    memberId: null,
    memberName: null,
    hqLinked: false,
    totalHeroPower: null,
    mainSquad: null,
    highestBaseVr: null,
  };

  if (!hqUserId) {
    return empty;
  }

  const link = await getHqMemberLinkForUser(allianceId, hqUserId);
  if (!link?.ashedMemberId) {
    return empty;
  }

  const index = await loadCommanderIndex(sessionId);
  const row = index.rows.find((entry) => entry.ashedMemberId === link.ashedMemberId);

  return {
    memberId: link.ashedMemberId,
    memberName: row?.memberName ?? link.memberDisplayName ?? null,
    hqLinked: true,
    totalHeroPower: row?.totalHeroPower ?? null,
    mainSquad: row?.mainSquad ?? null,
    highestBaseVr: row?.highestBaseVr ?? null,
  };
}
