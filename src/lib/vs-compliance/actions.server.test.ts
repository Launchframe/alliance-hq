import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { defaultVsPolicy } from "./policy.shared";
import { rebuildVsCompliance } from "./evaluate.shared";
import { evaluateVsWeek } from "@/lib/vs-scores/evidence.shared";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), authorizeTx: vi.fn(), receipt: vi.fn(), lock: vi.fn(), version: vi.fn(), external: vi.fn(), rebuild: vi.fn(), results: [] as unknown[][], writes: [] as { table: string; kind: string; values: Record<string, unknown> }[], inTransaction: false, failTable: "" }));
vi.mock("server-only", () => ({}));
vi.mock("./access.server", () => ({ requireVsComplianceAccess: mocks.authorize }));
vi.mock("./evidence.server", () => ({ lockCompliance: mocks.lock, prepareExternalEvidence: mocks.external, loadComplianceStateVersion: mocks.version }));
vi.mock("./repository.server", async () => ({ ...(await vi.importActual("./repository.server")), authorizeComplianceTx: mocks.authorizeTx, findComplianceReceipt: mocks.receipt, rebuildComplianceTx: mocks.rebuild }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = (rows: unknown[]) => { const query = Object.assign(Promise.resolve(rows), { from: () => query, where: () => query, limit: () => query, for: () => query, returning: () => query }); return query; };
  const write = (table: Parameters<typeof getTableName>[0], kind: string, values: Record<string, unknown>) => {
    const name = getTableName(table);
    if (mocks.failTable === name) throw new Error("injected");
    mocks.writes.push({ table: name, kind, values });
    const result = chain([{ id: "roster" }]);
    return Object.assign(result, { onConflictDoNothing: () => result, onConflictDoUpdate: () => result });
  };
  const tx = { select: () => chain(mocks.results.shift() ?? []), execute: vi.fn(), insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (values: Record<string, unknown>) => write(table, "insert", values) }), update: (table: Parameters<typeof getTableName>[0]) => ({ set: (values: Record<string, unknown>) => write(table, "update", values) }), delete: (table: Parameters<typeof getTableName>[0]) => write(table, "delete", {}) };
  return { schema, getDb: () => ({ ...tx, transaction: async (run: (db: typeof tx) => Promise<unknown>) => {
    const before = mocks.writes.length;
    mocks.inTransaction = true;
    try { return await run(tx); } catch (error) { mocks.writes.splice(before); throw error; } finally { mocks.inTransaction = false; }
  } }) };
});
import { performComplianceAction } from "./actions.server";
import { complianceHash } from "./repository.server";

const member = { active: true, currentRank: 3, rankVersion: "rank-1", joinedAt: "2020-01-01T00:00:00Z", leftAt: null, isOwner: false };
const input = { weekEnding: "2026-09-13", evidence: evaluateVsWeek([{ id: "hq:score:1", period: "weekly", recordedDate: "2026-09-13", score: 1 }], "2026-09-13"), excused: false, pendingExcusal: false, waived: false };
const evaluation = rebuildVsCompliance({ member, weeks: [input], policies: [{ ...defaultVsPolicy(), enabled: true, weeklyMinimum: 40_000_000, effectiveWeek: "2026-09-13", version: 1 }], now: new Date("2026-09-14") })[0];
const row = { id: "event", allianceId: "tenant", memberId: "member", memberName: "Member", weekEnding: "2026-09-13", input, evaluation: { ...evaluation, confirmationBasis: "a".repeat(64) }, memberSnapshot: member };
const body = { requestId: "request-1234", confirmationBasis: "a".repeat(64) };

beforeEach(() => {
  vi.clearAllMocks(); mocks.results = [[row], [], []]; mocks.writes = []; mocks.failTable = "";
  mocks.authorize.mockResolvedValue({ sessionId: "session", allianceId: "tenant", hqUserId: "officer", boundHqUserId: "officer" });
  mocks.authorizeTx.mockResolvedValue(undefined); mocks.receipt.mockResolvedValue(null); mocks.version.mockResolvedValue(7); mocks.lock.mockResolvedValue({ inputVersion: 7 });
  mocks.external.mockImplementation(async () => { expect(mocks.inTransaction).toBe(false); return { native: true, weeks: new Map() }; });
  mocks.rebuild.mockResolvedValue({ rows: [row], actions: [], facts: { alliance: { operatingMode: "native" }, members: [{ memberId: "member", name: "Member", member }] } });
});

