import { afterEach, expect, it, vi } from "vitest";

const processStep = vi.hoisted(() => vi.fn(async () => ({ processed: true })));
vi.mock("@/lib/notes/import-worker.server", () => ({ processHistoryStep: processStep }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("denies absent or invalid service authentication without running work", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-secret");
  expect((await GET(new Request("http://localhost/api/internal/notes/process"))).status).toBe(403);
  expect(processStep).not.toHaveBeenCalled();
});
it("processes one bounded step for an authenticated service call", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-secret");
  const response = await GET(new Request("http://localhost/api/internal/notes/process", { headers: { Authorization: "Bearer synthetic-secret" } }));
  expect(response.status).toBe(200);
  expect(processStep).toHaveBeenCalledTimes(1);
});
