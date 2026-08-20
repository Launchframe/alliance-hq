import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/lib/session", () => ({
  requireApiSession: vi.fn().mockResolvedValue({ id: "sess-1", hqUserId: "hq-1" }),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireTrainOfficer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/trains/api-context", () => ({
  resolveTrainRequestContext: vi.fn().mockResolvedValue({
    sessionId: "sess-1",
    allianceId: "ally-1",
    operatingMode: "native",
  }),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn().mockResolvedValue({ seasonKey: "1" }),
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: vi.fn(),
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: vi.fn(),
  assignVipOnLockedConductor: vi.fn(),
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getMemberRankAsOf: vi.fn().mockResolvedValue({ id: "rank-1" }),
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-07-27"),
}));

const BASE_BODY = {
  date: "2026-07-27",
  memberId: "m-alice",
  memberName: "Alice",
};

describe("VIP pick is an open roster assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupLockedDay(vipMechanism: string) {
    const { getConductorRecord, assignVipOnLockedConductor } = await import(
      "@/lib/trains/repository"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );

    vi.mocked(getConductorRecord).mockResolvedValue({
      lockedAt: new Date("2026-07-27T12:00:00Z"),
      conductorMemberId: "m-conductor",
      vipMemberId: null,
    } as never);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      dayConfigId: "day-1",
      vipMechanism,
      vipConfig: { eventKey: "capitol_war", topN: 10 },
      paintTemplate: "r4_event_vip",
    } as never);
    vi.mocked(assignVipOnLockedConductor).mockResolvedValue({
      lockedAt: new Date("2026-07-27T12:00:00Z"),
      vipMemberId: "m-alice",
    } as never);

    return { assignVipOnLockedConductor };
  }

  it("assigns any member on an event_top_x VIP day without touching pools", async () => {
    const { assignVipOnLockedConductor } = await setupLockedDay(
      "event_top_x_lottery",
    );

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(200);
    expect(assignVipOnLockedConductor).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "ally-1",
        date: "2026-07-27",
        vipMemberId: "m-alice",
        vipMemberName: "Alice",
        vipMechanism: "event_top_x_lottery",
      }),
    );
  });

  it("assigns on conductor_pick VIP days", async () => {
    const { assignVipOnLockedConductor } = await setupLockedDay(
      "conductor_pick",
    );

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(200);
    expect(assignVipOnLockedConductor).toHaveBeenCalled();
  });

  it("rejects VIP pick before lock", async () => {
    const { getConductorRecord } = await import("@/lib/trains/repository");
    vi.mocked(getConductorRecord).mockResolvedValue({
      lockedAt: null,
      conductorMemberId: "m-conductor",
    } as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/lock/i);
  });

  it("rejects VIP pick when the day has no VIP", async () => {
    await setupLockedDay("none");

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not allowed/i);
  });
});
