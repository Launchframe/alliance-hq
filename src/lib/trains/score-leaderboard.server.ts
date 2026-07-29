import "server-only";

import {
  mapPriorDayVsToScoreEntries,
  type ScoreLeaderboardKind,
  type ScoreLeaderboardPayload,
} from "@/lib/trains/score-leaderboard-podium.shared";
import { loadPriceIsRightVsLeaderboard } from "@/lib/trains/price-is-right-leaderboard.server";
import { loadVsPushLeaderboard } from "@/lib/trains/vs-push-leaderboard.server";

function mapTpifPayload(
  payload: Awaited<ReturnType<typeof loadPriceIsRightVsLeaderboard>>,
): ScoreLeaderboardPayload {
  const entries = mapPriorDayVsToScoreEntries(
    payload.entries.map((entry) => ({
      memberId: entry.memberId,
      memberName: entry.memberName,
      priorDayVsScore: entry.priorDayVsScore,
      isViewer: entry.isViewer,
    })),
  );
  return {
    kind: "tpif",
    trainDate: payload.trainDate,
    scoreDate: payload.scoreDate,
    podium: entries.slice(0, 3),
    entries,
  };
}

export async function loadScoreLeaderboard(input: {
  allianceId: string;
  trainDate: string;
  kind: ScoreLeaderboardKind;
  hqUserId?: string | null;
}): Promise<ScoreLeaderboardPayload> {
  switch (input.kind) {
    case "tpif": {
      const payload = await loadPriceIsRightVsLeaderboard({
        allianceId: input.allianceId,
        trainDate: input.trainDate,
        hqUserId: input.hqUserId,
      });
      return mapTpifPayload(payload);
    }
    case "vs_push":
      return loadVsPushLeaderboard(input);
    case "donations":
      return {
        kind: "donations",
        trainDate: input.trainDate,
        podium: [],
        entries: [],
        unavailable: true,
      };
    default: {
      const _exhaustive: never = input.kind;
      return _exhaustive;
    }
  }
}
