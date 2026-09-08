import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoJob } from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ loadAllianceVideoOcrContext: vi.fn(), sessionCanProcessVideo: vi.fn() }));
vi.mock("@/lib/video/alliance-ocr-settings.server", () => ({ ...mocks, isAllianceHqOcrOnlyLockedOnDeploy: () => false }));
vi.mock("@/lib/video/processor-slots.server", () => mocks);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }) }),
}));
import { buildVideoProcessPreview } from "./video-process-preview.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_OCR_PROVIDER", "ashed");
  mocks.loadAllianceVideoOcrContext.mockResolvedValue({ allianceOperatingMode: "native", allianceHqOcrOnly: false });
  mocks.sessionCanProcessVideo.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

const preview = (scoreTarget = "vs-performance") => buildVideoProcessPreview({
  sessionId: "processor",
  job: { id: "job", scoreTarget, allianceId: "alliance", groupId: null, boardKey: null } as VideoJob,
});

describe("native VS process preview", () => {
  it("matches native engine, no credential requirement, target lock, and no shadows", async () => {
    expect(await preview()).toMatchObject({
      primaryEngine: "native", requiresAshedConnection: false, hqOcrOnly: true,
      hqOcrOnlyLocked: true, hqOcrOnlyLockReason: "score_target", shadowFollowups: [],
    });
    expect(mocks.loadAllianceVideoOcrContext).toHaveBeenCalledWith("alliance");
  });

  it("keeps Ashed VS preview unchanged", async () => {
    mocks.loadAllianceVideoOcrContext.mockResolvedValue({ allianceOperatingMode: "ashed", allianceHqOcrOnly: false });
    expect(await preview()).toMatchObject({ primaryEngine: "ashed", requiresAshedConnection: true, hqOcrOnly: false, hqOcrOnlyLocked: false });
  });

  it("keeps non-VS native alliance targets unchanged", async () => {
    expect(await preview("desert-storm")).toMatchObject({ primaryEngine: "ashed", requiresAshedConnection: true });
  });
});
