import { isCalendarDateOnOrAfter } from "@/lib/trains/game-time";

/** Template paint and week-template bulk apply — officers only on today and future. */
export function canOfficerChangeTemplateForDate(
  date: string,
  today: string,
): boolean {
  return isCalendarDateOnOrAfter(date, today);
}

/** Spin wheel, roll, pick top scorer — live ritual only. */
export function canRollForDate(date: string, today: string): boolean {
  return isCalendarDateOnOrAfter(date, today);
}

/** Manual conductor/VIP pick — allowed on past when day is unlocked. */
export function canManualPickForDate(): boolean {
  return true;
}
