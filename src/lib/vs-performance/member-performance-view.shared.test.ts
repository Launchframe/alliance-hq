import { describe, expect, it } from "vitest";

import type { VsMemberDay, VsMemberRow } from "./member-performance.shared";
import {
  DEFAULT_VS_MEMBERS_QUERY,
  VS_MEMBER_DAY_STATE_KEYS,
  formatVsScore,
  vsMemberDayMessage,
  vsMemberPolicyLineKey,
  vsMemberShowCoverage,
  vsMemberSourceKey,
  vsMemberTotalDisplay,
  vsMembersFiltersActive,
  vsMembersPageRange,
  vsMembersQueryFromSearchParams,
  vsMembersQueryToApiParams,
  vsMembersQueryToSearchParams,
} from "./member-performance-view.shared";

const params = (entries: Record<string, string>) => new URLSearchParams(entries);

describe("vsMembersQueryFromSearchParams", () => {
  it("returns defaults for empty params", () => {
    expect(vsMembersQueryFromSearchParams(params({}))).toEqual(DEFAULT_VS_MEMBERS_QUERY);
  });

  it("parses all filters", () => {
    expect(
      vsMembersQueryFromSearchParams(
        params({ q: "  bob ", status: "below", rank: "3", excusal: "partial", signal: "at_risk", sort: "total", direction: "asc", page: "3", pageSize: "100" }),
      ),
    ).toEqual({ q: "bob", status: "below", rank: "3", excusal: "partial", signal: "at_risk", sort: "total", direction: "asc", page: 3, pageSize: 100 });
  });

  it("ignores invalid values", () => {
    expect(
      vsMembersQueryFromSearchParams(
        params({ status: "bogus", rank: "9", excusal: "maybe", signal: "x", sort: "evil", direction: "sideways", page: "-2", pageSize: "25" }),
      ),
    ).toEqual(DEFAULT_VS_MEMBERS_QUERY);
    expect(
      vsMembersQueryFromSearchParams(params({ page: "abc", pageSize: "0" })),
    ).toMatchObject({ page: 1, pageSize: 50 });
  });
});

describe("vsMembersQueryToSearchParams", () => {
  it("omits defaults", () => {
    const out = vsMembersQueryToSearchParams(DEFAULT_VS_MEMBERS_QUERY);
    expect(out.toString()).toBe("");
  });

  it("round-trips non-default values and preserves unrelated params", () => {
    const base = params({ week: "2026-09-28" });
    const query = { ...DEFAULT_VS_MEMBERS_QUERY, q: "ann", status: "zero" as const, sort: "day4" as const, direction: "desc" as const, page: 2, pageSize: 100 as const };
    const out = vsMembersQueryToSearchParams(query, base);
    expect(out.get("week")).toBe("2026-09-28");
    expect(vsMembersQueryFromSearchParams(out)).toEqual(query);
  });
});

describe("vsMembersQueryToApiParams", () => {
  it("includes weekStart and non-defaults only", () => {
    const out = new URLSearchParams(
      vsMembersQueryToApiParams({ ...DEFAULT_VS_MEMBERS_QUERY, status: "meeting", page: 4 }, "2026-09-28"),
    );
    expect(out.get("weekStart")).toBe("2026-09-28");
    expect(out.get("status")).toBe("meeting");
    expect(out.get("page")).toBe("4");
    expect(out.get("sort")).toBeNull();
    expect(out.get("direction")).toBeNull();
    expect(out.get("pageSize")).toBeNull();
  });
});

describe("vsMembersFiltersActive", () => {
  it("is false for defaults and true for any filter", () => {
    expect(vsMembersFiltersActive(DEFAULT_VS_MEMBERS_QUERY)).toBe(false);
    expect(vsMembersFiltersActive({ ...DEFAULT_VS_MEMBERS_QUERY, sort: "total", page: 3 })).toBe(false);
    expect(vsMembersFiltersActive({ ...DEFAULT_VS_MEMBERS_QUERY, q: "x" })).toBe(true);
    expect(vsMembersFiltersActive({ ...DEFAULT_VS_MEMBERS_QUERY, signal: "promotion" })).toBe(true);
  });
});

