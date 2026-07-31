import { NextResponse } from "next/server";
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

vi.mock("@/lib/trains/game-time", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-07-30"),
}));

vi.mock("@/lib/trains/repository", () => ({
  listLockedConductorHistory: vi.fn(),
}));

const BASE_CTX = {
  sessionId: "sess-1",
  allianceId: "ally-1",
  operatingMode: "native" as const,
};

describe("conductor history GET", () => {
  it("403s when scores:read is denied", async () => {
    const { requireSessionPermission } = await import(
      "@/lib/rbac/require-permission"
    );
    vi.mocked(requireSessionPermission).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await GET(new Request("http://localhost/api/trains/conductor/history"));
    expect(res.status).toBe(403);
    expect(requireSessionPermission).toHaveBeenCalledWith("sess-1", "scores:read");
  });

  it("scopes history to alliance and excludes future dates", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    const { listLockedConductorHistory } = await import(
      "@/lib/trains/repository"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue(BASE_CTX);
    vi.mocked(listLockedConductorHistory).mockResolvedValue({
      rows: [
        {
          id: "rec-1",
          date: "2026-07-28",
          conductorMemberId: "mem-1",
          conductorMemberName: "Alpha",
          vipMemberId: null,
          vipMemberName: null,
          conductorMechanism: "r3_lottery",
          vipMechanism: null,
          guardianIsVip: 0,
          lockedAt: new Date("2026-07-28T12:00:00.000Z"),
        },
      ],
      total: 1,
    } as never);

    const res = await GET(
      new Request(
        "http://localhost/api/trains/conductor/history?limit=10&offset=0&memberId=mem-1&allianceRank=3",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].guardianIsVip).toBe(false);
    expect(listLockedConductorHistory).toHaveBeenCalledWith({
      allianceId: "ally-1",
      seasonKey: "1",
      maxDate: "2026-07-30",
      limit: 10,
      offset: 0,
      memberId: "mem-1",
      allianceRank: 3,
    });
  });
});
