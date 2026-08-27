import "server-only";

import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import {
  buildVsDataStatus,
  classifyVsDataNeed,
  type TrainsVsDataStatus,
} from "@/lib/trains/vs-data-status.shared";
import { resolveScoreDateDayConfigForTrainDate } from "@/lib/trains/train-day-context.server";
import { scoreDateForTrainDay } from "@/lib/trains/train-day-context.shared";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";

/** Cap for VR readiness probe — enough to show a useful score count. */
const VR_STATUS_LIMIT = 50;

export type { TrainsVsDataStatus };

/**
 * Non-blocking VS / Price Is Freight score readiness for the guided flow.
 * Fetches when today's mechanism/paint needs scores, including Economy Week
 * optional probes (`required: false`).
 */
export async function loadTrainsVsDataStatus(input: {
  allianceId: string;
  trainDate: string;
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  leadDays?: number;
  seasonKey?: string;
}): Promise<TrainsVsDataStatus> {
  const leadDays = input.leadDays ?? 0;
  const scoreDateDay =
    input.seasonKey != null
      ? await resolveScoreDateDayConfigForTrainDate({
          allianceId: input.allianceId,
          trainDate: input.trainDate,
          leadDays,
          seasonKey: input.seasonKey,
        })
      : null;
  const need = classifyVsDataNeed({
    conductorMechanism: input.conductorMechanism,
    paintTemplate: input.paintTemplate,
    trainDate: input.trainDate,
    leadDays,
    scoreDateDay,
  });

  if (need.kind === "none") {
    return buildVsDataStatus({
      kind: "none",
      required: false,
      scoreCount: 0,
    });
  }

  if (need.kind === "vr") {
    try {
      const scorers = await fetchNativeVrTopScorers(
        input.allianceId,
        VR_STATUS_LIMIT,
      );
      return buildVsDataStatus({
        kind: "vr",
        required: true,
        scoreCount: scorers.length,
      });
    } catch {
      return buildVsDataStatus({
        kind: "vr",
        required: true,
        scoreCount: 0,
      });
    }
  }

  const scoreDate = scoreDateForTrainDay(input.trainDate, leadDays);
  try {
    const scores = await fetchAlliancePriorDayVsScoresByMember(
      input.allianceId,
      scoreDate,
    );
    return buildVsDataStatus({
      kind: "prior_day_vs",
      required: need.required,
      scoreCount: scores.size,
      scoreDate,
    });
  } catch {
    return buildVsDataStatus({
      kind: "prior_day_vs",
      required: need.required,
      scoreCount: 0,
      scoreDate,
    });
  }
}
