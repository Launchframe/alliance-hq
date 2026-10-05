import { describe, expect, it } from "vitest";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { VsComplianceDay, VsComplianceEvaluation, VsComplianceMember } from "@/lib/vs-compliance/types.shared";
import { buildVsMemberRow, mapVsMemberDay, parseVsMemberWeekQuery, queryVsMemberRows, summarizeVsMemberRows, vsMemberDisplayThreshold, type VsMemberRow } from "./member-performance.shared";

const now = new Date("2026-11-20T12:00:00.000Z"); // Friday of week ending 2026-11-22

function evaluation(overrides: Partial<VsComplianceEvaluation> = {}): VsComplianceEvaluation {
  return {
    weekEnding: "2026-11-15", outcome: "missed", threshold: 40_000_000, score: 30_000_000, policyVersion: 1,
    streak: 1, recommendation: { kind: "none", targetRank: null }, evaluationBasis: "basis", confirmationBasis: "conf",
    settled: null, correctionReview: false, ...overrides,
  };
}

const member: VsComplianceMember = { active: true, joinedAt: "2026-09-01T02:00:00.000Z", leftAt: null, currentRank: 3, rankVersion: "r", isOwner: false };

function day(date: string, overrides: Partial<VsComplianceDay> = {}): VsComplianceDay {
  return { date, score: 8_000_000, state: "ready", source: "hq", sourceReady: true, away: false, excused: false, pendingExcusal: false, ...overrides };
}

const v1Policy = { modelVersion: 1 as const, enabled: true, dailyTarget: 7_200_000, weeklyMinimum: 40_000_000, leewayPct: 0, preset: "rank_aware" as const, removalThreshold: 3, version: 1, effectiveWeek: "2026-09-13" };
const v2Policy = { modelVersion: 2 as const, enabled: true, dailyTarget: 7_200_000, leewayPct: 0, allowedMissedDays: 1, demotion: { unit: "weeks" as const, length: 1 }, promotion: { unit: "weeks" as const, length: 2 }, version: 1, effectiveWeek: "2026-09-13" };

function row(overrides: Partial<VsMemberRow> = {}, days?: VsMemberRow["days"]): VsMemberRow {
  const closed = (index: number, score: string | null, state: VsMemberRow["days"][number]["state"] = "met") => ({ date: addCalendarDays("2026-11-15", index - 6), score, state, source: "hq" as const });
  return {
    memberId: "m", name: "Member", currentRank: 3, rosterStatus: "active",
    days: days ?? [closed(0, "8000000"), closed(1, "8000000"), closed(2, "8000000"), closed(3, "8000000"), closed(4, "8000000"), closed(5, "8000000")],
    dailySubtotal: "48000000", knownDays: 6, reportedTotal: "48000000",
    counts: { required: 6, met: 6, missed: 0, excused: 0, unknown: 0 },
    status: "meeting", excusal: "none", signal: { kind: "none", targetRank: null }, actionNeeded: false, provisional: false,
    ...overrides,
  };
}

describe("member week query parsing", () => {
  it("defaults to the current server week and attention sort", () => {
    const query = parseVsMemberWeekQuery({}, now);
    expect(query).toEqual({ weekStart: "2026-11-16", q: null, status: "all", rank: "all", excusal: "all", signal: "all", sort: "attention", direction: "asc", page: 1, pageSize: 50 });
  });

  it("honours per-sort direction defaults", () => {
    expect(parseVsMemberWeekQuery({ sort: "total" }, now).direction).toBe("desc");
    expect(parseVsMemberWeekQuery({ sort: "name" }, now).direction).toBe("asc");
    expect(parseVsMemberWeekQuery({ sort: "rank" }, now).direction).toBe("desc");
    expect(parseVsMemberWeekQuery({ sort: "day3" }, now).direction).toBe("desc");
    expect(parseVsMemberWeekQuery({ sort: "total", direction: "asc" }, now).direction).toBe("asc");
  });

  it.each([
    { weekStart: "2026-11-22" }, // future week
    { weekStart: "2026-11-17" }, // Tuesday
    { weekStart: "bogus" }, { weekStart: "2026-02-30" },
    { q: "x".repeat(81) }, { status: "maybe" }, { rank: "0" }, { rank: "6" },
    { excusal: "soon" }, { signal: "angry" }, { sort: "streak" }, { direction: "up" },
    { page: "0" }, { page: "-2" }, { page: "1.5" }, { pageSize: "20" }, { extra: "1" },
  ])("rejects invalid query %j", (input) => {
    expect(() => parseVsMemberWeekQuery(input, now)).toThrow();
  });

  it("accepts a Monday weekStart in the past and trimmed q", () => {
    const query = parseVsMemberWeekQuery({ weekStart: "2026-10-05", q: "  Björn  ", pageSize: "100", page: "2" }, now);
    expect(query).toMatchObject({ weekStart: "2026-10-05", q: "Björn", pageSize: 100, page: 2 });
  });
});

