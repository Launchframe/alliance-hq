import { addCalendarDays } from "@/lib/trains/game-time";
import {
  DEFAULT_ALLIANCE_TRAIN_WEEK,
  getTrainWeekStart,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";

export const TRAIN_MINIMUMS_WINDOWS = ["daily", "weekly"] as const;
export type TrainMinimumsWindow = (typeof TRAIN_MINIMUMS_WINDOWS)[number];

export type TrainConductorMinimumsSettings = {
  minVsPoints: number | null;
  minDonationPoints: number | null;
  leewayPct: number;
  window: TrainMinimumsWindow;
};

export type QualificationCriterionSummary = {
  score: number;
  minimum: number;
  effectiveMinimum: number;
  shortfall: number;
};

export type MemberQualificationPayload = {
  qualified: boolean;
  evaluationWindow: TrainMinimumsWindow;
  periodStart: string;
  periodEnd: string;
  vs: QualificationCriterionSummary;
  donation: QualificationCriterionSummary;
};

export function normalizeTrainMinimumsSettings(input: {
  minVsPoints?: number | null;
  minDonationPoints?: number | null;
  leewayPct?: number | null;
  window?: string | null;
}): TrainConductorMinimumsSettings {
  const window =
    input.window === "daily" || input.window === "weekly"
      ? input.window
      : "weekly";
  const leewayRaw = input.leewayPct ?? 0;
  const leewayPct = Math.min(100, Math.max(0, Math.trunc(leewayRaw)));
  return {
    minVsPoints: normalizeOptionalMinimum(input.minVsPoints),
    minDonationPoints: normalizeOptionalMinimum(input.minDonationPoints),
    leewayPct,
    window,
  };
}

function normalizeOptionalMinimum(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

export function minimumsEnforcementEnabled(
  settings: TrainConductorMinimumsSettings,
): boolean {
  return (
    (settings.minVsPoints ?? 0) > 0 || (settings.minDonationPoints ?? 0) > 0
  );
}

/** Donation minimums are not enforceable until HQ stores donation scores. */
export function minimumsSettingsForHqLocalEval(
  settings: TrainConductorMinimumsSettings,
): TrainConductorMinimumsSettings {
  if (settings.minDonationPoints != null && settings.minDonationPoints > 0) {
    return { ...settings, minDonationPoints: null };
  }
  return settings;
}

/** Effective floor after leeway — e.g. min 1000 with 10% leeway → 900. */
export function effectiveMinimum(minimum: number, leewayPct: number): number {
  if (minimum <= 0) return 0;
  const pct = Math.min(100, Math.max(0, leewayPct));
  return Math.floor(minimum * (1 - pct / 100));
}

export function evaluationPeriodForTrainDate(
  trainDate: string,
  window: TrainMinimumsWindow,
  trainWeekConfig: AllianceTrainWeekConfig = DEFAULT_ALLIANCE_TRAIN_WEEK,
): { start: string; end: string } {
  if (window === "daily") {
    const day = addCalendarDays(trainDate, -1);
    return { start: day, end: day };
  }

  const weekStart = getTrainWeekStart(trainDate, trainWeekConfig);
  const prevWeekEnd = addCalendarDays(weekStart, -1);
  const prevWeekStart = addCalendarDays(weekStart, -7);
  return { start: prevWeekStart, end: prevWeekEnd };
}

export function buildMemberQualification(input: {
  vsScore: number;
  donationScore: number;
  settings: TrainConductorMinimumsSettings;
  periodStart: string;
  periodEnd: string;
}): MemberQualificationPayload {
  const vsMinimum = input.settings.minVsPoints ?? 0;
  const donationMinimum = input.settings.minDonationPoints ?? 0;
  const vsEffective = effectiveMinimum(vsMinimum, input.settings.leewayPct);
  const donationEffective = effectiveMinimum(
    donationMinimum,
    input.settings.leewayPct,
  );

  const vsQualified = vsMinimum <= 0 || input.vsScore >= vsEffective;
  const donationQualified =
    donationMinimum <= 0 || input.donationScore >= donationEffective;

  return {
    qualified: vsQualified && donationQualified,
    evaluationWindow: input.settings.window,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    vs: {
      score: input.vsScore,
      minimum: vsMinimum,
      effectiveMinimum: vsEffective,
      shortfall: vsQualified ? 0 : Math.max(0, vsEffective - input.vsScore),
    },
    donation: {
      score: input.donationScore,
      minimum: donationMinimum,
      effectiveMinimum: donationEffective,
      shortfall: donationQualified
        ? 0
        : Math.max(0, donationEffective - input.donationScore),
    },
  };
}

/** Server gate before persisting a minimums override — never trust client qualification. */
export function assertConductorMinimumOverrideQualification(
  qualification: MemberQualificationPayload | null,
): MemberQualificationPayload {
  if (!qualification) {
    throw new Error(
      "Cannot verify conductor qualification without score data.",
    );
  }
  if (qualification.qualified) {
    throw new Error("Member meets conductor minimums; override is not allowed.");
  }
  return qualification;
}
