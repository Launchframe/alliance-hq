import { z } from "zod";

import { addCalendarDays } from "@/lib/trains/game-time";
import { calculateVsWeekPoints, normalizeVsResult, vsTotalSchema, type VsDayResult } from "./match-results.shared";
import { VS_DAY_POINTS, VsPerformanceError, isVsCalendarDate, vsWeekStartSchema } from "./weekly-plan.shared";
import type { VsWeekOutcome } from "./opponent-info.shared";

export const VS_CAPTURE_KINDS = ["weekly_overview", "daily_totals"] as const;
export type VsCaptureKind = (typeof VS_CAPTURE_KINDS)[number];
export const vsCaptureAllianceSchema = z.object({
  server: z.number().int().positive().max(2_147_483_647).nullable(),
  tag: z.string().trim().max(24).nullable(),
  name: z.string().trim().max(120).nullable(),
}).strict();
export type VsCaptureAlliance = z.infer<typeof vsCaptureAllianceSchema>;
export const vsCaptureDaySchema = z.number().int().min(1).max(6);
export const vsCaptureDayResultSchema = z.object({
  day: vsCaptureDaySchema,
  winner: z.enum(["left", "right", "unknown"]),
}).strict();
export type VsCaptureDayResult = z.infer<typeof vsCaptureDayResultSchema>;

const captureReviewBase = {
  weekStart: vsWeekStartSchema,
  ourSide: z.enum(["left", "right"]),
  confirmSides: z.literal(true),
  left: vsCaptureAllianceSchema,
  right: vsCaptureAllianceSchema,
};
export const vsCaptureReviewSchema = z.discriminatedUnion("kind", [
  z.object({
    ...captureReviewBase,
    kind: z.literal("daily_totals"),
    day: vsCaptureDaySchema,
    leftScore: vsTotalSchema.nullable(),
    rightScore: vsTotalSchema.nullable(),
    finalDay: z.boolean(),
  }).strict(),
  z.object({
    ...captureReviewBase,
    kind: z.literal("weekly_overview"),
    leftPoints: z.number().int().min(0).max(13).nullable(),
    rightPoints: z.number().int().min(0).max(13).nullable(),
    dayResults: z.array(vsCaptureDayResultSchema).length(6),
  }).strict(),
]);
export type VsCaptureReview = z.infer<typeof vsCaptureReviewSchema>;
export type VsCaptureCandidate = {
  kind: VsCaptureKind;
  left: VsCaptureAlliance;
  right: VsCaptureAlliance;
  day: number | null;
  leftScore: string | null;
  rightScore: string | null;
  leftPoints: number | null;
  rightPoints: number | null;
  dayResults: VsCaptureDayResult[];
  ongoing: boolean;
  partial: boolean;
};
export type VsCaptureCommit = {
  weekStart: string;
  opponent: VsCaptureAlliance;
  days: VsDayResult[];
  weeklyPoints: { ours: number; theirs: number } | null;
  weekOutcome: VsWeekOutcome | null;
};

