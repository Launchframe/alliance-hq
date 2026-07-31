import "server-only";

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import {
  mapPriorDayVsToScoreEntries,
  SCORE_LEADERBOARD_LIST_MAX,
  type ScoreLeaderboardPayload,
} from "@/lib/trains/score-leaderboard-podium.shared";
import { fetchAllianceVsTopScorersForTrainDate } from "@/lib/trains/vs-scores.server";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

export async function loadVsPushLeaderboard(input: {
  allianceId: string;
  trainDate: string;
  hqUserId?: string | null;
}): Promise<ScoreLeaderboardPayload> {
  const scoreDate = vsScoreReferenceDate(input.trainDate);
  let viewerMemberId: string | null = null;
  if (input.hqUserId) {
    const link = await getHqMemberLinkForUser(
      input.allianceId,
      input.hqUserId,
    );
    viewerMemberId = link?.ashedMemberId ?? null;
  }

  const top = await fetchAllianceVsTopScorersForTrainDate(
    input.allianceId,
    input.trainDate,
    SCORE_LEADERBOARD_LIST_MAX,
  );

  const entries = mapPriorDayVsToScoreEntries(
    top.map((row) => ({
      memberId: row.memberId,
      memberName: row.memberName,
      priorDayVsScore: row.priorDayVsScore ?? 0,
      isViewer: viewerMemberId === row.memberId,
    })),
  );

  return {
    kind: "vs_push",
    trainDate: input.trainDate,
    scoreDate,
    podium: entries.slice(0, 3),
    entries,
  };
}
