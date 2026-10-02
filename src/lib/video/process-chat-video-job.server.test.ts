import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  claimVideoJobForProcessing: vi.fn(),
  historyMemberMayProcess: vi.fn(),
  streamObjectToFile: vi.fn(),
  deleteObject: vi.fn(),
  assertChatVideoTempFile: vi.fn(),
  emitVideoJobStatus: vi.fn(),
  writeAuditLog: vi.fn(),
  extractChatVideoFrames: vi.fn(),
  resolveChatFrameParser: vi.fn(),
  resolveOfficerChatLocaleText: vi.fn(),
  buildChatMediaArtifacts: vi.fn(),
  dedupeMediaArtifacts: vi.fn(),
  uploadChatMediaArtifacts: vi.fn(),
  touchKnowledgeResource: vi.fn(),
  txReturning: [] as Array<Array<Record<string, unknown>>>,
  inserted: { messages: [] as unknown[][], media: [] as unknown[][] },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
    update: () => ({ set: mocks.update }),
    transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/video/claim-video-job-for-processing.server", () => mocks);
vi.mock("@/lib/notes/jobs.server", () => mocks);
vi.mock("@/lib/notes/resources.server", () => mocks);
vi.mock("@/lib/storage", () => ({
  streamObjectToFile: mocks.streamObjectToFile,
  deleteObject: mocks.deleteObject,
}));
vi.mock("@/lib/video/chat-upload.server", () => ({
  assertChatVideoTempFile: mocks.assertChatVideoTempFile,
}));
vi.mock("@/lib/video/chat-frames.server", () => ({
  extractChatVideoFrames: mocks.extractChatVideoFrames,
}));
vi.mock("@/lib/video/chat-vision.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video/chat-vision.server")>()),
  resolveChatFrameParser: mocks.resolveChatFrameParser,
}));
vi.mock("@/lib/video/chat-media.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video/chat-media.server")>()),
  buildChatMediaArtifacts: mocks.buildChatMediaArtifacts,
  dedupeMediaArtifacts: mocks.dedupeMediaArtifacts,
  uploadChatMediaArtifacts: mocks.uploadChatMediaArtifacts,
}));
vi.mock("@/lib/officer-intel/locale-text.server", () => ({
  resolveOfficerChatLocaleText: mocks.resolveOfficerChatLocaleText,
}));
vi.mock("@/lib/events/video-jobs", () => mocks);
vi.mock("@/lib/bff/audit", () => mocks);
vi.mock("node:fs/promises", () => ({ default: { unlink: vi.fn().mockResolvedValue(undefined) } }));

import { processChatVideoJob } from "./process-chat-video-job.server";
import { OFFICER_CHAT_VIDEO_TARGET } from "./chat-video.shared";

const job = {
  id: "job-chat", status: "queued", fileName: "chat.mp4", fileSizeBytes: 1024,
  scoreTarget: OFFICER_CHAT_VIDEO_TARGET, category: OFFICER_CHAT_VIDEO_TARGET,
  storageKey: "staging/chat.mp4", sessionId: "session-1", allianceId: "alliance-1",
  knowledgeImportId: "import-1", timingsJson: null,
  hqUserId: "hq-1", enqueuedByHqUserId: "hq-1",
};
const record = {
  id: "import-1", kind: "video", state: "pending_approval", allianceId: "alliance-1",
  resourceId: "res-1", sourceVideoJobId: "job-chat",
};
const resource = { id: "res-1", allianceId: "alliance-1", archivedAt: null, ownershipState: "hq", ownerHqUserId: "hq-1" };
const asset = { id: "asset-1", importId: "import-1", allianceId: "alliance-1", stagingKey: "staging/chat.mp4", sealedKey: "staging/chat.mp4", contentType: "video/mp4" };

