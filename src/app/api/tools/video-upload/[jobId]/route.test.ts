import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const requireApiSessionMock = vi.fn();
const resolveVideoJobAccessMock = vi.fn();
const videoJobAccessErrorResponseMock = vi.fn();
const resolveHqAllianceIdFromStoredAllianceIdMock = vi.fn();
const requireAlliancePermissionMock = vi.fn();
const parseSessionLimitMock = vi.fn();
const parsedRowsOrderByMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: () => requireApiSessionMock(),
}));

vi.mock("@/lib/video/video-job-access.server", () => ({
  resolveVideoJobAccess: (
    jobId: string,
    sessionId: string,
    level: "read" | "mutate" | "process",
  ) => resolveVideoJobAccessMock(jobId, sessionId, level),
  videoJobAccessErrorResponse: (result: {
    ok: false;
    status: 403 | 404;
  }) => videoJobAccessErrorResponseMock(result),
}));

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId: (allianceId: string | null) =>
    resolveHqAllianceIdFromStoredAllianceIdMock(allianceId),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: (
    sessionId: string,
    allianceId: string,
    permission: string,
  ) => requireAlliancePermissionMock(sessionId, allianceId, permission),
}));

const currentScoreTarget = vi.hoisted(() => ({ id: "bank-deposit-slip-history" }));

vi.mock("@/lib/video/score-targets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/video/score-targets")>();
  return {
    ...actual,
    getScoreTarget: () => currentScoreTarget,
    toScoreTargetClientMeta: () => currentScoreTarget,
  };
});

const listAllianceMembersMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/members/roster.server", () => ({
  allianceMemberRowToAshedMember: (row: unknown) => row,
  listAllianceMembers: listAllianceMembersMock,
}));

vi.mock("@/lib/alliance/ashed-write-guard", () => ({
  getAshedAllianceIdIfLinked: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/video/pipeline-stats-display", () => ({
  isVideoProcessTimings: () => false,
}));

vi.mock("@/lib/video/resolve-job-video-storage", () => ({
  resolveJobVideoStorageKey: vi.fn(),
}));

vi.mock("@/lib/video/video-job-alliance.shared", () => ({
  isVideoJobAllianceStale: () => false,
  VIDEO_JOB_ALLIANCE_UNRESOLVED_CODE: "video_job_alliance_unresolved",
  VIDEO_JOB_ALLIANCE_UNRESOLVED_ERROR: "Alliance context missing on job.",
}));

vi.mock("@/lib/rbac/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/constants")>();
  return {
    ...actual,
    BANK_READ_PERMISSION: "bank:read",
  };
});

vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermission: vi.fn(),
  getRbacContext: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/video/scoreboard-review-preferences.server", () => ({
  canEditScoreboardReviewPreferences: () => false,
  canOfferScoreboardMemberActionsForAlliance: vi
    .fn()
    .mockResolvedValue({ canOffer: false, hqUserId: null }),
  loadScoreboardReviewPreferences: vi.fn(),
}));

const sessionCanProcessVideoMock = vi.fn();

vi.mock("@/lib/video/processor-slots.server", () => ({
  sessionCanProcessVideo: (...args: unknown[]) =>
    sessionCanProcessVideoMock(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: parseSessionLimitMock,
          orderBy: parsedRowsOrderByMock,
        }),
      }),
    }),
  }),
  schema: {
    alliances: { id: "alliances.id", tag: "alliances.tag", name: "alliances.name" },
    parseSessions: {
      id: "parseSessions.id",
      rowCount: "parseSessions.rowCount",
      matchedCount: "parseSessions.matchedCount",
      scoreTarget: "parseSessions.scoreTarget",
      allianceId: "parseSessions.allianceId",
      status: "parseSessions.status",
      dedupeReportJson: "parseSessions.dedupeReportJson",
    },
    parsedRows: {
      parseSessionId: "parsedRows.parseSessionId",
      allianceRank: "parsedRows.allianceRank",
      rank: "parsedRows.rank",
      frameIndex: "parsedRows.frameIndex",
    },
    videoFrames: {
      jobId: "videoFrames.jobId",
      frameIndex: "videoFrames.frameIndex",
      videoTimestampSeconds: "videoFrames.videoTimestampSeconds",
    },
  },
}));

import { GET } from "./route";

describe("GET /api/tools/video-upload/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      id: "sess-1",
      allianceTag: "LFgo",
      currentAllianceId: "alliance-1",
    });
    resolveVideoJobAccessMock.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        status: "review",
        scoreTarget: "bank-deposit-slip-history",
        category: "bank-deposit-slip-history",
        allianceId: "stored-alliance",
        parseSessionId: "parse-1",
      },
    });
    videoJobAccessErrorResponseMock.mockImplementation(
      (result: { ok: false; status: 403 | 404 }) =>
        NextResponse.json({ error: "Denied" }, { status: result.status }),
    );
    resolveHqAllianceIdFromStoredAllianceIdMock.mockResolvedValue("alliance-1");
    requireAlliancePermissionMock.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    parseSessionLimitMock.mockResolvedValue([
      {
        id: "parse-1",
        rowCount: 2,
        matchedCount: 0,
        scoreTarget: "bank-deposit-slip-history",
        allianceId: "alliance-1",
        status: "review",
        dedupeReportJson: null,
      },
    ]);
    parsedRowsOrderByMock.mockResolvedValue([]);
    sessionCanProcessVideoMock.mockResolvedValue(false);
    listAllianceMembersMock.mockResolvedValue([]);
    currentScoreTarget.id = "bank-deposit-slip-history";
  });

  it("requires bank read before returning deposit-slip review rows", async () => {
    const res = await GET(new Request("http://localhost/job"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 403,
      body: { error: "Forbidden" },
    });
    expect(requireAlliancePermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "alliance-1",
      "bank:read",
    );
    expect(parsedRowsOrderByMock).not.toHaveBeenCalled();
  });

  it("serializes frontlineStage on review rows without extra permission gates", async () => {
    currentScoreTarget.id = "frontline-breakthrough";
    resolveVideoJobAccessMock.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        status: "review",
        scoreTarget: "frontline-breakthrough",
        category: "frontline-breakthrough",
        allianceId: "stored-alliance",
        parseSessionId: "parse-1",
      },
    });
    parseSessionLimitMock.mockResolvedValue([
      {
        id: "parse-1",
        rowCount: 1,
        matchedCount: 0,
        scoreTarget: "frontline-breakthrough",
        allianceId: "alliance-1",
        status: "review",
        dedupeReportJson: null,
      },
    ]);
    parsedRowsOrderByMock.mockResolvedValue([
      {
        id: "r1",
        ocrName: "Alpha",
        score: "2670",
        rank: 3,
        frontlineStage: 5,
        rosterRankRaw: null,
        allianceRank: null,
        allianceRankTitle: null,
        powerLevel: null,
        memberLevel: null,
        profession: null,
        frameIndex: 0,
        memberId: null,
        memberName: null,
        matchConfidence: 0,
        matchMethod: "none",
        scoreConflict: 0,
        dedupeClusterId: null,
        deleted: 0,
        manuallyAdded: 0,
      },
    ]);

    const res = await GET(new Request("http://localhost/job"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ id: "r1", frontlineStage: 5, rank: 3 });
    expect(requireAlliancePermissionMock).not.toHaveBeenCalled();
  });
});
