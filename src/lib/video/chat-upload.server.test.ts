import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class KnowledgeAccessError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    requireSessionPermission: vi.fn(),
    getKnowledgeActorForSession: vi.fn(),
    recheckKnowledgeActor: vi.fn(),
    getOwnedHistoryImport: vi.fn(),
    assetRows: [] as Array<Record<string, unknown>>,
    transaction: vi.fn(),
    insertValues: vi.fn(),
    updateSet: vi.fn(),
    forResults: [] as Array<Array<Record<string, unknown>>>,
    returningRows: undefined as unknown,
    KnowledgeAccessError,
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"),
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: async () => mocks.assetRows, limit: async () => mocks.assetRows }) }),
    }),
    transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/rbac/require-permission", () => mocks);
vi.mock("@/lib/notes/access.server", () => mocks);
vi.mock("@/lib/notes/imports.server", () => mocks);
vi.mock("@/lib/notes/resources.server", () => ({
  KnowledgeAccessError: mocks.KnowledgeAccessError,
  recheckKnowledgeActor: mocks.recheckKnowledgeActor,
}));
vi.mock("@/lib/storage/r2", () => ({}));
vi.mock("@/lib/bff/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/events/video-jobs", () => ({ emitVideoJobStatus: vi.fn() }));
vi.mock("@/lib/video/frame-extractor", () => ({ probeVideoDurationSeconds: vi.fn() }));

import { NextResponse } from "next/server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import {
  chatAssetMatches,
  createChatVideoUploadJob,
  discardChatVideoUploadSetup,
  resolveChatVideoUpload,
} from "./chat-upload.server";
import { CHAT_VIDEO_EXTRACTION_CONFIG, OFFICER_CHAT_VIDEO_TARGET } from "./chat-video.shared";

const session = { id: "session-1", hqUserId: "hq-1", currentAllianceId: "alliance-1" };
const actor = { canCreate: true, isOfficer: true, kind: "web", allianceId: "alliance-1", hqUserId: "hq-1", sessionId: "session-1" };
const record = { id: "import-1", kind: "video", state: "uploading", allianceId: "alliance-1", resourceId: "res-1", sourceVideoJobId: null };
const asset = {
  id: "asset-1", importId: "import-1", allianceId: "alliance-1", position: 0,
  name: "chat.mp4", size: 1024, contentType: "video/mp4",
  stagingKey: "staging/chat.mp4", sealedKey: null, r2UploadId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionPermission.mockResolvedValue(null);
  mocks.getKnowledgeActorForSession.mockResolvedValue(actor);
  mocks.recheckKnowledgeActor.mockResolvedValue(actor);
  mocks.getOwnedHistoryImport.mockResolvedValue(record);
  mocks.assetRows = [asset];
  mocks.returningRows = undefined;
  mocks.forResults = [];
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      insert: () => ({ values: mocks.insertValues }),
      update: () => ({
        set: () => ({
          where: () => {
            const rows = (mocks.returningRows ?? [{ id: "row-1" }]) as unknown[];
            const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
              returning: () => Promise<unknown[]>;
            };
            thenable.returning = async () => rows;
            return thenable;
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => mocks.forResults.shift() ?? [],
          }),
        }),
      }),
      execute: async () => undefined,
    }),
  );
});

describe("resolveChatVideoUpload", () => {
  it("requires a knowledge import id", async () => {
    const result = await resolveChatVideoUpload(session, null);
    expect("response" in result && result.response.status).toBe(400);
  });

  it("denies callers without notes:create", async () => {
    mocks.requireSessionPermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const result = await resolveChatVideoUpload(session, "import-1");
    expect("response" in result && result.response.status).toBe(403);
    expect(mocks.getOwnedHistoryImport).not.toHaveBeenCalled();
  });

  it.each([
    { name: "non-owner foreign actor", actor: { ...actor, allianceId: "other-alliance" } },
    { name: "actor without create", actor: { ...actor, canCreate: false } },
    { name: "non-officer actor", actor: { ...actor, isOfficer: false } },
    { name: "no actor", actor: null },
  ])("rejects $name", async ({ actor: badActor }) => {
    mocks.getKnowledgeActorForSession.mockResolvedValue(badActor);
    const result = await resolveChatVideoUpload(session, "import-1");
    expect("response" in result && result.response.status).toBe(403);
  });

  it.each([
    { name: "non-video kind", record: { ...record, kind: "text" } },
    { name: "already queued", record: { ...record, state: "queued" } },
    { name: "committed", record: { ...record, state: "committed" } },
  ])("rejects $name imports", async ({ record: badRecord }) => {
    mocks.getOwnedHistoryImport.mockResolvedValue(badRecord);
    const result = await resolveChatVideoUpload(session, "import-1");
    expect("response" in result).toBe(true);
  });

  it("rejects imports without exactly one asset", async () => {
    mocks.assetRows = [asset, { ...asset, id: "asset-2" }];
    const result = await resolveChatVideoUpload(session, "import-1");
    expect("response" in result).toBe(true);
  });

  it("returns the owner context for a valid uploading video import", async () => {
    const result = await resolveChatVideoUpload(session, "import-1");
    expect("context" in result && result.context.asset.id).toBe("asset-1");
  });
});