describe("member day mapping", () => {
  const threshold = 7_200_000;
  it("maps open, in-progress, and closed states at the 02:00 UTC boundary", () => {
    expect(mapVsMemberDay(day("2026-11-23"), threshold, now.getTime())).toMatchObject({ state: "open", score: null });
    expect(mapVsMemberDay(day("2026-11-20"), threshold, now.getTime())).toMatchObject({ state: "in_progress", score: "8000000" });
    expect(mapVsMemberDay(day("2026-11-20"), threshold, Date.parse("2026-11-20T01:59:59.999Z"))).toMatchObject({ state: "open" });
    expect(mapVsMemberDay(day("2026-11-19"), threshold, now.getTime())).toMatchObject({ state: "met" });
  });
  it("maps closed days to excused, pending, conflict, missing, unverified, met, missed, recorded", () => {
    const date = "2026-11-18";
    expect(mapVsMemberDay(day(date, { excused: true }), threshold, now.getTime()).state).toBe("excused");
    expect(mapVsMemberDay(day(date, { pendingExcusal: true }), threshold, now.getTime()).state).toBe("pending_excusal");
    expect(mapVsMemberDay(day(date, { state: "conflict" }), threshold, now.getTime()).state).toBe("conflict");
    expect(mapVsMemberDay(day(date, { state: "missing", score: null, source: null }), threshold, now.getTime()).state).toBe("missing");
    expect(mapVsMemberDay(day(date, { state: "partial" }), threshold, now.getTime()).state).toBe("unverified");
    expect(mapVsMemberDay(day(date, { state: "ready", sourceReady: false }), threshold, now.getTime()).state).toBe("unverified");
    expect(mapVsMemberDay(day(date, { score: 7_000_000 }), threshold, now.getTime()).state).toBe("missed");
    expect(mapVsMemberDay(day(date), null, now.getTime()).state).toBe("recorded");
    expect(mapVsMemberDay(day(date, { pendingExcusal: true, excused: true }), threshold, now.getTime()).state).toBe("excused");
  });
});

