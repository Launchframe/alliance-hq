import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  candidates: [] as Array<{ importId: string; allianceId: string; assetId: string; sealedKey: string | null }>,
  limit: 0,
  txSets: [] as unknown[],
  returning: [] as Array<Array<{ id: string }>>,
  failTransaction: null as Error | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema"),
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async (value: number) => {
                mocks.limit = value;
                return mocks.candidates;
              },
            }),
          }),
        }),
      }),
    }),
    transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      if (mocks.failTransaction) throw mocks.failTransaction;
      return operation({
        update: () => ({
          set: (value: unknown) => {
            mocks.txSets.push(value);
            return { where: () => ({ returning: async () => mocks.returning.shift() ?? [] }) };
          },
        }),
      });
    },
  }),
}));
vi.mock("@/lib/storage", () => ({ deleteObject: mocks.remove }));

import { cleanupExpiredChatVideoSources } from "./chat-video-cleanup.server";

const candidate = {
  importId: "import-1", allianceId: "alliance-1", assetId: "asset-1", sealedKey: "notes-history/import-1/sealed/video.mp4",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidates = [];
  mocks.limit = 0;
  mocks.txSets = [];
  mocks.returning = [];
  mocks.failTransaction = null;
  mocks.remove.mockResolvedValue(undefined);
});

it("clamps the requested limit and filters only expired committed video imports", async () => {
  mocks.candidates = [candidate];
  mocks.returning = [[{ id: "import-1" }], [{ id: "asset-1" }]];
  const result = await cleanupExpiredChatVideoSources(0);
  expect(mocks.limit).toBe(1);
  expect(result).toEqual({ deleted: 1, failed: 0 });
});

it("deletes the storage object before clearing the asset seal and marking the import", async () => {
  mocks.candidates = [candidate];
  mocks.returning = [[{ id: "import-1" }], [{ id: "asset-1" }]];
  const order: string[] = [];
  mocks.remove.mockImplementation(async () => { order.push("delete"); });
  const result = await cleanupExpiredChatVideoSources();
  expect(result.deleted).toBe(1);
  expect(mocks.remove).toHaveBeenCalledWith(candidate.sealedKey);
  expect(order).toEqual(["delete"]);
  expect(mocks.txSets).toEqual([
    expect.objectContaining({ sourceDeletedAt: expect.any(Date), updatedAt: expect.any(Date) }),
    { sealedKey: null, sealedAt: null, r2UploadId: null },
  ]);
});

it("counts a missing CAS row as failure while keeping the delete retryable", async () => {
  mocks.candidates = [candidate];
  mocks.returning = [[], [{ id: "asset-1" }]];
  const result = await cleanupExpiredChatVideoSources();
  expect(result).toEqual({ deleted: 0, failed: 1 });
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  mocks.returning = [[{ id: "import-1" }], [{ id: "asset-1" }]];
  mocks.candidates = [candidate];
  const retry = await cleanupExpiredChatVideoSources();
  expect(retry).toEqual({ deleted: 1, failed: 0 });
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});

it("keeps processing other candidates when a deletion or transaction fails", async () => {
  const second = { ...candidate, importId: "import-2", assetId: "asset-2", sealedKey: "notes-history/import-2/sealed/video.mp4" };
  mocks.candidates = [candidate, second];
  mocks.remove.mockRejectedValueOnce(new Error("storage gone"));
  mocks.returning = [[{ id: "import-2" }], [{ id: "asset-2" }]];
  const result = await cleanupExpiredChatVideoSources();
  expect(result).toEqual({ deleted: 1, failed: 1 });
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});

it("never touches media keys or the video job storage key", async () => {
  mocks.candidates = [candidate];
  mocks.returning = [[{ id: "import-1" }], [{ id: "asset-1" }]];
  await cleanupExpiredChatVideoSources();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  expect(mocks.remove.mock.calls[0][0]).toBe(candidate.sealedKey);
});
