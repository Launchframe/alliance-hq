import type { AllianceSafeTimeSlot } from "@/lib/alliance/alliance-safe-time.shared";
import { allianceSafeTimeSlotStartHour } from "@/lib/alliance/alliance-safe-time.shared";
import {
  addCalendarDays,
  getServerCalendarDate,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";

/** Wednesday and Saturday are protection reset days (server calendar). */
const RESET_DAYS = new Set([3, 6]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function serverInstantFromCalendarParts(
  dateStr: string,
  hour: number,
): Date {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${dateStr}T${hh}:00:00.000-02:00`);
}

function isResetDay(dateStr: string): boolean {
  return RESET_DAYS.has(getServerDayOfWeek(dateStr));
}

/**
 * Next Wed/Sat safe-window start strictly after `after`.
 */
export function nextProtectionResetAt(
  after: Date,
  safeTimeSlot: AllianceSafeTimeSlot,
): Date {
  const hour = allianceSafeTimeSlotStartHour(safeTimeSlot);
  let cursor = getServerCalendarDate(after);

  for (let i = 0; i < 14; i += 1) {
    if (isResetDay(cursor)) {
      const candidate = serverInstantFromCalendarParts(cursor, hour);
      if (candidate.getTime() > after.getTime()) {
        return candidate;
      }
    }
    cursor = addCalendarDays(cursor, 1);
  }

  throw new Error("nextProtectionResetAt: no reset day found within 14 days");
}

export function computeProtectionExpiresAt(
  capturedAt: Date,
  safeTimeSlot: AllianceSafeTimeSlot,
): Date {
  return nextProtectionResetAt(capturedAt, safeTimeSlot);
}

export function resolveProtectionExpiresAt(params: {
  explicit: string | null | undefined;
  capturedAt: Date | null;
  safeTimeSlot: AllianceSafeTimeSlot | null;
}): Date | null {
  if (params.explicit) {
    return new Date(params.explicit);
  }
  if (!params.capturedAt || !params.safeTimeSlot) {
    return null;
  }
  return computeProtectionExpiresAt(params.capturedAt, params.safeTimeSlot);
}

/** Days between two instants (fractional). */
export function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}
