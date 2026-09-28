import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  matchupForUpdate: vi.fn(),
  loadVsObservation: vi.fn(),
  loadVsObservationById: vi.fn(),
  listVsObservationsForDate: vi.fn(async (): Promise<unknown[]> => []),
  loadVsMatchDayResultForUpdate: vi.fn(),
  insertVsObservation: vi.fn(),
  markVsObservationDisposition: vi.fn(),
  writeVsMatchDayResult: vi.fn(),
  upsertVsMatchup: vi.fn(),
  loadVsMatchupRowForUpdate: vi.fn(),
  writeAuditLog: vi.fn(async () => undefined),
  loadVsMatchup: vi.fn(async () => ({ id: "m1" })),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        select: () => ({
          from: () => ({
            where: () => ({ for: () => ({ limit: mocks.matchupForUpdate }) }),
          }),
        }),
        update: () => ({
          set: () => ({ where: async () => undefined }),
        }),
      }),
  }),
  schema: {
    vsMatchups: { id: "id", allianceId: "allianceId" },
    vsMatchDayResults: { id: "id" },
  },
}));

vi.mock("@/lib/time-off/availability.server", () => ({
  lockAllianceAvailability: vi.fn(async () => undefined),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/lib/vs-performance/match-results.repository.server", () => ({
  loadVsMatchup: mocks.loadVsMatchup,
  loadVsMatchDayResultForUpdate: mocks.loadVsMatchDayResultForUpdate,
  loadVsMatchupRowForUpdate: mocks.loadVsMatchupRowForUpdate,
  loadVsObservation: mocks.loadVsObservation,
  loadVsObservationById: mocks.loadVsObservationById,
  listVsObservationsForDate: mocks.listVsObservationsForDate,
  insertVsObservation: mocks.insertVsObservation,
  markVsObservationDisposition: mocks.markVsObservationDisposition,
  upsertVsMatchup: mocks.upsertVsMatchup,
  writeVsMatchDayResult: mocks.writeVsMatchDayResult,
}));

vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return { ...actual, getServerCalendarDate: () => "2099-06-15" };
});

import { createHash } from "node:crypto";

import {
  applyVerifiedVsMatchupSnapshot,
  resolveVsMatchConflict,
  saveVsMatchDayResult,
} from "./match-results.server";

const actor = {
  sessionId: "s1",
  hqUserId: "u1",
  allianceId: "a1",
};

const matchup = { id: "m1", allianceId: "a1", weekStart: "2099-06-08" };

const scope = createHash("sha256")
  .update(JSON.stringify(["s1", "u1", "a1", "2099-06-08"]))
  .digest("hex");

const savedHead = {
  id: "h1",
  recordedDate: "2099-06-08",
  ourScore: "100",
  opponentScore: "50",
  outcome: "won" as const,
  finality: "final" as const,
  source: "hq_manual" as const,
  sourceRef: null,
  hqConfirmed: 1,
  version: 1,
};

function baseInput() {
  return {
    actor,
    matchupId: "m1",
    recordedDate: "2099-06-08",
    expectedVersion: 0,
    requestId: "req-1",
    totals: { ourScore: "100", opponentScore: "50" },
    reportedOutcome: null,
    finality: "final" as const,
    scope,
    evidence: { kind: "hq_manual" as const },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.matchupForUpdate.mockResolvedValue([matchup]);
  mocks.loadVsObservation.mockResolvedValue(null);
  mocks.loadVsMatchDayResultForUpdate.mockResolvedValue(null);
  mocks.writeVsMatchDayResult.mockResolvedValue(savedHead);
});

describe("saveVsMatchDayResult", () => {
  it("writes head + applied observation and derives the outcome", async () => {
    const saved = await saveVsMatchDayResult(baseInput());
    expect(saved.outcome).toBe("won");
    expect(saved.totals).toEqual({ ourScore: "100", opponentScore: "50" });
    expect(mocks.writeVsMatchDayResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hqConfirmed: true }),
    );
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "applied" }),
    );
  });

  it("rejects a scope that does not match the matchup tenant/week", async () => {
    await expect(
      saveVsMatchDayResult({ ...baseInput(), scope: "other:2099-06-08" }),
    ).rejects.toThrow("stale");
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
  });

  it("rejects a scope minted by a different session of the same alliance", async () => {
    const otherSessionScope = createHash("sha256")
      .update(JSON.stringify(["s2", "u1", "a1", "2099-06-08"]))
      .digest("hex");
    await expect(
      saveVsMatchDayResult({ ...baseInput(), scope: otherSessionScope }),
    ).rejects.toThrow("stale");
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
  });

  it("is idempotent: same requestId + same payload returns the head", async () => {
    await saveVsMatchDayResult(baseInput());
    const inserted = mocks.insertVsObservation.mock.calls[0]![1] as {
      contentHash: string;
      source: string;
    };
    vi.clearAllMocks();
    mocks.matchupForUpdate.mockResolvedValue([matchup]);
    mocks.loadVsObservation.mockResolvedValue(inserted);
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue(savedHead);
    const replayed = await saveVsMatchDayResult(baseInput());
    expect(replayed.id).toBe("h1");
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
    expect(mocks.insertVsObservation).not.toHaveBeenCalled();
  });

  it("rejects same requestId with a different payload", async () => {
    mocks.loadVsObservation.mockResolvedValue({
      contentHash: "different-hash",
      source: "hq_manual",
    });
    await expect(saveVsMatchDayResult(baseInput())).rejects.toThrow("stale");
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
  });

  it("rejects future recorded dates", async () => {
    await expect(
      saveVsMatchDayResult({ ...baseInput(), recordedDate: "2099-06-15" }),
    ).rejects.toThrow("invalid");
  });
});

