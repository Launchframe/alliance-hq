import type { EurWeeklySlot } from "@/lib/eur/schedule-engine";

export type EurScheduleKind = "weekly" | "interval_after_last";

export type EurSchedulePayload = {
  scoreTarget?: string | null;
  customLabel?: string | null;
  scheduleKind: EurScheduleKind;
  weeklySlots?: EurWeeklySlot[] | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
  reminderDelayMinutes?: number;
  active?: boolean;
};

export function serializeEurScheduleRule(row: {
  id: string;
  allianceId: string;
  scoreTarget: string | null;
  customLabel: string | null;
  scheduleKind: string;
  weeklySlots: unknown;
  intervalDays: number | null;
  anchorTimeSt: string | null;
  reminderDelayMinutes: number;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    allianceId: row.allianceId,
    scoreTarget: row.scoreTarget,
    customLabel: row.customLabel,
    scheduleKind: row.scheduleKind,
    weeklySlots: (row.weeklySlots as EurWeeklySlot[] | null) ?? null,
    intervalDays: row.intervalDays,
    anchorTimeSt: row.anchorTimeSt,
    reminderDelayMinutes: row.reminderDelayMinutes,
    active: row.active === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function validateEurSchedulePayload(
  body: EurSchedulePayload,
): string | null {
  if (!body.scheduleKind) return "scheduleKind is required.";
  if (body.scheduleKind !== "weekly" && body.scheduleKind !== "interval_after_last") {
    return "Invalid scheduleKind.";
  }
  if (!body.scoreTarget && !body.customLabel?.trim()) {
    return "scoreTarget or customLabel is required.";
  }
  if (body.scheduleKind === "weekly") {
    if (!Array.isArray(body.weeklySlots) || body.weeklySlots.length === 0) {
      return "weeklySlots is required for weekly schedules.";
    }
    for (const slot of body.weeklySlots) {
      if (typeof slot.dow !== "number" || slot.dow < 0 || slot.dow > 6) {
        return "Invalid weekly slot day of week.";
      }
      if (!/^\d{1,2}:\d{2}$/.test(slot.timeSt)) {
        return "Invalid weekly slot time.";
      }
    }
  }
  if (body.scheduleKind === "interval_after_last") {
    if (!body.intervalDays || body.intervalDays < 1) {
      return "intervalDays must be at least 1.";
    }
    if (!body.anchorTimeSt || !/^\d{1,2}:\d{2}$/.test(body.anchorTimeSt)) {
      return "anchorTimeSt is required for interval schedules.";
    }
  }
  if (
    body.reminderDelayMinutes != null &&
    (body.reminderDelayMinutes < 0 || body.reminderDelayMinutes > 24 * 60)
  ) {
    return "reminderDelayMinutes out of range.";
  }
  return null;
}
