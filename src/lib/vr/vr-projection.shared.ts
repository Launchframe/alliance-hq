import {
  baseVrForInstituteLevel,
  coerceInstituteLevelFromBaseVr,
  instituteLevelForBaseVr,
  instituteVrByLevel,
  maxInstituteLevel,
} from "@/lib/vr/institute-levels.shared";

export const DEFAULT_PROJECTION_HORIZON_DAYS = 3;
export const PROJECTION_HORIZON_OPTIONS = [1, 3, 7] as const;

/** Ignore onboarding / learning-curve history older than this. */
export const PROJECTION_LOOKBACK_DAYS = 3;
/**
 * Window (relative to the latest event) within which single-level intervals
 * are damped to at most RECENT_MAX_LEVELS_PER_DAY.
 *
 * Intentionally equals PROJECTION_LOOKBACK_DAYS so the damping covers the
 * entire fitting window — all retained events are "recent" by design.
 */
const PROJECTION_RECENT_SMOOTHING_DAYS = 3;
/** Collapse rapid successive reports (wake-up double `/vr`, catch-up bumps). */
export const PROJECTION_BURST_WINDOW_MS = 45 * 60 * 1000;
/** Intervals shorter than this are treated as reporting bursts, not grind pace. */
export const PROJECTION_MIN_INTERVAL_DAYS = 2 / 24; // 2 hours
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BETA = 1.2;
const DEFAULT_SAMPLE_COUNT = 32;
/** Soft cap: even spenders rarely clear more than this many levels/day mid-season. */
const MAX_LEVELS_PER_DAY = 6;
/** Recent one-level catch-up reports are damped more aggressively than the hard cap. */
const RECENT_MAX_LEVELS_PER_DAY = 4;

export type VrProjectionEvent = {
  createdAt: string | Date;
  baseVr: number;
  instituteLevel?: number | null;
};

export type VrPowerLawProjectionFit = {
  beta: number;
  k: number;
  level0: number;
  t0Ms: number;
};

export type LevelEvent = {
  tMs: number;
  baseVr: number;
  level: number;
};

function toTimeMs(value: string | Date): number | null {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function levelForEvent(event: VrProjectionEvent, seasonKey: string): number {
  if (
    event.instituteLevel != null &&
    Number.isFinite(event.instituteLevel) &&
    event.instituteLevel >= 1
  ) {
    return Math.min(event.instituteLevel, maxInstituteLevel(seasonKey));
  }
  return (
    instituteLevelForBaseVr(seasonKey, event.baseVr) ??
    coerceInstituteLevelFromBaseVr(seasonKey, event.baseVr)
  );
}

function normalizeEvents(
  events: readonly VrProjectionEvent[],
  seasonKey: string,
): LevelEvent[] {
  return events
    .map((event) => {
      const tMs = toTimeMs(event.createdAt);
      if (tMs == null || !Number.isFinite(event.baseVr)) return null;
      return {
        tMs,
        baseVr: event.baseVr,
        level: levelForEvent(event, seasonKey),
      };
    })
    .filter((event): event is LevelEvent => event != null)
    .sort((a, b) => a.tMs - b.tMs || a.level - b.level);
}

/**
 * VR only goes up. Erroneous dips (e.g. 2750 → 100 → 3250) are dropped so the
 * series is a running max on institute level.
 */
export function enforceMonotonicLevels(events: readonly LevelEvent[]): LevelEvent[] {
  const out: LevelEvent[] = [];
  let maxLevel = 0;
  for (const event of events) {
    if (event.level < maxLevel) continue;
    maxLevel = event.level;
    out.push(event);
  }
  return out;
}

/**
 * Collapse rapid successive reports into one point at the burst's max level.
 * Timestamp = last report in the burst (when they finished catching up).
 */
export function collapseReportingBursts(
  events: readonly LevelEvent[],
  burstWindowMs = PROJECTION_BURST_WINDOW_MS,
): LevelEvent[] {
  if (events.length === 0) return [];
  const out: LevelEvent[] = [];
  let burst = [events[0]!];

  const flush = () => {
    const last = burst[burst.length - 1]!;
    const best = burst.reduce((a, b) => (b.level >= a.level ? b : a));
    out.push({
      tMs: last.tMs,
      level: best.level,
      baseVr: best.baseVr,
    });
    burst = [];
  };

  for (let i = 1; i < events.length; i++) {
    const event = events[i]!;
    const prev = burst[burst.length - 1]!;
    if (event.tMs - prev.tMs <= burstWindowMs) {
      burst.push(event);
    } else {
      flush();
      burst = [event];
    }
  }
  flush();
  return out;
}

/**
 * Prefer recent history for pace fitting. Always keep the latest point.
 * If the window leaves fewer than 2 points, expand backward until we have them.
 */
export function applyProjectionLookback(
  events: readonly LevelEvent[],
  nowMs: number,
  lookbackDays = PROJECTION_LOOKBACK_DAYS,
): LevelEvent[] {
  if (events.length <= 2) return [...events];
  const cutoff = nowMs - lookbackDays * DAY_MS;
  const recent = events.filter((event) => event.tMs >= cutoff);
  if (recent.length >= 2) return recent;

  const needed = 2;
  return events.slice(Math.max(0, events.length - needed));
}

/**
 * Clean event stream used for pace fitting + projection anchor.
 * Display charts should still show raw markers; only projection uses this.
 */
export function prepareEventsForProjection(
  events: readonly VrProjectionEvent[],
  seasonKey: string,
  now: string | Date = new Date(),
): LevelEvent[] {
  const nowMs = toTimeMs(now) ?? Date.now();
  const normalized = normalizeEvents(events, seasonKey);
  const monotonic = enforceMonotonicLevels(normalized);
  const collapsed = collapseReportingBursts(monotonic);
  return applyProjectionLookback(collapsed, nowMs);
}

function buildFitIntervals(events: readonly LevelEvent[]): Array<{
  midLevel: number;
  daysPerLevel: number;
}> {
  const intervals: Array<{ midLevel: number; daysPerLevel: number }> = [];
  const latestMs = events.at(-1)?.tMs ?? 0;
  const recentCutoffMs = latestMs - PROJECTION_RECENT_SMOOTHING_DAYS * DAY_MS;
  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1]!;
    const current = events[i]!;
    const deltaDays = (current.tMs - previous.tMs) / DAY_MS;
    const deltaLevel = current.level - previous.level;
    if (deltaDays < PROJECTION_MIN_INTERVAL_DAYS || deltaLevel <= 0) continue;
    const daysPerLevel = deltaDays / deltaLevel;
    // Reject absurdly fast pace that survived burst collapse (e.g. multi-day
    // catch-up attributed to a short window).
    if (1 / daysPerLevel > MAX_LEVELS_PER_DAY) continue;
    const smoothedDaysPerLevel =
      deltaLevel === 1 && current.tMs >= recentCutoffMs
        ? Math.max(daysPerLevel, 1 / RECENT_MAX_LEVELS_PER_DAY)
        : daysPerLevel;
    intervals.push({
      midLevel: (previous.level + current.level) / 2,
      daysPerLevel: smoothedDaysPerLevel,
    });
  }
  return intervals;
}

