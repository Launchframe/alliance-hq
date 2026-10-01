import { afterEach, describe, expect, it, vi } from "vitest";
const cleanup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notes/chat-video-cleanup.server", () => ({ cleanupExpiredChatVideoSources: cleanup }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); cleanup.mockReset(); });
describe("Notes chat video cleanup cron boundary", () => {
  it("denies missing configuration and forged authorization without running cleanup", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new Request("http://localhost/api/internal/notes/cleanup"))).status).toBe(403);
    vi.stubEnv("CRON_SECRET", "test-only");
    expect((await GET(new Request("http://localhost/api/internal/notes/cleanup", { headers: { authorization: "Bearer wrong" } }))).status).toBe(403);
    expect(cleanup).not.toHaveBeenCalled();
  });
  it("runs authorized cleanup and reports failures", async () => {
    vi.stubEnv("CRON_SECRET", "test-only"); cleanup.mockResolvedValue({ deleted: 2, failed: 0 });
    const response = await GET(new Request("http://localhost/api/internal/notes/cleanup", { headers: { authorization: "Bearer test-only" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2, failed: 0 });
    cleanup.mockRejectedValue(new Error("db down"));
    expect((await GET(new Request("http://localhost/api/internal/notes/cleanup", { headers: { authorization: "Bearer test-only" } }))).status).toBe(503);
  });
});
