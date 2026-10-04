import "server-only";

import { addCalendarDays } from "@/lib/trains/game-time";
import { loadTimeOffAvailability } from "@/lib/time-off/availability.server";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { loadVsWeekEvidence } from "@/lib/vs-scores/load-week.server";
import { VsComplianceError, type VsComplianceWeek } from "./types.shared";

export async function loadVsComplianceWeekEvidence(allianceId: string, weekEnding: string): Promise<Map<string, VsComplianceWeek>> {
  if (!validateVsPeriod(weekEnding, "weekly")) throw new VsComplianceError("invalid_week");
  const [scores, days] = await Promise.all([
    loadVsWeekEvidence(allianceId, weekEnding),
    Promise.all(Array.from({ length: 6 }, (_, index) => loadTimeOffAvailability(allianceId, addCalendarDays(weekEnding, index - 6), "vs"))),
  ]);
  return new Map([...scores.members].map(([memberId, evidence]) => [memberId, {
    weekEnding, evidence,
    excused: days.some((day) => day.excusedMemberIds.has(memberId)),
    pendingExcusal: days.some((day) => day.pendingMemberIds.has(memberId)),
    waived: false,
  }]));
}
