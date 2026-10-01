import { z } from "zod";

import { VsPerformanceError, isVsCalendarDate, vsWeekStartSchema } from "./weekly-plan.shared";
import { vsTotalSchema } from "./match-results.shared";

export const VS_WEEK_OUTCOMES = ["pending", "win", "loss"] as const;
export type VsWeekOutcome = (typeof VS_WEEK_OUTCOMES)[number];
export type VsOpponentScores = [string | null, string | null, string | null, string | null, string | null, string | null];
export type VsOpponentField = "opponentServer" | "opponentName" | "opponentTag" | "weekOutcome" | `day:${1 | 2 | 3 | 4 | 5 | 6}`;
export const VS_OPPONENT_FIELDS: readonly VsOpponentField[] = ["opponentServer", "opponentName", "opponentTag", "weekOutcome", "day:1", "day:2", "day:3", "day:4", "day:5", "day:6"];

export const vsOpponentInfoSchema = z.object({
  opponentServer: z.number().int().positive().max(2_147_483_647).nullable(),
  opponentTag: z.string().trim().max(24).nullable(),
  opponentName: z.string().trim().max(120).nullable(),
  opponentDailyScores: z.tuple([vsTotalSchema.nullable(), vsTotalSchema.nullable(), vsTotalSchema.nullable(), vsTotalSchema.nullable(), vsTotalSchema.nullable(), vsTotalSchema.nullable()]),
  weekOutcome: z.enum(VS_WEEK_OUTCOMES),
}).strict();
export type VsOpponentInfo = z.infer<typeof vsOpponentInfoSchema>;
export type AshedOpponentSnapshot = VsOpponentInfo & {
  remoteId: string;
  allianceId: string;
  weekStart: string;
  compatibilityScore: string | null;
  sourceRevision: string;
};
export const EMPTY_VS_OPPONENT_INFO: VsOpponentInfo = {
  opponentServer: null, opponentTag: null, opponentName: null,
  opponentDailyScores: [null, null, null, null, null, null], weekOutcome: "pending",
};

export function ashedOpponentSnapshotKey(snapshot: AshedOpponentSnapshot): string {
  return JSON.stringify([
    snapshot.remoteId, snapshot.allianceId, snapshot.weekStart,
    snapshot.opponentServer, snapshot.opponentTag, snapshot.opponentName,
    snapshot.opponentDailyScores, snapshot.compatibilityScore,
    snapshot.weekOutcome, snapshot.sourceRevision,
  ]);
}

