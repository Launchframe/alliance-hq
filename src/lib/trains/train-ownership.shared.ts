import { formatServerCalendarDate } from "@/lib/trains/game-time";

export const TRAIN_OWNERSHIP_REQUIRED_CODE = "train_ownership_required";

function lockedAtServerDate(
  lockedAt: string | Date | null | undefined,
): string | null {
  if (lockedAt == null) return null;
  const instant = typeof lockedAt === "string" ? new Date(lockedAt) : lockedAt;
  if (Number.isNaN(instant.getTime())) return null;
  return formatServerCalendarDate(instant);
}

/**
 * Train-owner unlock window (UTC−2 / Server Time).
 *
 * - Current or future train day: open until midnight ST of that train day.
 * - Past train day locked after that day (history import / past-day lock):
 *   the owning officer may unlock at any time.
 * - Once midnight ST ticks on a current/future train day, the window closes.
 */
export function trainOwnerUnlockWindowOpen(input: {
  trainDate: string;
  today: string;
  lockedAt: string | Date | null | undefined;
}): boolean {
  if (!input.lockedAt) return false;
  if (input.trainDate >= input.today) return true;
  const lockedOn = lockedAtServerDate(input.lockedAt);
  if (!lockedOn) return false;
  return lockedOn > input.trainDate;
}

export function canUnlockLockedConductor(input: {
  unlimitedUnlock: boolean;
  actorHqUserId: string | null | undefined;
  lockedByHqUserId: string | null | undefined;
  trainDate: string;
  today: string;
  lockedAt: string | Date | null | undefined;
}): boolean {
  if (!input.lockedAt) return false;
  if (input.unlimitedUnlock) return true;
  if (
    !input.actorHqUserId ||
    !input.lockedByHqUserId ||
    input.actorHqUserId !== input.lockedByHqUserId
  ) {
    return false;
  }
  return trainOwnerUnlockWindowOpen({
    trainDate: input.trainDate,
    today: input.today,
    lockedAt: input.lockedAt,
  });
}
