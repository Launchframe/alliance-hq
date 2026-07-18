import type {
  BankWithSlips,
  DepositStatus,
  FalloffPoint,
  ProjectionVsActualSummary,
  RecommendedDropMetrics,
  RiskHeatmapCell,
  SerializedDepositSlip,
} from "@/lib/banks/types.shared";
import {
  DEFAULT_FALLOFF_HORIZON_HOURS,
  DEFAULT_FALLOFF_STEP_HOURS,
  DEPOSIT_STATUSES,
  DEPOSIT_TERMS,
  type DepositTermDays,
} from "@/lib/banks/types.shared";

const MS_PER_HOUR = 60 * 60 * 1000;
const DEFAULT_HEATMAP_HOURS = 72;

export function isActiveLockedDeposit(
  slip: SerializedDepositSlip,
  now: Date = new Date(),
): boolean {
  return (
    slip.status === "locked" && new Date(slip.maturesAt).getTime() > now.getTime()
  );
}

export const DEPOSIT_DISPLAY_STATUSES = [...DEPOSIT_STATUSES, "term_elapsed"] as const;
export type DepositDisplayStatus = (typeof DEPOSIT_DISPLAY_STATUSES)[number];

export function depositSlipDisplayStatus(
  slip: Pick<SerializedDepositSlip, "status" | "maturesAt">,
  now?: Date,
): DepositDisplayStatus {
  if (slip.status === "locked" && new Date(slip.maturesAt).getTime() <= (now ?? new Date()).getTime()) {
    return "term_elapsed";
  }
  return slip.status;
}

export type DepositStats = {
  totalDeposited: number;
  totalRecovered: number;
  totalLooted: number;
  interestEarned: number | null;
};

export function computeDepositStats(slips: readonly SerializedDepositSlip[]): DepositStats {
  let totalDeposited = 0;
  let totalRecovered = 0;
  let totalLooted = 0;
  let interestEarned: number | null = null;

  for (const slip of slips) {
    totalDeposited += slip.amount;
    if (slip.status === "matured") {
      totalRecovered += slip.outcomeAmount ?? slip.amount;
      if (slip.outcomeAmount != null) {
        const interest = slip.outcomeAmount - slip.amount;
        interestEarned = (interestEarned ?? 0) + interest;
      }
    } else if (slip.status === "looted") {
      totalLooted +=
        slip.outcomeAmount != null ? slip.amount - slip.outcomeAmount : slip.amount;
    }
  }

  return {
    totalDeposited,
    totalRecovered,
    totalLooted,
    interestEarned,
  };
}

export function activeDeposits(
  slips: readonly SerializedDepositSlip[],
  now: Date = new Date(),
): SerializedDepositSlip[] {
  return slips.filter((slip) => isActiveLockedDeposit(slip, now));
}

/** Deposits still locked after `hourTs` would be lost if the bank is dropped then. */
export function depositsAtRiskAtHour(
  slips: readonly SerializedDepositSlip[],
  hourTs: Date,
  now: Date = new Date(),
): SerializedDepositSlip[] {
  const hourMs = hourTs.getTime();
  return activeDeposits(slips, now).filter(
    (slip) => new Date(slip.maturesAt).getTime() > hourMs,
  );
}

export function countAtRiskAtHour(
  slips: readonly SerializedDepositSlip[],
  hourTs: Date,
  now: Date = new Date(),
): number {
  return depositsAtRiskAtHour(slips, hourTs, now).length;
}

export function valueAtRiskAtHour(
  slips: readonly SerializedDepositSlip[],
  hourTs: Date,
  now: Date = new Date(),
): number {
  return depositsAtRiskAtHour(slips, hourTs, now).reduce(
    (sum, slip) => sum + slip.amount,
    0,
  );
}

export function hoursUntilAllMature(
  slips: readonly SerializedDepositSlip[],
  now: Date = new Date(),
): number | null {
  const active = activeDeposits(slips, now);
  if (active.length === 0) {
    return 0;
  }
  const latestMs = Math.max(
    ...active.map((slip) => new Date(slip.maturesAt).getTime()),
  );
  return Math.max(0, (latestMs - now.getTime()) / MS_PER_HOUR);
}

