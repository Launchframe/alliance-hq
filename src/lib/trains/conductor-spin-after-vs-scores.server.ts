import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { TRAINS_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { sessionHasPermission } from "@/lib/rbac/context";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { getConductorRecord } from "@/lib/trains/repository";
import { resolveTrainDayContext } from "@/lib/trains/train-day-context.server";
import {
  shouldOfferConductorSpinAfterVsScores,
  type ConductorSpinAfterVsOffer,
} from "@/lib/trains/conductor-spin-after-vs-scores.shared";
import { buildTrainsAutoSpinReturnPath } from "@/lib/trains/guided-video-upload.shared";

export async function resolveConductorSpinOfferAfterVsUpload(input: {
  sessionId: string;
  allianceId: string;
  vsRecordedDate: string;
  vsPeriod?: "daily" | "weekly" | null;
}): Promise<ConductorSpinAfterVsOffer | null> {
  if (input.vsPeriod === "weekly") return null;

  const canManage = await sessionHasPermission(
    input.sessionId,
    TRAINS_WRITE_PERMISSION,
  );
  if (!canManage) return null;

  const today = getServerCalendarDate();
  const { seasonKey } = await getEffectiveSeasonForAlliance(input.allianceId);
  const ctx = await resolveTrainDayContext({
    allianceId: input.allianceId,
    trainDate: today,
    seasonKey,
  });
  const record = await getConductorRecord(
    input.allianceId,
    today,
    seasonKey,
  );

  if (
    !shouldOfferConductorSpinAfterVsScores({
      vsPeriod: input.vsPeriod ?? "daily",
      vsRecordedDate: input.vsRecordedDate,
      todayTrainDate: today,
      leadDays: ctx.leadDays,
      conductorMemberId: record?.conductorMemberId,
      locked: Boolean(record?.lockedAt),
      conductorMechanism: ctx.dayConfig.conductorMechanism,
      paintTemplate: ctx.dayConfig.paintTemplate ?? null,
      conductorConfig: ctx.dayConfig.conductorConfig,
      scoreDateDay: ctx.scoreDateDay,
    })
  ) {
    return null;
  }

  return {
    trainDate: today,
    href: buildTrainsAutoSpinReturnPath(today),
  };
}
