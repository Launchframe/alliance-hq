import {
  VS_MEMBER_STATUSES as STATUSES,
  VS_MEMBER_EXCUSALS as EXCUSALS,
  VS_MEMBER_SIGNALS as SIGNALS,
  VS_MEMBER_SORTS as SORTS,
} from "./member-performance.shared";
import type { VsMemberDay, VsMemberRow } from "./member-performance.shared";

export type VsMemberAttentionGroup = {
  total: number;
  members: Array<{ memberId: string; name: string }>;
};

export type VsMemberWeekResponse = {
  weekStart: string;
  weekEnding: string;
  live: boolean;
  inputVersion: number;
  policy: {
    modelVersion: number | null;
    dailyThreshold: number | null;
    allowedMissedDays: number | null;
    enabled: boolean;
  };
  source: { native: boolean; verifiedAt: string | null; stale: boolean };
  summary: {
    members: number;
    meeting: number;
    below: number;
    zero: number;
    excused: number;
    needsEvidence: number;
  };
  attention: {
    minimumsMissed: VsMemberAttentionGroup;
    below: VsMemberAttentionGroup;
    zero: VsMemberAttentionGroup;
    needsEvidence: VsMemberAttentionGroup;
    promotion: VsMemberAttentionGroup;
  };
  outstanding: { count: number; weeks: string[] };
  rows: VsMemberRow[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
};

export type VsMembersViewQuery = {
  q: string;
  status: "all" | (typeof STATUSES)[number];
  rank: "all" | "1" | "2" | "3" | "4" | "5" | "unknown";
  excusal: "all" | (typeof EXCUSALS)[number];
  signal: "all" | (typeof SIGNALS)[number];
  sort: (typeof SORTS)[number];
  direction: "asc" | "desc" | null;
  page: number;
  pageSize: 50 | 100;
};

export const DEFAULT_VS_MEMBERS_QUERY: VsMembersViewQuery = {
  q: "",
  status: "all",
  rank: "all",
  excusal: "all",
  signal: "all",
  sort: "attention",
  direction: null,
  page: 1,
  pageSize: 50,
};

const inList = <T extends string>(value: string | null, list: readonly T[]): T | null =>
  value !== null && (list as readonly string[]).includes(value) ? (value as T) : null;

export function defaultSortDirection(sort: VsMembersViewQuery["sort"]): "asc" | "desc" {
  return sort === "attention" || sort === "name" ? "asc" : "desc";
}

export function vsMembersQueryFromSearchParams(
  params: Pick<URLSearchParams, "get">,
): VsMembersViewQuery {
  const q = params.get("q")?.trim() ?? "";
  const status = inList(params.get("status"), STATUSES) ?? "all";
  const rank = inList(params.get("rank"), ["1", "2", "3", "4", "5", "unknown"]) ?? "all";
  const excusal = inList(params.get("excusal"), EXCUSALS) ?? "all";
  const signal = inList(params.get("signal"), SIGNALS) ?? "all";
  const sort = inList(params.get("sort"), SORTS) ?? "attention";
  const direction = inList(params.get("direction"), ["asc", "desc"]);
  const rawPage = params.get("page");
  const page =
    rawPage !== null && /^\d+$/.test(rawPage) && Number(rawPage) >= 1
      ? Number(rawPage)
      : 1;
  const rawSize = params.get("pageSize");
  const pageSize = rawSize === "100" ? 100 : 50;
  return { q, status, rank, excusal, signal, sort, direction, page, pageSize };
}

export function vsMembersQueryToSearchParams(
  query: VsMembersViewQuery,
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString());
  const setOrDelete = (key: string, value: string | null, fallback?: string) => {
    if (value === null || value === fallback) params.delete(key);
    else params.set(key, value);
  };
  setOrDelete("q", query.q || null);
  setOrDelete("status", query.status, "all");
  setOrDelete("rank", query.rank, "all");
  setOrDelete("excusal", query.excusal, "all");
  setOrDelete("signal", query.signal, "all");
  setOrDelete("sort", query.sort, "attention");
  setOrDelete("direction", query.direction);
  setOrDelete("page", String(query.page), "1");
  setOrDelete("pageSize", String(query.pageSize), "50");
  return params;
}

