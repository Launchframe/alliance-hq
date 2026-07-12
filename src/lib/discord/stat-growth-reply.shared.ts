/** Shared Discord growth-window formatting for THP / kills success replies. */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type GrowthWindow = {
  /** Whole hours elapsed (min 1 when ms > 0). */
  hours: number;
  /** Whole days elapsed (min 1 when ms >= 1 day). */
  days: number;
  /** Prefer hours under 48h, otherwise days. */
  preferHours: boolean;
};

export function computeGrowthWindow(
  previousAt: Date,
  now: Date = new Date(),
): GrowthWindow | null {
  const ms = now.getTime() - previousAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const hours = Math.max(1, Math.round(ms / HOUR_MS));
  const days = Math.max(1, Math.round(ms / DAY_MS));
  return {
    hours,
    days,
    preferHours: ms < 48 * HOUR_MS,
  };
}

export function formatGrowthWindowLabel(window: GrowthWindow): string {
  if (window.preferHours) {
    return window.hours === 1 ? "1 hour" : `${window.hours} hours`;
  }
  return window.days === 1 ? "1 day" : `${window.days} days`;
}

export function formatKillsPerHour(delta: number, hours: number): string {
  if (!(hours > 0) || !(delta > 0)) {
    return "0";
  }
  const kph = delta / hours;
  if (kph >= 100) {
    return Math.round(kph).toLocaleString();
  }
  if (kph >= 10) {
    return kph.toLocaleString(undefined, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });
  }
  return kph.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

export type StatGrowthContext = {
  commanderName: string;
  total: number;
  previousTotal: number | null;
  previousAt: Date | null;
  now?: Date;
};

export function resolveStatGrowth(input: StatGrowthContext): {
  delta: number | null;
  window: GrowthWindow | null;
  hoursForRate: number | null;
} {
  const previous =
    input.previousTotal != null && Number.isFinite(input.previousTotal)
      ? Math.round(input.previousTotal)
      : null;
  const total = Math.round(input.total);
  if (previous == null || total <= previous) {
    return { delta: null, window: null, hoursForRate: null };
  }
  const delta = total - previous;
  const window =
    input.previousAt != null
      ? computeGrowthWindow(input.previousAt, input.now ?? new Date())
      : null;
  return {
    delta,
    window,
    hoursForRate: window?.hours ?? null,
  };
}
