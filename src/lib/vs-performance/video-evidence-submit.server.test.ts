import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobRows: [] as Record<string, unknown>[],
  allianceRows: [] as Record<string, unknown>[],
  groupRows: [] as Record<string, unknown>[],
  evidenceRows: [] as Record<string, unknown>[],
  receiptRows: [] as Record<string, unknown>[],
  inserted: [] as { table: string; values: Record<string, unknown> }[],
  updateCalls: [] as Record<string, unknown>[],
  applyVsCaptureReviewTx: vi.fn(),
  saveVsMatchupIdentityTx: vi.fn(),
  commitReviewedVsScoresTx: vi.fn(),
  loadVsMatchupRowForUpdate: vi.fn(),
  loadVsVideoEvidence: vi.fn(),
  loadVsVideoEvidenceRow: vi.fn(),
  vsVideoDefaultContext: vi.fn(() => ({
    recordedDate: "2026-09-29",
    period: "daily" as const,
  })),
  assertVsActorContextTx: vi.fn(async () => {}),
  lockAllianceAvailability: vi.fn(async () => {}),
  sessionHasPermissionForAlliance: vi.fn(),
  attemptVsOpponentSync: vi.fn(async () => null),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const rowsFor = (table: unknown) =>
    table === actual.schema.videoJobs
      ? mocks.jobRows
      : table === actual.schema.alliances
        ? mocks.allianceRows
        : table === actual.schema.videoUploadGroups
          ? mocks.groupRows
          : table === actual.schema.videoVsEvidence
            ? mocks.evidenceRows
            : table === actual.schema.videoVsEvidenceReceipts
              ? mocks.receiptRows
              : [];
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => rowsFor(table).slice(0, 1),
          for: () => ({ limit: async () => rowsFor(table).slice(0, 1) }),
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          mocks.updateCalls.push(set);
          const row = mocks.evidenceRows[0];
          if (row) {
            for (const [key, value] of Object.entries(set)) {
              row[key] =
                key === "version" && typeof value !== "number"
                  ? ((row.version as number) ?? 0) + 1
                  : value;
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const name =
          table === actual.schema.videoVsEvidenceReceipts
            ? "receipts"
            : table === actual.schema.auditLog
              ? "audit"
              : "other";
        if (name === "receipts") mocks.receiptRows.push(values);
        return Promise.resolve(
          mocks.inserted.push({ table: name, values }),
        );
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeDb),
  };
  return { schema: actual.schema, getDb: () => fakeDb };
});

vi.mock("@/lib/vs-performance/vs-capture.server", () => ({
  applyVsCaptureReviewTx: mocks.applyVsCaptureReviewTx,
}));
vi.mock("@/lib/vs-performance/match-results.server", () => ({
  saveVsMatchupIdentityTx: mocks.saveVsMatchupIdentityTx,
}));
vi.mock("@/lib/vs-performance/match-results.repository.server", () => ({
  loadVsMatchupRowForUpdate: mocks.loadVsMatchupRowForUpdate,
}));
vi.mock("@/lib/vs-scores/repository.server", () => ({
  commitReviewedVsScoresTx: mocks.commitReviewedVsScoresTx,
}));
vi.mock("@/lib/vs-performance/video-evidence.server", () => ({
  loadVsVideoEvidence: mocks.loadVsVideoEvidence,
  loadVsVideoEvidenceRow: mocks.loadVsVideoEvidenceRow,
  vsVideoDefaultContext: mocks.vsVideoDefaultContext,
  vsVideoScopeKey: (job: { id: string; groupId: string | null }) =>
    job.groupId ? `group:${job.groupId}` : `job:${job.id}`,
}));
vi.mock("@/lib/vs-performance/vs-scope.server", () => ({
  assertVsActorContextTx: mocks.assertVsActorContextTx,
  vsScope: () => "scope:week",
}));
vi.mock("@/lib/time-off/availability.server", () => ({
  lockAllianceAvailability: mocks.lockAllianceAvailability,
}));
vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: mocks.sessionHasPermissionForAlliance,
}));
vi.mock("@/lib/vs-performance/matchup-sync.server", () => ({
  attemptVsOpponentSync: mocks.attemptVsOpponentSync,
}));