describe("officer-confirmed native bookkeeping", () => {
  it("commits immutable receipt, rank history, roster, violation and local sync result together", async () => {
    const result = await performComplianceAction("session", "tenant", "event", body, false);
    expect(result.ok).toBe(true);
    expect(mocks.writes.find((write) => write.table === "member_alliance_rank_events")?.values).toMatchObject({ allianceRank: 2, recordedByHqUserId: "officer", source: "vs_compliance" });
    expect(mocks.writes.find((write) => write.table === "alliance_members")?.values).toMatchObject({ allianceRank: 2 });
    expect(mocks.writes.find((write) => write.table === "member_violations")?.values).toMatchObject({ complianceEventId: "event", notes: null });
    expect(mocks.writes.find((write) => write.table === "vs_compliance_sync_jobs")?.values).toMatchObject({ status: "local", actionId: result.actionId });
    expect(mocks.rebuild).toHaveBeenCalledTimes(2);
  });
  it("rolls back the claimed action and rank write if any local cleanup stage fails", async () => {
    for (const table of ["member_alliance_rank_events", "alliance_members", "commander_alliance_memberships", "vs_compliance_roster_guards", "member_violations", "vs_compliance_sync_jobs"]) {
      mocks.results = [[row], [], []]; mocks.failTable = table;
      await expect(performComplianceAction("session", "tenant", "event", body, false)).rejects.toThrow("injected");
      expect(mocks.writes).toHaveLength(0);
    }
  });
  it("replays an immutable receipt without re-evaluating or demoting again, even after later actions", async () => {
    mocks.receipt.mockResolvedValue({ id: "original-action", requestDigest: complianceHash(["event", false, { ...body, reason: null }]) });
    expect(await performComplianceAction("session", "tenant", "event", body, false)).toEqual({ ok: true, actionId: "original-action" });
    expect(mocks.external).not.toHaveBeenCalled(); expect(mocks.writes).toHaveLength(0);
  });
  it("rejects request-key reuse with a different event or command", async () => {
    mocks.receipt.mockResolvedValue({ id: "original", requestDigest: "different" });
    await expect(performComplianceAction("session", "tenant", "event", body, false)).rejects.toMatchObject({ code: "changed" });
  });
  it("rejects source-version changes or changed recommendation fingerprints before rank writes", async () => {
    mocks.lock.mockResolvedValue({ inputVersion: 8 });
    await expect(performComplianceAction("session", "tenant", "event", body, false)).rejects.toMatchObject({ code: "changed" });
    expect(mocks.writes).toHaveLength(0);
    mocks.lock.mockResolvedValue({ inputVersion: 7 }); mocks.results = [[row], []];
    await expect(performComplianceAction("session", "tenant", "event", { ...body, confirmationBasis: "b".repeat(64) }, false)).rejects.toMatchObject({ code: "changed" });
    expect(mocks.writes).toHaveLength(0);
  });
  it("never confirms against cached Ashed evidence when the bounded fresh snapshot is incomplete", async () => {
    mocks.external.mockResolvedValue({ native: false, verifiedAt: new Date(), weeks: new Map() });
    await expect(performComplianceAction("session", "tenant", "event", body, false)).rejects.toMatchObject({ code: "changed", status: 409 });
    expect(mocks.writes).toHaveLength(0);
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("denies R5, owner, departed and leadership-review ordinary completions", async () => {
    for (const change of [{ currentRank: 5 }, { isOwner: true }, { active: false }]) {
      mocks.results = [[row], []]; mocks.rebuild.mockResolvedValue({ rows: [{ ...row, memberSnapshot: { ...member, ...change } }], actions: [] });
      await expect(performComplianceAction("session", "tenant", "event", body, false)).rejects.toMatchObject({ code: "changed" });
    }
    expect(mocks.writes).toHaveLength(0);
  });
  it("records private waiver attribution without rank mutation and rebuilds later recommendations", async () => {
    await performComplianceAction("session", "tenant", "event", { ...body, reason: "Private waiver" }, true);
    expect(mocks.writes.find((write) => write.table === "vs_compliance_actions")?.values).toMatchObject({ kind: "waive", reason: "Private waiver", actorId: "officer" });
    expect(mocks.writes.some((write) => write.table === "alliance_members")).toBe(false);
    expect(mocks.rebuild).toHaveBeenCalledTimes(2);
  });
  it("denies unauthorized and foreign requests without preparing external evidence", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("forbidden"));
    await expect(performComplianceAction("session", "tenant", "event", body, false)).rejects.toThrow("forbidden");
    mocks.results = [[]];
    await expect(performComplianceAction("session", "tenant", "foreign", body, false)).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.external).not.toHaveBeenCalled();
  });
});
