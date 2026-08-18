import { isCalendarDateOnOrAfter } from "@/lib/trains/game-time";

/** Template paint and week-template bulk apply — officers only on today and future. */
export function canOfficerChangeTemplateForDate(
  date: string,
  today: string,
): boolean {
  return isCalendarDateOnOrAfter(date, today);
}

/**
 * Calendar date for Simple Mode day-mechanism Change (`DayMechanismPickerDialog`).
 * Must be the dashboard-selected day — never coerce to `today`. Painting `today`
 * while an officer is editing a future day clears today's unlocked conductor/VIP
 * when draw identity changes and leaves the selected day unchanged.
 */
export function dayMechanismPickerTargetDate(selectedDate: string): string {
  return selectedDate;
}

/** Spin wheel, roll, pick top scorer — live ritual only. */
export function canRollForDate(date: string, today: string): boolean {
  return isCalendarDateOnOrAfter(date, today);
}

/** Manual conductor/VIP pick — allowed on past when day is unlocked. */
export function canManualPickForDate(): boolean {
  return true;
}

/** Unlocked draft with a conductor — officers may clear it (releases the pool slot). */
export function canClearPendingConductor(record: {
  conductorMemberId?: string | null;
  lockedAt?: string | Date | null;
} | null | undefined): boolean {
  return Boolean(record?.conductorMemberId && record.lockedAt == null);
}