export function buildVsCaptureCommit(value: unknown, serverToday: string): VsCaptureCommit {
  const parsed = vsCaptureReviewSchema.safeParse(value);
  if (!parsed.success || !isVsCalendarDate(serverToday)) throw new VsPerformanceError("capture_invalid", 400);
  const review = parsed.data;
  const opponent = review.ourSide === "left" ? review.right : review.left;
  const result: VsCaptureCommit = { weekStart: review.weekStart, opponent, days: [], weeklyPoints: null, weekOutcome: null };
  if (review.kind === "daily_totals") {
    if (!review.finalDay) return result;
    const recordedDate = addCalendarDays(review.weekStart, review.day - 1);
    if (recordedDate > serverToday || review.leftScore === null || review.rightScore === null) throw new VsPerformanceError("capture_invalid", 400);
    const totals = {
      ourScore: review.ourSide === "left" ? review.leftScore : review.rightScore,
      opponentScore: review.ourSide === "left" ? review.rightScore : review.leftScore,
    };
    result.days = [{ recordedDate, ...normalizeVsResult({ totals, reportedOutcome: null, finality: "final" }) }];
    return result;
  }
  let ourKnownPoints = 0;
  let theirKnownPoints = 0;
  for (const [index, day] of review.dayResults.entries()) {
    if (day.day !== index + 1) throw new VsPerformanceError("capture_invalid", 400);
    if (day.winner === "unknown") continue;
    const recordedDate = addCalendarDays(review.weekStart, index);
    if (recordedDate >= serverToday) throw new VsPerformanceError("capture_invalid", 400);
    const won = day.winner === review.ourSide;
    if (won) ourKnownPoints += VS_DAY_POINTS[index];
    else theirKnownPoints += VS_DAY_POINTS[index];
    result.days.push({ recordedDate, totals: null, outcome: won ? "won" : "lost", finality: "final" });
  }
  if ((review.leftPoints === null) !== (review.rightPoints === null)) throw new VsPerformanceError("capture_invalid", 400);
  if (review.leftPoints !== null && review.rightPoints !== null) {
    const ours = review.ourSide === "left" ? review.leftPoints : review.rightPoints;
    const theirs = review.ourSide === "left" ? review.rightPoints : review.leftPoints;
    const available = VS_DAY_POINTS.reduce((sum, value, index) => sum + (addCalendarDays(review.weekStart, index) < serverToday ? value : 0), 0);
    if (ours + theirs > available) throw new VsPerformanceError("capture_invalid", 400);
    if (ours + theirs > 13 || ourKnownPoints > ours || theirKnownPoints > theirs || result.days.length === 6 && (ourKnownPoints !== ours || theirKnownPoints !== theirs)) throw new VsPerformanceError("capture_point_mismatch", 400);
    result.weeklyPoints = { ours, theirs };
    result.weekOutcome = ours >= 7 ? "win" : theirs >= 7 ? "loss" : null;
  }
  return result;
}

export function mergeVsCaptureResults(capture: VsCaptureCommit, existing: readonly VsDayResult[], serverToday: string): VsCaptureCommit {
  const byDate = new Map(existing.map(day => [day.recordedDate, day]));
  const days = capture.days.map(day => {
    const previous = byDate.get(day.recordedDate);
    if (day.totals !== null || previous?.finality !== "final" || previous.totals === null) return day;
    try {
      return {
        recordedDate: day.recordedDate,
        ...normalizeVsResult({ totals: previous.totals, reportedOutcome: day.outcome, finality: "final" }),
      };
    } catch (error) {
      if (error instanceof VsPerformanceError && error.code === "resultMismatch") throw new VsPerformanceError("capture_point_mismatch", 409);
      throw error;
    }
  });
  for (const day of days) byDate.set(day.recordedDate, day);
  const points = calculateVsWeekPoints(capture.weekStart, [...byDate.values()], serverToday);
  if (capture.weeklyPoints) {
    const { ours, theirs } = capture.weeklyPoints;
    if (points.alliancePoints > ours || points.opponentPoints > theirs || points.remainingPoints === 0 && (points.alliancePoints !== ours || points.opponentPoints !== theirs)) throw new VsPerformanceError("capture_point_mismatch", 409);
  }
  return { ...capture, days };
}

export type VsCaptureOcrLine = {
  text: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
};
export type VsCaptureFieldText = Partial<Record<"leftPoints" | "rightPoints" | "leftScore" | "rightScore" | "leftTag" | "rightTag", readonly string[]>>;

function uniqueValue<T>(values: readonly T[]): T | null {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : null;
}

function parsedScore(text: string): string | null {
  const value = text.trim();
  if (!/^\d+$/.test(value) && !/^\d{1,3}(?:[, .\u00a0\u202f]\d{3})+$/.test(value)) return null;
  const digits = value.replace(/[, .\u00a0\u202f]/g, "");
  if (!/^\d{1,30}$/.test(digits)) return null;
  return BigInt(digits).toString();
}

function preferScore(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts.keys()].sort((left, right) => {
    const byCount = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
    return byCount === 0 ? right.length - left.length : byCount;
  });
  const best = ranked[0];
  if (!best) return null;
  const bestCount = counts.get(best) ?? 0;
  const tied = ranked.filter((value) => counts.get(value) === bestCount);
  if (tied.length === 1) return best;
  const longest = tied.reduce((left, right) => (left.length >= right.length ? left : right));
  return tied.every((value) => longest.startsWith(value)) ? longest : null;
}