describe("applyVerifiedVsMatchupSnapshot", () => {
  beforeEach(() => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue(null);
    mocks.upsertVsMatchup.mockResolvedValue({ id: "m1" });
  });

  it("writes ashed_import heads when no HQ-confirmed row exists", async () => {
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: { name: "FOE", tag: "F1" },
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
        },
      ],
    });
    expect(mocks.writeVsMatchDayResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "ashed_import",
        hqConfirmed: false,
      }),
    );
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "applied" }),
    );
  });

  it("keeps HQ-confirmed head and records a conflict observation", async () => {
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue(savedHead);
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
        },
      ],
    });
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "conflict" }),
    );
  });

  it("is idempotent: identical import observation is skipped", async () => {
    mocks.loadVsObservation.mockResolvedValue({ id: "o1" });
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      opponentName: null,
      opponentTag: null,
      externalOpponentId: null,
      externalCompetitionId: null,
      identitySource: "ashed_import",
      version: 3,
    });
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
        },
      ],
    });
    expect(mocks.upsertVsMatchup).not.toHaveBeenCalled();
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
    expect(mocks.insertVsObservation).not.toHaveBeenCalled();
  });

  it("rejects an upstream opponent identity change", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      externalOpponentId: "ext-1",
    });
    await expect(
      applyVerifiedVsMatchupSnapshot(actor, {
        weekStart: "2099-06-08",
        opponent: { externalId: "ext-2" },
        days: [],
      }),
    ).rejects.toThrow("opponentMismatch");
  });

  it("keeps HQ-owned identity after a later import learns external ids", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      opponentName: "HQ Name",
      opponentTag: "HQT",
      externalOpponentId: "ext-1",
      externalCompetitionId: null,
      identitySource: "hq_manual",
      version: 2,
    });
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: { name: "Upstream", tag: "UP", externalId: "ext-1", competitionId: "comp-9" },
      days: [],
    });
    expect(mocks.upsertVsMatchup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        opponentName: "HQ Name",
        opponentTag: "HQT",
        identitySource: "hq_manual",
      }),
    );
  });

  it("applies A->B->A when the returning snapshot has a newer source revision", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      opponentName: null,
      opponentTag: null,
      externalOpponentId: null,
      externalCompetitionId: null,
      identitySource: "ashed_import",
      version: 3,
    });
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue({
      ...savedHead,
      ourScore: "9",
      opponentScore: "9",
      outcome: "pending",
      source: "ashed_import",
      hqConfirmed: 0,
      sourceRevision: "2099-06-09T00:00:00.000000000Z",
      version: 4,
    });
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
          sourceUpdatedAt: "2099-06-10T00:00:00Z",
        },
      ],
    });
    expect(mocks.writeVsMatchDayResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "ashed_import",
        expectedVersion: 4,
      }),
    );
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "applied" }),
    );
  });

  it("supersedes an import older than the head revision and cannot overwrite", async () => {
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue({
      ...savedHead,
      source: "ashed_import",
      hqConfirmed: 0,
      sourceRevision: "2099-06-10T00:00:00.000000000Z",
    });
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "5", opponentScore: "5" },
          reportedOutcome: null,
          finality: "final",
          sourceUpdatedAt: "2099-06-09T00:00:00Z",
        },
      ],
    });
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "superseded" }),
    );
  });

  it("fails closed to conflict when an upstream-owned head differs and revisions cannot be ordered", async () => {
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue({
      ...savedHead,
      ourScore: "9",
      opponentScore: "9",
      outcome: "pending",
      source: "ashed_import",
      hqConfirmed: 0,
      sourceRevision: null,
    });
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
        },
      ],
    });
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "conflict" }),
    );
  });

  it("supersedes an import older than an already-seen import revision on an HQ head", async () => {
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue(savedHead);
    mocks.listVsObservationsForDate.mockResolvedValue([
      {
        id: "o-old",
        source: "ashed_import",
        disposition: "superseded",
        sourceRevision: "2099-06-10T00:00:00.000000000Z",
        contentHash: "other",
      },
    ]);
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
          sourceUpdatedAt: "2099-06-09T00:00:00Z",
        },
      ],
    });
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "superseded" }),
    );
  });

  it("records a conflict for a newer import after an older observation was superseded", async () => {
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue(savedHead);
    mocks.listVsObservationsForDate.mockResolvedValue([
      {
        id: "o-old",
        source: "ashed_import",
        disposition: "superseded",
        sourceRevision: "2099-06-09T00:00:00.000000000Z",
        contentHash: "other",
      },
    ]);
    await applyVerifiedVsMatchupSnapshot(actor, {
      weekStart: "2099-06-08",
      opponent: {},
      days: [
        {
          recordedDate: "2099-06-08",
          totals: { ourScore: "1", opponentScore: "2" },
          reportedOutcome: null,
          finality: "final",
          sourceUpdatedAt: "2099-06-10T00:00:00Z",
        },
      ],
    });
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "conflict" }),
    );
  });

  it("rejects source revisions that are not canonical Z ISO or exceed 9 fractional digits", async () => {
    await expect(
      applyVerifiedVsMatchupSnapshot(actor, {
        weekStart: "2099-06-08",
        opponent: {},
        days: [
          {
            recordedDate: "2099-06-08",
            totals: { ourScore: "1", opponentScore: "2" },
            reportedOutcome: null,
            finality: "final",
            sourceUpdatedAt: "2099-06-09T00:00:00.1234567890Z",
          },
        ],
      }),
    ).rejects.toThrow("invalid");
    await expect(
      applyVerifiedVsMatchupSnapshot(actor, {
        weekStart: "2099-06-08",
        opponent: {},
        days: [
          {
            recordedDate: "2099-06-08",
            totals: { ourScore: "1", opponentScore: "2" },
            reportedOutcome: null,
            finality: "final",
            sourceUpdatedAt: "2099-06-09 00:00:00",
          },
        ],
      }),
    ).rejects.toThrow("invalid");
  });
});

