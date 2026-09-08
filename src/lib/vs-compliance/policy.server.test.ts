import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVsPolicy } from "./policy.shared";

const state = vi.hoisted(() => ({ results: [] as Record<string, unknown>[][], inserts: [] as Record<string, unknown>[], locks: [] as string[], activeTransaction: false, authorize: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./access.server", () => ({ requireVsComplianceAccess: (...args: unknown[]) => {
  expect(state.activeTransaction).toBe(false);
  return state.authorize(...args);
} }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const db = {
    select: () => {
      const rows = state.results.shift() ?? [];
      const chain = Object.assign(Promise.resolve(rows), {
        from: () => chain, where: () => chain, innerJoin: () => chain, limit: () => chain, orderBy: () => chain,
        for: (lock: string) => { state.locks.push(lock); return chain; },
      });
      return chain;
    },
    insert: () => ({ values: (row: Record<string, unknown>) => {
      state.inserts.push(row);
      return { returning: async () => [row] };
    } }),
  };
  return { schema, getDb: () => ({ ...db, transaction: async (run: (tx: typeof db) => Promise<unknown>) => {
    state.activeTransaction = true;
    try { return await run(db); } finally { state.activeTransaction = false; }
  } }) };
});
import { loadVsMembershipSettings, saveVsMembershipSettings } from "./policy.server";

const now = new Date("2026-09-08T12:00:00.000Z");
const actor = { sessionId: "session", allianceId: "alliance", hqUserId: "user", boundHqUserId: "user" };
const existing = { ...defaultVsPolicy(), enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", effectiveWeek: "2026-09-20", version: 1, createdByHqUserId: "other-owner", id: "old" };
function authorizedRows(policies: Record<string, unknown>[] = []) {
  return [[{ hqUserId: "user", expiresAt: new Date("2027-01-01T00:00:00Z") }], [{ id: "alliance" }], [{ id: "user", isPlatformMaintainer: 0 }], [{ roleName: "owner", permissionId: "vs_compliance:settings" }], policies];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.results = [];
  state.inserts = [];
  state.locks = [];
  state.activeTransaction = false;
  state.authorize.mockResolvedValue(actor);
});

describe("versioned policy persistence", () => {
  it("creates only an explicitly enabled, future-effective version under an alliance lock", async () => {
    state.results = authorizedRows();
    const saved = await saveVsMembershipSettings("session", "alliance", { expectedVersion: 0, patch: { weeklyMinimum: 40_000_000, enabled: true } }, () => now);
    expect(saved).toMatchObject({ version: 1, effectiveWeek: "2026-09-20", enabled: true, dailyTarget: 7_200_000 });
    expect(state.locks).toEqual(["share", "update", "share", "share"]);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({ allianceId: "alliance", createdByHqUserId: "user", version: 1 });
    expect(saved).not.toHaveProperty("createdByHqUserId");
  });

  it("appends a new version and preserves omitted values without updating historical rows", async () => {
    state.results = authorizedRows([existing]);
    const saved = await saveVsMembershipSettings("session", "alliance", { expectedVersion: 1, patch: { leewayPct: 5 } }, () => now);
    expect(saved).toMatchObject({ version: 2, preset: "consecutive", weeklyMinimum: 40_000_000, leewayPct: 5 });
    expect(existing).toMatchObject({ leewayPct: 0, version: 1 });
    expect(state.inserts).toHaveLength(1);
  });

  it("rejects stale PATCH and parallel double-submit rather than silently overwriting", async () => {
    state.results = authorizedRows([existing]);
    await expect(saveVsMembershipSettings("session", "alliance", { expectedVersion: 0, patch: { leewayPct: 5 } }, () => now)).rejects.toMatchObject({ code: "changed", status: 409 });
    expect(state.inserts).toHaveLength(0);
  });

  it.each([null, -1, 0.1, "0"])("requires a valid expected version %s", async (expectedVersion) => {
    await expect(saveVsMembershipSettings("session", "alliance", { expectedVersion, patch: {} }, () => now)).rejects.toMatchObject({ code: "invalid_policy" });
    expect(state.inserts).toHaveLength(0);
  });

  it("rechecks revoked permissions and rebound/expired sessions on the transaction connection", async () => {
    const revoked = authorizedRows();
    revoked[3] = [];
    const rebound = authorizedRows();
    rebound[0] = [{ hqUserId: "someone-else", expiresAt: new Date("2027-01-01") }];
    const expired = authorizedRows();
    expired[0] = [{ hqUserId: "user", expiresAt: new Date("2026-01-01") }];
    for (const rows of [revoked, rebound, expired]) {
      state.results = rows;
      await expect(saveVsMembershipSettings("session", "alliance", { expectedVersion: 0, patch: {} }, () => now)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("uses the clock after lock acquisition so a waiting PATCH cannot backdate a new policy week", async () => {
    state.results = authorizedRows();
    const clock = vi.fn().mockReturnValueOnce(new Date("2026-09-14T01:59:59.999Z")).mockReturnValue(new Date("2026-09-14T02:00:00.000Z"));
    const saved = await saveVsMembershipSettings("session", "alliance", { expectedVersion: 0, patch: { enabled: true, weeklyMinimum: 40_000_000 } }, clock);
    expect(saved.effectiveWeek).toBe("2026-09-27");
  });

  it("denies an ordinary officer with an accidentally granted settings permission", async () => {
    state.results = authorizedRows();
    state.results[3] = [{ roleName: "officer", permissionId: "vs_compliance:settings" }];
    await expect(saveVsMembershipSettings("session", "alliance", { expectedVersion: 0, patch: {} }, () => now)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("scopes authorized reads and projects only policy settings, never actor or private metadata", async () => {
    state.results = [[existing]];
    const result = await loadVsMembershipSettings("session", "alliance");
    expect(state.authorize).toHaveBeenCalledWith("session", "alliance", "vs_compliance:read");
    expect(result.history).toHaveLength(1);
    expect(result.latest).toMatchObject({ version: 1, weeklyMinimum: 40_000_000 });
    expect(JSON.stringify(result)).not.toContain("other-owner");
    expect(result.latest).not.toHaveProperty("id");
  });
});
