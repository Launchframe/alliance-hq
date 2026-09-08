import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const teamWork = vi.hoisted(() => vi.fn(async () => ({ reconciled: 2, delivered: 0, failed: 0 })));
vi.mock("@/lib/time-off/excused-worker.server", () => ({ runExcusedSyncTick: run }));
vi.mock("@/lib/support-teams/work-outbox.server", () => ({ runTeamWorkTick: teamWork }));
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("time-off sync cron boundary", () => {
  it("rejects missing or incorrect authorization before running work", async () => {
    vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
    expect((await GET(new Request("http://localhost/api/internal/time-off/sync"))).status).toBe(403);
    expect((await GET(new Request("http://localhost/api/internal/time-off/sync", { headers: { authorization: "Bearer wrong" } }))).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
    expect(teamWork).not.toHaveBeenCalled();
  });

  it("runs authorized work and reports partial failure without raw upstream details", async () => {
    vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
    const request = () => new Request("http://localhost/api/internal/time-off/sync", { headers: { authorization: "Bearer test-only-cron-secret" } });
    run.mockResolvedValueOnce({ processed: 2 });
    expect(await (await GET(request())).json()).toEqual({ ok: true, processed: 2, teamWork: { reconciled: 2, delivered: 0, failed: 0 } });
    run.mockResolvedValueOnce({ processed: 1, error: "credentials_required" });
    expect((await GET(request())).status).toBe(503);
    run.mockRejectedValueOnce(new Error("PRIVATE_UPSTREAM_DETAIL"));
    const failed = await GET(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("PRIVATE_UPSTREAM_DETAIL");
  });

  it("does not prevent absence synchronization when routing fails", async () => {
    vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
    teamWork.mockRejectedValueOnce(new Error("PRIVATE_DELIVERY_DETAIL"));
    run.mockResolvedValueOnce({ processed: 1 });
    const response = await GET(new Request("http://localhost/api/internal/time-off/sync", { headers: { authorization: "Bearer test-only-cron-secret" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, processed: 1, teamWork: { reconciled: 0, delivered: 0, failed: 1 } });
    expect(run).toHaveBeenCalledOnce();
  });
});
