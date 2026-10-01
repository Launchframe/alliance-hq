import "server-only";

import {
  mapPriorDayVsToScoreEntries,
  SCORE_LEADERBOARD_LIST_MAX,
  type ScoreLeaderboardKind,
  type ScoreLeaderboardPayload,
} from "@/lib/trains/score-leaderboard-podium.shared";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
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
    case "vr_push": {
      const { seasonKey } = await getEffectiveSeasonForAlliance(input.allianceId);
      const dayConfig = await resolveRollDayConfig(
        input.allianceId,
        input.trainDate,
        seasonKey,
      );
      const topN =
        dayConfig.conductorRule?.kind === "vr_top_n"
          ? dayConfig.conductorRule.topN
          : SCORE_LEADERBOARD_LIST_MAX;
      const limit = Math.min(topN, SCORE_LEADERBOARD_LIST_MAX);
      const top = await fetchNativeVrTopScorers(input.allianceId, limit);
      const entries = mapPriorDayVsToScoreEntries(
        top.map((row) => ({
          memberId: row.memberId,
          memberName: row.memberName,
          priorDayVsScore: row.priorDayVsScore ?? 0,
        })),
      );
      return {
        kind: "vr_push",
        trainDate: input.trainDate,
        podium: entries.slice(0, 3),
        entries,
      };
    }
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