describe("member row build and status mapping", () => {
  const days = (ending: string, specs: Partial<VsComplianceDay>[]) => specs.map((spec, index) => day(addCalendarDays(ending, index - 6), spec));
  const build = (over: Parameters<typeof buildVsMemberRow>[0]) => buildVsMemberRow(over);
  const base = (evalOver: Partial<VsComplianceEvaluation>, specDays: Partial<VsComplianceDay>[], policy = v1Policy as typeof v1Policy | typeof v2Policy | null, weekClosed = true) =>
    build({ memberId: "m", name: "Member", member, days: days("2026-11-15", specDays), evaluation: evaluation(evalOver), policy, weekClosed, reportedTotal: null, now: now.getTime() });

  const sixMet = Array.from({ length: 6 }, () => ({}));

  it("maps v1 closed outcomes to statuses", () => {
    expect(base({ outcome: "passed" }, sixMet).status).toBe("meeting");
    expect(base({ outcome: "missed", score: 30_000_000 }, sixMet).status).toBe("below");
    expect(base({ outcome: "missed", score: 0 }, sixMet).status).toBe("zero");
    expect(base({ outcome: "pending_data" }, sixMet).status).toBe("needs_evidence");
    expect(base({ outcome: "excused" }, sixMet).status).toBe("excused");
    expect(base({ outcome: "waived" }, sixMet).status).toBe("waived");
    expect(base({ outcome: "not_eligible" }, sixMet).status).toBe("not_eligible");
    expect(base({ outcome: "missed" }, sixMet, v1Policy, false).status).toBe("in_progress");
  });

  it("maps v2 outcomes including provisional weeks and the all-zero rule", () => {
    const v2Eval = (over: Partial<VsComplianceEvaluation>) => evaluation({ modelVersion: 2, policyVersion: 1, ...over });
    expect(base(v2Eval({ outcome: "passed" }), sixMet, v2Policy).status).toBe("meeting");
    expect(base(v2Eval({ outcome: "not_eligible" }), sixMet, v2Policy).status).toBe("not_eligible");
    const pending = base(v2Eval({ outcome: "pending_data" }), [{}, {}, {}, {}, {}, { state: "missing", score: null, source: null }], v2Policy);
    expect(pending.status).toBe("needs_evidence");
    const zeroDays = Array.from({ length: 6 }, () => ({ score: 0 }));
    expect(base(v2Eval({ outcome: "missed" }), zeroDays, v2Policy).status).toBe("zero");
    // provisional: open week, known misses under allowance → meeting; over → below
    const openNow = Date.parse("2026-11-18T12:00:00.000Z"); // Wednesday
    const openWeek = (spec: Partial<VsComplianceDay>[], evalOver: Partial<VsComplianceEvaluation>) =>
      build({ memberId: "m", name: "Member", member, days: days("2026-11-22", spec), evaluation: v2Eval({ outcome: "pending_data", provisional: true, ...evalOver }), policy: v2Policy, weekClosed: false, reportedTotal: null, now: openNow });
    expect(openWeek([{}, {}, {}, {}, {}, {}], {}).status).toBe("meeting");
    expect(openWeek([{ score: 0 }, { score: 0 }, {}, {}, {}, {}], {}).status).toBe("below");
    expect(openWeek([{ state: "missing", score: null, source: null }, {}, {}, {}, {}, {}], {}).status).toBe("needs_evidence");
  });

  it("keeps no-policy weeks not_eligible when closed and in_progress when open", () => {
    expect(base({ outcome: "not_eligible" }, sixMet, null).status).toBe("not_eligible");
    expect(base({ outcome: "passed" }, sixMet, null).status).toBe("not_eligible");
    expect(base({ outcome: "passed" }, sixMet, null, false).status).toBe("in_progress");
  });

  it("counts recorded scores under no policy without claiming they met a nonexistent minimum", () => {
    const result = base({ outcome: "not_eligible" }, sixMet, null);
    expect(result.days.every((day) => day.state === "recorded")).toBe(true);
    expect(result.counts).toEqual({ required: 0, met: 0, missed: 0, excused: 0, unknown: 0 });
    expect(result.knownDays).toBe(6);
    expect(result.dailySubtotal).toBe("48000000");
  });

  it("maps excusal precedence pending > full > partial > none", () => {
    const excused = { excused: true };
    expect(base({ outcome: "excused" }, [excused, excused, excused, excused, excused, excused]).excusal).toBe("full");
    expect(base({ outcome: "passed" }, [excused, {}, {}, {}, {}, {}]).excusal).toBe("partial");
    expect(base({ outcome: "passed" }, [{ pendingExcusal: true }, excused, {}, {}, {}, {}]).excusal).toBe("pending");
    expect(base({ outcome: "passed" }, sixMet).excusal).toBe("none");
  });

  it("maps recommendation and signal precedence", () => {
    expect(base({ recommendation: { kind: "demote", targetRank: 2 } }, sixMet).signal).toEqual({ kind: "review_ready", targetRank: 2 });
    expect(base({ recommendation: { kind: "remove", targetRank: null } }, sixMet).signal).toEqual({ kind: "removal_review", targetRank: null });
    expect(base({ recommendation: { kind: "leadership_review", targetRank: null } }, sixMet).signal).toEqual({ kind: "leadership_review", targetRank: null });
    expect(base({ signal: { kind: "concern", targetRank: null, reached: false } }, sixMet).signal).toEqual({ kind: "at_risk", targetRank: null });
    expect(base({ signal: { kind: "promotion", targetRank: 2, reached: true } }, sixMet).signal).toEqual({ kind: "promotion", targetRank: 2 });
    expect(base({ recommendation: { kind: "demote", targetRank: 2 }, signal: { kind: "promotion", targetRank: 2, reached: true } }, sixMet).signal.kind).toBe("review_ready");
  });

  it("marks actionNeeded on a recommendation or correctionReview", () => {
    expect(base({ recommendation: { kind: "demote", targetRank: 2 } }, sixMet).actionNeeded).toBe(true);
    expect(base({ correctionReview: true }, sixMet).actionNeeded).toBe(true);
    expect(base({}, sixMet).actionNeeded).toBe(false);
  });

  it("sums daily scores with exact bigint arithmetic beyond 2^53 and counts known days", () => {
    const huge = Number.MAX_SAFE_INTEGER; // 9007199254740991
    const result = base({ outcome: "passed" }, [{ score: huge }, { score: huge }, { state: "missing", score: null, source: null }, {}, {}, {}]);
    expect(result.dailySubtotal).toBe((BigInt(huge) * BigInt(2) + BigInt(24_000_000)).toString());
    expect(result.knownDays).toBe(5);
    expect(result.reportedTotal).toBeNull();
  });
});