import {
  applyVsVideoMatchSubmissionTx,
  commitVsVideoSubmission,
  saveVsVideoMatchOnly,
} from "./video-evidence-submit.server";
import { vsVideoDraftSchema } from "./video-evidence.shared";
import { VsPerformanceError } from "./weekly-plan.shared";
import { getDb } from "@/lib/db";
import type { VsVideoAccess } from "./video-evidence.server";
import type { VsVideoMatchSubmission } from "./video-evidence.shared";

const job = {
  id: "job-1",
  groupId: null,
  scoreTarget: "vs-performance",
  category: "vs-performance",
  status: "review",
  allianceId: "a1",
  recordedDate: "2026-09-29",
};

const access: VsVideoAccess = {
  actor: { sessionId: "sess-1", hqUserId: "u1", allianceId: "a1" },
  job: job as never,
  scopeKey: "job:job-1",
};

const context = { recordedDate: "2026-09-29", period: "daily" as const };

function tx() {
  return getDb() as never;
}

const baseEvidence = {
  scopeKey: "job:job-1",
  allianceId: "a1",
  jobId: "job-1",
  recordedDate: "2026-09-29",
  period: "daily",
  version: 3,
  imageVersion: 2,
  requestedKind: "auto",
  status: "ready",
  storageKey: "videos/job-1/vs-match/abc/sealed",
  imageSha256: "sha",
  candidate: { kind: "daily_totals" },
  draft: { includeResults: true, submission: null },
  appliedImageVersion: null,
};

const dailyReview = {
  kind: "daily_totals",
  weekStart: "2026-09-28",
  ourSide: "left",
  confirmSides: true,
  left: { server: 1203, tag: "LFgo", name: null },
  right: { server: 1236, tag: "TriV", name: null },
  day: 2,
  leftScore: "2241713380",
  rightScore: "2222858900",
  finalDay: true,
} as const;

function submission(
  data: VsVideoMatchSubmission["data"],
  extra: Partial<VsVideoMatchSubmission> = {},
): VsVideoMatchSubmission {
  return {
    evidenceVersion: 3,
    expectedMatchupVersion: 0,
    expectedDayVersions: { "2026-09-29": 0 },
    editOpponent: false,
    data,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobRows.length = 0;
  mocks.allianceRows.length = 0;
  mocks.groupRows.length = 0;
  mocks.evidenceRows.length = 0;
  mocks.receiptRows.length = 0;
  mocks.inserted.length = 0;
  mocks.updateCalls.length = 0;
  mocks.jobRows.push({ ...job });
  mocks.allianceRows.push({ id: "a1", ashedAllianceId: null });
  mocks.evidenceRows.push({ ...baseEvidence });
  mocks.loadVsMatchupRowForUpdate.mockResolvedValue(null);
  mocks.applyVsCaptureReviewTx.mockResolvedValue({
    weekStart: "2026-09-28",
    savedDays: ["2026-09-29"],
  });
  mocks.saveVsMatchupIdentityTx.mockResolvedValue({ identityChanged: true });
  mocks.commitReviewedVsScoresTx.mockResolvedValue({
    replayed: false,
    submitted: 2,
    batchId: "b1",
    vsRevision: 1,
    syncStatus: "local",
  });
  mocks.sessionHasPermissionForAlliance.mockImplementation(
    async () => true,
  );
  mocks.loadVsVideoEvidenceRow.mockResolvedValue({ ...baseEvidence });
  mocks.loadVsVideoEvidence.mockResolvedValue({ evidence: {} });
});