describe("chatAssetMatches", () => {
  const file = { name: "chat.mp4", size: 1024, contentType: "video/mp4" };
  it("requires exact name, size, and content type", () => {
    expect(chatAssetMatches(asset as never, file)).toBe(true);
    expect(chatAssetMatches(asset as never, { ...file, name: "other.mp4" })).toBe(false);
    expect(chatAssetMatches(asset as never, { ...file, size: 2048 })).toBe(false);
    expect(chatAssetMatches(asset as never, { ...file, contentType: "video/webm" })).toBe(false);
    expect(chatAssetMatches(asset as never, { ...file, contentType: "image/png" })).toBe(false);
    expect(chatAssetMatches(asset as never, { ...file, size: 0 })).toBe(false);
  });
});

describe("createChatVideoUploadJob", () => {
  const lockedResource = { id: "res-1", archivedAt: null, ownershipState: "hq", ownerHqUserId: "hq-1" };
  const createInput = () => ({
    importId: record.id,
    storageKey: asset.stagingKey,
    fileName: asset.name,
    fileSizeBytes: asset.size,
    status: "pending_upload" as const,
  });
  const happyLocks = () => {
    mocks.forResults = [
      [record],
      [lockedResource],
      [asset],
    ];
  };

  it("creates hidden-target group + job and links the import atomically", async () => {
    happyLocks();
    const { jobId, groupId } = await createChatVideoUploadJob(actor as never, createInput());
    expect(jobId).toBeTruthy();
    expect(groupId).toBeTruthy();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.recheckKnowledgeActor).toHaveBeenCalled();
    const [groupValues, jobValues] = mocks.insertValues.mock.calls.map((call) => call[0]);
    expect(groupValues).toMatchObject({ scoreTarget: OFFICER_CHAT_VIDEO_TARGET, boardKey: null, hqEventId: null });
    expect(jobValues).toMatchObject({
      status: "pending_upload",
      scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
      storageKey: asset.stagingKey,
      knowledgeImportId: record.id,
      extractionConfigJson: CHAT_VIDEO_EXTRACTION_CONFIG,
    });
  });

  it.each([
    { name: "membership revoked between resolve and create", forResults: [[record], [lockedResource], [asset]], recheck: () => { mocks.recheckKnowledgeActor.mockRejectedValue(new mocks.KnowledgeAccessError("forbidden")); } },
    { name: "import cancelled between resolve and create", forResults: [[{ ...record, state: "cancelled" }]] },
    { name: "import already linked between resolve and create", forResults: [[{ ...record, sourceVideoJobId: "job-other" }]] },
    { name: "resource archived between resolve and create", forResults: [[record], [{ ...lockedResource, archivedAt: new Date() }]] },
    { name: "resource ownership transferred", forResults: [[record], [{ ...lockedResource, ownerHqUserId: "hq-2" }]] },
    { name: "asset sealed between resolve and create", forResults: [[record], [lockedResource], [{ ...asset, sealedKey: "done" }]] },
    { name: "asset replaced between resolve and create", forResults: [[record], [lockedResource], [{ ...asset, stagingKey: "staging/other.mp4" }]] },
  ])("rolls back everything on race: $name", async ({ forResults, recheck }) => {
    mocks.forResults = forResults;
    recheck?.();
    await expect(createChatVideoUploadJob(actor as never, createInput())).rejects.toBeInstanceOf(KnowledgeAccessError);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rolls back inserts when the import link CAS loses to another job", async () => {
    happyLocks();
    mocks.returningRows = [];
    await expect(createChatVideoUploadJob(actor as never, createInput())).rejects.toBeInstanceOf(KnowledgeAccessError);
    expect(mocks.insertValues).toHaveBeenCalledTimes(2);
  });
});

describe("discardChatVideoUploadSetup", () => {
  it("clears the import link and asset upload id and deletes job and group", async () => {
    const whereCalls: unknown[] = [];
    const deleted: string[] = [];
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        update: () => ({
          set: () => ({
            where: (w: unknown) => {
              whereCalls.push(w);
              const thenable = Promise.resolve([{ id: "row" }]) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
              thenable.returning = async () => [{ id: "row" }];
              return thenable;
            },
          }),
        }),
        delete: () => ({ where: () => { deleted.push("row"); return Promise.resolve(); } }),
        execute: async () => undefined,
      }),
    );
    await discardChatVideoUploadSetup({
      importId: "import-1",
      jobId: "job-1",
      groupId: "group-1",
      assetId: "asset-1",
      storageKey: "staging/chat.mp4",
      uploadId: null,
      allianceId: "alliance-1",
    });
    expect(deleted).toHaveLength(2);
    expect(whereCalls.length).toBe(2);
  });
});