export function vsMembersQueryToApiParams(query: VsMembersViewQuery, weekStart: string): string {
  const params = new URLSearchParams({ weekStart });
  if (query.q) params.set("q", query.q);
  if (query.status !== "all") params.set("status", query.status);
  if (query.rank !== "all") params.set("rank", query.rank);
  if (query.excusal !== "all") params.set("excusal", query.excusal);
  if (query.signal !== "all") params.set("signal", query.signal);
  if (query.sort !== "attention") params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.page !== 1) params.set("page", String(query.page));
  if (query.pageSize !== 50) params.set("pageSize", String(query.pageSize));
  return params.toString();
}

export function vsMembersFiltersActive(query: VsMembersViewQuery): boolean {
  return (
    query.q !== "" ||
    query.status !== "all" ||
    query.rank !== "all" ||
    query.excusal !== "all" ||
    query.signal !== "all"
  );
}

export type VsMemberTotalDisplay =
  | { kind: "reported"; value: string }
  | { kind: "partial"; value: string; count: number }
  | { kind: "subtotal"; value: string }
  | { kind: "none" };

export function vsMemberTotalDisplay(row: VsMemberRow): VsMemberTotalDisplay {
  if (row.reportedTotal !== null) return { kind: "reported", value: row.reportedTotal };
  if (row.dailySubtotal === null) return { kind: "none" };
  if (row.knownDays < 6) return { kind: "partial", value: row.dailySubtotal, count: row.knownDays };
  return { kind: "subtotal", value: row.dailySubtotal };
}

export const VS_MEMBER_DAY_STATE_KEYS = {
  open: "dayOpen",
  in_progress: "dayInProgress",
  met: "dayMet",
  missed: "dayMissed",
  excused: "dayExcused",
  pending_excusal: "dayPendingExcusal",
  missing: "dayMissing",
  conflict: "dayConflict",
  unverified: "dayUnverified",
  recorded: "dayRecorded",
} as const;

export function vsMemberDayMessage(
  day: VsMemberDay,
): { key: (typeof VS_MEMBER_DAY_STATE_KEYS)[VsMemberDay["state"]]; args: { score?: string } } {
  const key = VS_MEMBER_DAY_STATE_KEYS[day.state];
  return day.score !== null ? { key, args: { score: day.score } } : { key, args: {} };
}

export const VS_MEMBER_STATUS_KEYS: Record<VsMemberRow["status"], string> = {
  meeting: "meeting",
  below: "below",
  zero: "zero",
  excused: "excused",
  waived: "waived",
  needs_evidence: "needsEvidence",
  not_eligible: "notEvaluated",
  in_progress: "statusInProgress",
};

export const VS_MEMBER_EXCUSAL_KEYS: Record<VsMemberRow["excusal"], string | null> = {
  none: null,
  partial: "partlyExcused",
  full: "excused",
  pending: "pendingExcusal",
};

export const VS_MEMBER_SIGNAL_KEYS: Record<VsMemberRow["signal"]["kind"], string> = {
  none: "noSignal",
  at_risk: "atRisk",
  review_ready: "reviewReady",
  removal_review: "removalReview",
  leadership_review: "vsCompliance.leadershipReview",
  promotion: "promotionPotential",
};

export function vsMemberShowCoverage(counts: VsMemberRow["counts"]): boolean {
  return counts.required > 0;
}

export function vsMemberPolicyLineKey(
  policy: { modelVersion: number | null; enabled: boolean } | null,
): "policyLine" | "policyLegacy" | "noPolicy" {
  if (!policy || policy.modelVersion === null || !policy.enabled) return "noPolicy";
  return policy.modelVersion === 2 ? "policyLine" : "policyLegacy";
}

export function vsMemberSourceKey(
  source: { native: boolean; verifiedAt: string | null; stale: boolean },
): "sourceChecked" | "sourceStale" | null {
  if (source.native) return null;
  return source.verifiedAt ? "sourceChecked" : "sourceStale";
}

export function vsMembersPageRange(
  total: number,
  page: number,
  pageSize: number,
): { start: number; end: number } {
  if (total === 0) return { start: 0, end: 0 };
  return { start: (page - 1) * pageSize + 1, end: Math.min(total, page * pageSize) };
}

