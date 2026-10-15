import "server-only";

import { and, eq, gte, isNotNull, lte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { loadAllianceTrainLeadTimeSettings } from "@/lib/trains/alliance-train-lead-time.server";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { pickScoreUploadSpinDate } from "@/lib/trains/score-upload-spin-prompt.shared";
import { resolveMergedDayConfigsForDateRange } from "@/lib/trains/train-day-context.server";

/**
 * After daily VS scores are saved, the train day an officer should spin a
 * conductor for next — or null when nothing is waiting on these scores.
 * Alliances with conductor confirmation enabled auto-nominate instead.
 */
export async function resolveScoreUploadSpinDate(input: {
  sessionId: string;
  allianceId: string;
  vsRecordedDate: string;
}): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.vsRecordedDate)) return null;
  const canManage = await sessionHasPermissionForAlliance(
    input.sessionId,
    input.allianceId,
    "trains:write",
  );
  if (!canManage) return null;

  const settings = await loadAllianceTrainLeadTimeSettings(
    input.allianceId,
    canManage,
  );
  if (settings.trainConductorConfirmationEnabled) return null;

  const leadDays = settings.trainConductorLeadTimeDays;
  const today = getServerCalendarDate();
  const firstCandidate = addCalendarDays(input.vsRecordedDate, 1);
  const start = firstCandidate > today ? firstCandidate : today;
  const end = addCalendarDays(input.vsRecordedDate, 2 + leadDays);
  if (end < start) return null;

  const { seasonKey } = await getEffectiveSeasonForAlliance(input.allianceId);
  const merged = await resolveMergedDayConfigsForDateRange({
    allianceId: input.allianceId,
    startDate: start,
    endDate: end,
    seasonKey,
  });

  const db = getDb();
  const assigned = await db
    .select({ date: schema.trainConductorRecords.date })
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
        gte(schema.trainConductorRecords.date, start),
        lte(schema.trainConductorRecords.date, end),
        isNotNull(schema.trainConductorRecords.conductorMemberId),
      ),
    );

  return pickScoreUploadSpinDate({
    vsRecordedDate: input.vsRecordedDate,
    today,
    leadDays,
    days: [...merged.values()].filter(
      (day) => day.date >= start && day.date <= end,
    ),
    assignedDates: new Set(assigned.map((row) => row.date)),
  });
}