export function recommendNextDrop(
  banks: readonly BankWithSlips[],
  options: {
    nextCaptureLevel?: number | null;
    now?: Date;
  } = {},
): RecommendedDropMetrics | null {
  if (banks.length === 0) {
    return null;
  }

  const now = options.now ?? new Date();
  const lowestLevel = Math.min(...banks.map((bank) => bank.level));
  const candidates = banks.filter((bank) => bank.level === lowestLevel);

  const scored = candidates.map((bank) => {
    const slips = bank.depositSlips;
    const valueAtRisk = valueAtRiskAtHour(slips, now, now);
    const count = countAtRiskAtHour(slips, now, now);
    const hours = hoursUntilAllMature(slips, now);
    return {
      bankId: bank.id,
      bank,
      valueAtRisk,
      countAtRisk: count,
      hoursUntilAllMature: hours,
      reasons: [] as string[],
    };
  });

  scored.sort((a, b) => {
    if (a.valueAtRisk !== b.valueAtRisk) {
      return a.valueAtRisk - b.valueAtRisk;
    }
    if (a.countAtRisk !== b.countAtRisk) {
      return a.countAtRisk - b.countAtRisk;
    }
    const aHours = a.hoursUntilAllMature ?? Number.POSITIVE_INFINITY;
    const bHours = b.hoursUntilAllMature ?? Number.POSITIVE_INFINITY;
    return aHours - bHours;
  });

  const best = scored[0]!;
  const reasons: string[] = [
    `Lowest held bank level is Lv.${best.bank.level}`,
  ];
  if (options.nextCaptureLevel != null) {
    reasons.push(
      `Next capture target is Lv.${options.nextCaptureLevel}; prefer dropping a lower-level bank`,
    );
  }
  reasons.push(
    `${best.countAtRisk} active deposit(s) at risk (${best.valueAtRisk.toLocaleString()} CrystalGold)`,
  );
  if (best.hoursUntilAllMature === 0) {
    reasons.push("No locked deposits remain — safe to drop now");
  } else if (best.hoursUntilAllMature != null) {
    reasons.push(
      `All current deposits mature in ~${Math.ceil(best.hoursUntilAllMature)}h`,
    );
  }
  best.reasons = reasons;
  return best;
}

/** ISO timestamp `hoursUntilAllMature` hours from `now`, or null if there's nothing to wait on. */
export function estimateDropSafeAtIso(
  hoursUntilAllMature: number | null,
  now: Date = new Date(),
): string | null {
  if (hoursUntilAllMature == null) return null;
  return new Date(now.getTime() + hoursUntilAllMature * MS_PER_HOUR).toISOString();
}

export function stopTakingDepositsAt(
  targetCaptureTime: Date,
  terms: readonly DepositTermDays[] = DEPOSIT_TERMS,
): { termDays: DepositTermDays; stopAtIso: string }[] {
  return terms.map((termDays) => ({
    termDays,
    stopAtIso: new Date(
      targetCaptureTime.getTime() - termDays * 24 * MS_PER_HOUR,
    ).toISOString(),
  }));
}

export function buildRiskHeatmap(
  bank: BankWithSlips,
  options: { hours?: number; now?: Date } = {},
): RiskHeatmapCell[] {
  const hours = options.hours ?? DEFAULT_HEATMAP_HOURS;
  const now = options.now ?? new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);

  const cells: RiskHeatmapCell[] = [];
  let maxCount = 0;
  for (let i = 0; i < hours; i += 1) {
    const cellStart = new Date(hourStart.getTime() + i * MS_PER_HOUR);
    const count = countAtRiskAtHour(bank.depositSlips, cellStart, now);
    const value = valueAtRiskAtHour(bank.depositSlips, cellStart, now);
    maxCount = Math.max(maxCount, count);
    cells.push({
      hourStartIso: cellStart.toISOString(),
      countAtRisk: count,
      valueAtRisk: value,
      intensity: 0,
    });
  }

  for (const cell of cells) {
    cell.intensity = maxCount === 0 ? 0 : cell.countAtRisk / maxCount;
  }
  return cells;
}

export function buildHeatmapsForBanks(
  banks: readonly BankWithSlips[],
  options: { hours?: number; now?: Date } = {},
): Record<string, RiskHeatmapCell[]> {
  const heatmaps: Record<string, RiskHeatmapCell[]> = {};
  for (const bank of banks) {
    heatmaps[bank.id] = buildRiskHeatmap(bank, options);
  }
  return heatmaps;
}

/**
 * Value of currently-locked deposits that mature within the one-hour bucket
 * starting at `hourTs` (i.e. `[hourTs, hourTs + 1h)`). Uses the same
 * locked-active semantics as `valueAtRiskAtHour`: only deposits that are
 * still `status === "locked"` as of `now` count, so already-terminal
 * (matured/looted) deposits never contribute outflow.
 */
export function maturityOutflowAtHour(
  slips: readonly SerializedDepositSlip[],
  hourTs: Date,
  now: Date = new Date(),
): number {
  const bucketStartMs = hourTs.getTime();
  const bucketEndMs = bucketStartMs + MS_PER_HOUR;
  return activeDeposits(slips, now)
    .filter((slip) => {
      const maturesMs = new Date(slip.maturesAt).getTime();
      return maturesMs >= bucketStartMs && maturesMs < bucketEndMs;
    })
    .reduce((sum, slip) => sum + slip.amount, 0);
}

