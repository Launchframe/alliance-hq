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

const BASE_CTX = {
  sessionId: "sess-1",
  allianceId: "ally-1",
  ashedAllianceId: "ashed-1",
  connection: null,
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
});
