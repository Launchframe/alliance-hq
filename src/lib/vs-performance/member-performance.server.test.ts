import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { VsComplianceDay } from "@/lib/vs-compliance/types.shared";

const state = vi.hoisted(() => ({ access: vi.fn(), external: vi.fn(), resolve: vi.fn(), version: vi.fn(), compute: vi.fn(), writes: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/vs-compliance/access.server", () => ({ requireVsComplianceAccess: state.access }));
vi.mock("@/lib/vs-compliance/evidence.server", async () => ({
  ...(await vi.importActual("@/lib/vs-compliance/evidence.server")),
  prepareExternalEvidence: state.external,
  resolveComplianceEvidence: state.resolve,
  loadComplianceStateVersion: state.version,
}));
vi.mock("@/lib/vs-compliance/repository.server", () => ({ computeComplianceRows: state.compute }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const results = [[{ memberId: "persisted-former" }]];
  const chain = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { from: () => chain(rows), where: () => chain(rows), innerJoin: () => chain(rows) });
  return {
    schema,
    getDb: () => ({
      select: () => chain(results.shift() ?? []),
      insert: () => ({ values: (value: unknown) => { state.writes.push(value); return Promise.resolve([]); } }),
      update: () => ({ set: (value: unknown) => { state.writes.push(value); return Promise.resolve([]); } }),
    }),
  };
});
import { loadVsMemberWeek } from "./member-performance.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

const weekEnding = "2020-01-12";
const weekStart = "2020-01-06";

const memberOf = (active: boolean) => ({ active, joinedAt: "2020-01-01T02:00:00.000Z", leftAt: null, currentRank: 3, rankVersion: "r", isOwner: false });
const daily = (ending: string): VsComplianceDay[] => Array.from({ length: 6 }, (_, index) => ({ date: addCalendarDays(ending, index - 6), score: 8_000_000, state: "ready", source: "hq", sourceReady: true, away: false, excused: false, pendingExcusal: false }));
const evaluation = (over: Record<string, unknown> = {}) => ({ weekEnding, outcome: "passed", threshold: 40_000_000, score: 48_000_000, policyVersion: 1, streak: 0, recommendation: { kind: "none", targetRank: null }, evaluationBasis: "basis-hex", confirmationBasis: "conf-hex", settled: null, correctionReview: false, ...over });
const rowFor = (memberId: string, over: Record<string, unknown> = {}) => ({ id: `row-${memberId}`, memberId, memberName: `Name ${memberId}`, weekEnding, memberSnapshot: memberOf(true), evaluation: evaluation(over), input: { evidence: { basis: ["hq:1:1"] } }, remoteEvidence: [{ id: "ashed:9", recordedDate: weekEnding, period: "weekly", score: 1 }], remoteVerifiedAt: null });

function facts(memberIds: Array<{ memberId: string; active: boolean }>, evidenceIds = memberIds.map(({ memberId }) => memberId)) {
  return {
    alliance: { operatingMode: "native" },
    policies: [{ modelVersion: 1, enabled: true, dailyTarget: 7_200_000, weeklyMinimum: 40_000_000, leewayPct: 0, preset: "rank_aware", removalThreshold: 3, version: 1, effectiveWeek: "2019-12-29" }],
    members: memberIds.map(({ memberId, active }) => ({ memberId, name: `Name ${memberId}`, member: memberOf(active) })),
    heads: evidenceIds.map((memberId) => ({ id: `h-${memberId}`, memberId, recordedDate: weekEnding, period: "weekly", origin: "hq", version: 1, score: 48_000_000 })),
    scopes: [], entries: [], revisions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.writes = [];
  state.access.mockResolvedValue({ sessionId: "session", allianceId: "tenant", hqUserId: "user", boundHqUserId: "user" });
  state.external.mockResolvedValue({ native: true, verifiedAt: null, weeks: new Map(), excuses: [] });
  state.version.mockResolvedValue(7);
  state.resolve.mockImplementation(() => ({ evidence: { state: "ready", score: 48_000_000, source: "weekly", dailyCoverage: 0, basis: [], derivedSaturday: null }, daily: daily(weekEnding), excused: false, pendingExcusal: false }));
  state.compute.mockImplementation(async () => ({
    facts: facts([{ memberId: "persisted-active", active: true }, { memberId: "persisted-former", active: false }, { memberId: "ghost-former", active: false }], ["persisted-active"]),
    rows: ["persisted-active", "persisted-former", "ghost-former"].flatMap((memberId) => [rowFor(memberId), { ...rowFor(memberId), weekEnding: "2020-01-05", evaluation: evaluation({ weekEnding: "2020-01-05" }) }]),
    changedRows: [], reviews: [], expungeIds: [], inbox: [], actions: [], jobs: [],
  }));
});

describe("officer member week read model", () => {
  it("returns filtered, paginated rows with no writes and a single scoped external fetch", async () => {
    const result = await loadVsMemberWeek("session", "tenant", { weekStart });
    expect(state.access).toHaveBeenCalledWith("session", "tenant", "vs_compliance:read");
    expect(state.external).toHaveBeenCalledTimes(1);
    expect(state.external).toHaveBeenCalledWith("tenant", [weekEnding]);
    expect(state.compute).toHaveBeenCalledTimes(1);
    expect(state.writes).toHaveLength(0);
    expect(result.weekEnding).toBe(weekEnding);
    expect(result.live).toBe(false);
    expect(result.inputVersion).toBe(7);
    expect(result.canManage).toBe(true);
    // former member with a persisted evaluation is included; the ghost is not
    expect(result.rows.map((row) => row.memberId).sort()).toEqual(["persisted-active", "persisted-former"]);
    expect(result.rows[0].rosterStatus).toBeDefined();
    expect(result.summary.members).toBe(2);
  });

  it("never leaks evidence ids, basis strings, actor data, reasons, or remote ids in the DTO", async () => {
    const result = await loadVsMemberWeek("session", "tenant", { weekStart });
    const serialized = JSON.stringify(result.rows);
    for (const forbidden of ["evaluationBasis", "confirmationBasis", "remoteEvidence", "ashed:", "reason", "actorId", "basis-hex", "conf-hex", "row-"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("excludes former members without data historically and keeps them off the live week", async () => {
    const factsOut = facts([{ memberId: "active", active: true }, { memberId: "former-no-data", active: false }], ["active"]);
    state.compute.mockImplementation(async () => ({ facts: factsOut, rows: [rowFor("active"), rowFor("former-no-data")], changedRows: [], reviews: [], expungeIds: [], inbox: [], actions: [], jobs: [] }));
    const result = await loadVsMemberWeek("session", "tenant", { weekStart });
    expect(result.rows.map((row) => row.memberId)).toEqual(["active"]);
  });

  it("propagates access denial before any evidence work", async () => {
    state.access.mockRejectedValue(new VsComplianceError("forbidden", 403));
    await expect(loadVsMemberWeek("session", "tenant", { weekStart })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(state.external).not.toHaveBeenCalled();
    expect(state.compute).not.toHaveBeenCalled();
  });

  it("flags canManage from the manage permission only", async () => {
    state.access.mockImplementation(async (_session: string, _alliance: string, permission: string) => {
      if (permission === "vs_compliance:manage") throw new VsComplianceError("forbidden", 403);
      return { sessionId: "session", allianceId: "tenant", hqUserId: "user", boundHqUserId: "user" };
    });
    const result = await loadVsMemberWeek("session", "tenant", { weekStart });
    expect(result.canManage).toBe(false);
  });
});
