import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(), insertValues: vi.fn(), updateSet: vi.fn(),
  loadAllianceVideoOcrContext: vi.fn(), getAshedConnection: vi.fn(),
  loadAshedConnectionForAllianceCapability: vi.fn(),
  resolveHqAllianceIdFromStoredAllianceId: vi.fn(),
  resolveHqAllianceIdFromSession: vi.fn(), resolveSessionAllianceId: vi.fn(),
  loadMembersForApiContext: vi.fn(), ocrVsNativeFrames: vi.fn(), ocrAllFrames: vi.fn(),
  mockOcrScoreFrames: vi.fn(), base44ListMembers: vi.fn(),
  listAllianceMembers: vi.fn(), emitVideoJobStatus: vi.fn(),
  maybeEnqueueShadowPass: vi.fn(), maybeEnqueueShadowPassEarly: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
    insert: () => ({ values: mocks.insertValues }),
    update: () => ({ set: mocks.updateSet }),
  }),
}));
vi.mock("@/lib/video/alliance-ocr-settings.server", () => mocks);
vi.mock("@/lib/video/video-job-alliance.server", () => mocks);
vi.mock("@/lib/members/resolve-hq-alliance", () => mocks);
vi.mock("@/lib/members/members-api-context", () => mocks);
vi.mock("@/lib/members/roster.server", () => ({ ...mocks, allianceMemberRowToAshedMember: (row: unknown) => row }));
vi.mock("@/lib/alliance/session-alliance", () => ({ ...mocks, getSessionAllianceTag: vi.fn().mockResolvedValue("OTHER") }));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/ashed/load-ashed-connection.server", () => mocks);
vi.mock("@/lib/base44/fetch", () => mocks);
vi.mock("@/lib/video/ocr-vs-native", () => mocks);
vi.mock("@/lib/video/ocr-pipeline", () => ({ ...mocks, defaultAshFrameConcurrency: () => 4 }));
vi.mock("@/lib/video/ocr-mock", () => mocks);
vi.mock("@/lib/video/enqueue-shadow-pass", () => mocks);
vi.mock("@/lib/video/run-deposit-slip-ocr-phase.server", () => ({}));
vi.mock("@/lib/video/resolve-job-video-storage", () => ({ resolveJobVideoStorageKey: vi.fn().mockResolvedValue("videos/test/source.mp4") }));
vi.mock("@/lib/storage", () => ({
  streamObjectToFile: vi.fn().mockResolvedValue(10), putObject: vi.fn(),
  frameStorageKey: () => "videos/test/frame.jpg", prefersLocalStorage: () => false, r2Configured: () => false,
}));
vi.mock("node:fs/promises", () => ({ default: { unlink: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/lib/video/frame-extractor", () => ({
  extractLeaderboardFrames: vi.fn().mockResolvedValue({ frames: [{ index: 0, buffer: Buffer.from("frame"), videoTimestampSeconds: 0 }] }),
  cleanupFrameTempDir: vi.fn(),
}));
vi.mock("@/lib/events/video-jobs", () => mocks);
vi.mock("@/lib/bff/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/video/pipeline-step-log", () => ({ logPipelineStep: vi.fn() }));
vi.mock("@/lib/video/trigger-archive", () => ({ dispatchVideoArchive: vi.fn() }));
vi.mock("@/lib/ocr/learning/recording.server", () => ({ recordPipelineRun: vi.fn().mockResolvedValue("run-1") }));
vi.mock("@/lib/ocr/learning/media-hash.server", () => ({ hashVideoInput: vi.fn().mockResolvedValue("a".repeat(64)) }));
vi.mock("@/lib/eur/satisfaction", () => ({ notifyEurVideoEvidence: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/analytics/video-pipeline", () => ({ trackVideoPipelineFailure: vi.fn(), trackVideoPipelineTimings: vi.fn() }));

import { processVideoJob } from "./process-job";
import { recordPipelineRun } from "@/lib/ocr/learning/recording.server";

const job = {
  id: "native-vs-job", sessionId: "uploader", processingSessionId: "processor",
  allianceId: "native-alliance", scoreTarget: "vs-performance", status: "queued",
  passRole: "primary", groupId: null, fileName: "test.mp4",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_OCR_PROVIDER", "ashed");
  mocks.selectLimit.mockResolvedValue([{ tag: "HQ" }]).mockResolvedValueOnce([job]);
  mocks.updateSet.mockImplementation(() => ({ where: () => Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: job.id }] }) }));
  mocks.loadAllianceVideoOcrContext.mockResolvedValue({ allianceOperatingMode: "native", allianceHqOcrOnly: false });
  mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("native-alliance");
  mocks.getAshedConnection.mockResolvedValue(null);
  mocks.loadAshedConnectionForAllianceCapability.mockResolvedValue(null);
  mocks.loadMembersForApiContext.mockResolvedValue([{ id: "member-alpha", current_name: "Alpha" }]);
  mocks.ocrVsNativeFrames.mockResolvedValue({
    entries: [{ name: "Alpha", score: "1234567", rank: 1, _sourceFrameIndex: 0 }],
    frameTimings: [{ frameIndex: 0, ms: 1, uploadMs: 0, extractMs: 1, entryCount: 1, error: null, rawResult: null }], concurrency: 1,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("processVideoJob native VS", () => {
  it("extracts and matches the job's HQ roster with no Ashed credential, even if sessions changed alliance", async () => {
    const result = await processVideoJob(job.id);
    expect(result).toMatchObject({ rowCount: 1, matchedCount: 1, ashedUploadTotalMs: 0, ashedExtractTotalMs: 0 });
    expect(mocks.ocrVsNativeFrames).toHaveBeenCalledOnce();
    expect(recordPipelineRun).toHaveBeenCalledWith(expect.objectContaining({ jobId: job.id, allianceId: "native-alliance", scoreTarget: "vs-performance", sourceSha256: "a".repeat(64), entries: [{ name: "Alpha", score: "1234567", rank: 1, _sourceFrameIndex: 0 }] }));
    expect(mocks.loadMembersForApiContext).toHaveBeenCalledWith({ operatingMode: "native", hqAllianceId: "native-alliance", ashedAllianceId: "native-alliance", connection: null });
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member-alpha", score: "1234567", frameIndex: 0 }));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "review", allianceId: "native-alliance" }));
    expect(mocks.getAshedConnection).not.toHaveBeenCalled();
    expect(mocks.loadAshedConnectionForAllianceCapability).not.toHaveBeenCalled();
    expect(mocks.resolveSessionAllianceId).not.toHaveBeenCalled();
    expect(mocks.resolveHqAllianceIdFromSession).not.toHaveBeenCalled();
    expect(mocks.base44ListMembers).not.toHaveBeenCalled();
    expect(mocks.ocrAllFrames).not.toHaveBeenCalled();
    expect(mocks.mockOcrScoreFrames).not.toHaveBeenCalled();
    expect(mocks.maybeEnqueueShadowPass).not.toHaveBeenCalled();
    expect(mocks.maybeEnqueueShadowPassEarly).not.toHaveBeenCalled();
  });

  it("returns Ashed VS to pending approval when credentials are missing", async () => {
    mocks.loadAllianceVideoOcrContext.mockResolvedValue({ allianceOperatingMode: "ashed", allianceHqOcrOnly: false });
    await expect(processVideoJob(job.id)).rejects.toMatchObject({ code: "ashed_not_connected" });
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "pending_approval", processingSessionId: null }));
    expect(mocks.ocrVsNativeFrames).not.toHaveBeenCalled();
  });

  it("fails a native OCR error rather than falling back to mock or Ashed", async () => {
    mocks.ocrVsNativeFrames.mockRejectedValue(new Error("OCR frame failed"));
    await expect(processVideoJob(job.id)).rejects.toThrow("OCR frame failed");
    expect(mocks.mockOcrScoreFrames).not.toHaveBeenCalled();
    expect(mocks.ocrAllFrames).not.toHaveBeenCalled();
  });
});
