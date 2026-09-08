import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ version: vi.fn(), lock: vi.fn(), external: vi.fn(), rebuild: vi.fn(), authorize: vi.fn(), retry: vi.fn(), results: [] as unknown[][], updates: [] as Record<string, unknown>[], inTransaction: false }));
vi.mock("server-only", () => ({}));
vi.mock("./evidence.server", () => ({ loadComplianceStateVersion: mocks.version, lockCompliance: mocks.lock, prepareExternalEvidence: mocks.external }));
vi.mock("./repository.server", () => ({ rebuildComplianceTx: mocks.rebuild, authorizeComplianceTx: mocks.authorize }));
vi.mock("./sync.server", () => ({ retryComplianceSync: mocks.retry }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = (rows: unknown[]) => { const value = Object.assign(Promise.resolve(rows), { from: () => value, where: () => value, orderBy: () => value, limit: () => value }); return value; };
  const tx = { execute: vi.fn(), select: () => chain(mocks.results.shift() ?? []), update: () => ({ set: (value: Record<string, unknown>) => { mocks.updates.push(value); return chain([]); } }) };
  return { schema, getDb: () => ({ ...tx, transaction: async (run: (db: typeof tx) => Promise<unknown>) => { mocks.inTransaction = true; try { return await run(tx); } finally { mocks.inTransaction = false; } } }) };
});
import { evaluateComplianceAlliance, runComplianceTick } from "./service.server";

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
  mocks.updates = []; mocks.results = []; mocks.inTransaction = false;
  mocks.version.mockResolvedValue(7); mocks.lock.mockResolvedValue({ inputVersion: 7, requestedFrom: "2026-08-16" });
  mocks.external.mockImplementation(async () => { expect(mocks.inTransaction).toBe(false); return { native: true, verifiedAt: null, weeks: new Map(), excuses: [] }; });
  mocks.rebuild.mockImplementation(async () => { expect(mocks.inTransaction).toBe(true); return { rows: [] }; });
  mocks.authorize.mockResolvedValue(undefined); mocks.retry.mockResolvedValue(0);
});
afterEach(() => vi.useRealTimers());

describe("bounded catch-up and snapshot revalidation", () => {
  it("prepares external evidence outside the transaction and rechecks authority inside it", async () => {
    const actor = { sessionId: "session", allianceId: "tenant", hqUserId: "officer", boundHqUserId: "officer" };
    const result = await evaluateComplianceAlliance("tenant", ["2026-09-13"], actor);
    expect(result.sourceReady).toBe(true);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), actor, "vs_compliance:read");
  });
  it("rejects a changed input version before persisting evaluations", async () => {
    mocks.lock.mockResolvedValue({ inputVersion: 8 });
    await expect(evaluateComplianceAlliance("tenant", ["2026-09-13"])).rejects.toMatchObject({ code: "changed", status: 409 });
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("rejects invalid or unfinished week identities without external I/O", async () => {
    for (const week of ["2026-09-14", "2026-09-20", "bad"]) await expect(evaluateComplianceAlliance("tenant", [week])).rejects.toMatchObject({ code: "invalid_week" });
    expect(mocks.external).not.toHaveBeenCalled();
  });
  it("advances only a four-week contiguous batch and keeps the next week queued", async () => {
    mocks.results = [[{ allianceId: "tenant", inputVersion: 7, requestedFrom: "2026-08-16" }]];
    expect(await runComplianceTick()).toEqual({ evaluated: 4, failed: 0, retried: 0 });
    expect(mocks.external).toHaveBeenCalledWith("tenant", ["2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06"]);
    expect(mocks.updates).toContainEqual(expect.objectContaining({ processedThrough: "2026-09-06", requestedFrom: "2026-09-13", lastError: null }));
  });
  it("keeps unavailable Ashed source work queued with visible failure rather than accepting an empty import", async () => {
    mocks.results = [[{ allianceId: "tenant", inputVersion: 7, requestedFrom: "2026-08-16" }]];
    mocks.external.mockResolvedValue({ native: false, verifiedAt: null, weeks: new Map(), excuses: [] });
    expect(await runComplianceTick()).toEqual({ evaluated: 0, failed: 1, retried: 0 });
    expect(mocks.updates).toContainEqual(expect.objectContaining({ lastError: "failed" }));
    expect(mocks.updates.some((update) => "processedThrough" in update)).toBe(false);
  });
});
