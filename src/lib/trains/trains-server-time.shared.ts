import {
  addCalendarDays,
  formatServerCalendarDate,
  isCalendarDateOnOrAfter,
} from "@/lib/trains/game-time";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

export type TrainNextDepartureState =
  | "awaiting_selection"
  | "on_platform"
  | "reset";

export type TrainNextDeparture = {
  state: TrainNextDepartureState;
  /** Server calendar date when reset applies (YYYY-MM-DD). */
  resetDate?: string;
};

const MS_PER_HOUR = 60 * 60 * 1000;
const LOCK_RESET_HOURS = 4;

/** Next departure board line for the selected train day. */
export function resolveTrainNextDeparture(input: {
  selectedDate: string;
  today: string;
  lockedAtIso: string | null | undefined;
  now?: Date;
}): TrainNextDeparture {
  if (!input.lockedAtIso) {
    return { state: "awaiting_selection" };
  }

  const lockedAt = new Date(input.lockedAtIso);
  if (Number.isNaN(lockedAt.getTime())) {
    return { state: "awaiting_selection" };
  }

  const now = input.now ?? new Date();
  const elapsedMs = now.getTime() - lockedAt.getTime();

  if (elapsedMs < LOCK_RESET_HOURS * MS_PER_HOUR) {
    return { state: "on_platform" };
  }

  const resetDate = isCalendarDateOnOrAfter(input.selectedDate, input.today)
    ? addCalendarDays(input.selectedDate, 1)
    : addCalendarDays(input.today, 1);

  return { state: "reset", resetDate };
}

export function formatServerClockTime(now = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SERVER_TIME_IANA,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);
}

export function formatServerClockDate(now = new Date()): string {
  return formatServerCalendarDate(now);
}
