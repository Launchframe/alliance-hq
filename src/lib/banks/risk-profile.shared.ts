import type { DepositTermDays } from "@/lib/banks/types.shared";
import { DEPOSIT_TERMS } from "@/lib/banks/types.shared";
import { daysBetween } from "@/lib/banks/protection-timer.shared";

export type RiskBand =
  | "unknown"
  | "risk-free"
  | "low"
  | "material"
  | "imminent";

export type DepositTermRiskGauge = {
  termDays: DepositTermDays;
  fillPercent: number;
  band: RiskBand;
  intensity: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bandFromFill(fillPercent: number): RiskBand {
  if (fillPercent <= 25) return "risk-free";
  if (fillPercent <= 50) return "low";
  if (fillPercent <= 75) return "material";
  return "imminent";
}

export function computeDepositTermRiskGauge(params: {
  termDays: DepositTermDays;
  now: Date;
  protectionExpiresAt: Date | null;
  dropByAt: Date | null;
  counterpartyRiskScore: number | null;
}): DepositTermRiskGauge {
  const { termDays, now, protectionExpiresAt, dropByAt, counterpartyRiskScore } =
    params;
  const maturesAt = new Date(now.getTime() + termDays * MS_PER_DAY);

  if (!protectionExpiresAt) {
    return {
      termDays,
      fillPercent: 0,
      band: "unknown",
      intensity: 0,
    };
  }

  if (dropByAt && dropByAt.getTime() < maturesAt.getTime()) {
    return {
      termDays,
      fillPercent: 100,
      band: "imminent",
      intensity: 1,
    };
  }

  if (maturesAt.getTime() <= protectionExpiresAt.getTime()) {
    const marginDays = daysBetween(maturesAt, protectionExpiresAt);
    const fillPercent = clamp(25 - marginDays * 5, 5, 25);
    return {
      termDays,
      fillPercent,
      band: "risk-free",
      intensity: fillPercent / 100,
    };
  }

  const overrunDays = daysBetween(protectionExpiresAt, maturesAt);
  const overrunComponent = Math.min(40, overrunDays * 10);
  const riskComponent = counterpartyRiskScore ?? 50;
  const fillPercent = clamp(riskComponent * 0.6 + overrunComponent, 26, 100);
  const band = bandFromFill(fillPercent);

  return {
    termDays,
    fillPercent,
    band,
    intensity: fillPercent / 100,
  };
}

export function computeDepositTermRiskGauges(params: {
  now: Date;
  protectionExpiresAt: Date | null;
  dropByAt: Date | null;
  counterpartyRiskScore: number | null;
}): DepositTermRiskGauge[] {
  return DEPOSIT_TERMS.map((termDays) =>
    computeDepositTermRiskGauge({ ...params, termDays }),
  );
}

export function shouldShowRiskReconfirmHint(params: {
  protectionExpiresAt: Date | null;
  capturedAt: Date | null;
  counterpartyRiskUpdatedAt: Date | null;
  now?: Date;
}): boolean {
  if (!params.protectionExpiresAt || !params.capturedAt) {
    return false;
  }
  const now = params.now ?? new Date();
  if (params.protectionExpiresAt.getTime() <= now.getTime()) {
    return false;
  }
  if (!params.counterpartyRiskUpdatedAt) {
    return true;
  }
  return (
    params.counterpartyRiskUpdatedAt.getTime() < params.capturedAt.getTime()
  );
}
