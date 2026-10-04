
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadVsAllianceLink: vi.fn(),
  resolveVsOpponentSyncContext: vi.fn(),
  revalidateVsOpponentSyncContext: vi.fn(async () => undefined),
  fetchAshedOpponentMeta: vi.fn(),
  findAshedWeekRecord: vi.fn(),
  createAshedOpponentMeta: vi.fn(),
  updateAshedOpponentMeta: vi.fn(),
  listPreviousVsOpponents: vi.fn(async (): Promise<unknown[]> => []),
  vsAshedSyncEligibility: vi.fn(async () => false),
  loadVsMatchupRowForUpdate: vi.fn(),
  loadVsMatchDayResultForUpdate: vi.fn(async () => null),
  ensureVsMatchupSyncRow: vi.fn(),
  upsertVsMatchup: vi.fn(),
  saveVsMatchDayResultTx: vi.fn(),
  loadVsPerformanceWeek: vi.fn(async () => ({ weekStart: "2026-09-28" })),
  writeTrainsOfficerAudit: vi.fn(async () => undefined),
  updateCalls: [] as Array<Record<string, unknown>>,
  txSelectDays: [] as unknown[],
  txAllianceRows: [] as unknown[],
}));

function updateBuilder() {
  return {
    set: (patch: Record<string, unknown>) => {
      mocks.updateCalls.push(patch);
      return {
        where: () =>
          Object.assign(Promise.resolve(undefined), {
            returning: async () => [{ matchupId: "m1" }],
          }),
      };
    },
  };
}

function fakeTx(schema: { vsMatchupAshedSync: unknown; alliances: unknown; vsMatchDayResults: unknown }) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          Object.assign(Promise.resolve(mocks.txSelectDays), {
            limit: async () =>
              table === schema.alliances
                ? mocks.txAllianceRows
                : mocks.txSelectDays,
            for: () => ({
              limit: async () =>
                table === schema.vsMatchupAshedSync
                  ? [syncRow()]
                  : mocks.txSelectDays,
            }),
          }),
      }),
    }),
    update: () => updateBuilder(),
    insert: () => ({
      values: () => ({ returning: async () => [{}] }),
    }),
  };
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    schema: actual.schema,
    getDb: () => ({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(fakeTx(actual.schema)),
      update: () => updateBuilder(),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: "m1" }] }),
        }),
      }),
    }),
  };
});

vi.mock("@/lib/vs-performance/ashed-opponent-sync.server", () => ({
  loadVsAllianceLink: mocks.loadVsAllianceLink,
  resolveVsOpponentSyncContext: mocks.resolveVsOpponentSyncContext,
  revalidateVsOpponentSyncContext: mocks.revalidateVsOpponentSyncContext,
  fetchAshedOpponentMeta: mocks.fetchAshedOpponentMeta,
  findAshedWeekRecord: mocks.findAshedWeekRecord,
  createAshedOpponentMeta: mocks.createAshedOpponentMeta,
  updateAshedOpponentMeta: mocks.updateAshedOpponentMeta,
  listPreviousVsOpponents: mocks.listPreviousVsOpponents,
  vsAshedSyncEligibility: mocks.vsAshedSyncEligibility,
}));

vi.mock("@/lib/vs-performance/match-results.repository.server", () => ({
  loadVsMatchupRowForUpdate: mocks.loadVsMatchupRowForUpdate,
  loadVsMatchDayResultForUpdate: mocks.loadVsMatchDayResultForUpdate,
  ensureVsMatchupSyncRow: mocks.ensureVsMatchupSyncRow,
  upsertVsMatchup: mocks.upsertVsMatchup,
  matchupOpponentInfo: (row: Record<string, unknown>) => ({
    opponentServer: row.opponentServer ?? null,
    opponentTag: row.opponentTag ?? null,
    opponentName: row.opponentName ?? null,
    opponentDailyScores:
      row.opponentDailyScores ?? [null, null, null, null, null, null],
    weekOutcome: row.weekOutcome ?? "pending",
  }),
}));

vi.mock("@/lib/vs-performance/match-results.server", () => ({
  saveVsMatchDayResultTx: mocks.saveVsMatchDayResultTx,
}));

vi.mock("@/lib/vs-performance/weekly-plan.server", () => ({
  loadVsPerformanceWeek: mocks.loadVsPerformanceWeek,
}));

vi.mock("@/lib/bff/officer-action-audit.server", () => ({
  writeTrainsOfficerAudit: mocks.writeTrainsOfficerAudit,
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  lockAllianceAvailability: vi.fn(async () => undefined),
}));

vi.mock("./vs-scope.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./vs-scope.server")>();
  return {
    ...actual,
    assertVsActorCurrent: vi.fn(async () => undefined),
    assertVsActorContextTx: vi.fn(async () => undefined),
    assertVsAshedLinkTx: vi.fn(async () => undefined),
  };
});