export function normalizeAshedVsTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new VsPerformanceError("invalid_snapshot", 422);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z?$/.exec(value);
  if (!match || !isVsCalendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new VsPerformanceError("invalid_snapshot", 422);
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] ?? "").padEnd(9, "0")}Z`;
}

export function normalizeAshedVsScore(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value).toString();
  if (typeof value === "string" && vsTotalSchema.safeParse(value).success) return value;
  throw new VsPerformanceError("invalid_snapshot", 422);
}

const ashedOpponentRowSchema = z.object({
  id: z.string().min(1).max(120),
  alliance_id: z.string().min(1).max(120),
  competition_date: vsWeekStartSchema,
  opponent_server: z.number().int().positive().max(2_147_483_647).nullish(),
  opponent_tag: z.string().max(24).nullish(),
  opponent_name: z.string().max(120).nullish(),
  opponent_daily_scores: z.union([z.tuple([]), z.array(z.unknown()).min(6).max(7)]).nullish(),
  outcome: z.enum(VS_WEEK_OUTCOMES).nullish(),
  updated_date: z.string(),
}).passthrough();

export function parseAshedOpponentRow(value: unknown, expectedAllianceId: string): AshedOpponentSnapshot {
  const parsed = ashedOpponentRowSchema.safeParse(value);
  if (!parsed.success || parsed.data.alliance_id !== expectedAllianceId) throw new VsPerformanceError("invalid_snapshot", 422);
  const row = parsed.data;
  const scores = row.opponent_daily_scores?.length ? row.opponent_daily_scores.map(normalizeAshedVsScore) : [null, null, null, null, null, null, null];
  return {
    remoteId: row.id,
    allianceId: row.alliance_id,
    weekStart: row.competition_date,
    opponentServer: row.opponent_server ?? null,
    opponentTag: row.opponent_tag?.trim() || null,
    opponentName: row.opponent_name?.trim() || null,
    opponentDailyScores: scores.slice(0, 6) as VsOpponentScores,
    compatibilityScore: scores.length === 7 ? scores[6] : null,
    weekOutcome: row.outcome ?? "pending",
    sourceRevision: normalizeAshedVsTimestamp(row.updated_date),
  };
}

export function vsOpponentFieldValue(info: VsOpponentInfo, field: VsOpponentField): string | number | null {
  if (field.startsWith("day:")) return info.opponentDailyScores[Number(field.slice(4)) - 1];
  return info[field as "opponentServer" | "opponentName" | "opponentTag" | "weekOutcome"];
}

export function setVsOpponentField(info: VsOpponentInfo, field: VsOpponentField, source: VsOpponentInfo): VsOpponentInfo {
  if (field.startsWith("day:")) {
    const index = Number(field.slice(4)) - 1;
    const opponentDailyScores: VsOpponentScores = [...info.opponentDailyScores];
    opponentDailyScores[index] = source.opponentDailyScores[index];
    return { ...info, opponentDailyScores };
  }
  return { ...info, [field]: vsOpponentFieldValue(source, field) };
}

export function reconcileVsOpponentSnapshot(input: {
  local: VsOpponentInfo;
  remote: AshedOpponentSnapshot;
  baseline: AshedOpponentSnapshot | null;
  owned: readonly VsOpponentField[];
  dirty: readonly VsOpponentField[];
  unresolved: readonly VsOpponentField[];
  acknowledged?: readonly VsOpponentField[];
}): { local: VsOpponentInfo; baseline: AshedOpponentSnapshot; conflicts: VsOpponentField[] } {
  const protectedFields = new Set([...input.owned, ...input.dirty]);
  const acknowledged = new Set(input.acknowledged ?? []);
  const sameRecord = input.baseline?.remoteId === input.remote.remoteId && input.baseline.allianceId === input.remote.allianceId && input.baseline.weekStart === input.remote.weekStart;
  let local = input.local;
  let baseline = input.remote;
  const conflicts: VsOpponentField[] = [];
  for (const field of VS_OPPONENT_FIELDS) {
    if (!protectedFields.has(field)) {
      local = setVsOpponentField(local, field, input.remote);
      continue;
    }
    const remoteValue = vsOpponentFieldValue(input.remote, field);
    const localValue = vsOpponentFieldValue(local, field);
    if (remoteValue === localValue) continue;
    const agreedValue = acknowledged.has(field) ? remoteValue : sameRecord ? vsOpponentFieldValue(input.baseline!, field) : undefined;
    const stillConflicted = input.unresolved.includes(field) && !acknowledged.has(field);
    if (stillConflicted || !input.dirty.includes(field) || agreedValue === undefined || remoteValue !== agreedValue) {
      conflicts.push(field);
      if (sameRecord) baseline = { ...baseline, ...setVsOpponentField(baseline, field, input.baseline!) };
    }
  }
  return { local, baseline, conflicts };
}

export function ashedWireVsScore(value: string | null): number | null {
  if (value === null) return null;
  if (!vsTotalSchema.safeParse(value).success) throw new VsPerformanceError("invalid");
  if (BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new VsPerformanceError("score_too_large", 422);
  return Number(value);
}

export function buildAshedOpponentUpdate(input: {
  current: AshedOpponentSnapshot;
  baseline: AshedOpponentSnapshot | null;
  desired: VsOpponentInfo;
  dirtyFields: readonly VsOpponentField[];
}): { patch: Record<string, unknown>; conflicts: VsOpponentField[] } {
  const desired = vsOpponentInfoSchema.parse(input.desired);
  const fields = [...new Set(input.dirtyFields)];
  if (fields.some(field => !VS_OPPONENT_FIELDS.includes(field))) throw new VsPerformanceError("invalid");
  const baseline = input.baseline;
  const sameRecord = baseline?.remoteId === input.current.remoteId && baseline?.allianceId === input.current.allianceId && baseline?.weekStart === input.current.weekStart;
  const conflicts = fields.filter(field => {
    const currentValue = vsOpponentFieldValue(input.current, field);
    if (currentValue === vsOpponentFieldValue(desired, field)) return false;
    return !sameRecord || currentValue !== vsOpponentFieldValue(baseline!, field);
  });
  if (conflicts.length) return { patch: {}, conflicts };
  const patch: Record<string, unknown> = {};
  let scoresChanged = false;
  const scores: VsOpponentScores = [...input.current.opponentDailyScores];
  const wireFields = { opponentServer: "opponent_server", opponentName: "opponent_name", opponentTag: "opponent_tag", weekOutcome: "outcome" } as const;
  for (const field of fields) {
    if (vsOpponentFieldValue(input.current, field) === vsOpponentFieldValue(desired, field)) continue;
    if (field.startsWith("day:")) {
      const index = Number(field.slice(4)) - 1;
      scores[index] = desired.opponentDailyScores[index];
      scoresChanged = true;
    } else {
      patch[wireFields[field as keyof typeof wireFields]] = vsOpponentFieldValue(desired, field);
    }
  }
  if (scoresChanged) patch.opponent_daily_scores = [...scores, input.current.compatibilityScore].map(ashedWireVsScore);
  return { patch, conflicts };
}

export function buildAshedOpponentCreate(allianceId: string, weekStart: string, info: VsOpponentInfo): Record<string, unknown> {
  vsWeekStartSchema.parse(weekStart);
  const desired = vsOpponentInfoSchema.parse(info);
  return {
    alliance_id: allianceId,
    competition_date: weekStart,
    week_type: "normal",
    opponent_server: desired.opponentServer,
    opponent_tag: desired.opponentTag,
    opponent_name: desired.opponentName,
    opponent_daily_scores: [...desired.opponentDailyScores, "0"].map(ashedWireVsScore),
    outcome: desired.weekOutcome,
  };
}
