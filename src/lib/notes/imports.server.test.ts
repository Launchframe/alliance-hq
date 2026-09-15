import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const imports = { id: "import.id", allianceId: "import.alliance", resourceId: "import.resource" };
  const assets = { id: "asset.id", importId: "asset.import", allianceId: "asset.alliance" };
  return { imports, assets, transaction: vi.fn(), put: vi.fn(), remove: vi.fn() };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  schema: { knowledgeHistoryImports: mocks.imports, knowledgeHistoryAssets: mocks.assets },
  getDb: () => ({
    select: () => ({ from: (table: unknown) => ({ where: async () => table === mocks.imports ? [{ id: "import-id", state: "uploading", resourceId: "source:import-id" }] : [{ id: "asset-id", sealedKey: null, stagingKey: "staging-key", contentType: "text/plain", size: 6, sha256: "hash" }] }) }),
    transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/notes/resources.server", async (original) => ({ ...await original<typeof import("./resources.server")>(), knowledgeAccessCondition: () => undefined }));
vi.mock("@/lib/notes/import-storage.server", () => ({ readHistoryObject: async () => Buffer.from("source") }));
vi.mock("@/lib/storage", () => ({ putObject: mocks.put, deleteObject: mocks.remove }));
vi.mock("@/lib/storage/r2", () => ({}));
vi.mock("@/lib/notes/jobs.server", () => ({}));
import { sealHistoryAsset } from "./imports.server";
import { KnowledgeAccessError } from "./resources.server";
import type { KnowledgeWebActor } from "./access.server";

const actor = { canCreate: true, allianceId: "alliance", hqUserId: "owner" } as KnowledgeWebActor;
beforeEach(() => { vi.clearAllMocks(); mocks.put.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); });
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