import {
  pullAshedOpponentInfo,
  syncAshedOpponentInfo,
} from "./matchup-sync.server";
import { vsOpponentConflictToken, vsScope } from "./vs-scope.server";
import type { AshedOpponentSnapshot } from "./opponent-info.shared";

const WEEK = "2026-09-28";
const actor = { sessionId: "s1", hqUserId: "u1", allianceId: "a1" };
const scope = () => vsScope(actor, WEEK);
const context = { connection: { token: "t" }, allianceId: "ashed-a" };

function remote(
  partial: Partial<AshedOpponentSnapshot> = {},
): AshedOpponentSnapshot {
  return {
    remoteId: "meta-1",
    allianceId: "ashed-a",
    weekStart: WEEK,
    opponentServer: 1236,
    opponentTag: "FOE",
    opponentName: "Opponent",
    opponentDailyScores: ["1", "2", "3", "4", "5", "6"],
    compatibilityScore: "0",
    weekOutcome: "loss" as const,
    sourceRevision: "2026-09-28T06:33:16.296000000Z",
    ...partial,
  };
}

function matchupRow(partial: Record<string, unknown> = {}) {
  return {
    id: "m1",
    allianceId: "a1",
    weekStart: WEEK,
    version: 3,
    opponentName: "Old",
    opponentTag: "OLD",
    opponentServer: 999,
    opponentDailyScores: [null, null, null, null, null, null],
    weekOutcome: "pending",
    reportedOurPoints: null,
    reportedOpponentPoints: null,
    externalCompetitionId: null,
    externalOpponentId: null,
    identitySource: "hq_manual",
    opponentInfoOwnedFields: [],
    ...partial,
  };
}

function syncRow(partial: Record<string, unknown> = {}) {
  const lease = [...mocks.updateCalls]
    .reverse()
    .find((patch) => "leaseToken" in patch);
  return {
    dirtyFields: [],
    baselineSnapshot: null,
    observedSnapshot: null,
    conflictFields: [],
    status: "idle",
    errorCode: null,
    leaseToken: (lease?.leaseToken as string | undefined) ?? null,
    leaseExpiresAt:
      (lease?.leaseExpiresAt as Date | undefined) ?? null,
    lastSyncedAt: null,
    ...partial,
  };
}

function statusWrites() {
  return mocks.updateCalls.filter((p) => "status" in p);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateCalls.length = 0;
  mocks.txSelectDays = [];
  mocks.txAllianceRows = [
    { ashedAllianceId: "ashed-a", operatingMode: "ashed" },
  ];
  mocks.loadVsAllianceLink.mockResolvedValue({
    ashedAllianceId: "ashed-a",
    operatingMode: "ashed",
  });
  mocks.resolveVsOpponentSyncContext.mockResolvedValue(context);
  mocks.loadVsMatchupRowForUpdate.mockResolvedValue(null);
  mocks.ensureVsMatchupSyncRow.mockImplementation(async () => syncRow());
  mocks.upsertVsMatchup.mockImplementation(async (_tx, input) => ({
    id: "m1",
    ...input,
  }));
  mocks.fetchAshedOpponentMeta.mockResolvedValue([]);
  mocks.fetchAshedOpponentMeta.mockResolvedValue([]);
});

describe("pullAshedOpponentInfo", () => {
  it("rejects when the alliance has no Ashed link", async () => {
    mocks.loadVsAllianceLink.mockResolvedValue(null);
    await expect(
      pullAshedOpponentInfo(actor, WEEK, scope()),
    ).rejects.toMatchObject({ code: "ashed_unavailable" });
  });

  it("records credentials_required when no connection resolves", async () => {
    mocks.resolveVsOpponentSyncContext.mockResolvedValue(null);
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    const payload = await pullAshedOpponentInfo(actor, WEEK, scope());
    expect(payload.weekStart).toBe(WEEK);
    expect(statusWrites().at(-1)).toMatchObject({
      status: "credentials_required",
      errorCode: "credentials_required",
    });
  });

  it("applies the remote record to unowned fields and marks synced", async () => {
    mocks.loadVsMatchupRowForUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValue(matchupRow({ identitySource: "ashed_import" }));
    mocks.fetchAshedOpponentMeta.mockResolvedValue([remote()]);
    await pullAshedOpponentInfo(actor, WEEK, scope());
    expect(mocks.upsertVsMatchup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentServer: 1236,
        weekOutcome: "loss",
        externalCompetitionId: "meta-1",
        identitySource: "ashed_import",
      }),
    );
    expect(statusWrites().at(-1)).toMatchObject({
      status: "synced",
      conflictFields: [],
    });
  });

  it("flags a conflict for a dirty local field the remote changed", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({
        opponentInfoOwnedFields: ["day:2"],
        opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
      }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ dirtyFields: ["day:2"], baselineSnapshot: remote() }),
    );
    mocks.fetchAshedOpponentMeta.mockResolvedValue([remote({ opponentDailyScores: ["1", "77", "3", "4", "5", "6"] })])
    await pullAshedOpponentInfo(actor, WEEK, scope());
    expect(mocks.updateAshedOpponentMeta).not.toHaveBeenCalled();
    const write = statusWrites().at(-1);
    expect(write).toMatchObject({ status: "conflict" });
    expect(write?.conflictFields).toEqual(["day:2"]);
  });
});

