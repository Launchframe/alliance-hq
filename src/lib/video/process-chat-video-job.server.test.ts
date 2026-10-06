import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  claimVideoJobForProcessing: vi.fn(),
  historyMemberMayProcess: vi.fn(),
  streamObjectToFile: vi.fn(),
  assertChatVideoTempFile: vi.fn(),
  emitVideoJobStatus: vi.fn(),
  writeAuditLog: vi.fn(),
  txReturning: [] as Array<Array<Record<string, unknown>>>,
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
vi.mock("@/lib/storage", () => ({ streamObjectToFile: mocks.streamObjectToFile }));
vi.mock("@/lib/video/chat-upload.server", () => ({
  assertChatVideoTempFile: mocks.assertChatVideoTempFile,
}));
vi.mock("@/lib/events/video-jobs", () => mocks);
vi.mock("@/lib/bff/audit", () => mocks);
vi.mock("node:fs/promises", () => ({ default: { unlink: vi.fn().mockResolvedValue(undefined) } }));

import {
  CHAT_VIDEO_PARSER_PENDING,
  processChatVideoJobFoundation,
} from "./process-chat-video-job.server";
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

function setCalls() {
  return mocks.update.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectLimit.mockResolvedValue([job]);
  mocks.claimVideoJobForProcessing.mockResolvedValue("claimed");
  mocks.historyMemberMayProcess.mockResolvedValue({ id: "member-1" });
  mocks.streamObjectToFile.mockResolvedValue(1024);
  mocks.assertChatVideoTempFile.mockResolvedValue({ durationSeconds: 90 });
  mocks.emitVideoJobStatus.mockResolvedValue(undefined);
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.update.mockReturnValue({
    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: job.id }]) }),
  });
  mocks.txReturning = [];
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const selects = [[record], [resource], [asset]];
    const rows = () => selects.shift() ?? [];
    const chain = () => {
      const value = Promise.resolve(rows());
      return Object.assign(value, { limit: async () => value });
    };
    const tx = {
      select: () => ({ from: () => ({ where: () => chain() }) }),
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

describe("processChatVideoJobFoundation", () => {
  it("parks the claimed job at review with a parser-pending marker and the import at review", async () => {
    const timings = await processChatVideoJobFoundation(job.id);
    expect(timings.videoDurationSeconds).toBe(90);
    const sets = setCalls();
    expect(sets).toContainEqual(expect.objectContaining({ status: "review", errorMessage: CHAT_VIDEO_PARSER_PENDING }));
    expect(mocks.assertChatVideoTempFile).toHaveBeenCalled();
    expect(mocks.emitVideoJobStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "review", scoreTarget: OFFICER_CHAT_VIDEO_TARGET }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: job.id,
      metadata: expect.objectContaining({ importId: record.id, parserPending: true }),
    }));
  });

  it("fails job and import durably when import linkage or owner authority is lost", async () => {
    mocks.transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({ from: () => ({ where: async () => [] , limit: async () => [] }) }),
      }),
    );
    await expect(processChatVideoJobFoundation(job.id)).rejects.toThrow("lost import linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(mocks.assertChatVideoTempFile).not.toHaveBeenCalled();
  });

  it("fails without queueing when the stored video exceeds the duration cap", async () => {
    mocks.assertChatVideoTempFile.mockRejectedValue(new Error("Chat video exceeds the 2 minute limit."));
    await expect(processChatVideoJobFoundation(job.id)).rejects.toThrow("2 minute");
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
    await expect(processChatVideoJobFoundation(job.id)).rejects.toThrow("lost import linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(setCalls()).not.toContainEqual(expect.objectContaining({ status: "review" }));
    expect(mocks.assertChatVideoTempFile).not.toHaveBeenCalled();
  });

  it("rolls the checkpoint back when the import state CAS loses a race", async () => {
    mocks.txReturning = [[{ id: job.id }], []];
    await expect(processChatVideoJobFoundation(job.id)).rejects.toThrow("lost linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("rolls the checkpoint back when the job review CAS loses a race", async () => {
    mocks.txReturning = [[]];
    await expect(processChatVideoJobFoundation(job.id)).rejects.toThrow("lost linkage");
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("stops before streaming when the import processing claim loses a race", async () => {
    mocks.update.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    await expect(processChatVideoJobFoundation(job.id)).rejects.toThrow("lost import linkage");
    expect(mocks.streamObjectToFile).not.toHaveBeenCalled();
    expect(mocks.assertChatVideoTempFile).not.toHaveBeenCalled();
    expect(setCalls()).toContainEqual(expect.objectContaining({ status: "failed" }));
  });

  it("returns stored timings without reclaiming a terminal job", async () => {
    mocks.selectLimit.mockResolvedValue([{ ...job, status: "review", timingsJson: { totalMs: 42 } }]);
    const timings = await processChatVideoJobFoundation(job.id);
    expect(timings.totalMs).toBe(42);
    expect(mocks.claimVideoJobForProcessing).not.toHaveBeenCalled();
  });
});