/**
 * Hourly projected falloff curve: how much locked value remains at risk, and
 * how much matures out of the pool, at each hour from `now` through the
 * horizon. Pure projection — assumes no new deposits arrive and no early
 * terminations happen (see `reconstructActualLockedSeries` for what actually
 * happened once time has passed).
 */
export function buildDepositFalloffSeries(
  slips: readonly SerializedDepositSlip[],
  options: { hours?: number; now?: Date; stepHours?: number } = {},
): FalloffPoint[] {
  const hours = options.hours ?? DEFAULT_FALLOFF_HORIZON_HOURS;
  const now = options.now ?? new Date();
  const stepHours = options.stepHours ?? DEFAULT_FALLOFF_STEP_HOURS;
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);

  const points: FalloffPoint[] = [];
  for (let i = 0; i < hours; i += stepHours) {
    const cellStart = new Date(hourStart.getTime() + i * MS_PER_HOUR);
    let maturingValue = 0;
    for (let h = 0; h < stepHours; h += 1) {
      maturingValue += maturityOutflowAtHour(
        slips,
        new Date(cellStart.getTime() + h * MS_PER_HOUR),
        now,
      );
    }
    points.push({
      hourStartIso: cellStart.toISOString(),
      lockedValue: valueAtRiskAtHour(slips, cellStart, now),
      lockedCount: countAtRiskAtHour(slips, cellStart, now),
      maturingValue,
    });
  }
  return points;
}

/** True iff `slip` was still locked (not yet matured or terminated) at wall-clock `hourTs`. */
function wasLockedAtHour(slip: SerializedDepositSlip, hourTs: Date): boolean {
  const hourMs = hourTs.getTime();
  const depositMs = new Date(slip.depositAt).getTime();
  const maturesMs = new Date(slip.maturesAt).getTime();
  const outcomeMs = slip.outcomeAt ? new Date(slip.outcomeAt).getTime() : null;
  return (
    depositMs <= hourMs && maturesMs > hourMs && (outcomeMs == null || outcomeMs > hourMs)
  );
}

/**
 * Frozen slip attributes captured when a falloff projection was saved.
 * Amount / depositAt / maturesAt are the fingerprint; outcome may advance later.
 */
export type SlipFingerprintEntry = {
  id: string;
  amount: number;
  status: DepositStatus;
  depositAt: string;
  maturesAt: string;
  outcomeAt: string | null;
};

function isDepositStatus(value: unknown): value is DepositStatus {
  return (
    typeof value === "string" &&
    (DEPOSIT_STATUSES as readonly string[]).includes(value)
  );
}

/** Parse `assumptionsJson.slipFingerprint` from a saved projection row. */
export function parseSlipFingerprint(
  assumptionsJson: unknown,
): SlipFingerprintEntry[] {
  if (!assumptionsJson || typeof assumptionsJson !== "object") return [];
  const raw = (assumptionsJson as { slipFingerprint?: unknown }).slipFingerprint;
  if (!Array.isArray(raw)) return [];
  const out: SlipFingerprintEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.amount !== "number" ||
      typeof row.depositAt !== "string" ||
      typeof row.maturesAt !== "string" ||
      !isDepositStatus(row.status)
    ) {
      continue;
    }
    out.push({
      id: row.id,
      amount: row.amount,
      status: row.status,
      depositAt: row.depositAt,
      maturesAt: row.maturesAt,
      outcomeAt:
        row.outcomeAt == null
          ? null
          : typeof row.outcomeAt === "string"
            ? row.outcomeAt
            : null,
    });
  }
  return out;
}

function deriveTermDays(depositAt: string, maturesAt: string): DepositTermDays {
  const ms =
    new Date(maturesAt).getTime() - new Date(depositAt).getTime();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if ((DEPOSIT_TERMS as readonly number[]).includes(days)) {
    return days as DepositTermDays;
  }
  return 3;
}

/**
 * Builds the slip set used to reconstruct "actual" locked value for a saved
 * projection overlay:
 * - Fingerprinted slips keep frozen amount / depositAt / maturesAt (post-save
 *   edits to those fields must not rewrite the comparison).
 * - Live `outcomeAt` / `status` are overlaid by id so maturities and loots that
 *   happened after save still appear.
 * - Current slips absent from the fingerprint are appended (unexpected inflow).
 * - If the fingerprint is empty (legacy rows), fall back to the live ledger.
 */
