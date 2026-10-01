import { z } from "zod";

import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";
import { parseVsScore, validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { vsTotalSchema } from "./match-results.shared";
import { vsCaptureAllianceSchema, vsCaptureReviewSchema, type VsCaptureCandidate, type VsCaptureKind } from "./vs-capture.shared";
import { vsDateSchema } from "./weekly-plan.shared";
import type { VsMatchupView } from "./weekly-view.shared";

export const vsVideoContextSchema = z.object({
  recordedDate: vsDateSchema,
  period: z.enum(["daily", "weekly"]),
}).strict().refine(value => validateVsPeriod(value.recordedDate, value.period));
export type VsVideoContext = z.infer<typeof vsVideoContextSchema>;
export const vsVideoRequestedKindSchema = z.enum(["auto", "daily_totals", "weekly_overview"]);
export type VsVideoRequestedKind = z.infer<typeof vsVideoRequestedKindSchema>;
export type VsVideoEvidenceStatus = "none" | "uploading" | "queued" | "running" | "needs_type" | "ready" | "failed";

export const vsVideoMatchSubmissionSchema = z.object({
  evidenceVersion: z.number().int().positive(),
  expectedMatchupVersion: z.number().int().min(0),
  expectedDayVersions: z.record(vsDateSchema, z.number().int().min(0)).refine(value => Object.keys(value).length <= 6).default({}),
  editOpponent: z.boolean().default(false),
  data: z.discriminatedUnion("source", [
    z.object({
      source: z.literal("screenshot"),
      imageVersion: z.number().int().positive(),
      review: vsCaptureReviewSchema,
      opponentScore: vsTotalSchema.optional(),
    }).strict().refine(value => value.opponentScore === undefined || value.review.kind === "weekly_overview"),
    z.object({
      source: z.literal("manual"),
      opponent: vsCaptureAllianceSchema.partial().optional(),
      opponentScore: vsTotalSchema.optional(),
    }).strict(),
  ]),
}).strict();
export type VsVideoMatchSubmission = z.infer<typeof vsVideoMatchSubmissionSchema>;

export const vsVideoDraftFormSchema = z.object({
  source: z.enum(["manual", "screenshot"]),
  kind: z.enum(["daily_totals", "weekly_overview"]).nullable(),
  basisImageVersion: z.number().int().min(0),
  editOpponent: z.boolean(),
  opponent: vsCaptureAllianceSchema,
  opponentScore: z.string().max(64),
  ourSide: z.enum(["left", "right"]).nullable(),
  confirmSides: z.boolean(),
  finalDay: z.boolean(),
  day: z.number().int().min(1).max(6).nullable(),
  left: vsCaptureAllianceSchema,
  right: vsCaptureAllianceSchema,
  leftScore: z.string().max(64),
  rightScore: z.string().max(64),
  leftPoints: z.string().max(8),
  rightPoints: z.string().max(8),
  winners: z.array(z.enum(["left", "right", "unknown"])).length(6),
  expectedMatchupVersion: z.number().int().min(0),
  expectedDayVersions: z.record(vsDateSchema, z.number().int().min(0)).refine(value => Object.keys(value).length <= 6),
  dirtyFields: z.array(z.enum(["opponent", "opponentScore", "ourSide", "confirmSides", "finalDay", "day", "left", "right", "leftScore", "rightScore", "leftPoints", "rightPoints", "winners"])).max(20),
}).strict();
export type VsVideoDraftForm = z.infer<typeof vsVideoDraftFormSchema>;

export const vsVideoDraftSchema = z.object({
  includeResults: z.boolean(),
  submission: vsVideoMatchSubmissionSchema.nullable(),
  form: vsVideoDraftFormSchema.optional(),
}).strict();
export type VsVideoDraft = z.infer<typeof vsVideoDraftSchema>;

export type VsVideoEvidenceView = VsVideoContext & {
  version: number;
  imageVersion: number;
  requestedKind: VsVideoRequestedKind;
  status: VsVideoEvidenceStatus;
  fileName: string | null;
  candidate: VsCaptureCandidate | null;
  errorCode: string | null;
  draft: VsVideoDraft | null;
  appliedImageVersion: number | null;
  previewUrl: string | null;
};

export type VsVideoScoreSyncStatus =
  | "local"
  | "idle"
  | "pending"
  | "synced"
  | "failed"
  | "credentials_required";

export type VsVideoEvidenceResponse = {
  evidence: VsVideoEvidenceView;
  canEditMatch: boolean;
  canAttach: boolean;
  canWriteScores: boolean;
  canProcessImage: boolean;
  draftIsOwn: boolean;
  today: string;
  ashedLinked: boolean;
  canImportAshed: boolean;
  scoreSync: { status: VsVideoScoreSyncStatus; lastSyncedAt: string | null };
  scope: string;
  contextScope: string;
  matchup: VsMatchupView | null;
  alliance: { tag: string | null; name: string | null; server: number | null };
};

export function vsVideoWeekStart(context: VsVideoContext): string {
  return getWeekStartMonday(context.period === "weekly" ? addCalendarDays(context.recordedDate, -1) : context.recordedDate);
}

export function vsVideoScreenshotContextMatches(context: VsVideoContext, review: { kind: VsCaptureKind; weekStart: string; day?: number | null }): boolean {
  const parsed = vsVideoContextSchema.safeParse({ recordedDate: context?.recordedDate, period: context?.period });
  if (!parsed.success || review.weekStart !== vsVideoWeekStart(parsed.data)) return false;
  return review.kind === "weekly_overview" || context.period === "daily" && review.day != null && addCalendarDays(review.weekStart, review.day - 1) === context.recordedDate;
}

export type VsVideoComparison = {
  state: "unavailable" | "incomplete" | "match" | "fine" | "warning" | "danger";
  direction: "equal" | "shortfall" | "excess" | null;
  screenshotTotal: string | null;
  videoTotal: string | null;
  difference: string | null;
  percentFloor: string | null;
};

export function compareVsVideoTotals(screenshotTotal: string | null, scores: readonly unknown[], complete = true): VsVideoComparison {
  const empty: VsVideoComparison = { state: "unavailable", direction: null, screenshotTotal, videoTotal: null, difference: null, percentFloor: null };
  let total = BigInt(0);
  try {
    for (const score of scores) total += BigInt(parseVsScore(score));
  } catch {
    return { ...empty, state: "incomplete" };
  }
  if (!complete || scores.length === 0) return { ...empty, state: "incomplete", videoTotal: scores.length ? total.toString() : null };
  if (screenshotTotal === null || !vsTotalSchema.safeParse(screenshotTotal).success) return { ...empty, videoTotal: total.toString() };
  const reference = BigInt(screenshotTotal);
  const difference = total - reference;
  const absolute = difference < BigInt(0) ? -difference : difference;
  const result = {
    ...empty,
    videoTotal: total.toString(),
    difference: difference.toString(),
    direction: difference === BigInt(0) ? "equal" as const : difference < BigInt(0) ? "shortfall" as const : "excess" as const,
    percentFloor: reference === BigInt(0) ? difference === BigInt(0) ? "0" : null : (absolute * BigInt(100) / reference).toString(),
  };
  if (absolute === BigInt(0)) return { ...result, state: "match" };
  if (reference === BigInt(0)) return { ...result, state: "danger" };
  return { ...result, state: absolute * BigInt(100) < reference ? "fine" : absolute * BigInt(100) < reference * BigInt(5) ? "warning" : "danger" };
}