export function formatVsScore(value: string, locale: string): string {
  return new Intl.NumberFormat(locale).format(BigInt(value));
}

export type VsMemberDetailSequence = {
  demotion: {
    unit: "days" | "weeks";
    length: number;
    progress: number | null;
    episode: string[] | null;
    recoveredAfter: string[];
  };
  promotion: { unit: "days" | "weeks"; length: number; progress: number | null };
};

export type VsMemberOutcome =
  | "passed"
  | "excused"
  | "waived"
  | "missed"
  | "pending_data"
  | "not_eligible";

export type VsMemberDetailWeek = {
  modelVersion: 1 | 2;
  status: VsMemberRow["status"];
  excusal: VsMemberRow["excusal"];
  signal: VsMemberRow["signal"];
  days: VsMemberDay[];
  dailySubtotal: string | null;
  knownDays: number;
  reportedTotal: string | null;
  counts: VsMemberRow["counts"];
  outcome: VsMemberOutcome;
  score: string | null;
  threshold: number | null;
  streak: number | null;
  policyVersion: number | null;
  provisional: boolean;
  sequence: VsMemberDetailSequence | null;
  settled: {
    kind: "demote" | "remove";
    targetRank: number | null;
    syncStatus: "local" | "pending" | "synced" | "failed" | "credentials_required" | null;
  } | null;
  correctionReview: boolean;
};

export type VsMemberHistoryWeek = {
  weekEnding: string;
  status: VsMemberRow["status"];
  outcome: VsMemberOutcome;
  modelVersion: number;
  policyVersion: number | null;
  score: string | null;
  threshold: number | null;
  counts: VsMemberRow["counts"] | null;
  settled: {
    kind: "demote" | "remove";
    targetRank: number | null;
    syncStatus: "local" | "pending" | "synced" | "failed" | "credentials_required" | null;
  } | null;
  correctionReview: boolean;
};

export type VsMemberDetailResponse = {
  allianceId: string;
  memberId: string;
  inputVersion: number;
  weekStart: string;
  weekEnding: string;
  live: boolean;
  canManage: boolean;
  member: {
    name: string;
    currentRank: number | null;
    rosterStatus: "active" | "former";
    joinedAt: string | null;
  };
  policy: {
    modelVersion: number | null;
    version: number | null;
    enabled: boolean;
    dailyThreshold: number | null;
    weeklyMinimum: number | null;
    allowedMissedDays: number | null;
  };
  source: { native: boolean; verifiedAt: string | null; stale: boolean };
  week: VsMemberDetailWeek;
  eventId: string | null;
  action: {
    eventId: string;
    confirmationBasis: string;
    canConfirm: boolean;
    canWaive: boolean;
  } | null;
  edit: {
    scope: string;
    inputVersion: number;
    evidenceFingerprint: string;
    cells: Array<{
      recordedDate: string;
      period: "daily" | "weekly";
      score: string | null;
      source: "hq" | "ashed" | "derived" | null;
      expectedHeadVersion: number | null;
      editable: boolean;
      canClear: boolean;
    }>;
  } | null;
  history: { weeks: VsMemberHistoryWeek[]; nextBefore: string | null };
};

export type VsMemberHistoryPage = {
  allianceId: string;
  memberId: string;
  weekStart: string;
  weekEnding: string;
  history: { weeks: VsMemberHistoryWeek[]; nextBefore: string | null };
};

export type VsMemberScoreRevision = {
  recordedDate: string;
  period: "daily" | "weekly";
  version: number;
  score: string | null;
  origin: "hq" | "derived";
  recordedAt: string;
  actorName: string | null;
  manual: boolean;
  reason: string | null;
};

export type VsMemberRevisionsResponse = {
  memberId: string;
  weekStart: string;
  weekEnding: string;
  page: number;
  hasMore: boolean;
  revisions: VsMemberScoreRevision[];
};

export function vsMemberDetailApiParams(weekStart: string, beforeWeek?: string): string {
  const params = new URLSearchParams({ weekStart });
  if (beforeWeek) params.set("beforeWeek", beforeWeek);
  return params.toString();
}
