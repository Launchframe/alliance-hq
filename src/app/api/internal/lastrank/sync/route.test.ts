import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncLastRankAlliance: vi.fn(),
  resolveLastRankSyncMapTargets: vi.fn(),
}));

vi.mock("@/lib/lastrank/sync-alliance.server", () => ({
  syncLastRankAlliance: mocks.syncLastRankAlliance,
}));

vi.mock("@/lib/lastrank/sync-registry.shared", () => ({
  resolveLastRankSyncMapTargets: mocks.resolveLastRankSyncMapTargets,
}));

import { GET } from "./route";

describe("internal lastrank sync GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("LASTRANK_SYNC_MAP", "LFgo=e7d1eaefdcfc42c8ac6c84247d2dad9b");
    mocks.resolveLastRankSyncMapTargets.mockReturnValue([
      {
        gameServerNumber: 1203,
        tag: "LFgo",
        lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      },
    ]);
    mocks.syncLastRankAlliance.mockResolvedValue({
      tag: "LFgo",
      lastRankCount: 42,
      match: { matched: [], unmatched: [], unmatchedHq: [] },
      apply: null,
    });
  });

  it("403s without cron auth", async () => {
    const res = await GET(new Request("http://localhost/api/internal/lastrank/sync"));
    expect(res.status).toBe(403);
    expect(mocks.syncLastRankAlliance).not.toHaveBeenCalled();
  });

  it("skips when LASTRANK_SYNC_MAP resolves to no targets", async () => {
    mocks.resolveLastRankSyncMapTargets.mockReturnValue([]);

    const res = await GET(
      new Request("http://localhost/api/internal/lastrank/sync", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, skipped: true });
    expect(mocks.syncLastRankAlliance).not.toHaveBeenCalled();
  });

  it("dry-runs when dryRun=1", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/lastrank/sync?dryRun=1", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.syncLastRankAlliance).toHaveBeenCalledWith({
      target: expect.objectContaining({ tag: "LFgo" }),
      apply: false,
    });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, apply: false });
  });

  it("applies sync for authorized cron requests", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/lastrank/sync", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.syncLastRankAlliance).toHaveBeenCalledWith({
      target: expect.objectContaining({ tag: "LFgo" }),
      apply: true,
    });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, apply: true });
  });
});
