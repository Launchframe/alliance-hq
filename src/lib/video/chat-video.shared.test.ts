import { describe, expect, it, vi } from "vitest";

import {
  CHAT_VIDEO_EXTRACTION_CONFIG,
  CHAT_VIDEO_MAX_DURATION_SECONDS,
  CHAT_VIDEO_MAX_SELECTED_FRAMES,
  OFFICER_CHAT_VIDEO_TARGET,
  isChatVideoSignature,
  isOfficerChatVideoTarget,
} from "./chat-video.shared";
import { videoQueueTargetLabelKey } from "./video-queue-display.shared";
import { uploadVideoFile } from "./client-upload";

describe("officer chat video target", () => {
  it("identifies only the hidden chat target", () => {
    expect(isOfficerChatVideoTarget(OFFICER_CHAT_VIDEO_TARGET)).toBe(true);
    expect(isOfficerChatVideoTarget("desert-storm")).toBe(false);
    expect(isOfficerChatVideoTarget(null)).toBe(false);
    expect(isOfficerChatVideoTarget(undefined)).toBe(false);
  });

  it("pins the lead-configured extraction pipeline", () => {
    expect(CHAT_VIDEO_MAX_DURATION_SECONDS).toBe(120);
    expect(CHAT_VIDEO_MAX_SELECTED_FRAMES).toBe(240);
    expect(CHAT_VIDEO_EXTRACTION_CONFIG).toEqual({
      mode: "scene",
      sceneThreshold: 0.08,
      sampleFps: 2,
      supplementFps: 2,
    });
  });

  it("labels queue rows without a score-target lookup", () => {
    expect(videoQueueTargetLabelKey(OFFICER_CHAT_VIDEO_TARGET)).toBe("chatLogs");
  });
});

describe("chat video signatures", () => {
  const head = (bytes: number[]) => new Uint8Array(bytes);
  it("accepts MP4/MOV ftyp and WebM EBML containers for their declared types", () => {
    const ftyp = head([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(isChatVideoSignature(ftyp, "video/mp4")).toBe(true);
    expect(isChatVideoSignature(ftyp, "video/quicktime")).toBe(true);
    expect(isChatVideoSignature(head([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), "video/webm")).toBe(true);
  });
  it("rejects truncated, mismatched, and non-video containers", () => {
    expect(isChatVideoSignature(head([0x1a, 0x45]), "video/webm")).toBe(false);
    expect(isChatVideoSignature(head([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), "video/mp4")).toBe(false);
    expect(isChatVideoSignature(head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "video/mp4")).toBe(false);
  });
});

describe("chat upload client request", () => {
  const file = { name: "chat.mp4", size: 1024, type: "video/mp4" } as File;
  const uploadConfig = {
    mode: "direct" as const,
    maxUploadBytes: 512 * 1024 * 1024,
    multipartThresholdBytes: 100 * 1024 * 1024,
    multipartPartBytes: 10 * 1024 * 1024,
    legacyDirectPostMaxBytes: 4 * 1024 * 1024,
  };

  it("allows knowledgeImportId only on the chat target", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("stop"));
    await expect(
      uploadVideoFile({
        file,
        scoreTarget: "desert-storm",
        knowledgeImportId: "import-1",
        uploadConfig,
      }),
    ).rejects.toThrow("knowledgeImportId is only valid for chat video uploads");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("requires knowledgeImportId on the chat target", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("stop"));
    await expect(
      uploadVideoFile({
        file,
        scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
        uploadConfig,
      }),
    ).rejects.toThrow("knowledgeImportId is required for chat video uploads");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("marks direct chat uploads in the URL so the route authorizes before parsing", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ jobId: "job-1", groupId: "group-1" }), { status: 200 }));
    await uploadVideoFile({
      file,
      scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
      knowledgeImportId: "import-1",
      uploadConfig,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tools/video-upload?scoreTarget=officer-chat-video&knowledgeImportId=import-1",
      expect.objectContaining({ method: "POST" }),
    );
    fetchSpy.mockRestore();
  });
});
