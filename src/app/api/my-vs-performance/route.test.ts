import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  detail: vi.fn(),
  history: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/rbac/require-permission", () => ({ requireSessionPermission: mocks.permission }));
vi.mock("@/lib/vs-performance/my-performance.server", () => ({
  loadMyVsPerformance: mocks.detail,
  loadMyVsPerformanceHistory: mocks.history,
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { GET } from "./route";

const request = (query = "") =>
  new Request(`https://example.test/api/my-vs-performance${query}`);

const detailPayload = {
  commanders: [{ memberId: "own-member", name: "Own Commander", currentRank: 3 }],
  member: { memberId: "own-member", name: "Own Commander", currentRank: 3 },
  weekStart: "2026-09-21",
  weekEnding: "2026-09-27",
  live: true,
  policy: { enabled: true, modelVersion: 2, dailyThreshold: 7_200_000, allowedMissedDays: 1 },
  source: { native: true, verifiedAt: null, stale: false },
  week: null,
  history: { weeks: [], nextBefore: null },
  officerHref: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session", hqUserId: "bound-user", currentAllianceId: "tenant" });
  mocks.permission.mockResolvedValue(null);
  mocks.detail.mockResolvedValue(detailPayload);
  mocks.history.mockResolvedValue({ memberId: "own-member", history: { weeks: [], nextBefore: null } });
});

describe("GET /api/my-vs-performance", () => {
  it("denies anonymous and permission-less sessions before any personal load", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ id: "session", hqUserId: "bound-user", currentAllianceId: "tenant" });
    mocks.permission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await GET(request())).status).toBe(403);
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("returns indistinguishable 404 when the session has no bound user or alliance", async () => {
    mocks.session.mockResolvedValue({ id: "session", hqUserId: null, currentAllianceId: "tenant" });
    expect((await GET(request())).status).toBe(404);
    mocks.session.mockResolvedValue({ id: "session", hqUserId: "bound-user", currentAllianceId: null, allianceId: null });
    expect((await GET(request())).status).toBe(404);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("loads with the bound hqUserId and alliance, ignoring any effective-user context", async () => {
    const response = await GET(request("?memberId=own-member"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detailPayload);
    expect(mocks.permission).toHaveBeenCalledWith("session", "members:read");
    expect(mocks.detail).toHaveBeenCalledWith("session", "bound-user", "tenant", { memberId: "own-member" });
  });

  it("falls back to session.allianceId when currentAllianceId is absent", async () => {
    mocks.session.mockResolvedValue({ id: "session", hqUserId: "bound-user", allianceId: "base-tenant" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith("session", "bound-user", "base-tenant", {});
  });

  it("propagates the loader 404 for a non-owned memberId", async () => {
    mocks.detail.mockRejectedValue(new VsComplianceError("not_found", 404));
    const response = await GET(request("?memberId=foreign-member"));
    expect(response.status).toBe(404);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("routes beforeWeek to the cursor history loader", async () => {
    const response = await GET(request("?memberId=own-member&beforeWeek=2026-09-20"));
    expect(response.status).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith("bound-user", "tenant", { memberId: "own-member", beforeWeek: "2026-09-20" });
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("maps an invalid or future cursor to 400", async () => {
    mocks.history.mockRejectedValue(new VsComplianceError("invalid_week"));
    const response = await GET(request("?memberId=own-member&beforeWeek=2999-01-03"));
    expect(response.status).toBe(400);
  });
});
