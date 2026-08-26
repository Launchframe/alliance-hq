import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

vi.mock("@/lib/session", () => ({
  requireApiSession: vi.fn().mockResolvedValue({ id: "sess-1", hqUserId: "hq-1" }),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/trains/api-context", () => ({
  resolveTrainRequestContext: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn().mockResolvedValue({ seasonKey: "1" }),
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: vi.fn(),
}));

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeDays: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/trains/service", () => ({
  loadAllianceTrainWeekConfig: vi
    .fn()
    .mockResolvedValue({ trainWeekStartDow: 1 }),
}));

vi.mock("@/lib/trains/repository", () => ({
  getWeekSchedule: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/trains/score-leaderboard.server", () => ({
  loadScoreLeaderboard: vi.fn(),
}));

const BASE_CTX = {
  sessionId: "sess-1",
  allianceId: "ally-1",
  operatingMode: "native" as const,
};

describe("score-leaderboard GET", () => {
  it("403s when scores:read is denied", async () => {
    const { requireSessionPermission } = await import(
      "@/lib/rbac/require-permission"
    );
    vi.mocked(requireSessionPermission).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await GET(
      new Request(
        "http://localhost/api/trains/score-leaderboard?date=2026-07-09&kind=vs_push",
      ),
    );
    expect(res.status).toBe(403);
  });

  it("400s without date", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);

    const res = await GET(
      new Request("http://localhost/api/trains/score-leaderboard"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/date/i);
  });

  it("400s when the day has no score leaderboard", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "economy_week",
      conductorMechanism: "r3_lottery",
    } as never);

    const res = await GET(
      new Request(
        "http://localhost/api/trains/score-leaderboard?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/score leaderboard/i);
  });

  it("ignores mismatched kind param and uses server day kind", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const { loadAllianceTrainLeadTimeDays } = await import(
      "@/lib/trains/alliance-train-lead-time.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(loadAllianceTrainLeadTimeDays).mockResolvedValue(0);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "vs_push_weekdays",
      conductorMechanism: "vs_top_10",
    } as never);
    const { loadScoreLeaderboard } = await import(
      "@/lib/trains/score-leaderboard.server"
    );
    vi.mocked(loadScoreLeaderboard).mockResolvedValue({
      kind: "vs_push",
      trainDate: "2026-07-09",
      podium: [],
      entries: [],
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/score-leaderboard?date=2026-07-09&kind=tpif",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("vs_push");
  });

  it("returns vs_push podium payload", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const { loadScoreLeaderboard } = await import(
      "@/lib/trains/score-leaderboard.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "vs_push_weekdays",
      conductorMechanism: "vs_top_10",
    } as never);
    vi.mocked(loadScoreLeaderboard).mockResolvedValue({
      kind: "vs_push",
      trainDate: "2026-07-09",
      scoreDate: "2026-07-08",
      podium: [
        {
          rank: 1,
          memberId: "a",
          memberName: "Alpha",
          score: 8_500_000,
        },
      ],
      entries: [],
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/score-leaderboard?date=2026-07-09&kind=vs_push",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("vs_push");
    expect(body.podium).toHaveLength(1);
    expect(loadScoreLeaderboard).toHaveBeenCalledWith({
      allianceId: "ally-1",
      trainDate: "2026-07-09",
      kind: "vs_push",
      hqUserId: "hq-1",
    });
  });

  it("inherits vs_push leaderboard for off-template Sunday under lead time", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const { loadAllianceTrainLeadTimeDays } = await import(
      "@/lib/trains/alliance-train-lead-time.server"
    );
    const { loadScoreLeaderboard } = await import(
      "@/lib/trains/score-leaderboard.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(loadAllianceTrainLeadTimeDays).mockResolvedValueOnce(1);
    vi.mocked(resolveRollDayConfig)
      .mockResolvedValueOnce({
        paintTemplate: "vs_push_week_lead_time",
        conductorMechanism: "custom",
      } as never)
      .mockResolvedValueOnce({
        paintTemplate: "vs_push_weekdays",
        conductorMechanism: "vs_top_10",
      } as never);
    vi.mocked(loadScoreLeaderboard).mockResolvedValue({
      kind: "vs_push",
      trainDate: "2026-08-30",
      scoreDate: "2026-08-28",
      podium: [],
      entries: [],
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/score-leaderboard?date=2026-08-30",
      ),
    );
    expect(res.status).toBe(200);
    expect(loadScoreLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({
        trainDate: "2026-08-30",
        kind: "vs_push",
      }),
    );
  });

  it("returns donations unavailable stub", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const { loadScoreLeaderboard } = await import(
      "@/lib/trains/score-leaderboard.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "donations_week",
      conductorMechanism: "donations_top",
    } as never);
    vi.mocked(loadScoreLeaderboard).mockResolvedValue({
      kind: "donations",
      trainDate: "2026-07-09",
      podium: [],
      entries: [],
      unavailable: true,
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/score-leaderboard?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).toBe(true);
  });
});