describe("applyVsVideoMatchSubmissionTx — screenshot source", () => {
  const screenshotInput = () =>
    submission({
      source: "screenshot",
      imageVersion: 2,
      review: dailyReview as never,
    });

  it("applies a confirmed daily capture and consumes the draft + generation", async () => {
    const result = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      screenshotInput(),
      "req-12345678",
    );
    expect(mocks.applyVsCaptureReviewTx).toHaveBeenCalledWith(
      expect.anything(),
      access.actor,
      dailyReview,
      {
        expectedMatchupVersion: 0,
        expectedDayVersions: { "2026-09-29": 0 },
        requestId: "req-12345678",
        scope: "scope:week",
        sourceRef: "video:job:job-1:2",
        allowOpponentIdentityChange: false,
      },
    );
    expect(result).toMatchObject({
      weekStart: "2026-09-28",
      recordedDate: "2026-09-29",
      period: "daily",
      imageVersion: 2,
      appliedImageVersion: 2,
      savedDays: ["2026-09-29"],
      replayed: false,
    });
    expect(mocks.updateCalls[0].draft).toBeNull();
    expect(mocks.updateCalls[0].appliedImageVersion).toBe(2);
    expect(typeof mocks.updateCalls[0].version).not.toBe("number");
    expect(mocks.evidenceRows[0].version).toBe(4);
    expect(mocks.receiptRows[0]).toMatchObject({
      scopeKey: "job:job-1",
      requestId: "req-12345678",
    });
    expect((mocks.receiptRows[0].result as { replayed?: boolean }).replayed).toBe(false);
    const audit = mocks.inserted.find((row) => row.table === "audit");
    expect(audit?.values).toMatchObject({
      action: "vs.video_match_submit",
      resourceId: "job-1",
      sessionId: access.actor.sessionId,
      severity: "update",
    });
    expect(JSON.stringify(audit?.values)).not.toContain("sealed");
  });

  it("retains an unapplied draft for a non-final daily review", async () => {
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({
        source: "screenshot",
        imageVersion: 2,
        review: { ...dailyReview, finalDay: false } as never,
      }),
      "req-nonfinal",
    );
    expect(mocks.updateCalls[0].draft).toBeUndefined();
    expect(mocks.updateCalls[0].appliedImageVersion).toBeUndefined();
    expect(mocks.evidenceRows[0].draft).not.toBeNull();
  });

  it("marks weekly reviews fully applied", async () => {
    mocks.evidenceRows[0] = {
      ...baseEvidence,
      recordedDate: "2026-10-04",
      period: "weekly",
      candidate: { kind: "weekly_overview" },
    };
    const weeklyContext = { recordedDate: "2026-10-04", period: "weekly" as const };
    const result = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      weeklyContext,
      submission({
        source: "screenshot",
        imageVersion: 2,
        review: {
          kind: "weekly_overview",
          weekStart: "2026-09-28",
          ourSide: "left",
          confirmSides: true,
          left: { server: 1203, tag: null, name: null },
          right: { server: 1236, tag: null, name: null },
          leftPoints: 3,
          rightPoints: 0,
          dayResults: [1, 2, 3, 4, 5, 6].map((day) => ({
            day,
            winner: "unknown",
          })),
        } as never,
      }),
      "req-weekly",
    );
    expect(result.appliedImageVersion).toBe(2);
    expect(mocks.updateCalls[0].draft).toBeNull();
  });

  it("rejects a day/week mismatch between context and review", async () => {
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        { recordedDate: "2026-09-30", period: "daily" },
        screenshotInput(),
        "req-mismatch",
      ),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({
          source: "screenshot",
          imageVersion: 2,
          review: { ...dailyReview, day: 3 } as never,
        }),
        "req-daymismatch",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("requires a ready sealed image and matching generation and kind", async () => {
    mocks.evidenceRows[0].status = "queued";
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        screenshotInput(),
        "req-notready",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    mocks.evidenceRows[0].status = "ready";
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({
          source: "screenshot",
          imageVersion: 9,
          review: dailyReview as never,
        }),
        "req-stalegen",
      ),
    ).rejects.toMatchObject({ code: "stale" });
    mocks.evidenceRows[0].candidate = { kind: "weekly_overview" };
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        screenshotInput(),
        "req-kindmismatch",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("applyVsVideoMatchSubmissionTx — version checks and replay", () => {
  it("rejects stale evidence and matchup versions", async () => {
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({ source: "manual", opponentScore: "100" }, { evidenceVersion: 9 }),
        "req-evstale",
      ),
    ).rejects.toMatchObject({ code: "stale" });
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({ id: "m1", version: 4 });
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({ source: "manual", opponentScore: "100" }, { expectedMatchupVersion: 2 }),
        "req-mstale",
      ),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("replays the same request result and rejects a different body with the same request id", async () => {
    const input = submission({
      source: "manual",
      opponentScore: "2222858900",
    });
    const first = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      input,
      "req-same",
    );
    expect(first.replayed).toBe(false);
    const second = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      input,
      "req-same",
    );
    expect(second.replayed).toBe(true);
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenCalledTimes(1);
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({ source: "manual", opponentScore: "999" }),
        "req-same",
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect(mocks.evidenceRows[0].version).toBe(4);
    expect(mocks.receiptRows).toHaveLength(1);
  });
});

