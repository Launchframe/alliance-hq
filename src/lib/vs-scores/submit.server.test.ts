import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitReviewedVsScores: vi.fn(),
  commitVsVideoSubmission: vi.fn(),
  resolveVsVideoAccess: vi.fn(),
  loadVsVideoEvidence: vi.fn(),
  requireAlliancePermission: vi.fn(),
  resolveHqAllianceIdFromStoredAllianceId: vi.fn(),
  emitVideoJobStatus: vi.fn(),
  syncVsScoresForAlliance: vi.fn(),
  getSolicitedEligibility: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<unknown> | void>,
  VsPerformanceErrorStub: class extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("next/server", () => ({
  after: (cb: () => Promise<unknown> | void) => {
    mocks.afterCallbacks.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));
vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: (...args: unknown[]) =>
    mocks.requireAlliancePermission(...args),
}));
vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId: (...args: unknown[]) =>
    mocks.resolveHqAllianceIdFromStoredAllianceId(...args),
}));
vi.mock("@/lib/events/video-jobs", () => ({
  emitVideoJobStatus: (...args: unknown[]) => mocks.emitVideoJobStatus(...args),
}));
vi.mock("@/lib/video/video-job-access.shared", () => ({
  videoJobStatusOwnerFields: () => ({}),
}));
vi.mock("@/lib/vs-scores/repository.server", () => ({
  commitReviewedVsScores: (...args: unknown[]) =>
    mocks.commitReviewedVsScores(...args),
}));
vi.mock("@/lib/vs-performance/video-evidence.server", () => ({
  resolveVsVideoAccess: (...args: unknown[]) =>
    mocks.resolveVsVideoAccess(...args),
  loadVsVideoEvidence: (...args: unknown[]) => mocks.loadVsVideoEvidence(...args),
}));
vi.mock("@/lib/vs-performance/video-evidence-submit.server", () => ({
  commitVsVideoSubmission: (...args: unknown[]) =>
    mocks.commitVsVideoSubmission(...args),
}));
vi.mock("@/lib/vs-performance/api-helpers.server", () => ({
  vsErrorResponse: (error: { status?: number; code?: string }) =>
    new Response(JSON.stringify({ error: error.code ?? "internal" }), {
      status: error.status ?? 500,
      headers: { "Content-Type": "application/json" },
    }),
}));
vi.mock("@/lib/vs-performance/weekly-plan.shared", () => ({
  VsPerformanceError: mocks.VsPerformanceErrorStub,
}));
vi.mock("@/lib/vs-scores/sync.server", () => ({
  syncVsScoresForAlliance: (...args: unknown[]) =>
    mocks.syncVsScoresForAlliance(...args),
}));
vi.mock("@/lib/feedback/solicited-eligibility", () => ({
  getSolicitedEligibility: (...args: unknown[]) =>
    mocks.getSolicitedEligibility(...args),
}));
vi.mock("@/lib/eur/satisfaction", () => ({
  notifyEurVideoEvidence: vi.fn(async () => {}),
}));
vi.mock("@/lib/trains/price-is-right-leaderboard-discord.server", () => ({
  announcePriceIsRightLeaderboardAfterVsUpload: vi.fn(async () => {}),
}));
vi.mock("@/lib/trains/conductor-confirmation.server", () => ({
  maybeNominateConductorAfterVsUpload: vi.fn(async () => {}),
}));
vi.mock("@/lib/vs-scores/errors.server", () => ({
  vsEvidenceErrorResponse: (error: { status?: number }) =>
    new Response(JSON.stringify({ error: "invalid" }), {
      status: error.status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
}));
vi.mock("@/lib/vs-performance/matchup-sync.server", () => ({
  attemptVsOpponentSync: vi.fn(async () => null),
}));

import { attemptVsOpponentSync } from "@/lib/vs-performance/matchup-sync.server";
import { submitVsReview } from "./submit.server";

const attemptSync = vi.mocked(attemptVsOpponentSync);

const job = {
  id: "job-1",
  allianceId: "stored-a1",
  parseSessionId: "ps-1",
  status: "review",
  fileName: null,
} as never;

const baseInput = {
  sessionId: "sess-1",
  hqUserId: "hq-1",
  job,
  automaticDeletedIds: [] as string[],
  body: {
    recordedDate: "2026-09-29",
    vsPeriod: "daily",
    requestId: "req-12345678",
    rows: [{ id: "row-1", memberId: "m-1", score: "2241713380" }] as never[],
  },
};

const access = {
  actor: { sessionId: "sess-1", hqUserId: "hq-1", allianceId: "a1" },
  job,
  scopeKey: "job:job-1",
};

describe("submitVsReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("a1");
    mocks.requireAlliancePermission.mockResolvedValue(null);
    mocks.resolveVsVideoAccess.mockResolvedValue(access);
    mocks.loadVsVideoEvidence.mockResolvedValue({
      ashedLinked: true,
      matchup: { sync: { status: "pending" } },
    });
    mocks.getSolicitedEligibility.mockResolvedValue({
      showSolicitedFeedback: false,
      completedUploadCount: 0,
    });
    mocks.commitReviewedVsScores.mockResolvedValue({
      ok: true,
      submitted: 1,
      batchId: "b1",
      vsRevision: 2,
      syncStatus: "local",
      replayed: false,
    });
    mocks.commitVsVideoSubmission.mockResolvedValue({
      ok: true,
      submitted: 1,
      batchId: "b1",
      vsRevision: 2,
      syncStatus: "local",
      replayed: false,
      matchResult: {
        weekStart: "2026-09-28",
        recordedDate: "2026-09-29",
        period: "daily",
        imageVersion: 2,
        appliedImageVersion: 2,
        savedDays: ["2026-09-29"],
        replayed: false,
      },
    });
  });

  it("keeps the legacy score-only path when vsMatchReview is absent", async () => {
    const res = await submitVsReview(baseInput);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, submitted: 1, storage: "hq" });
    expect(body.vsEvidence).toBeUndefined();
    expect(body.matchResultsSaved).toBeUndefined();
    expect(mocks.commitReviewedVsScores).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        hqUserId: "hq-1",
        jobId: "job-1",
        recordedDate: "2026-09-29",
        period: "daily",
        requestId: "req-12345678",
      }),
    );
    expect(mocks.commitVsVideoSubmission).not.toHaveBeenCalled();
    expect(mocks.resolveVsVideoAccess).not.toHaveBeenCalled();
  });

  it("requires scores:write before any combined path work", async () => {
    mocks.requireAlliancePermission.mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );
    const res = await submitVsReview({
      ...baseInput,
      body: { ...baseInput.body, vsMatchReview: { source: "manual" } },
    });
    expect(res.status).toBe(403);
    expect(mocks.resolveVsVideoAccess).not.toHaveBeenCalled();
    expect(mocks.commitVsVideoSubmission).not.toHaveBeenCalled();
  });

  it("denies match-included submissions when review access fails", async () => {
    mocks.resolveVsVideoAccess.mockRejectedValue(
      new mocks.VsPerformanceErrorStub("forbidden", 403),
    );
    const res = await submitVsReview({
      ...baseInput,
      body: { ...baseInput.body, vsMatchReview: { source: "manual" } },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(mocks.commitVsVideoSubmission).not.toHaveBeenCalled();
    expect(mocks.commitReviewedVsScores).not.toHaveBeenCalled();
  });

  it("commits scores and match atomically and reports separate sync status", async () => {
    const match = {
      evidenceVersion: 3,
      expectedMatchupVersion: 0,
      expectedDayVersions: { "2026-09-29": 0 },
      editOpponent: false,
      data: { source: "manual", opponentScore: "2222858900" },
    };
    const res = await submitVsReview({
      ...baseInput,
      body: { ...baseInput.body, vsMatchReview: match },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      submitted: 1,
      storage: "hq",
      matchResultsSaved: true,
      matchSyncStatus: "pending",
      vsEvidence: { ashedLinked: true },
    });
    const call = mocks.commitVsVideoSubmission.mock.calls[0]![0] as {
      access: unknown;
      score: { requestId?: string; recordedDate?: string };
      match: unknown;
    };
    expect(call.access).toBe(access);
    expect(call.score.requestId).toBe("req-12345678");
    expect(call.score.recordedDate).toBe("2026-09-29");
    expect(call.match).toBe(match);
    expect(mocks.commitReviewedVsScores).not.toHaveBeenCalled();
    expect(mocks.loadVsVideoEvidence).toHaveBeenCalledWith(access);
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]!();
    expect(mocks.syncVsScoresForAlliance).toHaveBeenCalledWith("a1");
  });

  it("reports matchSyncStatus 'local' for unlinked alliances regardless of stored status", async () => {
    mocks.loadVsVideoEvidence.mockResolvedValue({
      ashedLinked: false,
      matchup: { sync: { status: "synced" } },
    });
    const res = await submitVsReview({
      ...baseInput,
      body: { ...baseInput.body, vsMatchReview: { source: "manual" } },
    });
    const body = await res.json();
    expect(body.matchSyncStatus).toBe("local");
  });

  it("schedules no notifications or syncs when both commits replay", async () => {
    mocks.commitVsVideoSubmission.mockResolvedValue({
      ok: true,
      submitted: 0,
      batchId: "b1",
      vsRevision: 2,
      syncStatus: "synced",
      replayed: true,
      matchResult: {
        weekStart: "2026-09-28",
        recordedDate: "2026-09-29",
        period: "daily",
        imageVersion: 2,
        appliedImageVersion: 2,
        savedDays: [],
        replayed: true,
      },
    });
    const res = await submitVsReview({
      ...baseInput,
      body: { ...baseInput.body, vsMatchReview: { source: "manual" } },
    });
    expect(res.status).toBe(200);
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]!();
    expect(mocks.emitVideoJobStatus).not.toHaveBeenCalled();
    expect(mocks.syncVsScoresForAlliance).not.toHaveBeenCalled();
    expect(attemptSync).not.toHaveBeenCalled();
  });

  it("still syncs scores on match replay when the score commit is fresh", async () => {
    mocks.commitVsVideoSubmission.mockResolvedValue({
      ok: true,
      submitted: 1,
      batchId: "b1",
      vsRevision: 3,
      syncStatus: "local",
      replayed: false,
      matchResult: {
        weekStart: "2026-09-28",
        recordedDate: "2026-09-29",
        period: "daily",
        imageVersion: 2,
        appliedImageVersion: 2,
        savedDays: [],
        replayed: true,
      },
    });
    await submitVsReview({
      ...baseInput,
      body: { ...baseInput.body, vsMatchReview: { source: "manual" } },
    });
    await mocks.afterCallbacks[0]!();
    expect(mocks.emitVideoJobStatus).toHaveBeenCalled();
    expect(mocks.syncVsScoresForAlliance).toHaveBeenCalledWith("a1");
    expect(attemptSync).not.toHaveBeenCalled();
  });

  it("rejects anonymous submissions", async () => {
    const res = await submitVsReview({ ...baseInput, hqUserId: null });
    expect(res.status).toBe(403);
    expect(mocks.commitReviewedVsScores).not.toHaveBeenCalled();
  });
});
