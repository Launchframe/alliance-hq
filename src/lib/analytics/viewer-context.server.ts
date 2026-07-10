import "server-only";

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { loadCommanderIndex } from "@/lib/commanders/index.server";
import type { CommanderIndexPayload } from "@/lib/commanders/index.shared";
import type { DashboardViewerContext } from "@/lib/analytics/dashboard-summary.shared";

export type { DashboardViewerContext };

export function viewerContextFromCommanderIndex(
  commanderIndex: CommanderIndexPayload,
  link: { ashedMemberId: string; memberDisplayName: string | null },
): DashboardViewerContext {
  const row = commanderIndex.rows.find(
    (entry) => entry.ashedMemberId === link.ashedMemberId,
  );

  return {
    memberId: link.ashedMemberId,
    memberName: row?.memberName ?? link.memberDisplayName ?? null,
    hqLinked: true,
    totalHeroPower: row?.totalHeroPower ?? null,
    mainSquad: row?.mainSquad ?? null,
    highestBaseVr: row?.highestBaseVr ?? null,
  };
}

export async function loadDashboardViewerContext(
  sessionId: string,
  hqUserId: string | null,
  allianceId: string,
  commanderIndex?: CommanderIndexPayload,
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

  const index = commanderIndex ?? (await loadCommanderIndex(sessionId));
  return viewerContextFromCommanderIndex(index, link);
}
