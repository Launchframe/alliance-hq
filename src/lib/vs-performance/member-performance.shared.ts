import { z } from "zod";
import { getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { vsDayPhase } from "@/lib/vs-compliance/evaluate.shared";
import { vsThreshold } from "@/lib/vs-compliance/policy.shared";
import { VsComplianceError, type VsComplianceDay, type VsComplianceEvaluation, type VsComplianceMember, type VsPolicyVersion } from "@/lib/vs-compliance/types.shared";

export const VS_MEMBER_STATUSES = ["meeting", "below", "zero", "excused", "waived", "needs_evidence", "not_eligible", "in_progress"] as const;
export const VS_MEMBER_EXCUSALS = ["none", "partial", "full", "pending"] as const;
export const VS_MEMBER_SIGNALS = ["none", "at_risk", "review_ready", "removal_review", "leadership_review", "promotion"] as const;
export const VS_MEMBER_SORTS = ["attention", "total", "name", "rank", "day0", "day1", "day2", "day3", "day4", "day5"] as const;

export type VsMemberDay = {
  date: string;
  score: string | null;
  state: "open" | "in_progress" | "met" | "missed" | "excused" | "pending_excusal" | "missing" | "conflict" | "unverified" | "recorded";
  source: "hq" | "ashed" | "derived" | null;
};
export type VsMemberStatus = (typeof VS_MEMBER_STATUSES)[number];
export type VsMemberExcusal = (typeof VS_MEMBER_EXCUSALS)[number];
export type VsMemberRow = {
  memberId: string;
  name: string;
  currentRank: number | null;
  rosterStatus: "active" | "former";
  days: VsMemberDay[];
  dailySubtotal: string | null;
  knownDays: number;
  reportedTotal: string | null;
  counts: { required: number; met: number; missed: number; excused: number; unknown: number };
  status: VsMemberStatus;
  excusal: VsMemberExcusal;
  signal: { kind: (typeof VS_MEMBER_SIGNALS)[number]; targetRank: number | null };
  actionNeeded: boolean;
  provisional: boolean;
};

export const vsMemberWeekQuerySchema = z.object({
  weekStart: z.string().optional(),
  q: z.string().optional(),
  status: z.enum([...VS_MEMBER_STATUSES, "all"]).optional(),
  rank: z.enum(["1", "2", "3", "4", "5", "unknown", "all"]).optional(),
  excusal: z.enum([...VS_MEMBER_EXCUSALS, "all"]).optional(),
  signal: z.enum([...VS_MEMBER_SIGNALS, "all"]).optional(),
  sort: z.enum(VS_MEMBER_SORTS).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
}).strict();

export type VsMemberWeekQuery = {
  weekStart: string;
  q: string | null;
  status: (typeof VS_MEMBER_STATUSES)[number] | "all";
  rank: "1" | "2" | "3" | "4" | "5" | "unknown" | "all";
  excusal: VsMemberExcusal | "all";
  signal: (typeof VS_MEMBER_SIGNALS)[number] | "all";
  sort: (typeof VS_MEMBER_SORTS)[number];
  direction: "asc" | "desc";
  page: number;
  pageSize: 50 | 100;
};

const badQuery = (): never => { throw new VsComplianceError("invalid_policy"); };

export function currentVsWeekStart(now = new Date()): string {
  return getWeekStartMonday(getServerCalendarDate(now));
}

export function parseVsMemberWeekQuery(input: Record<string, string | undefined>, now: Date): VsMemberWeekQuery {
  const parsed = vsMemberWeekQuerySchema.safeParse(input);
  if (!parsed.success) throw new VsComplianceError("invalid_policy");
  const raw = parsed.data;
  const weekStart = raw.weekStart ?? currentVsWeekStart(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new VsComplianceError("invalid_week");
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== weekStart || date.getUTCDay() !== 1) throw new VsComplianceError("invalid_week");
  if (weekStart > currentVsWeekStart(now)) throw new VsComplianceError("invalid_week");
  const q = raw.q === undefined ? null : raw.q.trim();
  if (q !== null && q.length > 80) badQuery();
  const sort = raw.sort ?? "attention";
  const direction = raw.direction ?? (sort === "name" ? "asc" : sort === "attention" ? "asc" : "desc");
  const page = raw.page === undefined ? 1 : /^\d+$/.test(raw.page) ? Number(raw.page) : badQuery();
  if (!Number.isSafeInteger(page) || page < 1) badQuery();
  const pageSize = raw.pageSize === undefined ? 50 : raw.pageSize === "50" ? 50 : raw.pageSize === "100" ? 100 : badQuery();
  return {
    weekStart,
    q: q || null,
    status: raw.status ?? "all",
    rank: raw.rank ?? "all",
    excusal: raw.excusal ?? "all",
    signal: raw.signal ?? "all",
    sort,
    direction,
    page,
    pageSize,
  };
}

export const normalizeVsMemberName = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function vsMemberDisplayThreshold(policy: VsPolicyVersion | null): number | null {
  if (!policy) return null;
  return policy.modelVersion === 2 ? vsThreshold(policy.dailyTarget, policy.leewayPct) : policy.dailyTarget;
}

export function mapVsMemberDay(day: VsComplianceDay, threshold: number | null, now: number): VsMemberDay {
  const phase = vsDayPhase(day.date, now);
  if (phase === "open") return { date: day.date, score: null, state: "open", source: null };
  if (phase === "in_progress") {
    const score = day.state === "ready" && day.score !== null ? String(day.score) : null;
    return { date: day.date, score, state: "in_progress", source: day.source };
  }
  if (day.excused) return { date: day.date, score: day.score === null ? null : String(day.score), state: "excused", source: day.source };
  if (day.pendingExcusal) return { date: day.date, score: null, state: "pending_excusal", source: day.source };
  if (day.state === "conflict") return { date: day.date, score: null, state: "conflict", source: day.source };
  if (day.state === "missing") return { date: day.date, score: null, state: "missing", source: day.source };
  if (day.state !== "ready" || !day.sourceReady || day.score === null) return { date: day.date, score: null, state: "unverified", source: day.source };
  if (threshold === null) return { date: day.date, score: String(day.score), state: "recorded", source: day.source };
  return { date: day.date, score: String(day.score), state: day.score >= threshold ? "met" : "missed", source: day.source };
}

function vsMemberCounts(days: readonly VsMemberDay[]): VsMemberRow["counts"] {
  const counts = { required: 0, met: 0, missed: 0, excused: 0, unknown: 0 };
  for (const day of days) {
    if (day.state === "met") counts.met += 1;
    else if (day.state === "missed") counts.missed += 1;
    else if (day.state === "excused") counts.excused += 1;
    else if (day.state === "pending_excusal" || day.state === "missing" || day.state === "conflict" || day.state === "unverified") counts.unknown += 1;
  }
  counts.required = counts.met + counts.missed + counts.unknown;
  return counts;
}

export function mapVsMemberExcusal(days: readonly VsMemberDay[]): VsMemberExcusal {
  const closed = days.filter((day) => day.state !== "open" && day.state !== "in_progress");
  if (closed.some((day) => day.state === "pending_excusal")) return "pending";
  const excused = closed.filter((day) => day.state === "excused").length;
  if (!excused) return "none";
  return excused === closed.length ? "full" : "partial";
}

export function mapVsMemberStatus(input: {
  evaluation: VsComplianceEvaluation;
  policy: VsPolicyVersion | null;
  days: readonly VsMemberDay[];
  counts: VsMemberRow["counts"];
  weekClosed: boolean;
}): VsMemberStatus {
  const { evaluation, policy, days, counts, weekClosed } = input;
  if (!policy) return weekClosed ? "not_eligible" : "in_progress";
  if (evaluation.outcome === "not_eligible") return "not_eligible";
  if (evaluation.outcome === "excused") return "excused";
  if (evaluation.outcome === "waived") return "waived";
  if (evaluation.modelVersion === 2) {
    const allowedMissedDays = policy.modelVersion === 2 ? policy.allowedMissedDays : 0;
    if (evaluation.provisional || !weekClosed) {
      if (counts.missed > allowedMissedDays) return "below";
      if (counts.unknown > 0) return "needs_evidence";
      return "meeting";
    }
    if (evaluation.outcome === "pending_data") return "needs_evidence";
    if (evaluation.outcome === "missed") {
      const required = days.filter((day) => day.state === "met" || day.state === "missed" || day.state === "recorded");
      if (required.length > 0 && counts.unknown === 0 && required.every((day) => day.score === "0")) return "zero";
      return "below";
    }
    return "meeting";
  }
  if (!weekClosed) return "in_progress";
  if (evaluation.outcome === "pending_data") return "needs_evidence";
  if (evaluation.outcome === "missed") return evaluation.score === 0 ? "zero" : "below";
  return "meeting";
}

export function mapVsMemberSignal(evaluation: VsComplianceEvaluation): VsMemberRow["signal"] {
  const recommendation = evaluation.recommendation;
  if (recommendation.kind === "demote") return { kind: "review_ready", targetRank: recommendation.targetRank };
  if (recommendation.kind === "remove") return { kind: "removal_review", targetRank: null };
  if (recommendation.kind === "leadership_review") return { kind: "leadership_review", targetRank: null };
  if (evaluation.signal?.kind === "concern") return { kind: "at_risk", targetRank: null };
  if (evaluation.signal?.kind === "promotion") return { kind: "promotion", targetRank: evaluation.signal.targetRank };
  return { kind: "none", targetRank: null };
}

export function buildVsMemberRow(input: {
  memberId: string;
  name: string;
  member: VsComplianceMember;
  days: readonly VsComplianceDay[];
  evaluation: VsComplianceEvaluation;
  policy: VsPolicyVersion | null;
  weekClosed: boolean;
  reportedTotal: number | null;
  now: number;
}): VsMemberRow {
  const { evaluation, policy, weekClosed, reportedTotal } = input;
  const threshold = vsMemberDisplayThreshold(policy);
  const days = input.days.map((day) => mapVsMemberDay(day, threshold, input.now));
  const counts = evaluation.counts ?? vsMemberCounts(days);
  const knownDays = days.filter((day) => day.score !== null).length;
  const subtotal = days.reduce((sum, day) => sum + (day.score === null ? BigInt(0) : BigInt(day.score)), BigInt(0));
  const status = mapVsMemberStatus({ evaluation, policy, days, counts, weekClosed });
  const signal = mapVsMemberSignal(evaluation);
  return {
    memberId: input.memberId,
    name: input.name,
    currentRank: input.member.currentRank,
    rosterStatus: input.member.active ? "active" : "former",
    days,
    dailySubtotal: knownDays ? subtotal.toString() : null,
    knownDays,
    reportedTotal: reportedTotal === null ? null : String(reportedTotal),
    counts,
    status,
    excusal: mapVsMemberExcusal(days),
    signal,
    actionNeeded: evaluation.recommendation.kind !== "none" || evaluation.correctionReview,
    provisional: evaluation.provisional === true,
  };
}

const attentionKey = (row: VsMemberRow): number =>
  row.actionNeeded ? 0 : row.signal.kind === "at_risk" ? 1 : row.status === "needs_evidence" ? 2 : row.signal.kind === "promotion" ? 3 : 4;

const rankCmp = (a: number | null, b: number | null) => a === null ? 1 : b === null ? -1 : b - a;

export function compareVsMemberAttention(a: VsMemberRow, b: VsMemberRow): number {
  return attentionKey(a) - attentionKey(b) || rankCmp(a.currentRank, b.currentRank) || normalizeVsMemberName(a.name).localeCompare(normalizeVsMemberName(b.name)) || a.memberId.localeCompare(b.memberId);
}

const nameCmp = (a: VsMemberRow, b: VsMemberRow) => normalizeVsMemberName(a.name).localeCompare(normalizeVsMemberName(b.name));
const memberCmp = (a: VsMemberRow, b: VsMemberRow) => rankCmp(a.currentRank, b.currentRank) || nameCmp(a, b) || a.memberId.localeCompare(b.memberId);

export function compareVsMemberRows(sort: VsMemberWeekQuery["sort"], direction: "asc" | "desc"): (a: VsMemberRow, b: VsMemberRow) => number {
  const sign = direction === "asc" ? 1 : -1;
  return (a, b) => {
    if (sort === "attention") return sign * (attentionKey(a) - attentionKey(b)) || memberCmp(a, b);
    if (sort === "name") return sign * nameCmp(a, b) || memberCmp(a, b);
    const value = (row: VsMemberRow): string | number | null => {
      if (sort === "rank") return row.currentRank;
      if (sort === "total") return row.reportedTotal ?? row.dailySubtotal;
      return row.days[Number(sort.slice(3))]?.score ?? null;
    };
    const left = value(a);
    const right = value(b);
    const result = left === null ? 1 : right === null ? -1 : sign * (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
    return result || memberCmp(a, b);
  };
}

export function filterVsMemberRows(rows: readonly VsMemberRow[], query: VsMemberWeekQuery): VsMemberRow[] {
  const q = query.q ? normalizeVsMemberName(query.q) : null;
  return rows.filter((row) => {
    if (q && !normalizeVsMemberName(row.name).includes(q)) return false;
    if (query.status !== "all" && row.status !== query.status) return false;
    if (query.rank === "unknown" ? row.currentRank !== null : query.rank !== "all" && row.currentRank !== Number(query.rank)) return false;
    if (query.excusal !== "all" && row.excusal !== query.excusal) return false;
    if (query.signal !== "all" && row.signal.kind !== query.signal) return false;
    return true;
  });
}

export function queryVsMemberRows(rows: readonly VsMemberRow[], query: VsMemberWeekQuery): { rows: VsMemberRow[]; total: number } {
  const filtered = filterVsMemberRows(rows, query);
  const sorted = [...filtered].sort(compareVsMemberRows(query.sort, query.direction));
  const total = sorted.length;
  return { rows: sorted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total };
}

export function summarizeVsMemberRows(rows: readonly VsMemberRow[]) {
  const ordered = [...rows].sort(compareVsMemberAttention);
  const top = (filter: (row: VsMemberRow) => boolean) => {
    const matching = ordered.filter(filter);
    return { total: matching.length, members: matching.slice(0, 5).map((row) => ({ memberId: row.memberId, name: row.name })) };
  };
  return {
    summary: {
      members: rows.length,
      meeting: rows.filter((row) => row.status === "meeting").length,
      below: rows.filter((row) => row.status === "below").length,
      zero: rows.filter((row) => row.status === "zero").length,
      excused: rows.filter((row) => row.excusal === "full" || row.excusal === "partial").length,
      needsEvidence: rows.filter((row) => row.status === "needs_evidence").length,
    },
    attention: {
      minimumsMissed: top((row) => row.days.some((day) => day.state === "missed")),
      below: top((row) => row.status === "below"),
      zero: top((row) => row.status === "zero"),
      needsEvidence: top((row) => row.status === "needs_evidence"),
      promotion: top((row) => row.signal.kind === "promotion"),
    },
  };
}
