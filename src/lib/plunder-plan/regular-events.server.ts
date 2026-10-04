import "server-only";

import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { expandRuleMarkersForRange } from "@/lib/regular-events/calendar-markers.shared";
import { isRegularEventKey, regularEventLabel } from "@/lib/regular-events/catalog.shared";
import type { RegularEventWeeklySlot } from "@/lib/regular-events/types.shared";
import { planClock, resolvePlanClock } from "./schedule.shared";
import type { PlanTx } from "./access.server";

export async function readPlanRegularEvents(tx: PlanTx, allianceId: string, from: string, until: string) {
  const rules = await tx.select().from(schema.regularEventScheduleRules).where(eq(schema.regularEventScheduleRules.allianceId, allianceId));
  const markers = expandRuleMarkersForRange(rules.filter((row) => isRegularEventKey(row.eventKey)).map((row) => ({ ...row, active: row.active === 1, eventLabel: regularEventLabel(row.eventKey), weeklySlots: row.weeklySlots as RegularEventWeeklySlot[] | null, oneShotDates: row.oneShotDates as string[] | null })), planClock(from, "Etc/GMT+2").date, planClock(until, "Etc/GMT+2").date);
  return markers.flatMap((marker) => {
    const startAt = resolvePlanClock(marker.date, marker.timeSt, "Etc/GMT+2");
    return startAt && Date.parse(startAt) >= Date.parse(from) && Date.parse(startAt) < Date.parse(until) ? [{ id: `regular:${marker.eventKey}:${startAt}`, eventKey: marker.eventKey, label: marker.eventLabel, startAt }] : [];
  });
}
