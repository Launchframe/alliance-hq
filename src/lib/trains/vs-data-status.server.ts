import "server-only";

import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import {
  buildVsDataStatus,
  classifyVsDataNeed,
  type TrainsVsDataStatus,
} from "@/lib/trains/vs-data-status.shared";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

/** Cap for VR readiness probe — enough to show a useful score count. */
const VR_STATUS_LIMIT = 50;

export type { TrainsVsDataStatus };

/**
 * Non-blocking VS / Price Is Freight score readiness for the guided flow.
 * Only fetches when today's mechanism/paint requires scores.
 */
export async function loadTrainsVsDataStatus(input: {
  allianceId: string;
  trainDate: string;
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
}): Promise<TrainsVsDataStatus> {
  const need = classifyVsDataNeed({
    conductorMechanism: input.conductorMechanism,
    paintTemplate: input.paintTemplate,
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

  const scoreDate = vsScoreReferenceDate(input.trainDate);
  try {
    const scores = await fetchAlliancePriorDayVsScoresByMember(
      input.allianceId,
      scoreDate,
    );
    return buildVsDataStatus({
      kind: "prior_day_vs",
      required: true,
      scoreCount: scores.size,
      scoreDate,
    });
  } catch {
    return buildVsDataStatus({
      kind: "prior_day_vs",
      required: true,
      scoreCount: 0,
      scoreDate,
    });
  }
}
