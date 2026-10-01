import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  requireSessionPermission: vi.fn(),
  resolveChatVideoUpload: vi.fn(),
  activateChatVideoUpload: vi.fn(),
  assertChatVideoTempFile: vi.fn(),
  failChatVideoUpload: vi.fn(),
  completeR2MultipartUpload: vi.fn(),
  headR2ObjectSize: vi.fn(),
  r2Configured: vi.fn(),
  streamObjectToFile: vi.fn(),
  selectLimit: vi.fn(),
}));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/rbac/require-permission", () => mocks);
vi.mock("@/lib/storage/r2", () => mocks);
vi.mock("@/lib/storage", () => ({ streamObjectToFile: mocks.streamObjectToFile }));
vi.mock("@/lib/video/activate-pending-upload", () => ({ activatePendingVideoUpload: vi.fn() }));
vi.mock("@/lib/video/chat-upload.server", () => ({
  resolveChatVideoUpload: mocks.resolveChatVideoUpload,
  activateChatVideoUpload: mocks.activateChatVideoUpload,
  assertChatVideoTempFile: mocks.assertChatVideoTempFile,
  failChatVideoUpload: mocks.failChatVideoUpload,
  chatUploadErrorResponse: () => NextResponse.json({ error: "fail" }, { status: 500 }),
}));
vi.mock("@/lib/db", async () => ({
  schema: await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
  }),
}));
vi.mock("node:fs/promises", () => ({ default: { unlink: vi.fn().mockResolvedValue(undefined) } }));

import { POST } from "./route";

const session = { id: "session-1", hqUserId: "hq-1", currentAllianceId: "alliance-1" };
const job = {
  id: "job-1", sessionId: "session-1", status: "pending_upload",
  scoreTarget: "officer-chat-video", storageKey: "staging/chat.mp4",
  groupId: "group-1", r2UploadId: "upload-1", expectedFileSizeBytes: 1024,
  knowledgeImportId: "import-1", fileName: "chat.mp4", allianceId: "alliance-1",
};
const context = {
  actor: { hqUserId: "hq-1", allianceId: "alliance-1" },
  record: { id: "import-1", sourceVideoJobId: "job-1" },
  asset: { id: "asset-1", stagingKey: "staging/chat.mp4", sealedKey: null, contentType: "video/mp4" },
};

function request(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/complete", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue(session);
  mocks.r2Configured.mockReturnValue(true);
  mocks.selectLimit.mockResolvedValue([job]);
  mocks.resolveChatVideoUpload.mockResolvedValue({ context });
  mocks.headR2ObjectSize.mockResolvedValue(1024);
  mocks.streamObjectToFile.mockResolvedValue(1024);
  mocks.assertChatVideoTempFile.mockResolvedValue({ durationSeconds: 90 });
  mocks.failChatVideoUpload.mockResolvedValue(undefined);
  mocks.completeR2MultipartUpload.mockResolvedValue(undefined);
  mocks.activateChatVideoUpload.mockResolvedValue(undefined);
});

describe("chat video complete", () => {
  const body = { jobId: "job-1", uploadId: "upload-1", parts: [{ partNumber: 1, etag: "e" }] };

  it("seals and activates a valid upload without VIDEO_ENQUEUE_PERMISSION", async () => {
    const response = await request(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: "job-1", status: "pending_approval" });
    expect(mocks.requireSessionPermission).not.toHaveBeenCalled();
    expect(mocks.completeR2MultipartUpload).toHaveBeenCalledWith("staging/chat.mp4", "upload-1", body.parts);
    expect(mocks.activateChatVideoUpload).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1", importId: "import-1", assetId: "asset-1", storageKey: "staging/chat.mp4",
    }));
  });

  it("rejects multipart upload id mismatch", async () => {
    const response = await request({ ...body, uploadId: "wrong" });
    expect(response.status).toBe(400);
    expect(mocks.completeR2MultipartUpload).not.toHaveBeenCalled();
  });

  it.each([
    { name: "too many parts", parts: [{ partNumber: 1, etag: "e" }, { partNumber: 2, etag: "f" }] },
    { name: "out-of-range part", parts: [{ partNumber: 2, etag: "e" }] },
    { name: "empty part list", parts: [] },
  ])("rejects malformed part list: $name", async ({ parts }) => {
    const response = await request({ ...body, parts });
    expect(response.status).toBe(400);
    expect(mocks.completeR2MultipartUpload).not.toHaveBeenCalled();
    expect(mocks.activateChatVideoUpload).not.toHaveBeenCalled();
  });

  it("requires the exact declared part count when more than one part is expected", async () => {
    mocks.selectLimit.mockResolvedValue([{ ...job, expectedFileSizeBytes: 11 * 1024 * 1024 }]);
    mocks.headR2ObjectSize.mockResolvedValue(11 * 1024 * 1024);
    const parts = [
      { partNumber: 1, etag: "e" },
      { partNumber: 2, etag: "f" },
    ];
    const ok = await request({ ...body, parts });
    expect(ok.status).toBe(200);
    expect(mocks.completeR2MultipartUpload).toHaveBeenCalledWith("staging/chat.mp4", "upload-1", parts);

    mocks.completeR2MultipartUpload.mockClear();
    const response = await request({ ...body, parts: [parts[0]] });
    expect(response.status).toBe(400);
    expect(mocks.completeR2MultipartUpload).not.toHaveBeenCalled();
  });

  it("rejects declared vs actual size mismatch", async () => {
    mocks.headR2ObjectSize.mockResolvedValue(1024 * 1024);
    const response = await request(body);
    expect(response.status).toBe(400);
    expect(mocks.activateChatVideoUpload).not.toHaveBeenCalled();
  });

  it("rejects when the import link or asset staging key diverges", async () => {
    mocks.resolveChatVideoUpload.mockResolvedValue({
      context: { ...context, record: { ...context.record, sourceVideoJobId: "other" } },
    });
    const response = await request(body);
    expect(response.status).toBe(409);
    expect(mocks.activateChatVideoUpload).not.toHaveBeenCalled();
  });

  it("does not activate when signature or duration validation fails", async () => {
    mocks.assertChatVideoTempFile.mockRejectedValue(new Error("Chat video exceeds the 2 minute limit."));
    const response = await request(body);
    expect(response.status).toBe(400);
    expect(mocks.activateChatVideoUpload).not.toHaveBeenCalled();
  });
});
