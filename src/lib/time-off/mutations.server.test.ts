import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  results: [] as Array<Array<Record<string, unknown>>>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const tx = {
    execute: vi.fn(),
    select: () => ({ from: () => ({ where: () => ({ limit: () => {
      const rows = state.results.shift() ?? [];
      return Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) });
    } }) }) }),
    insert: () => ({ values: (row: Record<string, unknown>) => {
      state.inserts.push(row);
      return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ ...row, cancelledAt: null }]) });
    } }),
    update: () => ({ set: (row: Record<string, unknown>) => {
      state.updates.push(row);
      return { where: () => ({ returning: () => Promise.resolve([row]) }) };
    } }),
  };
  return { schema, getDb: () => ({ transaction: (run: (db: typeof tx) => unknown) => run(tx) }) };
});

import { createTimeOff, updateTimeOff, cancelTimeOff, type TimeOffActor } from "./mutations.server";

const actor: TimeOffActor = {
  allianceId: "alliance-a",
  hqUserId: "user-a",
  canManageOthers: false,
  ownedCommanderIds: ["member-a"],
};
const draft = { ashedMemberId: "member-a", startDate: "2026-09-09", endDate: "2026-09-10", notes: "private" };
const entry = {
  ...draft,
  id: "entry-a",
  allianceId: "alliance-a",
  memberName: "Real name",
  entryKind: "planned",
  availability: "full_away",
  version: 2,
  globalAbsence: true,
  cancelledAt: null,
  createdAt: new Date("2026-09-08T12:00:00Z"),
  updatedAt: new Date("2026-09-08T12:00:00Z"),
  source: "web",
};

beforeEach(() => {
  state.results = [];
  state.inserts = [];
  state.updates = [];
});

describe("shared time-off mutations", () => {
  it("rejects anonymous, unrelated and officer-kind self-service creates before persistence", async () => {
    await expect(createTimeOff({ ...actor, hqUserId: null }, draft, "request-1234567890")).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(createTimeOff(actor, { ...draft, ashedMemberId: "other" }, "request-1234567890")).rejects.toMatchObject({ code: "forbidden" });
    await expect(createTimeOff(actor, { ...draft, entryKind: "unexpected" }, "request-1234567890")).rejects.toMatchObject({ code: "forbidden" });
    expect(state.inserts).toHaveLength(0);
  });

  it("uses the active tenant roster name and writes an immutable global-absence revision", async () => {
    state.results = [[], [{ name: "Real name", status: "active" }]];
    const created = await createTimeOff(actor, { ...draft, memberName: "Spoof", availability: "minimums", source: "officer" }, "request-1234567890");
    expect(created).toMatchObject({ memberName: "Real name", availability: "full_away", source: "web", version: 1, globalAbsence: true });
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[1]).toMatchObject({ allianceId: actor.allianceId, entryId: created.id, version: 1, recordedByHqUserId: actor.hqUserId });
    expect(state.inserts[1].snapshot).not.toHaveProperty("notes");
  });

  it("returns the original create result on delivery retry without another revision", async () => {
    state.results = [[], [{ name: "Real name", status: "active" }]];
    const first = await createTimeOff(actor, draft, "request-1234567890");
    state.results = [[state.inserts[0]]];
    const retry = await createTimeOff(actor, draft, "request-1234567890");
    expect(retry.id).toBe(first.id);
    expect(state.inserts).toHaveLength(2);
    state.results = [[state.inserts[0]]];
    await expect(createTimeOff(actor, { ...draft, endDate: "2026-09-11" }, "request-1234567890")).rejects.toMatchObject({ code: "staleEntry" });
  });

  it("rejects a missing or former roster member even for an officer", async () => {
    for (const roster of [[], [{ name: "Former", status: "former" }]]) {
      state.results = [[], roster];
      await expect(createTimeOff({ ...actor, canManageOthers: true }, draft, "request-1234567890")).rejects.toMatchObject({ code: "commanderUnavailable" });
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("does not allow changing an officer record into a self-service record", async () => {
    state.results = [[{ ...entry, entryKind: "officer_marked" }]];
    await expect(updateTimeOff(actor, entry.id, draft, 2)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    state.results = [[{ ...entry, entryKind: "unexpected" }]];
    await expect(cancelTimeOff(actor, entry.id, 2)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(state.updates).toHaveLength(0);
  });

  it("refreshes ownership and privilege before beginning a mutation", async () => {
    const revoked = { ...actor, ownedCommanderIds: [], canManageOthers: false };
    const stale = { ...actor, canManageOthers: true, refresh: async () => revoked };
    await expect(createTimeOff(stale, draft, "request-1234567890")).rejects.toMatchObject({ code: "forbidden" });
    state.results = [[entry]];
    await expect(cancelTimeOff(stale, entry.id, 2)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createTimeOff({ ...actor, refresh: async () => ({ ...actor, allianceId: "other" }) }, draft, "request-1234567890")).rejects.toMatchObject({ code: "forbidden" });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects stale versions and cross-commander rebinding without mutating", async () => {
    state.results = [[entry]];
    await expect(updateTimeOff(actor, entry.id, draft, 1)).rejects.toMatchObject({ code: "staleEntry", status: 409 });
    state.results = [[entry]];
    await expect(updateTimeOff({ ...actor, canManageOthers: true }, entry.id, { ...draft, ashedMemberId: "member-b" }, 2)).rejects.toMatchObject({ code: "forbidden" });
    state.results = [[]];
    await expect(cancelTimeOff(actor, "other-alliance-entry", 2)).rejects.toMatchObject({ code: "entryUnavailable", status: 404 });
    expect(state.updates).toHaveLength(0);
  });
});
