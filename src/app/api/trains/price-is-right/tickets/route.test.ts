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

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn().mockResolvedValue({ seasonKey: "1" }),
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: vi.fn(),
}));

vi.mock("@/lib/trains/train-economy-threshold.server", () => ({
  loadPriceIsRightTicketSettings: vi.fn(),
  buildPriceIsRightWeightedCandidates: vi.fn(),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: vi.fn(),
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getAllianceRanksAsOf: vi.fn(),
  isMemberEligibleForPool: vi.fn(() => true),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
}));

const BASE_CTX = {
  sessionId: "sess-1",
  allianceId: "ally-1",
  operatingMode: "native" as const,
};

describe("price-is-right tickets GET", () => {
  it("400s without date", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);

    const res = await GET(
      new Request("http://localhost/api/trains/price-is-right/tickets"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/date/i);
  });

  it("400s when selected day is not a Price Is Freight day", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "standard",
    } as never);

    const res = await GET(
      new Request(
        "http://localhost/api/trains/price-is-right/tickets?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Price Is Freight/i);
  });

  it("400s when exponential ticket weighting is disabled", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const { loadPriceIsRightTicketSettings } = await import(
      "@/lib/trains/train-economy-threshold.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "price_is_right",
    } as never);
    vi.mocked(loadPriceIsRightTicketSettings).mockResolvedValue({
      weightingEnabled: false,
      cliffPoints: null,
      hardCutoffEnabled: false,
      maxTicketMemberIds: [],
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/price-is-right/tickets?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/weighting/i);
  });

  it("returns board and missedFloor as separate lists", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const {
      loadPriceIsRightTicketSettings,
      buildPriceIsRightWeightedCandidates,
    } = await import("@/lib/trains/train-economy-threshold.server");
    const { loadActiveAlliancePoolMembers } = await import(
      "@/lib/members/game-roster"
    );
    const { getAllianceRanksAsOf } = await import("@/lib/trains/rank-history");
    const { getHqMemberLinkForUser } = await import(
      "@/lib/member-link/repository.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "price_is_right",
    } as never);
    vi.mocked(loadPriceIsRightTicketSettings).mockResolvedValue({
      weightingEnabled: true,
      cliffPoints: null,
      hardCutoffEnabled: false,
      maxTicketMemberIds: [],
    });
    vi.mocked(loadActiveAlliancePoolMembers).mockResolvedValue([
      {
        ashedMemberId: "a",
        currentName: "Alpha",
        allianceRank: 3,
      },
      {
        ashedMemberId: "b",
        currentName: "Bravo",
        allianceRank: 3,
      },
    ] as never);
    vi.mocked(getAllianceRanksAsOf).mockResolvedValue([]);
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);
    vi.mocked(buildPriceIsRightWeightedCandidates).mockResolvedValue({
      scoreDate: "2026-07-08",
      candidates: [],
      board: [
        {
          memberId: "a",
          memberName: "Alpha",
          priorDayVsScore: 7_200_000,
          ticketCount: 1024,
          winProbability: 1,
          isTakedownOverride: false,
        },
      ],
      missedFloor: [
        {
          memberId: "b",
          memberName: "Bravo",
          priorDayVsScore: 6_500_000,
        },
      ],
    });

    const res = await GET(
      new Request(
        "http://localhost/api/trains/price-is-right/tickets?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      board: Array<{ memberId: string }>;
      missedFloor: Array<{ memberId: string }>;
    };
    expect(body.board).toHaveLength(1);
    expect(body.missedFloor).toHaveLength(1);
    expect(body.board[0]?.memberId).toBe("a");
    expect(body.missedFloor[0]?.memberId).toBe("b");
  });
});
