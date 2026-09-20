export const TRAIN_COUNTDOWN_SECONDS = 4 * 60 * 60;
export const TRAIN_BOARDING_CUTOFF_SECONDS = 5 * 60;
export const TRAIN_BOARDING_SECONDS = TRAIN_COUNTDOWN_SECONDS - TRAIN_BOARDING_CUTOFF_SECONDS;

export function parseBoardingCountdown(value: unknown): number {
  if (typeof value !== "string" || !/^\d{2}:[0-5]\d:[0-5]\d$/.test(value)) throw new Error("invalid_countdown");
  const [hours, minutes, seconds] = value.split(":").map(Number);
  const result = hours * 3600 + minutes * 60 + seconds;
  if (result > TRAIN_COUNTDOWN_SECONDS) throw new Error("invalid_countdown");
  return result;
}

export function boardingWindow(input: { lockedAt: string; observedAt: string; remainingSeconds: number | null }) {
  const lock = Date.parse(input.lockedAt), observed = Date.parse(input.observedAt), remaining = input.remainingSeconds;
  if (!Number.isFinite(lock) || !Number.isFinite(observed) || (remaining !== null && (!Number.isInteger(remaining) || remaining < 0 || remaining > TRAIN_COUNTDOWN_SECONDS))) throw new Error("invalid_countdown");
  const start = remaining === null ? lock : observed - (TRAIN_COUNTDOWN_SECONDS - remaining) * 1000;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + TRAIN_BOARDING_SECONDS * 1000).toISOString(), basis: remaining === null ? "estimated" as const : "countdown" as const };
}