export function fitPowerLawProjection(
  events: readonly VrProjectionEvent[],
  seasonKey: string,
  now: string | Date = new Date(),
): VrPowerLawProjectionFit | null {
  const prepared = prepareEventsForProjection(events, seasonKey, now);
  const latest = prepared.at(-1);
  if (!latest) return null;

  const intervals = buildFitIntervals(prepared);
  if (intervals.length === 0) return null;

  let beta = DEFAULT_BETA;
  if (intervals.length >= 2) {
    const points = intervals.map((interval) => ({
      x: Math.log(interval.midLevel),
      y: Math.log(interval.daysPerLevel),
    }));
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const variance = points.reduce(
      (sum, point) => sum + (point.x - meanX) ** 2,
      0,
    );
    if (variance > 0) {
      beta =
        points.reduce(
          (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
          0,
        ) / variance;
    }
    // Keep beta in a sane band; negative β would accelerate forever.
    if (!Number.isFinite(beta) || beta < 0.2) beta = DEFAULT_BETA;
    if (beta > 3) beta = 3;
  }

  const k =
    intervals.reduce(
      (sum, interval) =>
        sum + (1 / interval.daysPerLevel) * interval.midLevel ** beta,
      0,
    ) / intervals.length;

  if (!Number.isFinite(beta) || !Number.isFinite(k) || k <= 0) return null;

  const nowMs = toTimeMs(now) ?? Date.now();
  return {
    beta,
    k,
    // Anchor at "now" with current level so a reporting gap does not invent
    // progress between the last event and the cutoff line.
    level0: latest.level,
    t0Ms: Math.max(latest.tMs, nowMs),
  };
}

function projectedLevelAt(fit: VrPowerLawProjectionFit, atMs: number): number {
  const deltaDays = Math.max(0, (atMs - fit.t0Ms) / DAY_MS);
  const raw =
    (fit.level0 ** (fit.beta + 1) + (fit.beta + 1) * fit.k * deltaDays) **
    (1 / (fit.beta + 1));
  // Cap instantaneous pace relative to level0.
  const capped = Math.min(raw, fit.level0 + MAX_LEVELS_PER_DAY * deltaDays);
  return capped;
}

function baseVrForProjectedLevel(seasonKey: string, level: number): number {
  const table = instituteVrByLevel(seasonKey);
  const clamped = Math.min(table.length, Math.max(1, level));
  const lowerLevel = Math.floor(clamped);
  const upperLevel = Math.ceil(clamped);
  const lowerVr = baseVrForInstituteLevel(seasonKey, lowerLevel)!;
  const upperVr = baseVrForInstituteLevel(seasonKey, upperLevel)!;
  if (lowerLevel === upperLevel) return lowerVr;

  const ratio = clamped - lowerLevel;
  return Math.round(lowerVr + (upperVr - lowerVr) * ratio);
}

export function projectVrSeries(input: {
  events: readonly VrProjectionEvent[];
  seasonKey: string;
  now: string | Date;
  horizonDays: number;
  sampleCount?: number;
}): Array<{ at: string; baseVr: number }> {
  const prepared = prepareEventsForProjection(
    input.events,
    input.seasonKey,
    input.now,
  );
  const latest = prepared.at(-1);
  if (!latest) return [];

  const nowMs = toTimeMs(input.now) ?? Date.now();
  const startMs = Math.max(latest.tMs, nowMs);
  const horizonMs = Math.max(0, input.horizonDays) * DAY_MS;
  const endMs = startMs + horizonMs;
  const sampleCount = Math.max(
    2,
    Math.floor(input.sampleCount ?? DEFAULT_SAMPLE_COUNT),
  );
  const fit = fitPowerLawProjection(input.events, input.seasonKey, input.now);

  return Array.from({ length: sampleCount }, (_, index) => {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const atMs = startMs + (endMs - startMs) * ratio;
    const baseVr = fit
      ? baseVrForProjectedLevel(input.seasonKey, projectedLevelAt(fit, atMs))
      : latest.baseVr;
    return {
      at: new Date(atMs).toISOString(),
      // Never project below the known current VR.
      baseVr: Math.max(baseVr, latest.baseVr),
    };
  });
}
