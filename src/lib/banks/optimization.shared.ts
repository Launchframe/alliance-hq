import type {
  BankWithSlips,
  RecommendedDropMetrics,
  RiskHeatmapCell,
  SerializedDepositSlip,
} from "@/lib/banks/types.shared";
import { DEPOSIT_TERMS, type DepositTermDays } from "@/lib/banks/types.shared";

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
