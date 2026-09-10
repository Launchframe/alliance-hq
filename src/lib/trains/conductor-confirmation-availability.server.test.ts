import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reads: [] as unknown[][],
  update: vi.fn(),
  availability: vi.fn(),
  lock: vi.fn(),
  draft: vi.fn(),
  release: vi.fn(),
  audit: vi.fn(),
  roster: vi.fn(),
  summary: vi.fn(),
  lockAvailability: vi.fn(),
  conflicts: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const db = {
      select: () => {
        const query = {
          from: () => query,
          where: () => query,
          orderBy: () => query,
          limit: async () => mocks.reads.shift() ?? [],
          for: async () => mocks.reads.shift() ?? [],
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve(mocks.reads.shift() ?? [])),
        };
        return query;
      },
      update: () => ({ set: (values: unknown) => ({ where: () => { mocks.update(values); return { returning: async () => [{ id: "record-1" }] }; } }) }),
  };
  return { ...actual, getDb: () => ({ ...db, transaction: async <T>(work: (tx: typeof db) => Promise<T>): Promise<T> => work(db) }) };
});
vi.mock("@/lib/time-off/availability.server", () => ({ loadTimeOffAvailability: mocks.availability, lockAllianceAvailability: mocks.lockAvailability }));
vi.mock("@/lib/time-off/coverage.server", async (original) => ({ ...await original<object>(), findCoverageConflicts: mocks.conflicts }));
vi.mock("@/lib/trains/repository", () => ({ lockConductorRecord: mocks.lock, upsertConductorDraft: mocks.draft }));
vi.mock("@/lib/trains/pool", () => ({ getPoolSummary: mocks.summary, releasePoolSelectionForDate: mocks.release }));
vi.mock("@/lib/bff/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/members/roster.server", () => ({ listActiveAllianceMembersForPool: mocks.roster }));
vi.mock("@/lib/trains/service", () => ({ rollForConductor: vi.fn() }));

import { nominateConductorForDate, processConductorConfirmationTick } from "./conductor-confirmation.server";

const pending = {
  id: "record-1",
  allianceId: "alliance-1",
  date: "2099-06-20",
  conductorMemberId: "primary",
  conductorMemberName: "Primary",
  conductorNominationStatus: "pending_confirmation",
  successorAttempt: 0,
  updatedAt: new Date("2026-09-08T12:00:00Z"),
  lockedAt: null,
  successionSnapshot: [
    { memberId: "primary", memberName: "Primary" },
    { memberId: "away-successor", memberName: "Away" },
    { memberId: "available-successor", memberName: "Available" },
  ],
};

describe("conductor confirmation duty-date availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reads = [];
    mocks.conflicts.mockResolvedValue([]);
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set() });
    mocks.release.mockResolvedValue(undefined);
    mocks.summary.mockResolvedValue({ remaining: 0 });
    mocks.roster.mockResolvedValue([]);
  });

  it("preserves an away pending draft rather than forfeiting or replacing it", async () => {
    mocks.reads = [[{ ...pending, nominatedAt: new Date(0) }], []];
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set(["primary"]) });
    expect(await processConductorConfirmationTick()).toEqual({ forfeits: 0, fallbacks: 0, autoLocks: 0 });
    expect(mocks.availability).toHaveBeenCalledWith("alliance-1", "2099-06-20");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it("does not auto-lock a confirmed assignment that now needs coverage", async () => {
    mocks.reads = [[], [{ ...pending, conductorNominationStatus: "confirmed" }]];
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set(["primary"]) });
    expect((await processConductorConfirmationTick()).autoLocks).toBe(0);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("skips an away successor without rewriting the succession snapshot", async () => {
    mocks.reads = [[{ ...pending, nominatedAt: new Date() }], [pending], []];
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set(["away-successor"]) });
    expect((await processConductorConfirmationTick()).forfeits).toBe(1);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ conductorMemberId: "available-successor", successorAttempt: 2 }));
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("successionSnapshot");
  });

  it("uses only available R4 roster fallback candidates", async () => {
    mocks.reads = [[{ ...pending, nominatedAt: new Date(0) }], [pending], []];
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set(["away-r4"]) });
    mocks.roster.mockResolvedValue([
      { ashedMemberId: "away-r4", currentName: "Away", allianceRank: 4 },
      { ashedMemberId: "available-r5", currentName: "Available", allianceRank: 5 },
    ]);
    expect((await processConductorConfirmationTick()).fallbacks).toBe(1);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ conductorMemberId: "available-r5", conductorNominationStatus: "fallback_r4" }));
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it("does not report a fallback or release history when all leadership is away", async () => {
    mocks.reads = [[{ ...pending, nominatedAt: new Date(0) }], []];
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set(["away-r4"]) });
    mocks.roster.mockResolvedValue([{ ashedMemberId: "away-r4", currentName: "Away", allianceRank: 4 }]);
    expect((await processConductorConfirmationTick()).fallbacks).toBe(0);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it("does not open a confirmation window for an existing away draft", async () => {
    mocks.reads = [[{ trainConductorConfirmationEnabled: 1 }], [{ ...pending, conductorNominationStatus: null }]];
    mocks.availability.mockResolvedValue({ awayMemberIds: new Set(["primary"]) });
    expect(await nominateConductorForDate({ allianceId: "alliance-1", trainDate: "2099-06-20", trigger: { mode: "scheduled_reset", anchor: "day_before_train" } })).toMatchObject({ ok: false, reason: "coverage_conflict" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });
});