/** Use the crop when it parsed. Only scan the page when the crop produced no number. */
function scoreOrLines(field: readonly string[] | undefined, lines: readonly VsCaptureOcrLine[]): string | null {
  const parsed = (field ?? []).map(parsedScore).filter((value): value is string => value !== null);
  const chosen = preferScore(parsed);
  if (chosen) return chosen;
  if (parsed.length > 0) return null;
  return scoreFromLines(lines);
}

function scoreFromLines(lines: readonly VsCaptureOcrLine[]): string | null {
  const found: string[] = [];
  for (const line of lines) {
    for (const match of line.text.matchAll(/\d{1,3}(?:[, .\u00a0\u202f]\d{3})+|\d{4,30}/g)) {
      const score = parsedScore(match[0]);
      if (score && score.length >= 4) found.push(score);
    }
  }
  return preferScore(found);
}

function linesForScore(lines: readonly VsCaptureOcrLine[], imageWidth: number, side: "left" | "right"): VsCaptureOcrLine[] {
  return lines.filter((line) => {
    if (!line.bbox) return false;
    const mid = (line.bbox.x0 + line.bbox.x1) / 2;
    return side === "left" ? mid < imageWidth * 0.5 : mid >= imageWidth * 0.5;
  });
}

function resolvedTag(field: readonly string[] | undefined, lines: readonly VsCaptureOcrLine[]): string | null {
  const fromField = field && field.length > 0 ? fieldTag(field) : null;
  return fromField ?? fieldTag(lines.map((line) => line.text));
}

function bannerResult(lines: readonly VsCaptureOcrLine[]): "victory" | "defeat" | null {
  const text = lines.map((line) => line.text).join("\n");
  const victory = /\b(?:victory|vit[oó]ria)\b/i.test(text);
  const defeat = /\b(?:defeat|derrota)\b/i.test(text);
  if (victory === defeat) return null;
  return victory ? "victory" : "defeat";
}

function fieldPoints(values: readonly string[] | undefined): number | null {
  return uniqueValue((values ?? []).map(value => value.trim()).filter(value => /^(?:[0-9]|1[0-3])$/.test(value)).map(Number));
}

export function normalizedVsCaptureTag(value: string): string {
  return value.trim().replace(/^\[+|\]+$/g, "").trim().toLocaleLowerCase("en-US");
}

function fieldTag(lines: readonly string[]): string | null {
  const tags = lines.flatMap(line => [...line.matchAll(/\[([^\]\r\n]{1,24})\]/g)].map(match => match[1].trim())).filter(tag => !/^\d{12,16}$/.test(tag));
  return uniqueValue(tags);
}

