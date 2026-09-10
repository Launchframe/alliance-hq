import { addCalendarDays } from "@/lib/trains/game-time";

export type PlanSchedule = {
  kind: "weekly" | "once";
  zone: string;
  start: string;
  end: string;
  endsNextDay: boolean;
  date: string;
  days: number[];
  instant?: { startAt: string; endAt: string };
};
export type PlanOccurrence = { key: string; localDate: string; startAt: string; endAt: string };
export type ScheduleErrorCode = "invalidSchedule" | "invalidDuration" | "invalidZone" | "nonexistentTime" | "pastTime";
export class PlanScheduleError extends Error {
  constructor(readonly code: ScheduleErrorCode) { super(code); }
}

const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isPlanDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2200-12-31";
}

export function isPlanZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}

function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    if (!isPlanZone(zone)) throw new PlanScheduleError("invalidZone");
    value = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    if (formatters.size >= 64) formatters.clear();
    formatters.set(zone, value);
  }
  return value;
}

export function planClock(instant: number | Date | string, zone: string): { date: string; time: string } {
  const parts = formatter(zone).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === key)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function clockMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new PlanScheduleError("invalidSchedule");
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function resolvePlanClock(date: string, time: string, zone: string): string | null {
  if (!isPlanDate(date)) throw new PlanScheduleError("invalidSchedule");
  clockMinutes(time);
  const anchor = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = anchor + hours * 3_600_000;
    const local = planClock(sample, zone);
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - sample);
  }
  const matches = [...offsets].map((offset) => anchor - offset).filter((instant) => {
    const local = planClock(instant, zone);
    return local.date === date && local.time === time;
  }).sort((a, b) => a - b);
  return matches.length ? new Date(matches[0]).toISOString() : null;
}

export function parsePlanSchedule(value: unknown): PlanSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanScheduleError("invalidSchedule");
  const row = value as Record<string, unknown>;
  if ((row.kind !== "weekly" && row.kind !== "once") || !isPlanDate(row.date) || typeof row.start !== "string" || typeof row.end !== "string" || typeof row.endsNextDay !== "boolean") throw new PlanScheduleError("invalidSchedule");
  if (!isPlanZone(row.zone)) throw new PlanScheduleError("invalidZone");
  const duration = clockMinutes(row.end) - clockMinutes(row.start) + (row.endsNextDay ? 1440 : 0);
  if (duration <= 0 || duration > 1440) throw new PlanScheduleError("invalidDuration");
  const days = row.kind === "once" ? [] : row.days;
  if (!Array.isArray(days) || (row.kind === "weekly" && !days.length) || days.length > 7 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new PlanScheduleError("invalidSchedule");
  const schedule: PlanSchedule = { kind: row.kind, date: row.date, start: row.start, end: row.end, endsNextDay: row.endsNextDay, zone: row.zone, days: [...new Set(days)].sort() };
  if (schedule.kind === "once") {
    const occurrence = occurrenceOn(schedule, schedule.date);
    if (!occurrence) throw new PlanScheduleError("nonexistentTime");
    schedule.instant = { startAt: occurrence.startAt, endAt: occurrence.endAt };
  }
  return schedule;
}

export function occurrenceOn(schedule: PlanSchedule, date: string): PlanOccurrence | null {
  if (date < schedule.date || (schedule.kind === "once" ? date !== schedule.date : !schedule.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay()))) return null;
  const startAt = schedule.kind === "once" && schedule.instant ? schedule.instant.startAt : resolvePlanClock(date, schedule.start, schedule.zone);
  const endAt = schedule.kind === "once" && schedule.instant ? schedule.instant.endAt : resolvePlanClock(schedule.endsNextDay ? addCalendarDays(date, 1) : date, schedule.end, schedule.zone);
  if (!startAt || !endAt || startAt >= endAt) return null;
  return { key: date, localDate: date, startAt, endAt };
}

export function expandPlan(schedule: PlanSchedule, from: string, until: string): { occurrences: PlanOccurrence[]; skippedDates: string[] } {
  const start = Date.parse(from), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 56 * DAY) throw new PlanScheduleError("invalidSchedule");
  const first = addCalendarDays(planClock(start, schedule.zone).date, -1);
  const last = planClock(end - 1, schedule.zone).date;
  const occurrences: PlanOccurrence[] = [], skippedDates: string[] = [];
  for (let date = first; date <= last; date = addCalendarDays(date, 1)) {
    if (date < schedule.date || (schedule.kind === "once" ? date !== schedule.date : !schedule.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay()))) continue;
    const occurrence = occurrenceOn(schedule, date);
    if (!occurrence) { skippedDates.push(date); continue; }
    if (Date.parse(occurrence.startAt) < end && Date.parse(occurrence.endAt) > start) occurrences.push(occurrence);
  }
  return { occurrences, skippedDates };
}

export function assertFuturePlan(schedule: PlanSchedule, now = new Date()): void {
  const from = Math.max(now.getTime(), Date.parse(`${schedule.date}T00:00:00Z`) - 2 * DAY);
  const until = Math.min(from + 14 * DAY, Date.parse("2200-12-31T00:00:00Z"));
  if (until <= from || !expandPlan(schedule, new Date(from).toISOString(), new Date(until).toISOString()).occurrences.some((row) => Date.parse(row.startAt) > now.getTime())) throw new PlanScheduleError("pastTime");
}

export function occurrenceIsAway(occurrence: Pick<PlanOccurrence, "startAt" | "endAt">, absences: ReadonlyArray<{ startDate: string; endDate: string }>): boolean {
  const first = planClock(occurrence.startAt, "Etc/GMT+2").date;
  const last = planClock(Date.parse(occurrence.endAt) - 1, "Etc/GMT+2").date;
  return absences.some((absence) => absence.startDate <= last && absence.endDate >= first);
}
