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
  expect(processKnowledgeIndex).toHaveBeenCalledOnce();
});
it("stays closed without cron configuration", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(new Request("http://localhost/api/internal/notes/knowledge", { headers: { Authorization: "Bearer " } }))).status).toBe(403);
  expect(processKnowledgeIndex).not.toHaveBeenCalled();
});
