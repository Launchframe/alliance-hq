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
  loadTrainEconomyThreshold: vi.fn(),
}));

vi.mock("@/lib/trains/price-is-freight-roll.server", () => ({
  loadPriceIsFreightR3Candidates: vi.fn(),
}));

vi.mock("@/lib/trains/heavy-hitter-pool.server", () => ({
  buildHeavyHitterPoolCandidates: vi.fn(),
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAlliancePriorDayVsScoresByMember: vi.fn(),
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

  it("returns uniform mode with equal probabilities when weighting is off", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const {
      loadPriceIsRightTicketSettings,
      loadTrainEconomyThreshold,
    } = await import("@/lib/trains/train-economy-threshold.server");
    const { loadPriceIsFreightR3Candidates } = await import(
      "@/lib/trains/price-is-freight-roll.server"
    );
    const { fetchAlliancePriorDayVsScoresByMember } = await import(
      "@/lib/trains/vs-scores.server"
    );
    const { getHqMemberLinkForUser } = await import(
      "@/lib/member-link/repository.server"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      paintTemplate: "price_is_right",
    } as never);
    vi.mocked(loadPriceIsRightTicketSettings).mockResolvedValue({
      weightingEnabled: false,
      cliffPoints: 8_500_000,
      hardCutoffEnabled: false,
      maxTicketMemberIds: [],
    });
    vi.mocked(loadTrainEconomyThreshold).mockResolvedValue({
      thresholdPoints: 8_500_000,
      fudgePct: 1,
    } as never);
    vi.mocked(loadPriceIsFreightR3Candidates).mockResolvedValue([
      { memberId: "a", memberName: "Alpha" },
      { memberId: "b", memberName: "Bravo" },
    ]);
    vi.mocked(fetchAlliancePriorDayVsScoresByMember).mockResolvedValue(
      new Map([
        ["a", 7_500_000],
        ["b", 7_600_000],
      ]),
    );
    vi.mocked(getHqMemberLinkForUser).mockResolvedValue(null as never);

    const res = await GET(
      new Request(
        "http://localhost/api/trains/price-is-right/tickets?date=2026-07-09",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      board: Array<{ winProbability: number }>;
    };
    expect(body.mode).toBe("uniform");
    expect(body.board).toHaveLength(2);
    const sum = body.board.reduce((n, row) => n + row.winProbability, 0);
    expect(sum).toBeCloseTo(1, 8);
  });

  it("returns board and missedFloor as separate lists in weighted mode", async () => {
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
    const { loadPriceIsFreightR3Candidates } = await import(
      "@/lib/trains/price-is-freight-roll.server"
    );
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
    vi.mocked(loadPriceIsFreightR3Candidates).mockResolvedValue([
      { memberId: "a", memberName: "Alpha" },
      { memberId: "b", memberName: "Bravo" },
    ]);
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
      mode: string;
      board: Array<{ memberId: string }>;
      missedFloor: Array<{ memberId: string }>;
    };
    expect(body.mode).toBe("weighted");
    expect(body.board).toHaveLength(1);
    expect(body.missedFloor).toHaveLength(1);
    expect(body.board[0]?.memberId).toBe("a");
    expect(body.missedFloor[0]?.memberId).toBe("b");
  });
});
