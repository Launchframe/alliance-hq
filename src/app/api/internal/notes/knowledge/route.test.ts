import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/notes/knowledge-index.server", () => ({ processKnowledgeIndex: vi.fn(async () => ({ processed: false })) }));
import { processKnowledgeIndex } from "@/lib/notes/knowledge-index.server";
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("requires the configured cron secret before advancing any index", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-knowledge-cron");
  expect((await GET(new Request("http://localhost/api/internal/notes/knowledge"))).status).toBe(403);
  expect(processKnowledgeIndex).not.toHaveBeenCalled();
  expect((await GET(new Request("http://localhost/api/internal/notes/knowledge", { headers: { Authorization: "Bearer synthetic-knowledge-cron" } }))).status).toBe(200);
  expect(processKnowledgeIndex).toHaveBeenCalled();
});
it("stays closed without cron configuration", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(new Request("http://localhost/api/internal/notes/knowledge", { headers: { Authorization: "Bearer " } }))).status).toBe(403);
  expect(processKnowledgeIndex).not.toHaveBeenCalled();
});
it("keeps claiming batches until the tick has no more work", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-knowledge-cron");
  vi.mocked(processKnowledgeIndex).mockResolvedValueOnce({ processed: true }).mockResolvedValueOnce({ processed: true }).mockResolvedValueOnce({ processed: false });
  const response = await GET(new Request("http://localhost/api/internal/notes/knowledge", { headers: { Authorization: "Bearer synthetic-knowledge-cron" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ processed: true, batches: 2 });
  expect(processKnowledgeIndex).toHaveBeenCalledTimes(3);
});