describe("applyVsVideoMatchSubmissionTx — manual source", () => {
  it("fills omitted opponent identity from the matchup and never invents scores", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 0,
      opponentName: "Trinity Vanguard",
      opponentTag: "TriV",
      opponentServer: 1236,
      opponentDailyScores: ["123", null, null, null, null, null],
    });
    const result = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({
        source: "manual",
        opponentScore: "2222858900",
      }),
      "req-manual",
    );
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenCalledWith(
      expect.anything(),
      access.actor,
      {
        weekStart: "2026-09-28",
        opponentName: "Trinity Vanguard",
        opponentTag: "TriV",
        opponentServer: 1236,
        opponentScores: [{ day: 2, score: "2222858900" }],
        expectedVersion: 0,
        scope: "scope:week",
      },
    );
    expect(result.savedDays).toEqual([]);
    expect(result.replayed).toBe(false);
  });

  it("omits the opponent score entry when it matches the stored value", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 0,
      opponentDailyScores: ["123", "2222858900", null, null, null, null],
    });
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({ source: "manual", opponentScore: "2222858900" }),
      "req-samescore",
    );
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenCalledWith(
      expect.anything(),
      access.actor,
      expect.objectContaining({ opponentScores: [] }),
    );
  });

  it("rejects identity changes without editOpponent but allows filling gaps", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 0,
      opponentName: "Old Name",
      opponentTag: "TriV",
      opponentServer: 1236,
      opponentDailyScores: [null, null, null, null, null, null],
    });
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({
          source: "manual",
          opponent: { name: "Different", tag: null, server: null },
        }),
        "req-identity",
      ),
    ).rejects.toMatchObject({ code: "capture_invalid" });
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({
        source: "manual",
        opponent: { name: "Different", tag: null, server: null },
      }, { editOpponent: true }),
      "req-identity2",
    );
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenCalledWith(
      expect.anything(),
      access.actor,
      expect.objectContaining({ opponentName: "Different" }),
    );
    mocks.receiptRows.length = 0;
    mocks.evidenceRows[0].version = 3;
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 0,
      opponentName: null,
      opponentTag: null,
      opponentServer: null,
      opponentDailyScores: [null, null, null, null, null, null],
    });
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({
        source: "manual",
        opponent: { name: "Filled", tag: null, server: null },
      }),
      "req-fill",
    );
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenLastCalledWith(
      expect.anything(),
      access.actor,
      expect.objectContaining({ opponentName: "Filled" }),
    );
  });

  it("rejects opponent scores on weekly context and empty manual payloads", async () => {
    mocks.evidenceRows[0] = {
      ...baseEvidence,
      recordedDate: "2026-10-04",
      period: "weekly",
    };
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        { recordedDate: "2026-10-04", period: "weekly" },
        submission({ source: "manual", opponentScore: "5" }),
        "req-weeklyscore",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    mocks.evidenceRows[0] = { ...baseEvidence };
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({ source: "manual" }),
        "req-empty",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(mocks.saveVsMatchupIdentityTx).not.toHaveBeenCalled();
  });

  it("does not produce day results for a manual opponent score", async () => {
    const result = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({ source: "manual", opponentScore: "1" }),
      "req-nopair",
    );
    expect(result.savedDays).toEqual([]);
    expect(mocks.applyVsCaptureReviewTx).not.toHaveBeenCalled();
  });
});

