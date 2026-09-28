import { z } from "zod";

import { addCalendarDays } from "@/lib/trains/game-time";
import { VS_DAY_POINTS, VsPerformanceError, isVsCalendarDate, vsDayIndex, vsDatesForWeek } from "./weekly-plan.shared";

export const VS_OUTCOMES = ["pending", "won", "lost"] as const;
export type VsOutcome = (typeof VS_OUTCOMES)[number];
export type VsFinality = "unconfirmed" | "final";
export const vsTotalSchema = z.string().regex(/^(0|[1-9]\d{0,29})$/);
export const vsTotalsSchema = z.object({ ourScore: vsTotalSchema, opponentScore: vsTotalSchema }).strict();
export type VsTotals = z.infer<typeof vsTotalsSchema>;
export const vsResultInputSchema = z.object({
  totals: vsTotalsSchema.nullable(),
  reportedOutcome: z.enum(VS_OUTCOMES).nullable(),
  finality: z.enum(["unconfirmed", "final"]),
}).strict();
export type VsResultInput = z.infer<typeof vsResultInputSchema>;
export type VsNormalizedResult = { totals: VsTotals | null; outcome: VsOutcome; finality: VsFinality };
export type VsResultSource = "hq_manual" | "ashed_import" | "reviewed_upload";
export type VsDayResult = VsNormalizedResult & { recordedDate: string };
export type VsIdentitySnapshot = {
  kind: "identity";
  opponentName: string | null;
  opponentTag: string | null;
  externalOpponentId: string | null;
  externalCompetitionId: string | null;
};

export function normalizeVsResult(input: VsResultInput): VsNormalizedResult {
  const parsed = vsResultInputSchema.safeParse(input);
  if (!parsed.success) throw new VsPerformanceError("invalidTotals");
  const { totals, reportedOutcome, finality } = parsed.data;
  if (finality === "unconfirmed") {
    if (reportedOutcome && reportedOutcome !== "pending") throw new VsPerformanceError("resultMismatch");
    return { totals, outcome: "pending", finality };
  }
  if (!totals) return { totals, outcome: reportedOutcome ?? "pending", finality };
  const ourScore = BigInt(totals.ourScore);
  const opponentScore = BigInt(totals.opponentScore);
  const derived: VsOutcome = ourScore > opponentScore ? "won" : ourScore < opponentScore ? "lost" : "pending";
  if (derived !== "pending" && reportedOutcome != null && reportedOutcome !== derived) throw new VsPerformanceError("resultMismatch");
  return { totals, outcome: derived === "pending" ? reportedOutcome ?? "pending" : derived, finality };
}

export function assertVsResultDate(weekStart: string, recordedDate: string, serverToday: string, finality: VsFinality): void {
  vsDayIndex(weekStart, recordedDate);
  if (!isVsCalendarDate(serverToday) || recordedDate > serverToday || finality === "final" && recordedDate >= serverToday) {
    throw new VsPerformanceError("invalid");
  }
}

export function calculateVsWeekPoints(weekStart: string, rows: readonly VsDayResult[], serverToday: string) {
  if (!isVsCalendarDate(serverToday)) throw new VsPerformanceError("invalid");
  const dates = vsDatesForWeek(weekStart);
  const seen = new Set<string>();
  let alliancePoints = 0;
  let opponentPoints = 0;
  let saturdayOutcome: VsOutcome = "pending";
  for (const row of rows) {
    const index = vsDayIndex(weekStart, row.recordedDate);
    if (seen.has(row.recordedDate)) throw new VsPerformanceError("invalid");
    seen.add(row.recordedDate);
    const normalized = normalizeVsResult({ totals: row.totals, reportedOutcome: row.outcome, finality: row.finality });
    if (normalized.finality !== "final" || row.recordedDate >= serverToday) continue;
    if (index === 5) saturdayOutcome = normalized.outcome;
    if (normalized.outcome === "won") alliancePoints += VS_DAY_POINTS[index];
    if (normalized.outcome === "lost") opponentPoints += VS_DAY_POINTS[index];
  }
  const victory: "alliance" | "opponent" | null = alliancePoints >= 7 ? "alliance" : opponentPoints >= 7 ? "opponent" : null;
  return {
    alliancePoints,
    opponentPoints,
    remainingPoints: 13 - alliancePoints - opponentPoints,
    victory,
    saturdayWinSecuresWeek: victory == null && serverToday <= dates[5] && saturdayOutcome === "pending" && alliancePoints + 4 >= 7,
    weekEnd: addCalendarDays(weekStart, 6),
  };
}

export function parseLocalizedVsTotal(value: string, locale: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new VsPerformanceError("invalidTotals");
  const formatter = new Intl.NumberFormat(locale, { useGrouping: true });
  const digits = new Map(Array.from({ length: 10 }, (_, digit) => [new Intl.NumberFormat(locale, { useGrouping: false }).format(digit), String(digit)]));
  const group = formatter.formatToParts(BigInt(1234567)).find((part) => part.type === "group")?.value;
  const normalized = [...trimmed].map((char) => digits.get(char) ?? char).join("");
  const ungrouped = group ? normalized.split(group).join("") : normalized;
  if (!/^\d{1,30}$/.test(ungrouped)) throw new VsPerformanceError("invalidTotals");
  const canonical = BigInt(ungrouped).toString();
  if (group && normalized.includes(group) && formatter.format(BigInt(canonical)) !== trimmed) throw new VsPerformanceError("invalidTotals");
  if (!vsTotalSchema.safeParse(canonical).success) throw new VsPerformanceError("invalidTotals");
  return canonical;
}

export function formatVsTotal(value: string, locale: string): string {
  if (!vsTotalSchema.safeParse(value).success) throw new VsPerformanceError("invalidTotals");
  return new Intl.NumberFormat(locale).format(BigInt(value));
}
