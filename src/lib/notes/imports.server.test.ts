import { beforeEach, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => {
  const imports = { id: "import.id", allianceId: "import.alliance", resourceId: "import.resource", updatedAt: "import.updatedAt" };
  const assets = { id: "asset.id", importId: "asset.import", allianceId: "asset.alliance" };
  return { imports, assets, transaction: vi.fn(), put: vi.fn(), remove: vi.fn(), rows: [] as Array<Record<string, unknown>> };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: { ...await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"), knowledgeHistoryImports: mocks.imports, knowledgeHistoryAssets: mocks.assets },
  getDb: () => {
    const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: async () => mocks.rows };
    return {
      select: (selection?: unknown) => selection ? query : ({ from: (table: unknown) => ({ where: async () => table === mocks.imports ? [{ id: "import-id", state: "uploading", resourceId: "source:import-id" }] : [{ id: "asset-id", sealedKey: null, stagingKey: "staging-key", contentType: "text/plain", size: 6, sha256: "hash" }] }) }),
      transaction: mocks.transaction,
    };
  },
}));
vi.mock("@/lib/notes/resources.server", async (original) => ({ ...await original<typeof import("./resources.server")>(), knowledgeAccessCondition: () => undefined }));
vi.mock("@/lib/notes/import-storage.server", () => ({ readHistoryObject: async () => Buffer.from("source") }));
vi.mock("@/lib/storage", () => ({ putObject: mocks.put, deleteObject: mocks.remove }));
vi.mock("@/lib/storage/r2", () => ({}));
vi.mock("@/lib/notes/jobs.server", () => ({}));
import { sealHistoryAsset, listHistoryImports } from "./imports.server";
import { KnowledgeAccessError } from "./resources.server";
import type { KnowledgeWebActor } from "./access.server";
import { knowledgeHistoryImports } from "@/lib/db/schema";

const actor = { canCreate: true, allianceId: "alliance", hqUserId: "owner" } as KnowledgeWebActor;
const timestamp = "2026-09-15T12:00:00.123456Z";
beforeEach(() => {
  vi.clearAllMocks(); mocks.put.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined);
  mocks.rows = Array.from({ length: 51 }, (_, index) => ({
    record: { id: `source-${index}`, kind: "text", state: "committed", updatedAt: new Date(timestamp) },
    title: `Source ${index}`, cursorTime: timestamp,
  }));
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
it("declares the alliance-scoped descending keyset index", () => {
  const index = getTableConfig(knowledgeHistoryImports).indexes.find((item) => item.config.name === "knowledge_history_imports_page_idx");
  expect(index).toBeDefined();
  expect(index!.config.columns).toMatchObject([
    { name: "alliance_id" },
    { name: "updated_at", indexConfig: { order: "desc" } },
    { name: "id", indexConfig: { order: "desc" } },
  ]);
});
