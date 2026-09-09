import { canSpinConductorForDay } from "@/lib/trains/conductor-mechanism.shared";
import { scoreDateForTrainDay } from "@/lib/trains/train-day-context.shared";
import { classifyVsDataNeed } from "@/lib/trains/vs-data-status.shared";
import type { ScoreDateDayConfig } from "@/lib/trains/vs-data-status.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

export type ConductorSpinAfterVsOffer = {
  trainDate: string;
  href: string;
};

export type ShouldOfferConductorSpinAfterVsScoresInput = {
  vsPeriod?: "daily" | "weekly" | null;
  vsRecordedDate: string;
  todayTrainDate: string;
  /** Alliance conductor lead time (shifts score lookback: T−1−leadDays). */
  leadDays?: number;
  conductorMemberId?: string | null;
  locked?: boolean;
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  conductorConfig?: unknown;
  /** Painted rule on the score-reference day (needed when leadDays ≥ 1). */
  scoreDateDay?: ScoreDateDayConfig | null;
};

/**
 * After daily VS scores land for Day Y, offer a conductor spin when today's
 * train still has no pending/locked conductor and its wheel rules require
 * those scores. Day Y is `today − 1 − leadDays`, not always yesterday.
 */
export function shouldOfferConductorSpinAfterVsScores(
  input: ShouldOfferConductorSpinAfterVsScoresInput,
): boolean {
  if (input.vsPeriod === "weekly") return false;
  const leadDays = input.leadDays ?? 0;
  const expectedScoreDate = scoreDateForTrainDay(
    input.todayTrainDate,
    leadDays,
  );
  if (input.vsRecordedDate !== expectedScoreDate) return false;
  if (input.conductorMemberId) return false;
  if (input.locked) return false;

  const need = classifyVsDataNeed({
    conductorMechanism: input.conductorMechanism,
    paintTemplate: input.paintTemplate,
    trainDate: input.todayTrainDate,
    leadDays,
    scoreDateDay: input.scoreDateDay,
  });
  if (need.kind !== "prior_day_vs") return false;
  // Economy Week probes VS without requiring it; lead-time inherit is the
  // same optional probe. Only required prior-day VS gates the spin prompt.
  if (!need.required) return false;

  return canSpinConductorForDay(
    input.conductorMechanism,
    false,
    input.paintTemplate as WeekTemplateType | null,
    input.todayTrainDate,
    input.conductorConfig,
  );
}

export function parseConductorSpinOfferPayload(
  raw: unknown,
): ConductorSpinAfterVsOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as { trainDate?: unknown; href?: unknown };
  if (
    typeof rec.trainDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(rec.trainDate)
  ) {
    return null;
  }
  if (typeof rec.href !== "string" || !rec.href.startsWith("/trains?")) {
    return null;
  }
  return { trainDate: rec.trainDate, href: rec.href };
}
