import type { VsMemberDay, VsMemberRow } from "./member-performance.shared";

export type MyVsCommander = {
  memberId: string;
  name: string;
  currentRank: number | null;
};

export type MyVsSequence = { unit: "days" | "weeks"; length: number; progress: number | null };

export type MyVsWeek = {
  status: VsMemberRow["status"];
  excusal: VsMemberRow["excusal"];
  signal: VsMemberRow["signal"];
  days: VsMemberDay[];
  dailySubtotal: string | null;
  knownDays: number;
  reportedTotal: string | null;
  counts: VsMemberRow["counts"];
  corrected: boolean;
  sequence: { demotion: MyVsSequence; promotion: MyVsSequence } | null;
};

export type MyVsHistoryWeek = {
  weekEnding: string;
  status: VsMemberRow["status"];
  outcome: "passed" | "excused" | "waived" | "missed" | "pending_data" | "not_eligible";
  counts: VsMemberRow["counts"] | null;
  score: string | null;
  excused: boolean;
  corrected: boolean;
  settled: { kind: "demote" | "remove"; targetRank: number | null } | null;
};

export type MyVsHistory = { weeks: MyVsHistoryWeek[]; nextBefore: string | null };

export type MyVsPerformanceResponse = {
  commanders: MyVsCommander[];
  member: MyVsCommander | null;
  weekStart: string | null;
  weekEnding: string | null;
  live: boolean;
  policy: {
    enabled: boolean;
    modelVersion: number | null;
    dailyThreshold: number | null;
    allowedMissedDays: number | null;
  } | null;
  source: { native: boolean; verifiedAt: string | null; stale: boolean } | null;
  week: MyVsWeek | null;
  history: MyVsHistory;
  officerHref: string | null;
};

export type MyVsPerformanceHistoryPage = {
  memberId: string;
  history: MyVsHistory;
};

export function mapPersistedMyVsDays(
  days: ReadonlyArray<{ date: string; assessment: "met" | "missed" | "excused" | "unknown" | "open"; score: number | null }>,
): VsMemberDay[] {
  return days.map((day) => ({
    date: day.date,
    score: day.score === null || day.assessment === "open" || day.assessment === "unknown" ? null : String(day.score),
    state:
      day.assessment === "met" ? "met"
      : day.assessment === "missed" ? "missed"
      : day.assessment === "excused" ? "excused"
      : day.assessment === "open" ? "open"
      : "unverified",
    source: null,
  }));
}
