import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { VsComplianceDay } from "@/lib/vs-compliance/types.shared";

const state = vi.hoisted(() => ({ access: vi.fn(), external: vi.fn(), resolve: vi.fn(), version: vi.fn(), compute: vi.fn(), results: [] as unknown[][] }));
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
  const chain = (rows: unknown[]): Promise<unknown[]> => {
    const query = Object.assign(Promise.resolve(rows), {
      from: () => chain(rows),
      where: () => chain(rows),
      innerJoin: () => chain(rows),
      leftJoin: () => chain(rows),
      orderBy: () => chain(rows),
      limit: () => chain(rows),
      offset: () => chain(rows),
      for: () => chain(rows),
    });
    return query;
  };
  return {
    schema,
    getDb: () => ({ select: () => chain(state.results.shift() ?? []) }),
  };
});
import { loadVsMemberDetail, loadVsMemberHistory, loadVsMemberScoreRevisions } from "./member-performance.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

const weekEnding = "2020-01-12";
const weekStart = "2020-01-06";

const memberOf = (active: boolean) => ({ active, joinedAt: "2020-01-01T02:00:00.000Z", leftAt: null, currentRank: 3, rankVersion: "r", isOwner: false });
const daily = (ending: string): VsComplianceDay[] => Array.from({ length: 6 }, (_, index) => ({ date: addCalendarDays(ending, index - 6), score: 8_000_000, state: "ready", source: "hq", sourceReady: true, away: false, excused: false, pendingExcusal: false }));
const evaluation = (over: Record<string, unknown> = {}) => ({ weekEnding, outcome: "missed", threshold: 40_000_000, score: 10_000_000, policyVersion: 3, streak: 1, recommendation: { kind: "demote", targetRank: 2 }, evaluationBasis: "eval-secret", confirmationBasis: "conf-secret", settled: null, correctionReview: false, ...over });
const rowFor = (memberId: string, over: Record<string, unknown> = {}) => ({ id: `row-${memberId}`, memberId, memberName: `Name ${memberId}`, weekEnding, memberSnapshot: memberOf(true), evaluation: evaluation(over), input: { evidence: { basis: ["hq:1:1"] } }, remoteEvidence: [{ id: "ashed:9", recordedDate: weekEnding, period: "weekly", score: 1 }], remoteVerifiedAt: null });
const persistedFor = (memberId: string, over: Record<string, unknown> = {}) => ({ ...rowFor(memberId, over), remoteVerifiedAt: null });

function facts(memberIds: Array<{ memberId: string; active: boolean }>) {
  return {
    alliance: { operatingMode: "native" },
    policies: [{ modelVersion: 1, enabled: true, dailyTarget: 7_200_000, weeklyMinimum: 40_000_000, leewayPct: 0, preset: "rank_aware", removalThreshold: 3, version: 3, effectiveWeek: "2019-12-29" }],
    members: memberIds.map(({ memberId, active }) => ({ memberId, name: `Name ${memberId}`, member: memberOf(active) })),
    heads: [], scopes: [], entries: [], revisions: [],
  };
}

function historyRows(memberId: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `hist-${memberId}-${index}`,
    weekEnding: addCalendarDays(weekEnding, -7 * (index + 1)),
    evaluation: evaluation({ weekEnding: addCalendarDays(weekEnding, -7 * (index + 1)) }),
    memberSnapshot: memberOf(true),
    remoteVerifiedAt: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.results = [];
  state.access.mockResolvedValue({ sessionId: "session", allianceId: "tenant", hqUserId: "user", boundHqUserId: "user" });
  state.external.mockResolvedValue({ native: true, verifiedAt: null, weeks: new Map(), excuses: [] });
  state.version.mockResolvedValue(7);
  state.resolve.mockImplementation(() => ({ evidence: { state: "ready", score: 48_000_000, source: "weekly", dailyCoverage: 0, basis: [], derivedSaturday: null }, daily: daily(weekEnding), excused: false, pendingExcusal: false }));
  state.compute.mockImplementation(async () => ({
    facts: facts([{ memberId: "member", active: true }]),
    rows: [rowFor("member")],
    changedRows: [], reviews: [], expungeIds: [], inbox: [], actions: [], jobs: [],
  }));
});

