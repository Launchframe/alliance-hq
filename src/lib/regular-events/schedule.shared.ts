import {
  DEFAULT_ANNOUNCE_LEAD_MINUTES,
  DEFAULT_EVENT_ANCHOR_TIME_ST,
  MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS,
  WEDNESDAY_DOW,
  ZOMBIE_SIEGE_CANYON_TIME_ST,
  ZOMBIE_SIEGE_DEFAULT_DOWS,
  type RegularEventKey,
} from "@/lib/regular-events/catalog.shared";
import type {
  RegularEventScheduleRuleInput,
  RegularEventWeeklySlot,
} from "@/lib/regular-events/types.shared";

/** Zombie Siege start time: 23:30 ST while Canyon Storm is active, else 23:00. */
export function zombieSiegeTimeSt(canyonStormActive: boolean): string {
  return canyonStormActive
    ? ZOMBIE_SIEGE_CANYON_TIME_ST
    : DEFAULT_EVENT_ANCHOR_TIME_ST;
}

export function zombieSiegeWeeklySlots(
  canyonStormActive: boolean,
): RegularEventWeeklySlot[] {
  const timeSt = zombieSiegeTimeSt(canyonStormActive);
  return ZOMBIE_SIEGE_DEFAULT_DOWS.map((dow) => ({ dow, timeSt }));
}

export function wednesdayEventSlots(
  timeSt: string = DEFAULT_EVENT_ANCHOR_TIME_ST,
): RegularEventWeeklySlot[] {
  return [{ dow: WEDNESDAY_DOW, timeSt }];
}

export function announceAtFromStart(
  scheduledStartAt: Date,
  announceLeadMinutes: number = DEFAULT_ANNOUNCE_LEAD_MINUTES,
): Date {
  return new Date(
    scheduledStartAt.getTime() - announceLeadMinutes * 60 * 1000,
  );
}

export function defaultRulesForAlliance(
  canyonStormActive: boolean,
): RegularEventScheduleRuleInput[] {
  return [
    {
      eventKey: "zombie_siege",
      scheduleKind: "weekly",
      weeklySlots: zombieSiegeWeeklySlots(canyonStormActive),
      announceLeadMinutes: DEFAULT_ANNOUNCE_LEAD_MINUTES,
      active: true,
    },
    {
      eventKey: "sky_marshall",
      scheduleKind: "weekly",
      weeklySlots: wednesdayEventSlots(),
      announceLeadMinutes: DEFAULT_ANNOUNCE_LEAD_MINUTES,
      active: true,
    },
    {
      eventKey: "glacierdon",
      scheduleKind: "weekly",
      weeklySlots: wednesdayEventSlots(),
      announceLeadMinutes: DEFAULT_ANNOUNCE_LEAD_MINUTES,
      active: true,
    },
    {
      eventKey: "marshal_guard",
      scheduleKind: "interval_after_last",
      intervalDays: MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS,
      anchorTimeSt: DEFAULT_EVENT_ANCHOR_TIME_ST,
      weeklySlots: null,
      announceLeadMinutes: DEFAULT_ANNOUNCE_LEAD_MINUTES,
      active: true,
    },
  ];
}

export function isCanyonStormActiveFlag(value: number | boolean | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  return value === 1;
}

export function formatServerTimeLabel(timeSt: string): string {
  return timeSt;
}

export function eventKeysNeedingZombieTimeRefresh(): RegularEventKey[] {
  return ["zombie_siege"];
}

export function parseWeeklySlots(
  value: unknown,
): RegularEventWeeklySlot[] | null {
  if (!Array.isArray(value)) return null;
  const slots: RegularEventWeeklySlot[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return null;
    const dow = (row as { dow?: unknown }).dow;
    const timeSt = (row as { timeSt?: unknown }).timeSt;
    if (typeof dow !== "number" || dow < 0 || dow > 6) return null;
    if (typeof timeSt !== "string" || !/^\d{1,2}:\d{2}$/.test(timeSt)) {
      return null;
    }
    const [hRaw, mRaw] = timeSt.split(":");
    const hours = Number.parseInt(hRaw ?? "", 10);
    const minutes = Number.parseInt(mRaw ?? "", 10);
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    slots.push({ dow, timeSt });
  }
  return slots;
}
