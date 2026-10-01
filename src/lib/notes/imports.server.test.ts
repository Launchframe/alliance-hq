import { beforeEach, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const mocks = vi.hoisted(() => {
  const imports = { id: "import.id", allianceId: "import.alliance", resourceId: "import.resource", updatedAt: "import.updatedAt" };
  const assets = { id: "asset.id", importId: "asset.import", allianceId: "asset.alliance" };
  return {
    imports,
    assets,
    transaction: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
    abort: vi.fn(),
    rows: [] as Array<Record<string, unknown>>,
    recheck: vi.fn(),
    lockResource: vi.fn(),
    touchResource: vi.fn(),
    memberMayProcess: vi.fn(),
    queueJob: vi.fn(),
    selectRows: [] as Array<Array<Record<string, unknown>>>,
    txSelect: [] as Array<Array<Record<string, unknown>>>,
    txSets: [] as unknown[],
    txWheres: [] as unknown[],
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: { ...await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"), knowledgeHistoryImports: mocks.imports, knowledgeHistoryAssets: mocks.assets },
  getDb: () => {
    const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: async () => mocks.rows };
    return {
      select: (selection?: unknown) => selection ? query : ({ from: (table: unknown) => ({ where: async () => table === mocks.imports ? [{ id: "import-id", state: "uploading", resourceId: "source:import-id" }] : (mocks.selectRows.shift() ?? [{ id: "asset-id", sealedKey: null, stagingKey: "staging-key", contentType: "text/plain", size: 6, sha256: "hash" }]) }) }),
      transaction: mocks.transaction,
    };
  },
}));
vi.mock("@/lib/notes/resources.server", async (original) => ({
  ...await original<typeof import("./resources.server")>(),
  knowledgeAccessCondition: () => sql`true`,
  recheckKnowledgeActor: mocks.recheck,
  lockKnowledgeResource: mocks.lockResource,
  touchKnowledgeResource: mocks.touchResource,
}));
vi.mock("@/lib/notes/import-storage.server", () => ({ readHistoryObject: async () => Buffer.from("source") }));
vi.mock("@/lib/storage", () => ({ putObject: mocks.put, deleteObject: mocks.remove, r2Configured: () => true }));
vi.mock("@/lib/storage/r2", () => ({ abortR2MultipartUpload: mocks.abort, presignR2PutObject: vi.fn() }));
vi.mock("@/lib/notes/jobs.server", () => ({
  historyMemberMayProcess: mocks.memberMayProcess,
  queueHistoryJob: mocks.queueJob,
}));
vi.mock("@/lib/notes/mutations.server", async (original) => ({
  ...await original<typeof import("./mutations.server")>(),
  withKnowledgeReceipt: async (_a: unknown, _n: unknown, _r: unknown, _p: unknown, operation: (tx: unknown) => Promise<unknown>) =>
    operation({
      select: () => ({ from: () => ({ where: (w: unknown) => { mocks.txWheres.push(w); return Promise.resolve(mocks.txSelect.shift() ?? []); } }) }),
      update: () => ({
        set: (value: unknown) => {
          mocks.txSets.push(value);
          return {
            where: (w: unknown) => {
              mocks.txWheres.push(w);
              const thenable = Promise.resolve([{ id: "row" }]) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
              thenable.returning = async () => [{ id: "row" }];
              return thenable;
            },
          };
        },
      }),
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
      delete: () => ({ where: () => Promise.resolve() }),
      execute: async () => undefined,
    }),
}));
import { commandHistoryImport, sealHistoryAsset, listHistoryImports, historyMediaTarget } from "./imports.server";
import { KnowledgeAccessError } from "./resources.server";
import type { KnowledgeWebActor } from "./access.server";
import { knowledgeHistoryImports } from "@/lib/db/schema";

const actor = { canCreate: true, allianceId: "alliance", hqUserId: "owner" } as KnowledgeWebActor;
const timestamp = "2026-09-15T12:00:00.123456Z";
beforeEach(() => {
  vi.clearAllMocks(); mocks.put.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined);
  mocks.abort.mockResolvedValue(undefined);
  mocks.recheck.mockResolvedValue(undefined);
  mocks.lockResource.mockResolvedValue({ id: "res-1", version: 3 });
  mocks.touchResource.mockResolvedValue(undefined);
  mocks.memberMayProcess.mockResolvedValue({ id: "member-1" });
  mocks.txSelect = [];
  mocks.txSets = [];
  mocks.txWheres = [];
  mocks.rows = Array.from({ length: 51 }, (_, index) => ({
    record: { id: `source-${index}`, kind: "text", state: "committed", audience: "private", updatedAt: new Date(timestamp) },
    title: `Source ${index}`, owned: true, cursorTime: timestamp,
  }));
});

const videoRecord = (state: string) => ({
  id: "import-1", kind: "video", state, allianceId: "alliance", resourceId: "res-1",
  sourceVideoJobId: "job-1", audience: "private",
});
const videoJobRow = { storageKey: "staging/chat.mp4", uploadId: "upload-1" };

it("cancel on a video import discards the linked job and aborts + deletes staged upload", async () => {
  const record = videoRecord("uploading");
  mocks.txSelect = [[record], [record], [videoJobRow]];
  const result = await commandHistoryImport(actor, "import-1", { requestId: "req-1", expectedVersion: 3, command: "cancel" });
  expect(result).toMatchObject({ importId: "import-1" });
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ state: "cancelled" }));
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ status: "discarded" }));
  expect(mocks.abort).toHaveBeenCalledWith("staging/chat.mp4", "upload-1");
  expect(mocks.remove).toHaveBeenCalledWith("staging/chat.mp4");
});