describe("officer member detail read model", () => {
  it("requires read access before any evidence or database work", async () => {
    state.access.mockRejectedValue(new VsComplianceError("forbidden", 403));
    await expect(loadVsMemberDetail("session", "tenant", "member", { weekStart })).rejects.toMatchObject({ code: "forbidden" });
    expect(state.external).not.toHaveBeenCalled();
    expect(state.compute).not.toHaveBeenCalled();
    expect(state.results.length).toBe(0);
  });

  it("fetches remote evidence for the selected week only", async () => {
    state.results = [[persistedFor("member")], []];
    await loadVsMemberDetail("session", "tenant", "member", { weekStart });
    expect(state.external).toHaveBeenCalledTimes(1);
    expect(state.external).toHaveBeenCalledWith("tenant", [weekEnding]);
  });

  it("returns a safe allowlisted DTO without internal basis, evidence ids, or actor data", async () => {
    state.results = [[persistedFor("member")], historyRows("member", 2)];
    const result = await loadVsMemberDetail("session", "tenant", "member", { weekStart });
    expect(result.weekEnding).toBe(weekEnding);
    expect(result.member).toMatchObject({ name: "Name member", currentRank: 3, rosterStatus: "active" });
    expect(result.history.weeks).toHaveLength(2);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["evaluationBasis", "remoteEvidence", "memberSnapshot", "ashed:", "actorId", "eval-secret", "hq:1:1", '"input"']) {
      expect(serialized).not.toContain(forbidden);
    }
    // confirmationBasis is only exposed inside the offerable action payload
    expect(result.action).toMatchObject({ eventId: "row-member", confirmationBasis: "conf-secret" });
  });

  it("returns 404 when neither a computed nor a persisted row exists, even for a foreign member id", async () => {
    state.compute.mockImplementation(async () => ({ facts: facts([]), rows: [rowFor("other-member")], changedRows: [], reviews: [], expungeIds: [], inbox: [], actions: [], jobs: [] }));
    state.results = [[], []];
    await expect(loadVsMemberDetail("session", "tenant", "member", { weekStart })).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("falls back to the persisted read-only record with null current rank when the member left the roster", async () => {
    state.compute.mockImplementation(async () => ({ facts: facts([]), rows: [], changedRows: [], reviews: [], expungeIds: [], inbox: [], actions: [], jobs: [] }));
    state.results = [[persistedFor("member")], []];
    const result = await loadVsMemberDetail("session", "tenant", "member", { weekStart });
    expect(result.member).toMatchObject({ name: "Name member", currentRank: null, rosterStatus: "former" });
    expect(result.action).toBeNull();
    expect(result.eventId).toBe(`row-member`);
  });

  it("offers confirm/waive only when the persisted event matches the computed basis", async () => {
    state.results = [[persistedFor("member")], []];
    const result = await loadVsMemberDetail("session", "tenant", "member", { weekStart });
    expect(result.action).toMatchObject({ eventId: "row-member", canConfirm: true, canWaive: true });
    // Stale persisted evaluation (different basis) suppresses the action offer
    state.results = [[persistedFor("member", { confirmationBasis: "stale-basis" })], []];
    const stale = await loadVsMemberDetail("session", "tenant", "member", { weekStart });
    expect(stale.action).toBeNull();
    expect(stale.eventId).toBe("row-member");
  });

  it("suppresses actions on live or provisional weeks", async () => {
    state.compute.mockImplementation(async () => ({ facts: facts([{ memberId: "member", active: true }]), rows: [rowFor("member", { provisional: true })], changedRows: [], reviews: [], expungeIds: [], inbox: [], actions: [], jobs: [] }));
    state.results = [[persistedFor("member", { provisional: true })], []];
    const result = await loadVsMemberDetail("session", "tenant", "member", { weekStart });
    expect(result.action).toBeNull();
  });

  it("pages recorded history in 12+1 blocks without provider or compute calls", async () => {
    const rows = historyRows("member", 13);
    state.results = [[persistedFor("member")], rows];
    const page = await loadVsMemberHistory("session", "tenant", "member", { weekStart, beforeWeek: weekEnding });
    expect(state.external).not.toHaveBeenCalled();
    expect(state.compute).not.toHaveBeenCalled();
    expect(page.history.weeks).toHaveLength(12);
    expect(page.history.nextBefore).toBe(rows[11].weekEnding);
    state.results = [[persistedFor("member")], rows.slice(0, 5)];
    const last = await loadVsMemberHistory("session", "tenant", "member", { weekStart, beforeWeek: weekEnding });
    expect(last.history.weeks).toHaveLength(5);
    expect(last.history.nextBefore).toBeNull();
  });

  it("keeps v1 history honest without v2 fields and rejects bad cursors", async () => {
    state.results = [[persistedFor("member")], historyRows("member", 1)];
    const page = await loadVsMemberHistory("session", "tenant", "member", { weekStart, beforeWeek: weekEnding });
    expect(page.history.weeks[0]).not.toHaveProperty("input");
    await expect(loadVsMemberHistory("session", "tenant", "member", { weekStart, beforeWeek: "2099-01-04" })).rejects.toMatchObject({ code: "invalid_week" });
    await expect(loadVsMemberHistory("session", "tenant", "member", { weekStart, beforeWeek: "2020-01-06" })).rejects.toMatchObject({ code: "invalid_week" });
  });

  it("scopes score revisions to the selected member-week and caps the page", async () => {
    const revision = { recordedDate: weekEnding, period: "weekly", version: 2, score: 42_000_000, origin: "hq", recordedAt: new Date("2020-01-12T03:00:00Z"), actorName: "Officer" };
    state.results = [[persistedFor("member")], [revision]];
    const result = await loadVsMemberScoreRevisions("session", "tenant", "member", { weekStart, page: "1" });
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ score: "42000000", actorName: "Officer" });
    expect(result.hasMore).toBe(false);
    await expect(loadVsMemberScoreRevisions("session", "tenant", "member", { weekStart, page: "101" })).rejects.toMatchObject({ code: "invalid_week" });
    state.results = [[], []];
    await expect(loadVsMemberScoreRevisions("session", "tenant", "member", { weekStart })).rejects.toMatchObject({ code: "not_found" });
  });
});
