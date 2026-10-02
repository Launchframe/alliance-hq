import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  requireSessionPermission: vi.fn(),
  resolveChatVideoUpload: vi.fn(),
  createChatVideoUploadJob: vi.fn(),
  discardChatVideoUploadSetup: vi.fn(),
  createR2MultipartUpload: vi.fn(),
  presignR2PutObject: vi.fn(),
  presignR2UploadPart: vi.fn(),
  abortR2MultipartUpload: vi.fn(),
  r2Configured: vi.fn(),
}));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/rbac/require-permission", () => mocks);
vi.mock("@/lib/storage/r2", () => mocks);
vi.mock("@/lib/storage", () => ({ videoStorageKey: () => "videos/key.mp4" }));
vi.mock("@/lib/video/chat-upload.server", () => ({
  resolveChatVideoUpload: mocks.resolveChatVideoUpload,
  createChatVideoUploadJob: mocks.createChatVideoUploadJob,
  discardChatVideoUploadSetup: mocks.discardChatVideoUploadSetup,
  chatAssetMatches: (asset: { name: string; size: number; contentType: string }, file: { name: string; size: number; contentType: string }) =>
    asset.name === file.name && asset.size === file.size && asset.contentType === file.contentType,
  chatUploadErrorResponse: (error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/banks/resolve-deposit-slip-upload-bank-id.server", () => ({ resolveDepositSlipUploadBankId: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db", async () => ({
  getDb: () => ({
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
  }),
  schema: await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"),
}));

import { POST } from "./route";

const session = { id: "session-1", hqUserId: "hq-1", currentAllianceId: "alliance-1" };
const asset = { id: "asset-1", name: "chat.mp4", size: 5 * 1024 * 1024, contentType: "video/mp4", stagingKey: "staging/chat.mp4" };
const record = { id: "import-1", kind: "video", state: "uploading" };

function request(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/init", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue(session);
  mocks.r2Configured.mockReturnValue(true);
  mocks.requireSessionPermission.mockResolvedValue(null);
  mocks.resolveChatVideoUpload.mockResolvedValue({ context: { actor: { hqUserId: "hq-1", allianceId: "alliance-1" }, record, asset } });
  mocks.createChatVideoUploadJob.mockResolvedValue({ jobId: "job-1", groupId: "group-1" });
  mocks.discardChatVideoUploadSetup.mockResolvedValue(undefined);
  mocks.presignR2PutObject.mockResolvedValue("https://r2/put");
});

describe("chat video init", () => {
  const body = { fileName: "chat.mp4", fileSize: asset.size, contentType: "video/mp4", scoreTarget: "officer-chat-video", knowledgeImportId: "import-1" };

  it("creates an r2_put session on the asset staging key without VIDEO_ENQUEUE_PERMISSION", async () => {
    const response = await request(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "r2_put", jobId: "job-1", storageKey: "staging/chat.mp4" });
    expect(mocks.requireSessionPermission).not.toHaveBeenCalled();
    expect(mocks.createChatVideoUploadJob).toHaveBeenCalledWith(
      expect.objectContaining({ hqUserId: "hq-1", allianceId: "alliance-1" }),
      expect.objectContaining({
        importId: "import-1", storageKey: "staging/chat.mp4", status: "pending_upload",
      }),
    );
  });

  it("rolls back the job and link when presigning fails after setup", async () => {
    mocks.presignR2PutObject.mockRejectedValue(new Error("r2 down"));
    const response = await request(body);
    expect(response.status).toBe(500);
    expect(mocks.discardChatVideoUploadSetup).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1", groupId: "group-1", importId: "import-1", assetId: "asset-1",
      storageKey: "staging/chat.mp4", uploadId: null, allianceId: "alliance-1",
    }));
  });

  it("rejects uploads that do not match the declared asset", async () => {
    const response = await request({ ...body, fileName: "other.mp4" });
    expect(response.status).toBe(400);
    expect(mocks.createChatVideoUploadJob).not.toHaveBeenCalled();
  });

  it("surfaces ownership denial from the resolver", async () => {
    mocks.resolveChatVideoUpload.mockResolvedValue({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await request(body)).status).toBe(403);
    expect(mocks.createChatVideoUploadJob).not.toHaveBeenCalled();
  });

  it("falls back to direct mode when R2 is not configured", async () => {
    mocks.r2Configured.mockReturnValue(false);
    const response = await request(body);
    expect(await response.json()).toMatchObject({ mode: "direct" });
    expect(mocks.resolveChatVideoUpload).toHaveBeenCalled();
    expect(mocks.createChatVideoUploadJob).not.toHaveBeenCalled();
  });

  it("still authorizes chat init when R2 is not configured", async () => {
    mocks.r2Configured.mockReturnValue(false);
    mocks.resolveChatVideoUpload.mockResolvedValue({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await request(body)).status).toBe(403);
    expect(mocks.createChatVideoUploadJob).not.toHaveBeenCalled();
  });

  it("enforces the declared size ceiling before ownership work", async () => {
    const response = await request({ ...body, fileSize: 2 * 1024 * 1024 * 1024 });
    expect(response.status).toBe(400);
    expect(mocks.resolveChatVideoUpload).not.toHaveBeenCalled();
  });
});
