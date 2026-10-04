import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAllianceDailySnapshotPass: vi.fn(),
}));

vi.mock("@/lib/analytics/alliance-daily-snapshot.server", () => ({
  runAllianceDailySnapshotPass: mocks.runAllianceDailySnapshotPass,
}));

import { GET } from "./route";

describe("internal alliance-daily-snapshot GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    mocks.runAllianceDailySnapshotPass.mockResolvedValue(12);
  });

  it("403s without cron auth", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/alliance-daily-snapshot"),
    );
    expect(res.status).toBe(403);
    expect(mocks.runAllianceDailySnapshotPass).not.toHaveBeenCalled();
  });

  it("runs snapshot pass for authorized cron requests", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/alliance-daily-snapshot", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.runAllianceDailySnapshotPass).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toEqual({ ok: true, alliances: 12 });
  });
});
