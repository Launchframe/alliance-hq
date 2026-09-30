import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { fetchAlliancePriorDayVsScoresForTrainDate } from "@/lib/trains/vs-scores.server";
import {
  buildPriceIsRightVsLeaderboard,
  type PriceIsRightLeaderboardEntry,
} from "@/lib/trains/price-is-right-leaderboard.shared";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import { resolveScoreLeaderboardKind } from "@/lib/trains/score-leaderboard-podium.shared";
import {
  getAllianceRanksAsOf,
  isMemberEligibleForPool,
  resolveMemberPoolAllianceRank,
} from "@/lib/trains/rank-history";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

export type PriceIsRightLeaderboardPayload = {
  trainDate: string;
  scoreDate: string;
  podium: PriceIsRightLeaderboardEntry[];
  entries: PriceIsRightLeaderboardEntry[];
};

export async function loadPriceIsRightVsLeaderboard(input: {
  allianceId: string;
  trainDate: string;
  hqUserId?: string | null;
}): Promise<PriceIsRightLeaderboardPayload> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(input.allianceId);
  const leadDays = await loadAllianceTrainLeadTimeDays(input.allianceId);
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.trainDate,
    seasonKey,
  );
  const scoreDate = vsScoreReferenceDate(input.trainDate, leadDays);
  const scoreDateDayConfig = await resolveRollDayConfig(
    input.allianceId,
    scoreDate,
    seasonKey,
  );
  const leaderboardKind = resolveScoreLeaderboardKind({
    rule: dayConfig.conductorRule,
    trainDate: input.trainDate,
    leadDays,
    scoreDayRule: scoreDateDayConfig.conductorRule,
  });
  if (leaderboardKind !== "tpif") {
    throw new Error("Selected day is not a Price Is Freight train day.");
  }

  const [members, rankEvents, vsScores] = await Promise.all([
    loadActiveAlliancePoolMembers({ allianceId: input.allianceId }),
    getAllianceRanksAsOf(input.allianceId, input.trainDate),
    fetchAlliancePriorDayVsScoresForTrainDate(
      input.allianceId,
      input.trainDate,
      leadDays,
    ),
  ]);

  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );

  const candidates = members.flatMap((member) => {
    const rankEvent = rankByMember.get(member.ashedMemberId);
    const rank = resolveMemberPoolAllianceRank(member, rankEvent);
    if (!isMemberEligibleForPool("r3", rank)) return [];
    return [
      {
        memberId: member.ashedMemberId,
        memberName: member.currentName,
      },
    ];
  });

  let viewerMemberId: string | null = null;
  if (input.hqUserId) {
    const link = await getHqMemberLinkForUser(
      input.allianceId,
      input.hqUserId,
    );
    viewerMemberId = link?.ashedMemberId ?? null;
  }

  const entries = buildPriceIsRightVsLeaderboard(
    candidates,
    vsScores,
    viewerMemberId,
  );

  return {
    trainDate: input.trainDate,
    scoreDate,
    podium: entries.slice(0, 3),
    entries,
  };
}