const frame = {
  frameIndex: 0, png: Buffer.from("png"), filePath: "/tmp/f0.png", timestampMs: 0,
  frameHash: "hash-0", width: 400, height: 300, sharpness: 0.5,
  fingerprint: new Uint8Array(256),
};
const parsedMessage = {
  localId: "m0", sender: "Officer", originalText: "hello there", detectedLanguage: "en",
  confidence: 0.95, box: { x: 0.05, y: 0.1, width: 0.8, height: 0.08 },
  isReply: false, replyToName: null, replyExcerpt: null, coordinates: null,
};
const parsedMedia = {
  kind: "embedded" as const, box: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
  messageLocalId: "m0", confidence: 0.9,
};
const artifact = {
  media: { ...parsedMedia, sourceFrameIndex: 0, sourceTimestampMs: 0, messageIndex: 0 as number | null },
  mediaId: "media-1", storageKey: "notes-history/import-1/media/media-1.png",
  thumbnailStorageKey: "notes-history/import-1/media/media-1.webp",
  contentType: "image/png", sha256: "sha", width: 160, height: 120,
  sharpness: 0.5, fingerprint: new Uint8Array(256),
  png: Buffer.from("png"), thumb: Buffer.from("webp"),
};

function setCalls() {
  return mocks.update.mock.calls.map((call) => call[0]);
}

function parseOutput(overrides?: { messages?: unknown[]; media?: unknown[] }) {
  return {
    parse: vi.fn().mockResolvedValue({
      messages: overrides?.messages ?? [parsedMessage],
      media: overrides?.media ?? [],
    }),
    model: "gpt-test",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectLimit.mockResolvedValue([job]);
  mocks.claimVideoJobForProcessing.mockResolvedValue("claimed");
  mocks.historyMemberMayProcess.mockResolvedValue({ id: "member-1" });
  mocks.streamObjectToFile.mockResolvedValue(1024);
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.assertChatVideoTempFile.mockResolvedValue({ durationSeconds: 90 });
  mocks.extractChatVideoFrames.mockResolvedValue({ frames: [frame], videoDurationSeconds: 90 });
  mocks.resolveChatFrameParser.mockReturnValue(parseOutput());
  mocks.resolveOfficerChatLocaleText.mockResolvedValue({ localeText: "hello there", localeCode: "en-US", translationUnavailable: false });
  mocks.buildChatMediaArtifacts.mockImplementation((items: unknown[]) =>
    Promise.resolve((items as unknown[]).length ? [artifact] : []),
  );
  mocks.dedupeMediaArtifacts.mockImplementation((items: unknown[]) => items);
  mocks.uploadChatMediaArtifacts.mockResolvedValue([]);
  mocks.emitVideoJobStatus.mockResolvedValue(undefined);
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.update.mockReturnValue({
    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: job.id }]) }),
  });
  mocks.txReturning = [];
  mocks.inserted = { messages: [], media: [] };
  let txCalls = 0;
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    txCalls += 1;
    const selects = txCalls === 1 ? [[record], [resource], [asset]] : [];
    const rows = () => selects.shift() ?? [];
    const chain = () => {
      const value = Promise.resolve(rows());
      return Object.assign(value, { limit: async () => value });
    };
    const tx = {
      select: () => ({ from: () => ({ where: () => chain() }) }),
      insert: () => ({
        values: (values: unknown[]) => {
          const bucket = (values[0] as Record<string, unknown> | undefined)?.storageKey != null
            ? mocks.inserted.media
            : mocks.inserted.messages;
          bucket.push(values);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (value: unknown) => {
          mocks.update(value);
          return {
            where: () => {
              const rowsOut = mocks.txReturning.shift() ?? [{ id: "x" }];
              const thenable = Promise.resolve(rowsOut) as Promise<unknown[]> & {
                returning: () => Promise<unknown[]>;
              };
              thenable.returning = async () => rowsOut;
              return thenable;
            },
          };
        },
      }),
    };
    return fn(tx);
  });
});