export function parseVsCaptureLines(input: {
  kind: VsCaptureKind;
  lines: readonly VsCaptureOcrLine[];
  imageWidth: number;
  fields?: VsCaptureFieldText;
}): VsCaptureCandidate {
  const blankAlliance = (): VsCaptureAlliance => ({ server: null, tag: null, name: null });
  const result: VsCaptureCandidate = {
    kind: input.kind,
    left: blankAlliance(), right: blankAlliance(), day: null,
    leftScore: null, rightScore: null, leftPoints: null, rightPoints: null,
    dayResults: Array.from({ length: 6 }, (_, index) => ({ day: index + 1, winner: "unknown" })),
    ongoing: input.lines.some(line => /\d+\s*d\s*\d{1,2}:\d{2}(?::\d{2})?/i.test(line.text)),
    partial: true,
  };
  const leftLines = input.lines.filter(line => line.bbox && line.bbox.x1 < input.imageWidth * .48);
  const rightLines = input.lines.filter(line => line.bbox && line.bbox.x0 > input.imageWidth * .52);
  const leftIdentity = leftLines.filter(line => /#\s*\d{1,7}\b/.test(line.text));
  const rightIdentity = rightLines.filter(line => /#\s*\d{1,7}\b/.test(line.text));
  const dailyLeft = linesForScore(input.lines, input.imageWidth, "left");
  const dailyRight = linesForScore(input.lines, input.imageWidth, "right");
  result.left.tag = resolvedTag(input.fields?.leftTag, input.kind === "weekly_overview" ? leftIdentity : dailyLeft);
  result.right.tag = resolvedTag(input.fields?.rightTag, input.kind === "weekly_overview" ? rightIdentity : dailyRight);
  for (const [side, lines, identityLines] of [[result.left, leftLines, leftIdentity], [result.right, rightLines, rightIdentity]] as const) {
    if (input.kind !== "weekly_overview") continue;
    const servers = identityLines.flatMap(line => [...line.text.matchAll(/#\s*(\d{1,7})\b/g)].map(match => Number(match[1]))).filter(value => value > 0);
    side.server = uniqueValue(servers);
    const bottom = identityLines.reduce((value, line) => Math.max(value, line.bbox?.y1 ?? 0), 0);
    if (bottom > 0) {
      const next = lines.filter(line => line.bbox && line.bbox.y0 > bottom && line.bbox.y0 - bottom < input.imageWidth * .08 && !/\b(?:Day|Dia|MVP|Win|Date|Match|Use|Increase)\b/i.test(line.text)).sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0));
      if (next.length && next[0].text.length <= 120 && !/\d{12,16}/.test(next[0].text)) side.name = next[0].text.trim();
    }
  }
  if (input.kind === "daily_totals") {
    const dayNumbers = input.lines.flatMap(line => {
      if (!line.bbox || line.bbox.x0 > input.imageWidth * .65 || line.bbox.x1 < input.imageWidth * .35) return [];
      const match = /\b(?:Day|Dia)[^\d\r\n]{0,3}([1-6])\b/i.exec(line.text);
      return match ? [Number(match[1])] : [];
    });
    result.day = uniqueValue(dayNumbers);
    result.leftScore = scoreOrLines(input.fields?.leftScore, dailyLeft);
    result.rightScore = scoreOrLines(input.fields?.rightScore, dailyRight);
    const leftBanner = bannerResult(dailyLeft);
    const rightBanner = bannerResult(dailyRight);
    if (result.day != null && leftBanner && rightBanner && leftBanner !== rightBanner) {
      const winner = leftBanner === "victory" ? "left" : "right";
      result.dayResults[result.day - 1] = { day: result.day, winner };
    }
    result.ongoing ||= result.leftScore === "0" && result.rightScore === "0";
    result.partial = result.day === null || result.leftScore === null || result.rightScore === null || result.left.tag === null || result.right.tag === null;
    return result;
  }
  result.leftPoints = fieldPoints(input.fields?.leftPoints);
  result.rightPoints = fieldPoints(input.fields?.rightPoints);
  const tagsDistinct = result.left.tag !== null && result.right.tag !== null && normalizedVsCaptureTag(result.left.tag) !== normalizedVsCaptureTag(result.right.tag);
  if (tagsDistinct) {
    const dayLabels = input.lines.flatMap(line => {
      const match = /^\s*(?:Day|Dia)\s*([1-6])\s*$/i.exec(line.text);
      return match && line.bbox && line.bbox.x0 < input.imageWidth * .3 ? [{ day: Number(match[1]), box: line.bbox }] : [];
    });
    for (const label of dayLabels) {
      const candidates = input.lines.filter(line => line.bbox && line.bbox.x0 > input.imageWidth * .86 && Math.min(line.bbox.y1, label.box.y1) > Math.max(line.bbox.y0, label.box.y0));
      const tag = fieldTag(candidates.map(line => line.text));
      if (!tag) continue;
      const normalized = normalizedVsCaptureTag(tag);
      const winner = normalized === normalizedVsCaptureTag(result.left.tag!) ? "left" : normalized === normalizedVsCaptureTag(result.right.tag!) ? "right" : "unknown";
      result.dayResults[label.day - 1] = { day: label.day, winner };
    }
  }
  result.partial = result.leftPoints === null || result.rightPoints === null || result.left.tag === null || result.right.tag === null || result.dayResults.some(day => day.winner === "unknown");
  return result;
}
