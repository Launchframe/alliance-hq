import { afterEach, describe, expect, it, vi } from "vitest";
const tick = vi.hoisted(() => vi.fn());
vi.mock("@/lib/plunder-plan/delivery.server", () => ({ runPlunderPlanTick: tick }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); tick.mockReset(); });
describe("Plunder Plan cron boundary", () => {
  it("denies missing configuration and forged authorization without running delivery", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new Request("http://localhost/api/internal/plunder-plan/tick"))).status).toBe(403);
    vi.stubEnv("CRON_SECRET", "test-only");
    expect((await GET(new Request("http://localhost/api/internal/plunder-plan/tick", { headers: { authorization: "Bearer wrong" } }))).status).toBe(403);
    expect(tick).not.toHaveBeenCalled();
  });
  it("runs authorized work and reports partial failure", async () => {
    vi.stubEnv("CRON_SECRET", "test-only"); tick.mockResolvedValue({ failed: 1, sent: 0, materialized: 0 });
    expect((await GET(new Request("http://localhost/api/internal/plunder-plan/tick", { headers: { authorization: "Bearer test-only" } }))).status).toBe(503);
    expect(tick).toHaveBeenCalledOnce();
  });
});
