import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const state = vi.hoisted(() => ({ results: [] as unknown[][], writes: [] as { table: string; values: Record<string, unknown> }[], resolve: vi.fn(), fetch: vi.fn(), transaction: false }));
vi.mock("server-only", () => ({}));
vi.mock("nanoid", () => ({ nanoid: () => "lease" }));
vi.mock("./evidence.server", () => ({ lockCompliance: vi.fn() }));
vi.mock("@/lib/time-off/excused-transport.server", () => ({ resolveExcusedConnection: state.resolve }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = (rows: unknown[]) => { const query = Object.assign(Promise.resolve(rows), { from: () => query, where: () => query, for: () => query, limit: () => query }); return query; };
  const tx = { select: () => chain(state.results.shift() ?? []), update: (table: Parameters<typeof getTableName>[0]) => ({ set: (values: Record<string, unknown>) => { state.writes.push({ table: getTableName(table), values }); return chain([]); } }) };
  return { schema, getDb: () => ({ ...tx, transaction: async (run: (db: typeof tx) => Promise<unknown>) => { state.transaction = true; try { return await run(tx); } finally { state.transaction = false; } } }) };
});
import { syncComplianceAction } from "./sync.server";

const action = { id: "action", allianceId: "tenant", memberId: "member", eventId: "event", kind: "demote", expectedRank: 3, targetRank: 2, recordedAt: new Date("2026-09-01") };
const job = { actionId: "action", status: "failed", memberId: "member", attempts: 1, leaseToken: null, leaseExpiresAt: null };
const finalJob = { ...job, leaseToken: "lease" };
function queue(extra: unknown[][] = []) { state.results = [[job], [action], [{ allianceRank: 2, status: "active" }], [{ actionId: "action" }], [], ...extra, [finalJob]]; }
function remote(rank: string, status = "active", alliance = "upstream") { return Response.json({ id: "member", alliance_id: alliance, rank, status }); }

beforeEach(() => {
  vi.clearAllMocks(); state.writes = []; state.transaction = false;
  state.resolve.mockResolvedValue({ connection: { token: "test-token", appId: "test-app", originUrl: "https://example.test" }, allianceId: "upstream", appId: "test-app" });
  vi.stubGlobal("fetch", (...args: unknown[]) => { expect(state.transaction).toBe(false); return state.fetch(...args); });
});

describe("resumable optional Ashed rank mirror", () => {
  it("repairs failed Ashed work after the native roster already has the target rank", async () => {
    queue([[{ token: "lease", expiry: new Date(Date.now() + 180_000) }]]);
    state.fetch.mockResolvedValueOnce(remote("R3")).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(remote("R2"));
    expect(await syncComplianceAction("tenant", "action")).toBe("synced");
    expect(state.fetch).toHaveBeenCalledTimes(3);
    expect(state.fetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ rank: "R2" }) });
    expect(state.writes.some((write) => write.table === "member_alliance_rank_events" && write.values.ashedSyncedAt)).toBe(true);
    expect(state.writes.some((write) => write.table === "alliance_members")).toBe(false);
  });
  it("reconciles an uncertain prior PUT by verifying the remote value without a duplicate write", async () => {
    queue(); state.fetch.mockResolvedValueOnce(remote("R2"));
    expect(await syncComplianceAction("tenant", "action")).toBe("synced");
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it("never reports synchronized after failed PUT or failed verification", async () => {
    queue([[{ token: "lease", expiry: new Date(Date.now() + 180_000) }]]);
    state.fetch.mockResolvedValueOnce(remote("R3")).mockRejectedValueOnce(new Error("network"));
    expect(await syncComplianceAction("tenant", "action")).toBe("failed");
    expect(state.writes.some((write) => write.table === "member_alliance_rank_events")).toBe(false);
  });
  it("keeps wrong-alliance and newer upstream promotion conflicts unmodified", async () => {
    for (const response of [remote("R3", "active", "other"), remote("R4")]) {
      queue(); state.fetch.mockReset().mockResolvedValueOnce(response);
      expect(await syncComplianceAction("tenant", "action")).toBe("failed");
      expect(state.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("does not run Ashed requests when a newer local manual promotion exists", async () => {
    queue(); state.results[4] = [{ id: "new-promotion" }]; state.results[5] = [{ status: "failed" }];
    expect(await syncComplianceAction("tenant", "action")).toBe("failed");
    expect(state.resolve).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("retires a superseded mirror only with durable proof of newer synchronized authority", async () => {
    queue();
    state.results[4] = [{ id: "manual-2", rank: 2, ashedSyncedAt: new Date(), recordedAt: new Date() }];
    expect(await syncComplianceAction("tenant", "action")).toBe("failed");
    expect(state.writes.find((write) => write.table === "vs_compliance_sync_jobs")?.values).toMatchObject({ supersededBy: "rank:manual-2", supersededAt: expect.any(Date) });
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("does not invent successful completion when the durable sync job is missing", async () => {
    state.results = [[], []];
    expect(await syncComplianceAction("tenant", "action")).toBe("failed");
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("records credential recovery state without undoing locally recorded history", async () => {
    queue(); state.resolve.mockRejectedValue({ code: "credentials_required" });
    expect(await syncComplianceAction("tenant", "action")).toBe("credentials_required");
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("native settled jobs do not resolve Ashed or rewrite local rank", async () => {
    state.results = [[{ ...job, status: "local" }], [{ status: "local" }]];
    expect(await syncComplianceAction("tenant", "action")).toBe("local");
    expect(state.resolve).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
  it("does not fabricate a successful upstream removal from local former status", async () => {
    queue(); state.results[1] = [{ ...action, kind: "remove", expectedRank: 1, targetRank: null }]; state.results[2] = [{ allianceRank: 1, status: "former" }];
    state.fetch.mockResolvedValueOnce(remote("R1"));
    expect(await syncComplianceAction("tenant", "action")).toBe("failed");
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
});
