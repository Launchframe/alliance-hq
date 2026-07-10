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
import {
  getAllianceRanksAsOf,
  isMemberEligibleForPool,
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
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.trainDate,
    seasonKey,
  );
  if (dayConfig.paintTemplate !== "price_is_right") {
    throw new Error("Selected day is not a Price Is Freight train day.");
  }

  const scoreDate = vsScoreReferenceDate(input.trainDate);
  const [members, rankEvents, vsScores] = await Promise.all([
    loadActiveAlliancePoolMembers({ allianceId: input.allianceId }),
    getAllianceRanksAsOf(input.allianceId, input.trainDate),
    fetchAlliancePriorDayVsScoresForTrainDate(
      input.allianceId,
      input.trainDate,
    ),
  ]);

  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );

  const candidates = members.flatMap((member) => {
    const rankEvent = rankByMember.get(member.ashedMemberId);
    const rank = rankEvent?.allianceRank ?? member.allianceRank ?? null;
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
