import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { conductorRuleUsesVsScores } from "@/lib/trains/rules/derive.shared";
import { scoreDateForTrainDay } from "@/lib/trains/train-day-context.shared";

export type ScoreUploadSpinPromptDay = {
  date: string;
  conductorRule: ConductorRule | null;
};

/**
 * Earliest train day (today or later) whose conductor rule draws from the
 * daily VS scores just saved for `vsRecordedDate` and still has no conductor.
 */
export function pickScoreUploadSpinDate(input: {
  vsRecordedDate: string;
  today: string;
  leadDays: number;
  days: readonly ScoreUploadSpinPromptDay[];
  assignedDates: ReadonlySet<string>;
}): string | null {
  const candidates = input.days
    .filter(
      (day) =>
        day.date >= input.today &&
        !input.assignedDates.has(day.date) &&
        conductorRuleUsesVsScores(day.conductorRule) &&
        scoreDateForTrainDay(day.date, input.leadDays) === input.vsRecordedDate,
    )
    .map((day) => day.date)
    .sort();
  return candidates[0] ?? null;
}