it("retry on a failed video import frees the job link and resets the asset to uploading", async () => {
  const record = videoRecord("failed");
  const assetRow = { id: "asset-1", importId: "import-1", sealedKey: "staging/chat.mp4" };
  mocks.txSelect = [[record], [record], [assetRow], [videoJobRow]];
  const result = await commandHistoryImport(actor, "import-1", { requestId: "req-2", expectedVersion: 3, command: "retry" });
  expect(result).toMatchObject({ importId: "import-1" });
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ status: "discarded", knowledgeImportId: null }));
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ state: "uploading", sourceVideoJobId: null }));
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ sealedKey: null, sealedAt: null, r2UploadId: null }));
  expect(mocks.queueJob).not.toHaveBeenCalled();
});

it("cancel -> retry clears discarded job links so a second upload can bind", async () => {
  const record = videoRecord("uploading");
  mocks.txSelect = [[record], [record], [videoJobRow]];
  await commandHistoryImport(actor, "import-1", { requestId: "req-3", expectedVersion: 3, command: "cancel" });
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ status: "discarded" }));

  mocks.txSets = [];
  mocks.txWheres = [];
  const cancelled = videoRecord("cancelled");
  const assetRow = { id: "asset-1", importId: "import-1", sealedKey: "staging/chat.mp4" };
  const discardedJob = { storageKey: "staging/chat.mp4", uploadId: "upload-1" };
  mocks.txSelect = [[cancelled], [cancelled], [assetRow], [discardedJob]];
  await commandHistoryImport(actor, "import-1", { requestId: "req-4", expectedVersion: 3, command: "retry" });
  const discardIndex = mocks.txSets.findIndex(
    (set) => typeof set === "object" && set !== null && (set as Record<string, unknown>).knowledgeImportId === null && (set as Record<string, unknown>).status === "discarded",
  );
  expect(discardIndex).toBeGreaterThanOrEqual(0);
  const updateWheres = mocks.txWheres.slice(mocks.txWheres.length - mocks.txSets.length);
  const containsDiscarded = (value: unknown, seen = new Set<object>()): boolean => {
    if (value === "discarded") return true;
    if (!value || typeof value !== "object" || seen.has(value as object)) return false;
    seen.add(value as object);
    return Object.values(value).some((entry) => containsDiscarded(entry, seen));
  };
  expect(containsDiscarded(updateWheres[discardIndex])).toBe(true);
  expect(mocks.txSets).toContainEqual(expect.objectContaining({ state: "uploading", sourceVideoJobId: null }));
});
it("retains the sealed object when database commit outcome is unknown", async () => {
  mocks.transaction.mockRejectedValueOnce(new Error("commit acknowledgement lost"));
  await expect(sealHistoryAsset(actor, "import-id", "asset-id")).rejects.toThrow("commit acknowledgement lost");
  expect(mocks.put).toHaveBeenCalledTimes(1);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("only removes a newly written object after a confirmed losing seal race", async () => {
  mocks.transaction.mockResolvedValueOnce(false);
  await sealHistoryAsset(actor, "import-id", "asset-id");
  expect(mocks.remove).toHaveBeenCalledWith(mocks.put.mock.calls[0][0]);
});
it("deletes the sealed object when lock fails after putObject", async () => {
  mocks.transaction.mockRejectedValueOnce(new KnowledgeAccessError("changed"));
  await expect(sealHistoryAsset(actor, "import-id", "asset-id")).rejects.toBeInstanceOf(KnowledgeAccessError);
  expect(mocks.remove).toHaveBeenCalledWith(mocks.put.mock.calls[0][0]);
});
it("emits exact microseconds in every list row and its continuation cursor", async () => {
  const page = await listHistoryImports(actor);
  expect(page.imports).toHaveLength(50);
  expect(page.imports.every((row) => row.updatedAt === timestamp)).toBe(true);
  expect(JSON.parse(page.nextCursor!)).toMatchObject({ updatedAt: timestamp, id: "source-49", direction: "next" });
  expect(page.previousCursor).toBeNull();
  mocks.rows = mocks.rows.slice(0, 1);
  const terminal = await listHistoryImports(actor);
  expect(terminal.imports[0].updatedAt).toBe(timestamp);
  expect(terminal.nextCursor).toBeNull();
});
it("serves the WebP thumbnail variant and falls back to the PNG content type", async () => {
  const mediaRow = {
    id: "media-1", sessionId: "import-id", storageKey: "notes-history/import-id/media/media-1.png",
    thumbnailStorageKey: "notes-history/import-id/media/media-1.webp", contentType: "image/png",
  };
  mocks.selectRows = [[mediaRow]];
  await expect(historyMediaTarget(actor, "import-id", "media-1", true)).resolves.toEqual({
    storageKey: "notes-history/import-id/media/media-1.webp",
    contentType: "image/webp",
  });
  mocks.selectRows = [[{ ...mediaRow, thumbnailStorageKey: null }]];
  await expect(historyMediaTarget(actor, "import-id", "media-1", true)).resolves.toEqual({
    storageKey: "notes-history/import-id/media/media-1.png",
    contentType: "image/png",
  });
});
it("declares the alliance-scoped descending keyset index", () => {
  const index = getTableConfig(knowledgeHistoryImports).indexes.find((item) => item.config.name === "knowledge_history_imports_page_idx");
  expect(index).toBeDefined();
  expect(index!.config.columns).toMatchObject([
    { name: "alliance_id" },
    { name: "updated_at", indexConfig: { order: "desc" } },
    { name: "id", indexConfig: { order: "desc" } },
  ]);
});
