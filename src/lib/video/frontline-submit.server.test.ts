import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAlliancePermission: vi.fn(),
  resolveHqAllianceIdFromStoredAllianceId: vi.fn(),
  commitFrontlineReview: vi.fn(),
  emitVideoJobStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: mocks.requireAlliancePermission,
}));

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId:
    mocks.resolveHqAllianceIdFromStoredAllianceId,
}));

vi.mock("@/lib/events/video-jobs", () => ({
  emitVideoJobStatus: mocks.emitVideoJobStatus,
}));

vi.mock("@/lib/video/frontline-results.server", () => {
  class FrontlineReviewError extends Error {
    constructor(
      readonly code: string,
      readonly status = 400,
      readonly issues: Array<{ id: string; fields: string[] }> = [],
    ) {
      super(code);
    }
  }
  return {
    FrontlineReviewError,
    commitFrontlineReview: mocks.commitFrontlineReview,
  };
});

import { FrontlineReviewError } from "@/lib/video/frontline-results.server";
import { submitFrontlineReview } from "@/lib/video/frontline-submit.server";
import type { VideoJob } from "@/lib/db/schema";

const job = {
  id: "job-1",
  allianceId: "al-1",
  sessionId: "sess-uploader",
  fileName: "frontline.mp4",
  scoreTarget: "frontline-breakthrough",
  status: "review",
} as unknown as VideoJob;

const body = { recordedDate: "2025-06-15", rows: [{ id: "r1", memberId: "m1" }] };

describe("submitFrontlineReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("al-1");
    mocks.requireAlliancePermission.mockResolvedValue(null);
    mocks.commitFrontlineReview.mockResolvedValue({ submitted: 2 });
    mocks.emitVideoJobStatus.mockResolvedValue(undefined);
  });

  it("returns ok with hq storage and the submitted count", async () => {
    const response = await submitFrontlineReview({
      sessionId: "sess-1",
      hqUserId: "hq-1",
      job,
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, storage: "hq", submitted: 2 });
    expect(mocks.commitFrontlineReview).toHaveBeenCalledWith({
      job,
      allianceId: "al-1",
      sessionId: "sess-1",
      hqUserId: "hq-1",
      body,
    });
  });

  it("returns the permission denial before any commit", async () => {
    const denied = Response.json({ error: "denied" }, { status: 403 });
    mocks.requireAlliancePermission.mockResolvedValue(denied);
    const response = await submitFrontlineReview({
      sessionId: "sess-1",
      hqUserId: "hq-1",
      job,
      body,
    });
    expect(response.status).toBe(403);
    expect(mocks.commitFrontlineReview).not.toHaveBeenCalled();
    expect(mocks.emitVideoJobStatus).not.toHaveBeenCalled();
  });

  it("denies without an HQ user before permission checks", async () => {
    const response = await submitFrontlineReview({
      sessionId: "sess-1",
      hqUserId: null,
      job,
      body,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "frontlineSaveFailed" });
    expect(mocks.requireAlliancePermission).not.toHaveBeenCalled();
    expect(mocks.commitFrontlineReview).not.toHaveBeenCalled();
  });

  it("denies when the job has no resolvable HQ alliance", async () => {
    mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue(null);
    const response = await submitFrontlineReview({
      sessionId: "sess-1",
      hqUserId: "hq-1",
      job,
      body,
    });
    expect(response.status).toBe(403);
    expect(mocks.requireAlliancePermission).not.toHaveBeenCalled();
  });

  it("maps FrontlineReviewError codes, status, and issues into the response", async () => {
    mocks.commitFrontlineReview.mockRejectedValue(
      new FrontlineReviewError("frontlineInvalidRows", 400, [
        { id: "r1", fields: ["stage"] },
      ]),
    );
    const response = await submitFrontlineReview({
      sessionId: "sess-1",
      hqUserId: "hq-1",
      job,
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "frontlineInvalidRows",
      error: "frontlineInvalidRows",
      issues: [{ id: "r1", fields: ["stage"] }],
    });
  });

  it("maps unexpected errors to frontlineSaveFailed 500 without internals", async () => {
    mocks.commitFrontlineReview.mockRejectedValue(new Error("db secret detail"));
    const response = await submitFrontlineReview({
      sessionId: "sess-1",
      hqUserId: "hq-1",
      job,
      body,
    });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({
      code: "frontlineSaveFailed",
      error: "frontlineSaveFailed",
      issues: [],
    });
    expect(JSON.stringify(json)).not.toContain("db secret detail");
  });
});
