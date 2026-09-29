import "server-only";

import { z } from "zod";

import {
  assertVsResultDate,
  vsResultInputSchema,
} from "@/lib/vs-performance/match-results.shared";
import { applyVerifiedVsMatchupSnapshot } from "@/lib/vs-performance/match-results.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  isVsCalendarDate,
  vsWeekStartSchema,
} from "@/lib/vs-performance/weekly-plan.shared";
import type {
  VsActor,
  VsMatchupView,
} from "@/lib/vs-performance/weekly-view.shared";

export const normalizedAshedMatchupSchema = z
  .object({
    weekStart: vsWeekStartSchema,
    opponent: z
      .object({
        externalId: z.string().max(120).nullish(),
        competitionId: z.string().max(120).nullish(),
        name: z.string().max(120).nullish(),
        tag: z.string().max(24).nullish(),
      })
      .strict(),
    days: z
      .array(
        z
          .object({
            recordedDate: z.string().refine(isVsCalendarDate),
            totals: z
              .object({
                ourScore: z.string(),
                opponentScore: z.string(),
              })
              .strict()
              .nullable(),
            reportedOutcome: z.enum(["pending", "won", "lost"]).nullable(),
            finality: z.enum(["unconfirmed", "final"]),
            sourceRef: z.string().max(200).nullish(),
            sourceUpdatedAt: z.string().datetime().nullish(),
          })
          .strict()
          .superRefine((day, context) => {
            const parsed = vsResultInputSchema.safeParse({
              totals: day.totals,
              reportedOutcome: day.reportedOutcome,
              finality: day.finality,
            });
            if (!parsed.success) {
              context.addIssue({ code: "custom", message: "invalidTotals" });
            }
          }),
      )
      .max(6),
  })
  .strict();

export type NormalizedAshedMatchup = z.infer<
  typeof normalizedAshedMatchupSchema
>;

export function parseVerifiedAshedMatchupSnapshot(
  input: unknown,
): NormalizedAshedMatchup {
  const snapshot = normalizedAshedMatchupSchema.parse(input);
  const today = getServerCalendarDate();
  for (const day of snapshot.days) {
    assertVsResultDate(
      snapshot.weekStart,
      day.recordedDate,
      today,
      "unconfirmed",
    );
  }
  return snapshot;
}

export async function importVerifiedAshedMatchup(
  actor: VsActor,
  input: unknown,
): Promise<VsMatchupView> {
  const snapshot = parseVerifiedAshedMatchupSnapshot(input);
  return applyVerifiedVsMatchupSnapshot(actor, {
    weekStart: snapshot.weekStart,
    opponent: snapshot.opponent,
    days: snapshot.days.map((day) => ({
      recordedDate: day.recordedDate,
      totals: day.totals,
      reportedOutcome: day.reportedOutcome,
      finality: day.finality,
      sourceRef: day.sourceRef ?? null,
      sourceUpdatedAt: day.sourceUpdatedAt ?? null,
    })),
  });
}