export function slipsForProjectionActualOverlay(
  fingerprint: readonly SlipFingerprintEntry[],
  currentSlips: readonly SerializedDepositSlip[],
): SerializedDepositSlip[] {
  if (fingerprint.length === 0) {
    return [...currentSlips];
  }

  const currentById = new Map(currentSlips.map((slip) => [slip.id, slip]));
  const fingerprintIds = new Set(fingerprint.map((entry) => entry.id));

  const fromFingerprint: SerializedDepositSlip[] = fingerprint.map((entry) => {
    const live = currentById.get(entry.id);
    return {
      id: entry.id,
      bankId: live?.bankId ?? "",
      depositAt: entry.depositAt,
      termDays: live?.termDays ?? deriveTermDays(entry.depositAt, entry.maturesAt),
      maturesAt: entry.maturesAt,
      status: live?.status ?? entry.status,
      outcomeAt: live?.outcomeAt ?? entry.outcomeAt,
      amount: entry.amount,
      outcomeAmount: live?.outcomeAmount ?? null,
      depositAllianceTag: live?.depositAllianceTag ?? null,
      depositAllianceId: live?.depositAllianceId ?? null,
      commanderName: live?.commanderName ?? "",
      commanderId: live?.commanderId ?? null,
      allianceMemberId: live?.allianceMemberId ?? null,
      createdAt: live?.createdAt ?? entry.depositAt,
      updatedAt: live?.updatedAt ?? entry.depositAt,
    };
  });

  const newcomers = currentSlips.filter((slip) => !fingerprintIds.has(slip.id));
  return [...fromFingerprint, ...newcomers];
}

/**
 * Reconstructs what was *actually* locked at each hour between `from` and
 * `to`, purely from deposit/maturity/outcome timestamps (ignoring the current
 * `status` field, which only reflects the latest known state). A deposit
 * counts as locked at hour `H` iff `depositAt <= H`, `maturesAt > H`, and
 * (`outcomeAt` is null or `outcomeAt > H`) — i.e. it existed, hadn't reached
 * its scheduled maturity, and hadn't been withdrawn/looted early.
 */
export function reconstructActualLockedSeries(
  slips: readonly SerializedDepositSlip[],
  from: Date,
  to: Date,
  stepHours: number = DEFAULT_FALLOFF_STEP_HOURS,
): FalloffPoint[] {
  const points: FalloffPoint[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const stepMs = stepHours * MS_PER_HOUR;

  for (let ts = fromMs; ts <= toMs; ts += stepMs) {
    const hourStart = new Date(ts);
    const lockedSlips = slips.filter((slip) => wasLockedAtHour(slip, hourStart));
    const bucketEndMs = ts + stepMs;
    const maturingValue = lockedSlips
      .filter((slip) => {
        const maturesMs = new Date(slip.maturesAt).getTime();
        return maturesMs >= ts && maturesMs < bucketEndMs;
      })
      .reduce((sum, slip) => sum + slip.amount, 0);

    points.push({
      hourStartIso: hourStart.toISOString(),
      lockedValue: lockedSlips.reduce((sum, slip) => sum + slip.amount, 0),
      lockedCount: lockedSlips.length,
      maturingValue,
    });
  }
  return points;
}

/**
 * Compares a saved projection against the reconstructed actual series over
 * the same hours (matched by `hourStartIso`) and summarizes how reality
 * diverged from plan:
 *
 * - `finalDelta` — signed gap at the last aligned hour (actual − projected).
 * - `maxPositiveError` — worst-case moment actual stayed *above* projected
 *   (bank held more risk than planned, e.g. late maturities or new deposits).
 * - `unexpectedInflow` — total of any locked-value increases between
 *   consecutive actual hours; a pure maturity projection never rises, so any
 *   rise in actuals means deposits arrived that the projection didn't know
 *   about.
 * - `earlyLootValue` — worst-case moment actual fell *below* projected
 *   (deposits left — matured or were looted — earlier than the maturity-only
 *   projection expected).
 */
export function summarizeProjectionVsActual(
  projected: readonly FalloffPoint[],
  actual: readonly FalloffPoint[],
): ProjectionVsActualSummary {
  const actualByHour = new Map(actual.map((point) => [point.hourStartIso, point]));

  let finalDelta = 0;
  let maxPositiveError = 0;
  let earlyLootValue = 0;

  for (const projectedPoint of projected) {
    const actualPoint = actualByHour.get(projectedPoint.hourStartIso);
    if (!actualPoint) continue;
    const delta = actualPoint.lockedValue - projectedPoint.lockedValue;
    finalDelta = delta;
    if (delta > maxPositiveError) maxPositiveError = delta;
    if (-delta > earlyLootValue) earlyLootValue = -delta;
  }

  let unexpectedInflow = 0;
  for (let i = 1; i < actual.length; i += 1) {
    const rise = actual[i]!.lockedValue - actual[i - 1]!.lockedValue;
    if (rise > 0) unexpectedInflow += rise;
  }

  return { finalDelta, maxPositiveError, unexpectedInflow, earlyLootValue };
}