describe("resolveVsMatchConflict", () => {
  const observation = {
    id: "o1",
    matchupId: "m1",
    recordedDate: "2099-06-08",
    disposition: "conflict",
    recordedAt: new Date("2099-06-10"),
    sourceRef: "ref-1",
    snapshot: {
      totals: { ourScore: "1", opponentScore: "2" },
      outcome: "lost" as const,
      finality: "final" as const,
    },
  };

  beforeEach(() => {
    mocks.loadVsObservationById.mockResolvedValue(observation);
    mocks.loadVsMatchDayResultForUpdate.mockResolvedValue(savedHead);
  });

  it("keep_hq records a review observation without touching the head", async () => {
    mocks.listVsObservationsForDate.mockResolvedValue([observation]);
    await resolveVsMatchConflict(actor, "o1", {
      action: "keep_hq",
      nativeVersion: 1,
      scope,
    });
    expect(mocks.writeVsMatchDayResult).not.toHaveBeenCalled();
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "reviewed_keep_hq" }),
    );
    expect(mocks.markVsObservationDisposition).toHaveBeenCalledWith(
      expect.anything(),
      "o1",
      "superseded",
    );
  });

  it("use_ashed confirms the imported snapshot as the head", async () => {
    mocks.listVsObservationsForDate.mockResolvedValue([observation]);
    mocks.writeVsMatchDayResult.mockResolvedValue({
      ...savedHead,
      outcome: "lost",
      source: "ashed_import",
      version: 2,
    });
    const saved = await resolveVsMatchConflict(actor, "o1", {
      action: "use_ashed",
      nativeVersion: 1,
      scope,
    });
    expect(mocks.writeVsMatchDayResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "ashed_import",
        hqConfirmed: true,
      }),
    );
    expect(mocks.insertVsObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disposition: "reviewed_use_ashed" }),
    );
    expect(saved.outcome).toBe("lost");
  });

  it("fails when the head version moved since review", async () => {
    mocks.listVsObservationsForDate.mockResolvedValue([observation]);
    await expect(
      resolveVsMatchConflict(actor, "o1", {
        action: "keep_hq",
        nativeVersion: 99,
        scope,
      }),
    ).rejects.toThrow("stale");
  });

  it("fails when a newer observation already resolved the date", async () => {
    mocks.listVsObservationsForDate.mockResolvedValue([
      observation,
      { ...observation, id: "o2", disposition: "reviewed_keep_hq" },
    ]);
    await expect(
      resolveVsMatchConflict(actor, "o1", {
        action: "keep_hq",
        nativeVersion: 1,
        scope,
      }),
    ).rejects.toThrow("stale");
  });
});