describe("syncAshedOpponentInfo", () => {
  it("falls back to a pull when no local matchup exists", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(null);
    mocks.fetchAshedOpponentMeta.mockResolvedValue([remote()]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.upsertVsMatchup).toHaveBeenCalled();
  });

  it("keeps the conflict state when no resolution is given", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({
        status: "conflict",
        observedSnapshot: remote(),
        conflictFields: ["day:2"],
      }),
    );
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.updateAshedOpponentMeta).not.toHaveBeenCalled();
    expect(statusWrites()).toHaveLength(0);
    expect(mocks.updateCalls.at(-1)).toMatchObject({
      leaseToken: null,
    });
  });

  it("rejects a stale conflict token", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({
        status: "conflict",
        observedSnapshot: remote(),
        conflictFields: ["day:2"],
      }),
    );
    await expect(
      syncAshedOpponentInfo(actor, {
        weekStart: WEEK,
        scope: scope(),
        resolution: "use_ashed",
        conflictToken: "bogus",
      }),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
  });

  it("applies observed remote values on use_ashed with a valid token", async () => {
    const observed = remote({
      opponentDailyScores: ["1", "77", "3", "4", "5", "6"],
    });
    const matchup = matchupRow({ version: 5 });
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchup);
    mocks.txSelectDays = [];
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({
        status: "conflict",
        observedSnapshot: observed,
        conflictFields: ["day:2"],
      }),
    );
    const token = vsOpponentConflictToken({
      remote: observed,
      matchupVersion: 5,
      days: [],
      fields: ["day:2"],
      scope: scope(),
    });
    mocks.fetchAshedOpponentMeta.mockResolvedValue([observed]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
      resolution: "use_ashed",
      conflictToken: token,
    });
    const matchupWrite = mocks.updateCalls.find((p) =>
      Array.isArray((p as { opponentDailyScores?: unknown }).opponentDailyScores),
    );
    expect(matchupWrite?.opponentDailyScores).toEqual([
      null,
      "77",
      null,
      null,
      null,
      null,
    ]);
  });

  it("pushes dirty fields when the remote still matches the baseline", async () => {
    const remoteRecord = remote();
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({
        opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
        opponentInfoOwnedFields: ["day:2"],
      }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({
        dirtyFields: ["day:2"],
        baselineSnapshot: remoteRecord,
      }),
    );
    mocks.fetchAshedOpponentMeta.mockImplementation(async () =>
      mocks.updateAshedOpponentMeta.mock.calls.length > 0
        ? [remote({ opponentDailyScores: ["1", "99", "3", "4", "5", "6"] })]
        : [remoteRecord],
    );
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.updateAshedOpponentMeta).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "ashed-a" }),
      "meta-1",
      { opponent_daily_scores: [1, 99, 3, 4, 5, 6, 0] },
    );
    expect(statusWrites().at(-1)).toMatchObject({
      status: "synced",
      conflictFields: [],
    });
  });

  it("records conflict instead of pushing when the remote moved", async () => {
    const remoteMoved = remote({
      opponentDailyScores: ["1", "77", "3", "4", "5", "6"],
    });
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({
        opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
      }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({
        dirtyFields: ["day:2"],
        baselineSnapshot: remote(),
      }),
    );
    mocks.fetchAshedOpponentMeta.mockResolvedValue([remoteMoved]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.updateAshedOpponentMeta).not.toHaveBeenCalled();
    const write = statusWrites().at(-1);
    expect(write).toMatchObject({ status: "conflict" });
    expect(write?.conflictFields).toEqual(["day:2"]);
  });

  it("creates a missing remote record once, then re-reads before marking synced", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentServer: 1236,
        opponentDailyScores: ["1", "2", "3", "4", "5", "6"],
        weekOutcome: "loss",
      }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ dirtyFields: ["opponentTag"] }),
    );
    mocks.fetchAshedOpponentMeta.mockImplementation(async () =>
      mocks.createAshedOpponentMeta.mock.calls.length > 0 ? [remote()] : [],
    );
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.createAshedOpponentMeta).toHaveBeenCalledTimes(1);
    expect(mocks.createAshedOpponentMeta).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "ashed-a" }),
      expect.objectContaining({
        alliance_id: "ashed-a",
        competition_date: WEEK,
        week_type: "normal",
      }),
    );
    expect(statusWrites().at(-1)).toMatchObject({ status: "synced" });
  });

  it("marks duplicate remote records as a conflict, not a write", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () => syncRow());
    mocks.fetchAshedOpponentMeta.mockResolvedValue([
      remote(),
      remote({ remoteId: "meta-2" }),
    ]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.updateAshedOpponentMeta).not.toHaveBeenCalled();
    expect(statusWrites().at(-1)).toMatchObject({
      status: "conflict",
      errorCode: "conflict",
    });
  });

  it("rejects a resolution when no conflict is recorded", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ status: "idle" }),
    );
    await expect(
      syncAshedOpponentInfo(actor, {
        weekStart: WEEK,
        scope: scope(),
        resolution: "keep_hq",
        conflictToken: "anything",
      }),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
    expect(mocks.updateAshedOpponentMeta).not.toHaveBeenCalled();
  });

  it("rejects both resolutions when the remote moved after the token", async () => {
    const observed = remote();
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({ version: 5 }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({
        status: "conflict",
        observedSnapshot: observed,
        conflictFields: ["day:2"],
      }),
    );
    const token = vsOpponentConflictToken({
      remote: observed,
      matchupVersion: 5,
      days: [],
      fields: ["day:2"],
      scope: scope(),
    });
    mocks.fetchAshedOpponentMeta.mockResolvedValue([remote({ opponentTag: "MOVED" })])
    for (const resolution of ["keep_hq", "use_ashed"] as const) {
      await expect(
        syncAshedOpponentInfo(actor, {
          weekStart: WEEK,
          scope: scope(),
          resolution,
          conflictToken: token,
        }),
      ).rejects.toMatchObject({ code: "stale", status: 409 });
    }
    expect(mocks.updateAshedOpponentMeta).not.toHaveBeenCalled();
  });

  it("keeps an uncertain create sticky without a second POST until refreshed", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ status: "uncertain", dirtyFields: ["opponentTag"] }),
    );
    mocks.fetchAshedOpponentMeta.mockResolvedValue([]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
      reason: "sync",
    });
    expect(mocks.createAshedOpponentMeta).not.toHaveBeenCalled();
    expect(statusWrites().at(-1)).toMatchObject({
      status: "uncertain",
    });
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
      reason: "refresh",
    });
    expect(mocks.createAshedOpponentMeta).not.toHaveBeenCalled();
    expect(statusWrites().at(-1)).toMatchObject({ status: "pending" });
  });

  it("binds an uncertain create when the record appears, without a POST", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({
        opponentName: "Opponent",
        opponentTag: "FOE",
        opponentServer: 1236,
        opponentDailyScores: ["1", "2", "3", "4", "5", "6"],
        weekOutcome: "loss",
      }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ status: "uncertain" }),
    );
    mocks.fetchAshedOpponentMeta.mockResolvedValue([remote()]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
      reason: "sync",
    });
    expect(mocks.createAshedOpponentMeta).not.toHaveBeenCalled();
    expect(statusWrites().at(-1)).toMatchObject({ status: "synced" });
  });

  it("does not mark a mismatched create read-back as synced", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(matchupRow());
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ dirtyFields: ["opponentTag"] }),
    );
    mocks.fetchAshedOpponentMeta.mockImplementation(async () =>
      mocks.createAshedOpponentMeta.mock.calls.length > 0
        ? [remote({ opponentTag: "OTHER", opponentServer: 999 })]
        : [],
    );
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.createAshedOpponentMeta).toHaveBeenCalledTimes(1);
    expect(statusWrites().at(-1)).toMatchObject({ status: "conflict" });
  });

  it("surfaces score_too_large without issuing a remote write", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(
      matchupRow({
        opponentDailyScores: [
          "9007199254740993",
          null,
          null,
          null,
          null,
          null,
        ],
      }),
    );
    mocks.ensureVsMatchupSyncRow.mockImplementation(async () =>
      syncRow({ dirtyFields: ["day:1"] }),
    );
    mocks.fetchAshedOpponentMeta.mockResolvedValue([]);
    await syncAshedOpponentInfo(actor, {
      weekStart: WEEK,
      scope: scope(),
    });
    expect(mocks.createAshedOpponentMeta).not.toHaveBeenCalled();
    expect(statusWrites().at(-1)).toMatchObject({
      status: "failed",
      errorCode: "score_too_large",
    });
  });
});