describe("commitVsVideoSubmission", () => {
  const score = {
    allianceId: "a1",
    hqUserId: "u1",
    jobId: "job-1",
    parseSessionId: "ps1",
    recordedDate: "2026-09-29",
    period: "daily" as const,
    requestId: "req-combined",
    rows: [],
  };

  it("requires the score binding to match the access actor and job", async () => {
    await expect(
      commitVsVideoSubmission({
        access,
        score: { ...score, hqUserId: "other" },
        match: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      commitVsVideoSubmission({
        access,
        score: { ...score, allianceId: "a2" },
        match: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("requires both scores:write and trains:write", async () => {
    mocks.sessionHasPermissionForAlliance.mockImplementation(
      async (_s: string, _a: string, permission: string) =>
        permission === "scores:write",
    );
    await expect(
      commitVsVideoSubmission({
        access,
        score,
        match: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.commitReviewedVsScoresTx).not.toHaveBeenCalled();
  });

  it("commits scores and match in one transaction with a canonical match digest", async () => {
    const match = submission(
      { source: "manual", opponentScore: "2222858900" },
      { expectedDayVersions: { "2026-09-29": 0, "2026-09-28": 0 } },
    );
    const result = await commitVsVideoSubmission({ access, score, match });
    const additionalDigest = mocks.commitReviewedVsScoresTx.mock.calls[0][1]
      .additionalDigest as { expectedDayVersions: Record<string, number> };
    expect(Object.keys(additionalDigest.expectedDayVersions)).toEqual([
      "2026-09-28",
      "2026-09-29",
    ]);
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      submitted: 2,
      matchResult: { weekStart: "2026-09-28", replayed: false },
    });
    expect(mocks.lockAllianceAvailability).toHaveBeenCalled();
  });
});

describe("saveVsVideoMatchOnly", () => {
  it("requires an existing evidence record", async () => {
    mocks.loadVsVideoEvidenceRow.mockResolvedValue(undefined);
    await expect(
      saveVsVideoMatchOnly(access, {
        requestId: "req-saveonly",
        submission: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("saves, syncs the opponent, and returns a fresh evidence view", async () => {
    const response = await saveVsVideoMatchOnly(access, {
      requestId: "req-saveonly",
      submission: submission({ source: "manual", opponentScore: "1" }),
    });
    expect(response).toEqual({ evidence: {} });
    expect(mocks.attemptVsOpponentSync).toHaveBeenCalledWith(
      access.actor,
      "2026-09-28",
    );
    expect(mocks.loadVsVideoEvidence).toHaveBeenCalledWith(access);
  });

  it("skips remote sync on replay", async () => {
    const input = {
      requestId: "req-saveonly",
      submission: submission({ source: "manual", opponentScore: "1" }),
    };
    await saveVsVideoMatchOnly(access, input);
    await saveVsVideoMatchOnly(access, input);
    expect(mocks.attemptVsOpponentSync).toHaveBeenCalledTimes(1);
  });
});

describe("vsVideoDraftSchema form", () => {
  it("persists an incomplete draft form without confirmSides", () => {
    const parsed = vsVideoDraftSchema.safeParse({
      includeResults: true,
      submission: null,
      form: {
        source: "screenshot",
        kind: "daily_totals",
        basisImageVersion: 2,
        editOpponent: false,
        opponent: { server: null, tag: null, name: null },
        opponentScore: "",
        ourSide: null,
        confirmSides: false,
        finalDay: false,
        day: null,
        left: { server: null, tag: null, name: null },
        right: { server: null, tag: null, name: null },
        leftScore: "",
        rightScore: "",
        leftPoints: "",
        rightPoints: "",
        winners: ["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"],
        expectedMatchupVersion: 0,
        expectedDayVersions: {},
        dirtyFields: ["opponentScore"],
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("commitVsVideoSubmission — score context binding", () => {
  const score = {
    allianceId: "a1",
    hqUserId: "u1",
    jobId: "job-1",
    parseSessionId: "ps1",
    recordedDate: "2026-09-29",
    period: "daily" as const,
    requestId: "req-context",
    rows: [],
  };

  it("rejects and rolls back when the score context differs from the evidence context", async () => {
    await expect(
      commitVsVideoSubmission({
        access,
        score: { ...score, recordedDate: "2026-09-28" },
        match: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "stale" });
    expect(mocks.commitReviewedVsScoresTx).toHaveBeenCalledTimes(1);
    expect(mocks.saveVsMatchupIdentityTx).not.toHaveBeenCalled();
    expect(mocks.evidenceRows[0].version).toBe(3);
    await expect(
      commitVsVideoSubmission({
        access,
        score: { ...score, recordedDate: "2026-10-04", period: "weekly" },
        match: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "stale" });
    expect(mocks.evidenceRows[0].version).toBe(3);
    expect(mocks.receiptRows).toHaveLength(0);
  });
});

describe("applyVsVideoMatchSubmissionTx — replay generation enforcement", () => {
  const manualInput = () =>
    submission({ source: "manual", opponentScore: "2222858900" });

  it("replays before replacement and rejects the same request after an image-version bump", async () => {
    const first = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      manualInput(),
      "req-gen000",
    );
    expect(first.replayed).toBe(false);
    const second = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      manualInput(),
      "req-gen000",
    );
    expect(second.replayed).toBe(true);
    const updatesBefore = mocks.updateCalls.length;
    mocks.evidenceRows[0].imageVersion = 3;
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        manualInput(),
        "req-gen000",
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect(mocks.updateCalls).toHaveLength(updatesBefore);
    mocks.evidenceRows[0].imageVersion = 2;
    mocks.evidenceRows[0].recordedDate = "2026-09-30";
    mocks.jobRows[0].recordedDate = "2026-09-30";
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        { recordedDate: "2026-09-30", period: "daily" },
        manualInput(),
        "req-gen000",
      ),
    ).rejects.toMatchObject({ code: "stale" });
  });
});

describe("applyVsVideoMatchSubmissionTx — identity guard semantics", () => {
  const withMatchup = (over: Record<string, unknown>) => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 0,
      opponentName: "Trinity Vanguard",
      opponentTag: "TriV",
      opponentServer: 1236,
      opponentDailyScores: [null, null, null, null, null, null],
      ...over,
    });
  };

  it("rejects explicit null clearing of saved identity without editOpponent", async () => {
    withMatchup({});
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({
          source: "manual",
          opponent: { name: null },
        }),
        "req-nullclear",
      ),
    ).rejects.toMatchObject({ code: "capture_invalid" });
    expect(mocks.saveVsMatchupIdentityTx).not.toHaveBeenCalled();
  });

  it("rejects a wrong screenshot opponent name and accepts null name + explicit edit", async () => {
    withMatchup({});
    const reviewWithName = {
      ...dailyReview,
      right: { ...dailyReview.right, name: "Wrong Name" },
    } as never;
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({
          source: "screenshot",
          imageVersion: 2,
          review: reviewWithName,
        }),
        "req-wrongname",
      ),
    ).rejects.toMatchObject({ code: "capture_invalid" });
    expect(mocks.applyVsCaptureReviewTx).not.toHaveBeenCalled();
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission({
        source: "screenshot",
        imageVersion: 2,
        review: dailyReview as never,
      }),
      "req-nullname",
    );
    expect(mocks.applyVsCaptureReviewTx).toHaveBeenCalledTimes(1);
    mocks.receiptRows.length = 0;
    mocks.evidenceRows[0].version = 3;
    mocks.evidenceRows[0].draft = {};
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      submission(
        {
          source: "screenshot",
          imageVersion: 2,
          review: reviewWithName,
        },
        { editOpponent: true },
      ),
      "req-editok",
    );
    expect(mocks.applyVsCaptureReviewTx).toHaveBeenCalledTimes(2);
  });
});

describe("vsVideoMatchSubmissionSchema bounds", () => {
  it("rejects invalid date keys and more than six day-version entries", async () => {
    await expect(
      saveVsVideoMatchOnly(access, {
        requestId: "req-bounds",
        submission: {
          evidenceVersion: 3,
          expectedMatchupVersion: 0,
          expectedDayVersions: { "not-a-date": 0 },
          data: { source: "manual", opponentScore: "1" },
        },
      }),
    ).rejects.toThrow();
    const seven: Record<string, number> = {};
    for (let day = 1; day <= 7; day += 1) {
      seven[`2026-09-2${day}`] = 0;
    }
    await expect(
      saveVsVideoMatchOnly(access, {
        requestId: "req-bounds2",
        submission: {
          evidenceVersion: 3,
          expectedMatchupVersion: 0,
          expectedDayVersions: seven,
          data: { source: "manual", opponentScore: "1" },
        },
      }),
    ).rejects.toThrow();
    expect(mocks.attemptVsOpponentSync).not.toHaveBeenCalled();
  });
});

describe("saveVsVideoMatchOnly — trains gate", () => {
  it("requires trains:write before touching evidence", async () => {
    mocks.sessionHasPermissionForAlliance.mockImplementation(
      async (_s: string, _a: string, permission: string) =>
        permission !== "trains:write",
    );
    await expect(
      saveVsVideoMatchOnly(access, {
        requestId: "req-gate",
        submission: submission({ source: "manual", opponentScore: "1" }),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.loadVsVideoEvidenceRow).not.toHaveBeenCalled();
  });
});

describe("applyVsVideoMatchSubmissionTx — weekly screenshot manual opponent score", () => {
  const weeklyReview = {
    kind: "weekly_overview",
    weekStart: "2026-09-28",
    ourSide: "left",
    confirmSides: true,
    left: { server: 1203, tag: "LFgo", name: null },
    right: { server: 1236, tag: "TriV", name: null },
    leftPoints: 3,
    rightPoints: 0,
    dayResults: [1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      winner: "unknown" as const,
    })),
  } as const;

  function weeklyScreenshotInput(opponentScore?: string) {
    return submission(
      {
        source: "screenshot",
        imageVersion: 2,
        review: weeklyReview as never,
        ...(opponentScore !== undefined ? { opponentScore } : {}),
      },
      { expectedMatchupVersion: 7 },
    );
  }

  beforeEach(() => {
    mocks.evidenceRows[0].candidate = { kind: "weekly_overview" };
  });

  it("persists the manual foe score for the recorded day without inventing totals", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 7,
      opponentName: "Trinity Vanguard",
      opponentTag: "TriV",
      opponentServer: 1236,
      opponentDailyScores: [null, null, null, null, null, null],
    });
    const result = await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      weeklyScreenshotInput("2222858900"),
      "req-weeklyscore",
    );
    expect(result.appliedImageVersion).toBe(2);
    expect(mocks.saveVsMatchupIdentityTx).toHaveBeenCalledWith(
      expect.anything(),
      access.actor,
      {
        weekStart: "2026-09-28",
        opponentName: "Trinity Vanguard",
        opponentTag: "TriV",
        opponentServer: 1236,
        opponentScores: [{ day: 2, score: "2222858900" }],
        expectedVersion: 7,
        scope: "scope:week",
      },
    );
  });

  it("omits the identity write when the stored score already matches", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 7,
      opponentName: "Trinity Vanguard",
      opponentTag: "TriV",
      opponentServer: 1236,
      opponentDailyScores: [null, "2222858900", null, null, null, null],
    });
    await applyVsVideoMatchSubmissionTx(
      tx(),
      access,
      context,
      weeklyScreenshotInput("2222858900"),
      "req-samescore",
    );
    expect(mocks.saveVsMatchupIdentityTx).not.toHaveBeenCalled();
  });

  it("rolls back the whole commit when the confirmed-day score write rejects", async () => {
    mocks.loadVsMatchupRowForUpdate.mockResolvedValue({
      id: "m1",
      version: 7,
      opponentName: "Trinity Vanguard",
      opponentTag: "TriV",
      opponentServer: 1236,
      opponentDailyScores: [null, null, null, null, null, null],
    });
    mocks.saveVsMatchupIdentityTx.mockRejectedValue(
      new VsPerformanceError("capture_invalid", 409),
    );
    const versionBefore = mocks.evidenceRows[0].version;
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        weeklyScreenshotInput("5"),
        "req-rollback",
      ),
    ).rejects.toMatchObject({ code: "capture_invalid" });
    expect(mocks.evidenceRows[0].version).toBe(versionBefore);
    expect(mocks.receiptRows).toHaveLength(0);
  });

  it("rejects a manual score on a weekly evidence context or daily kind", async () => {
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        { recordedDate: "2026-10-04", period: "weekly" },
        weeklyScreenshotInput("5"),
        "req-wrongperiod",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    mocks.evidenceRows[0].candidate = { kind: "daily_totals" };
    await expect(
      applyVsVideoMatchSubmissionTx(
        tx(),
        access,
        context,
        submission({
          source: "screenshot",
          imageVersion: 2,
          review: { ...dailyReview, finalDay: false } as never,
          opponentScore: "5",
        }),
        "req-dailyscore",
      ),
    ).rejects.toThrow();
  });
});
