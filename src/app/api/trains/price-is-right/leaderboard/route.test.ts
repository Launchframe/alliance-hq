import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

vi.mock("@/lib/session", () => ({
  getOrCreateSession: vi.fn().mockResolvedValue({ id: "sess-1", hqUserId: "hq-1" }),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/trains/api-context", () => ({
  resolveTrainRequestContext: vi.fn(),
}));

vi.mock("@/lib/trains/price-is-right-leaderboard.server", () => ({
  loadPriceIsRightVsLeaderboard: vi.fn(),
}));

const BASE_CTX = {
  sessionId: "sess-1",
  allianceId: "ally-1",
  operatingMode: "native" as const,
};

describe("price-is-right leaderboard GET", () => {
  it("400s without date", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);

    const res = await GET(
      new Request("http://localhost/api/trains/price-is-right/leaderboard"),
    );
    expect(res.status).toBe(400);
  });

  it("returns podium payload", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { loadPriceIsRightVsLeaderboard } = await import(
      "@/lib/trains/price-is-right-leaderboard.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(loadPriceIsRightVsLeaderboard).mockResolvedValue({
      trainDate: "2026-07-09",
      scoreDate: "2026-07-08",
      podium: [
        {
          rank: 1,
          memberId: "a",
          memberName: "Alpha",
          priorDayVsScore: 5_600_000,
        },
      ],
      entries: [],
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/price-is-right/leaderboard?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.podium).toHaveLength(1);
    expect(body.scoreDate).toBe("2026-07-08");
  });
});
