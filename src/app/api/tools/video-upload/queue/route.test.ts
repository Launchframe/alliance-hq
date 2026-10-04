import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(), getAshedConnection: vi.fn(), sessionCanProcessVideo: vi.fn(),
  sessionCanReadAllianceVideoQueue: vi.fn(), listVideoQueueJobsForSession: vi.fn(),
  loadEffectiveAllianceHqOcrOnly: vi.fn(),
}));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/video/processor-slots.server", () => mocks);
vi.mock("@/lib/video/video-queue.server", () => ({ ...mocks, listAllianceActiveVideoJobs: vi.fn(), listAlliancePendingVideoJobs: vi.fn() }));
vi.mock("@/lib/video/alliance-ocr-settings.server", () => ({ ...mocks, isAllianceHqOcrOnlyLockedOnDeploy: () => false }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_OCR_PROVIDER", "ashed");
  mocks.requireApiSession.mockResolvedValue({ id: "session", currentAllianceId: "native-alliance" });
  mocks.getAshedConnection.mockResolvedValue(null);
  mocks.sessionCanProcessVideo.mockResolvedValue(true);
  mocks.sessionCanReadAllianceVideoQueue.mockResolvedValue(true);
  mocks.loadEffectiveAllianceHqOcrOnly.mockResolvedValue(false);
  mocks.listVideoQueueJobsForSession.mockResolvedValue([{ id: "native-vs", requiresAshedConnection: false }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("queue connection requirements", () => {
  it("does not gate a native VS-only queue on Ashed or change the alliance preference", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ashedRequired: false, ashedConnected: false, hqOcrOnly: false, canProcess: true });
  });

  it("preserves the credential requirement for Ashed jobs in mixed queues", async () => {
    mocks.listVideoQueueJobsForSession.mockResolvedValue([{ requiresAshedConnection: false }, { requiresAshedConnection: true }]);
    expect(await (await GET()).json()).toMatchObject({ ashedRequired: true });
  });

  it("denies unauthorized queue readers before loading credentials or jobs", async () => {
    mocks.sessionCanReadAllianceVideoQueue.mockResolvedValue(false);
    expect((await GET()).status).toBe(403);
    expect(mocks.listVideoQueueJobsForSession).not.toHaveBeenCalled();
    expect(mocks.getAshedConnection).not.toHaveBeenCalled();
  });

  it("forwards unauthenticated session denial", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET()).status).toBe(401);
    expect(mocks.sessionCanReadAllianceVideoQueue).not.toHaveBeenCalled();
  });
});