describe("processChatVideoJob", () => {
  it("persists stitched messages/media with provenance and parks job/import at review", async () => {
    const timings = await processChatVideoJob(job.id);
    expect(timings.videoDurationSeconds).toBe(90);
    expect(timings.frameCount).toBe(1);
    const inserted = mocks.inserted.messages[0]![0]! as Record<string, unknown>;
    expect(inserted).toEqual(expect.objectContaining({
      sessionId: record.id,
      originalText: "hello there",
      localeText: "hello there",
      localeCode: "en-US",
      historyIncluded: true,
      historyReviewed: false,
      sourceImageIndex: 0,
      parserProvenance: expect.objectContaining({ provider: "openai", model: "gpt-test", configVersion: "chat-video-v1", frameHash: "hash-0" }),
    }));
    const sets = setCalls();
    expect(sets).toContainEqual(expect.objectContaining({ status: "review", errorMessage: null }));
    expect(sets).toContainEqual(expect.objectContaining({ state: "review" }));
    expect(sets).not.toContainEqual(expect.objectContaining({ errorMessage: "chat_parser_pending" }));
    expect(mocks.touchKnowledgeResource).toHaveBeenCalled();
    expect(mocks.emitVideoJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "review", scoreTarget: OFFICER_CHAT_VIDEO_TARGET }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "video.parse_complete",
      resourceId: job.id,
      metadata: expect.objectContaining({ importId: record.id, messageCount: 1, mediaCount: 0 }),
    }));
  });

  it("does not auto-include empty-text stubs that only exist to hold media", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({
      messages: [{ ...parsedMessage, originalText: "   " }],
      media: [parsedMedia],
    }));
    mocks.uploadChatMediaArtifacts.mockResolvedValue([artifact.storageKey, artifact.thumbnailStorageKey]);
    await processChatVideoJob(job.id);
    expect(mocks.inserted.messages[0]![0]).toEqual(expect.objectContaining({
      originalText: "   ",
      historyIncluded: false,
    }));
    expect(mocks.inserted.media[0]![0]).toEqual(expect.objectContaining({
      messageId: (mocks.inserted.messages[0]![0] as { id: string }).id,
    }));
  });

  it("flags reply_unresolved when the reply target is dropped as empty", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({
      messages: [
        { ...parsedMessage, localId: "target", sender: "Rhea", originalText: "   " },
        {
          ...parsedMessage,
          localId: "reply",
          originalText: "on my way",
          isReply: true,
          replyToName: "Rhea",
          replyExcerpt: "   ",
        },
      ],
    }));
    await processChatVideoJob(job.id);
    expect(mocks.inserted.messages[0]).toHaveLength(1);
    expect(mocks.inserted.messages[0]![0]).toEqual(expect.objectContaining({
      originalText: "on my way",
      isReply: true,
      replyToMessageId: null,
      replyMatchConfidence: null,
      reviewReasons: expect.arrayContaining(["reply_unresolved"]),
    }));
  });

  it("does not mark the import failed when job.allianceId is missing", async () => {
    mocks.selectLimit.mockResolvedValue([{ ...job, allianceId: null }]);
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost import linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ state: "failed" }));
  });

  it("succeeds with media-only content and links the media to its stitched message", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({ media: [parsedMedia] }));
    mocks.uploadChatMediaArtifacts.mockResolvedValue([artifact.storageKey, artifact.thumbnailStorageKey]);
    await processChatVideoJob(job.id);
    expect(mocks.inserted.media[0]![0]).toEqual(expect.objectContaining({
      sessionId: record.id,
      kind: "embedded",
      storageKey: artifact.storageKey,
      reviewed: false,
    }));
    const messageId = (mocks.inserted.messages[0]![0]! as { id: string }).id;
    expect((mocks.inserted.media[0]![0]! as { messageId: string }).messageId).toBe(messageId);
  });

  it("succeeds with media-only content", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(
      parseOutput({ messages: [], media: [{ ...parsedMedia, messageLocalId: null }] }),
    );
    mocks.buildChatMediaArtifacts.mockResolvedValue([
      { ...artifact, media: { ...artifact.media, messageIndex: null, messageLocalId: null } },
    ]);
    mocks.uploadChatMediaArtifacts.mockResolvedValue([artifact.storageKey, artifact.thumbnailStorageKey]);
    await processChatVideoJob(job.id);
    expect(mocks.inserted.messages).toHaveLength(0);
    expect(mocks.inserted.media[0]![0]).toEqual(expect.objectContaining({ messageId: null, kind: "embedded" }));
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "review", errorMessage: null }));
  });

  it("flags translation_unavailable and keeps original text when translation is unavailable", async () => {
    mocks.resolveOfficerChatLocaleText.mockResolvedValue({ localeText: "hello there", localeCode: "en-US", translationUnavailable: true });
    await processChatVideoJob(job.id);
    const inserted = mocks.inserted.messages[0]![0]! as { reviewReasons: string[] };
    expect(inserted.reviewReasons).toContain("translation_unavailable");
  });

  it("fails with chat_no_content when stitching yields no messages and no media", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({ messages: [], media: [] }));
    await expect(processChatVideoJob(job.id)).rejects.toThrow("chat_no_content");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ status: "review" }));
  });

  it("fails with chat_parser_not_configured when no provider is configured", async () => {
    mocks.resolveChatFrameParser.mockImplementation(() => {
      throw new Error("chat_parser_not_configured");
    });
    await expect(processChatVideoJob(job.id)).rejects.toThrow("chat_parser_not_configured");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed", errorMessage: "chat_parser_not_configured" }));
  });

  it("cleans every created media object and leaves no review state when persistence loses the CAS race", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({ media: [parsedMedia] }));
    mocks.uploadChatMediaArtifacts.mockResolvedValue([artifact.storageKey, artifact.thumbnailStorageKey]);
    mocks.txReturning = [[{ id: job.id }], []];
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost linkage");
    expect(mocks.deleteObject).toHaveBeenCalledWith(artifact.storageKey);
    expect(mocks.deleteObject).toHaveBeenCalledWith(artifact.thumbnailStorageKey);
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("fails job and import durably when import linkage or owner authority is lost", async () => {
    mocks.transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({ from: () => ({ where: async () => [], limit: async () => [] }) }),
      }),
    );
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost import linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(mocks.assertChatVideoTempFile).not.toHaveBeenCalled();
  });

  it("fails without queueing when the stored video exceeds the duration cap", async () => {
    mocks.assertChatVideoTempFile.mockRejectedValue(new Error("Chat video exceeds the 2 minute limit."));
    await expect(processChatVideoJob(job.id)).rejects.toThrow("2 minute");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("fails a tampered job whose uploader is not the resource owner, without review state", async () => {
    const selects = [[record], [{ ...resource, ownerHqUserId: "hq-9" }], [asset]];
    mocks.transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => {
              const value = Promise.resolve(selects.shift() ?? []);
              return Object.assign(value, { limit: async () => value });
            },
          }),
        }),
      }),
    );
    mocks.selectLimit.mockResolvedValue([{ ...job, enqueuedByHqUserId: "hq-9" }]);
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost import linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ status: "review" }));
    expect(mocks.assertChatVideoTempFile).not.toHaveBeenCalled();
  });

  it("rolls the checkpoint back when the job review CAS loses a race", async () => {
    mocks.txReturning = [[]];
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("stops before streaming when the import processing claim loses a race", async () => {
    mocks.update.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost import linkage");
    expect(mocks.streamObjectToFile).not.toHaveBeenCalled();
    expect(mocks.assertChatVideoTempFile).not.toHaveBeenCalled();
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("fails with chat_import_limit when stitched messages exceed the import cap, without translating or persisting", async () => {
    mocks.extractChatVideoFrames.mockResolvedValue({
      frames: Array.from({ length: 51 }, (_, i) => ({ ...frame, frameIndex: i, frameHash: `h${i}` })),
      videoDurationSeconds: 90,
    });
    mocks.resolveChatFrameParser.mockReturnValue({
      parse: vi.fn().mockImplementation((input: { frameIndex: number }) =>
        Promise.resolve({
          messages: Array.from({ length: 100 }, (_, i) => ({
            ...parsedMessage,
            localId: `f${input.frameIndex}-m${i}`,
            originalText: String(input.frameIndex * 100 + i),
          })),
          media: [],
        }),
      ),
      model: "gpt-test",
    });
    await expect(processChatVideoJob(job.id)).rejects.toThrow("chat_import_limit");
    expect(mocks.resolveOfficerChatLocaleText).not.toHaveBeenCalled();
    expect(mocks.buildChatMediaArtifacts).not.toHaveBeenCalled();
    expect(mocks.uploadChatMediaArtifacts).not.toHaveBeenCalled();
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed", errorMessage: "chat_import_limit" }));
  });

  it("fails with chat_import_limit when stitched media observations exceed the cap", async () => {
    mocks.extractChatVideoFrames.mockResolvedValue({
      frames: Array.from({ length: 9 }, (_, i) => ({ ...frame, frameIndex: i, frameHash: `h${i}` })),
      videoDurationSeconds: 90,
    });
    mocks.resolveChatFrameParser.mockReturnValue({
      parse: vi.fn().mockResolvedValue({
        messages: [],
        media: Array.from({ length: 30 }, () => ({ ...parsedMedia, messageLocalId: null })),
      }),
      model: "gpt-test",
    });
    await expect(processChatVideoJob(job.id)).rejects.toThrow("chat_import_limit");
    expect(mocks.buildChatMediaArtifacts).not.toHaveBeenCalled();
    expect(mocks.uploadChatMediaArtifacts).not.toHaveBeenCalled();
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed", errorMessage: "chat_import_limit" }));
  });

  it("fails with chat_import_limit when aggregate media bytes overflow before upload", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({ media: [parsedMedia] }));
    mocks.buildChatMediaArtifacts.mockRejectedValue(new Error("chat_import_limit"));
    await expect(processChatVideoJob(job.id)).rejects.toThrow("chat_import_limit");
    expect(mocks.uploadChatMediaArtifacts).not.toHaveBeenCalled();
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed", errorMessage: "chat_import_limit" }));
  });

  it("fails with chat_no_content when every media crop is rejected and no messages exist", async () => {
    mocks.resolveChatFrameParser.mockReturnValue(
      parseOutput({ messages: [], media: [{ ...parsedMedia, messageLocalId: null }] }),
    );
    mocks.buildChatMediaArtifacts.mockResolvedValue([]);
    await expect(processChatVideoJob(job.id)).rejects.toThrow("chat_no_content");
    expect(mocks.uploadChatMediaArtifacts).not.toHaveBeenCalled();
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed", errorMessage: "chat_no_content" }));
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ status: "review" }));
  });

  it("does not touch the import when the failed-job CAS loses to a concurrent state change", async () => {
    // The import claim CAS loses (stale linkage), then the failed-job update also
    // loses (job is no longer extracting): no import update may run at all.
    mocks.update
      .mockReturnValueOnce({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      })
      .mockReturnValueOnce({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      });
    await expect(processChatVideoJob(job.id)).rejects.toThrow("lost import linkage");
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ state: "failed" }));
  });

  it("resolves successfully when post-commit audit writing throws", async () => {
    mocks.writeAuditLog.mockRejectedValue(new Error("audit unavailable"));
    mocks.resolveChatFrameParser.mockReturnValue(parseOutput({ media: [parsedMedia] }));
    mocks.uploadChatMediaArtifacts.mockResolvedValue([artifact.storageKey, artifact.thumbnailStorageKey]);
    await processChatVideoJob(job.id);
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "review", errorMessage: null }));
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("returns stored timings without reclaiming a terminal job", async () => {
    mocks.selectLimit.mockResolvedValue([{ ...job, status: "review", timingsJson: { totalMs: 42 } }]);
    const timings = await processChatVideoJob(job.id);
    expect(timings.totalMs).toBe(42);
    expect(mocks.claimVideoJobForProcessing).not.toHaveBeenCalled();
  });
});
