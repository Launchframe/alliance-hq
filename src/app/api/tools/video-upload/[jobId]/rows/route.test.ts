import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const getOrCreateSessionMock = vi.fn();
const resolveVideoJobAccessMock = vi.fn();
const videoJobAccessErrorResponseMock = vi.fn();
const resolveHqAllianceIdFromStoredAllianceIdMock = vi.fn();
const requireAlliancePermissionMock = vi.fn();
const selectLimitMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock("nanoid", () => ({
  nanoid: () => "row-1",
}));

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
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

vi.mock("@/lib/video/score-targets", () => ({
  isBankDepositSlipHistoryTarget: (id: string) =>
    id === "bank-deposit-slip-history",
}));

vi.mock("@/lib/rbac/constants", () => ({
  BANK_WRITE_PERMISSION: "bank:write",
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: (
    sessionId: string,
    allianceId: string,
    permission: string,
  ) => requireAlliancePermissionMock(sessionId, allianceId, permission),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimitMock,
        }),
      }),
    }),
    insert: () => ({
      values: insertValuesMock,
    }),
  }),
  schema: {
    parseSessions: {
      id: "parseSessions.id",
      allianceId: "parseSessions.allianceId",
      scoreTarget: "parseSessions.scoreTarget",
    },
    parsedRows: {
      parseSessionId: "parsedRows.parseSessionId",
      frameIndex: "parsedRows.frameIndex",
      rank: "parsedRows.rank",
      allianceRank: "parsedRows.allianceRank",
    },
  },
}));

import { POST } from "./route";

describe("POST /api/tools/video-upload/[jobId]/rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue({ id: "sess-1" });
    resolveVideoJobAccessMock.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        status: "review",
        allianceId: "stored-alliance",
        parseSessionId: "parse-1",
      },
    });
    videoJobAccessErrorResponseMock.mockImplementation(
      (result: { ok: false; status: 403 | 404 }) =>
        NextResponse.json({ error: "Denied" }, { status: result.status }),
    );
    selectLimitMock.mockResolvedValue([
      {
        allianceId: "alliance-1",
        scoreTarget: "bank-deposit-slip-history",
      },
    ]);
    resolveHqAllianceIdFromStoredAllianceIdMock.mockResolvedValue("alliance-1");
    requireAlliancePermissionMock.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    insertValuesMock.mockResolvedValue(undefined);
  });

  it("requires bank write before adding manual deposit-slip rows", async () => {
    const res = await POST(
      new Request("http://localhost/job/rows", {
        method: "POST",
        body: JSON.stringify({ position: "end" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(res.status).toBe(403);
    expect(requireAlliancePermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "alliance-1",
      "bank:write",
    );
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