describe("member row filtering, sorting, and pagination", () => {
  const rows = [
    row({ memberId: "a", name: "Zed", currentRank: 1, status: "below", signal: { kind: "at_risk", targetRank: null } }),
    row({ memberId: "b", name: "Åsa", currentRank: 2, status: "needs_evidence", actionNeeded: true }),
    row({ memberId: "c", name: "Álvaro", currentRank: null, status: "meeting", signal: { kind: "promotion", targetRank: null }, dailySubtotal: null, reportedTotal: null, knownDays: 0 }),
    row({ memberId: "d", name: "Björn", currentRank: 4, status: "zero", signal: { kind: "review_ready", targetRank: 3 }, actionNeeded: true }),
  ];
  const query = (over: Record<string, string> = {}) => parseVsMemberWeekQuery(over, now);

  it("filters before sorting and paginating", () => {
    const result = queryVsMemberRows(rows, query({ q: "á", pageSize: "50" }));
    expect(result.total).toBe(2); // normalized "a" matches Åsa and Álvaro
    expect(result.rows.map((row) => row.memberId)).toEqual(["b", "c"]);
    expect(queryVsMemberRows(rows, query({ status: "below" })).rows.map((row) => row.memberId)).toEqual(["a"]);
    expect(queryVsMemberRows(rows, query({ rank: "unknown" })).rows.map((row) => row.memberId)).toEqual(["c"]);
    expect(queryVsMemberRows(rows, query({ rank: "4" })).rows.map((row) => row.memberId)).toEqual(["d"]);
    expect(queryVsMemberRows(rows, query({ signal: "promotion" })).rows.map((row) => row.memberId)).toEqual(["c"]);
  });

  it("orders by attention: actionNeeded, at_risk, needs_evidence, promotion, then rest", () => {
    expect(queryVsMemberRows(rows, query()).rows.map((row) => row.memberId)).toEqual(["d", "b", "a", "c"]);
  });

  it("keeps nulls last in both directions for score and rank sorts", () => {
    expect(queryVsMemberRows(rows, query({ sort: "total", direction: "desc" })).rows.map((row) => row.memberId)).toEqual(["d", "b", "a", "c"]);
    expect(queryVsMemberRows(rows, query({ sort: "total", direction: "asc" })).rows.at(-1)?.memberId).toBe("c");
    expect(queryVsMemberRows(rows, query({ sort: "rank", direction: "desc" })).rows.map((row) => row.memberId)).toEqual(["d", "b", "a", "c"]);
    expect(queryVsMemberRows(rows, query({ sort: "rank", direction: "asc" })).rows.at(-1)?.memberId).toBe("c");
    expect(queryVsMemberRows(rows, query({ sort: "day0", direction: "desc" })).rows.at(-1)?.memberId).toBe("c");
  });

  it("paginates the filtered set", () => {
    const many = Array.from({ length: 60 }, (_, index) => row({ memberId: `m${index}`, name: `M${String(index).padStart(2, "0")}` }));
    const page = queryVsMemberRows(many, query({ page: "2" }));
    expect(page.total).toBe(60);
    expect(page.rows).toHaveLength(10);
    expect(page.rows[0].memberId).toBe("m50");
  });
});

describe("summary and attention lists", () => {
  it("counts statuses over the unfiltered set and caps attention lists at five in attention order", () => {
    const rows = Array.from({ length: 7 }, (_, index) => row({ memberId: `z${index}`, name: `Member ${index}`, status: "needs_evidence", currentRank: index + 1 === 6 ? null : index }));
    rows.push(row({ memberId: "w", name: "With Miss", status: "below", days: [row().days[0], { date: "x", score: "0", state: "missed", source: "hq" }, ...row().days.slice(2)] }));
    const { summary, attention } = summarizeVsMemberRows(rows);
    expect(summary).toEqual({ members: 8, meeting: 0, below: 1, zero: 0, excused: 0, needsEvidence: 7 });
    expect(attention.needsEvidence.total).toBe(7);
    expect(attention.needsEvidence.members).toHaveLength(5);
    expect(attention.needsEvidence.members[0].memberId).toBe("z6"); // highest currentRank first
    expect(attention.minimumsMissed.total).toBe(1);
    expect(attention.minimumsMissed.members[0].memberId).toBe("w");
  });
});

describe("display threshold", () => {
  it("uses leeway-adjusted threshold for v2 and the informational daily target for v1", () => {
    expect(vsMemberDisplayThreshold(v2Policy)).toBe(7_200_000);
    expect(vsMemberDisplayThreshold({ ...v2Policy, leewayPct: 10 })).toBe(6_480_000);
    expect(vsMemberDisplayThreshold(v1Policy)).toBe(7_200_000);
    expect(vsMemberDisplayThreshold(null)).toBeNull();
  });
});
