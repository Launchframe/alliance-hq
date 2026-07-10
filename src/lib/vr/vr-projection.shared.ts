import {
  baseVrForInstituteLevel,
  coerceInstituteLevelFromBaseVr,
  instituteLevelForBaseVr,
  maxInstituteLevel,
} from "@/lib/vr/institute-levels.shared";

export const DEFAULT_PROJECTION_HORIZON_DAYS = 3;
export const PROJECTION_HORIZON_OPTIONS = [1, 3, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BETA = 1.2;
const DEFAULT_SAMPLE_COUNT = 32;

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

type LevelEvent = {
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
    .sort((a, b) => a.tMs - b.tMs);
}

export function fitPowerLawProjection(
  events: readonly VrProjectionEvent[],
  seasonKey: string,
): VrPowerLawProjectionFit | null {
  const normalized = normalizeEvents(events, seasonKey);
  const latest = normalized.at(-1);
  if (!latest) return null;

  const intervals: Array<{ midLevel: number; daysPerLevel: number }> = [];
  for (let i = 1; i < normalized.length; i++) {
    const previous = normalized[i - 1]!;
    const current = normalized[i]!;
    const deltaDays = (current.tMs - previous.tMs) / DAY_MS;
    const deltaLevel = current.level - previous.level;
    if (deltaDays > 0 && deltaLevel > 0) {
      intervals.push({
        midLevel: (previous.level + current.level) / 2,
        daysPerLevel: deltaDays / deltaLevel,
      });
    }
  }

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
  }

  const k =
    intervals.reduce(
      (sum, interval) =>
        sum + (1 / interval.daysPerLevel) * interval.midLevel ** beta,
      0,
    ) / intervals.length;

  if (!Number.isFinite(beta) || !Number.isFinite(k) || k <= 0) return null;

  return {
    beta,
    k,
    level0: latest.level,
    t0Ms: latest.tMs,
  };
}

function projectedLevelAt(fit: VrPowerLawProjectionFit, atMs: number): number {
  const deltaDays = Math.max(0, (atMs - fit.t0Ms) / DAY_MS);
  return (fit.level0 ** (fit.beta + 1) + (fit.beta + 1) * fit.k * deltaDays) **
    (1 / (fit.beta + 1));
}

function baseVrForProjectedLevel(seasonKey: string, level: number): number {
  const clamped = Math.min(
    maxInstituteLevel(seasonKey),
    Math.max(1, Math.floor(level)),
  );
  return baseVrForInstituteLevel(seasonKey, clamped)!;
}

export function projectVrSeries(input: {
  events: readonly VrProjectionEvent[];
  seasonKey: string;
  now: string | Date;
  horizonDays: number;
  sampleCount?: number;
}): Array<{ at: string; baseVr: number }> {
  const normalized = normalizeEvents(input.events, input.seasonKey);
  const latest = normalized.at(-1);
  if (!latest) return [];

  const nowMs = toTimeMs(input.now) ?? Date.now();
  const startMs = Math.max(latest.tMs, nowMs);
  const horizonMs = Math.max(0, input.horizonDays) * DAY_MS;
  const endMs = startMs + horizonMs;
  const sampleCount = Math.max(2, Math.floor(input.sampleCount ?? DEFAULT_SAMPLE_COUNT));
  const fit = fitPowerLawProjection(input.events, input.seasonKey);

  return Array.from({ length: sampleCount }, (_, index) => {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const atMs = startMs + (endMs - startMs) * ratio;
    const baseVr = fit
      ? baseVrForProjectedLevel(input.seasonKey, projectedLevelAt(fit, atMs))
      : latest.baseVr;
    return {
      at: new Date(atMs).toISOString(),
      baseVr,
    };
  });
}