const row = (over: Partial<VsMemberRow>): VsMemberRow => ({
  memberId: "m1",
  name: "Member",
  currentRank: 3,
  rosterStatus: "active",
  days: [],
  dailySubtotal: null,
  knownDays: 0,
  reportedTotal: null,
  counts: { required: 0, met: 0, missed: 0, excused: 0, unknown: 0 },
  status: "meeting",
  excusal: "none",
  signal: { kind: "none", targetRank: null },
  actionNeeded: false,
  provisional: false,
  ...over,
});

describe("vsMemberTotalDisplay", () => {
  it("prefers reported totals", () => {
    expect(vsMemberTotalDisplay(row({ reportedTotal: "900", dailySubtotal: "800", knownDays: 6 }))).toEqual({ kind: "reported", value: "900" });
  });
  it("marks partial subtotals when fewer than 6 days are known", () => {
    expect(vsMemberTotalDisplay(row({ dailySubtotal: "800", knownDays: 4 }))).toEqual({ kind: "partial", value: "800", count: 4 });
  });
  it("returns subtotal when all days known", () => {
    expect(vsMemberTotalDisplay(row({ dailySubtotal: "800", knownDays: 6 }))).toEqual({ kind: "subtotal", value: "800" });
  });
  it("returns none without any scores", () => {
    expect(vsMemberTotalDisplay(row({}))).toEqual({ kind: "none" });
  });
  it("handles totals beyond 2^53", () => {
    const big = "900719925474099312345";
    expect(vsMemberTotalDisplay(row({ reportedTotal: big }))).toEqual({ kind: "reported", value: big });
    expect(formatVsScore(big, "en-US")).toBe(new Intl.NumberFormat("en-US").format(BigInt(big)));
  });
});

describe("vsMemberDayMessage", () => {
  const day = (state: VsMemberDay["state"], score: string | null = null): VsMemberDay => ({ date: "2026-09-28", state, score, source: "hq" });
  it("maps every state to a message key", () => {
    const states: VsMemberDay["state"][] = ["open", "in_progress", "met", "missed", "excused", "pending_excusal", "missing", "conflict", "unverified", "recorded"];
    for (const state of states) {
      expect(vsMemberDayMessage(day(state)).key).toBe(VS_MEMBER_DAY_STATE_KEYS[state]);
    }
    expect(Object.keys(VS_MEMBER_DAY_STATE_KEYS).sort()).toEqual(states.sort());
  });
  it("passes the score when present", () => {
    expect(vsMemberDayMessage(day("met", "125"))).toEqual({ key: "dayMet", args: { score: "125" } });
  });
});

describe("status/coverage/source helpers", () => {
  it("shows coverage only when days are required", () => {
    expect(vsMemberShowCoverage({ required: 4, met: 3, missed: 1, excused: 2, unknown: 0 })).toBe(true);
    expect(vsMemberShowCoverage({ required: 0, met: 0, missed: 0, excused: 6, unknown: 0 })).toBe(false);
  });
  it("maps policy versions", () => {
    expect(vsMemberPolicyLineKey(null)).toBe("noPolicy");
    expect(vsMemberPolicyLineKey({ modelVersion: null, enabled: true })).toBe("noPolicy");
    expect(vsMemberPolicyLineKey({ modelVersion: 2, enabled: false })).toBe("noPolicy");
    expect(vsMemberPolicyLineKey({ modelVersion: 1, enabled: true })).toBe("policyLegacy");
    expect(vsMemberPolicyLineKey({ modelVersion: 2, enabled: true })).toBe("policyLine");
  });
  it("maps evidence source", () => {
    expect(vsMemberSourceKey({ native: true, verifiedAt: null, stale: false })).toBeNull();
    expect(vsMemberSourceKey({ native: false, verifiedAt: "2026-09-28T00:00:00Z", stale: false })).toBe("sourceChecked");
    expect(vsMemberSourceKey({ native: false, verifiedAt: null, stale: true })).toBe("sourceStale");
  });
});

describe("vsMembersPageRange", () => {
  it("computes display bounds", () => {
    expect(vsMembersPageRange(0, 1, 50)).toEqual({ start: 0, end: 0 });
    expect(vsMembersPageRange(120, 2, 50)).toEqual({ start: 51, end: 100 });
    expect(vsMembersPageRange(120, 3, 50)).toEqual({ start: 101, end: 120 });
  });
});
