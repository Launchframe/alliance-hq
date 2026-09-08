import "server-only";

import {
  listRegularEventScheduleRules,
  upsertRegularEventScheduleRule,
} from "@/lib/regular-events/repository.server";
import { defaultRulesForAlliance } from "@/lib/regular-events/schedule.shared";
import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";
import { zombieSiegeWeeklySlots } from "@/lib/regular-events/schedule.shared";

/**
 * Seed catalog defaults for any missing event_key when announcements are enabled.
 * Does not overwrite officer-customized rules that already exist.
 */
export async function ensureDefaultRegularEventRules(input: {
  allianceId: string;
  canyonStormActive: boolean;
}): Promise<{ created: number }> {
  const existing = await listRegularEventScheduleRules(input.allianceId);
  const have = new Set(existing.map((row) => row.eventKey));
  const defaults = defaultRulesForAlliance(input.canyonStormActive);
  let created = 0;

  for (const rule of defaults) {
    if (have.has(rule.eventKey)) continue;
    await upsertRegularEventScheduleRule({
      allianceId: input.allianceId,
      eventKey: rule.eventKey,
      scheduleKind: rule.scheduleKind,
      weeklySlots: rule.weeklySlots,
      oneShotDates: rule.oneShotDates,
      biweeklyPhaseMonday: rule.biweeklyPhaseMonday,
      intervalDays: rule.intervalDays,
      anchorTimeSt: rule.anchorTimeSt,
      announceLeadMinutes: rule.announceLeadMinutes,
      active: rule.active,
    });
    created += 1;
  }

  return { created };
}

/**
 * When Canyon Storm toggles, refresh Zombie Siege weekly slot times if the rule
 * is still the default weekly Mon+Thu shape (do not clobber custom DOWs).
 */
export async function refreshZombieSiegeTimesForCanyon(input: {
  allianceId: string;
  canyonStormActive: boolean;
}): Promise<boolean> {
  const rules = await listRegularEventScheduleRules(input.allianceId);
  const zombie = rules.find((row) => row.eventKey === "zombie_siege");
  if (!zombie || zombie.scheduleKind !== "weekly") return false;

  const slots = (zombie.weeklySlots ?? []) as Array<{
    dow: number;
    timeSt: string;
  }>;
  const dows = slots.map((s) => s.dow).sort((a, b) => a - b);
  const isDefaultDows =
    dows.length === 2 && dows[0] === 1 && dows[1] === 4;
  if (!isDefaultDows && slots.length > 0) {
    // Still update times on existing slots for canyon offset.
    const nextSlots = slots.map((s) => ({
      dow: s.dow,
      timeSt: zombieSiegeWeeklySlots(input.canyonStormActive)[0]!.timeSt,
    }));
    await upsertRegularEventScheduleRule({
      allianceId: input.allianceId,
      eventKey: "zombie_siege" as RegularEventKey,
      scheduleKind: "weekly",
      weeklySlots: nextSlots,
      announceLeadMinutes: zombie.announceLeadMinutes,
      active: zombie.active === 1,
    });
    return true;
  }

  await upsertRegularEventScheduleRule({
    allianceId: input.allianceId,
    eventKey: "zombie_siege",
    scheduleKind: "weekly",
    weeklySlots: zombieSiegeWeeklySlots(input.canyonStormActive),
    announceLeadMinutes: zombie.announceLeadMinutes,
    active: zombie.active === 1,
  });
  return true;
}
