import { beforeEach, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ row: {} as Record<string, unknown>, update: vi.fn(), set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./access.server", () => ({ getKnowledgeActorForGenerationJob: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({
  ...await original<typeof import("@/lib/db")>(),
  getDb: () => ({ transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
    select: () => ({ from: () => ({ where: () => ({ for: async () => [testState.row] }) }) }),
    update: testState.update,
  }) }),
}));
import { stopGeneration, cancelGenerationCandidate } from "./generation.server";

beforeEach(() => {
  vi.clearAllMocks();
  testState.row = { id: "job", version: 3, attempts: 1, state: "running", availableAt: new Date(Date.now() - 1), threadId: null, leaseToken: "lease", leaseExpiresAt: new Date(Date.now() + 60_000) };
  testState.update.mockReturnValue({ set: testState.set });
  testState.set.mockReturnValue({ where: async () => undefined });
});
it("does not let an expired worker change job state on failure", async () => {
  testState.row.leaseExpiresAt = new Date(Date.now() - 1);
  await stopGeneration("job", "lease", new Error("provider failure"));
  expect(testState.update).not.toHaveBeenCalled();
});
it("does not cancel a newer generation version or release its conversation slot", async () => {
  testState.row.version = 4;
  testState.row.threadId = "thread";
  await cancelGenerationCandidate({ id: "job", version: 3, threadId: "thread" });
  expect(testState.update).not.toHaveBeenCalled();
});
it("does not cancel a live lease based on an old queue scan", async () => {
  await cancelGenerationCandidate({ id: "job", version: 3, threadId: null });
  expect(testState.update).not.toHaveBeenCalled();
});
it("cancels the unchanged expired candidate", async () => {
  testState.row.leaseExpiresAt = new Date(Date.now() - 1);
  await cancelGenerationCandidate({ id: "job", version: 3, threadId: null });
  expect(testState.set).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled", leaseToken: null }));
});
it("still retries a failure while the lease is valid", async () => {
  await stopGeneration("job", "lease", new Error("provider failure"));
  expect(testState.set).toHaveBeenCalledWith(expect.objectContaining({ state: "pending", version: 4, leaseToken: null }));
});
