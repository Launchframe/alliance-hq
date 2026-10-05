import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/vs-performance/member-performance.server", () => ({ loadVsMemberWeek: mocks.load }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
import { GET } from "./route";

const request = (query = "") => new Request(`https://example.test/api/vs-performance/members${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: "tenant" });
  mocks.load.mockResolvedValue({ weekStart: "2020-01-06", weekEnding: "2020-01-12", rows: [], total: 0 });
});

describe("member week list route", () => {
  it("passes the resolved actor and raw query to the read model", async () => {
    const response = await GET(request("?weekStart=2020-01-06&status=below&sort=total"));
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith("session", "tenant", { weekStart: "2020-01-06", status: "below", sort: "total" });
  });

  it("denies anonymous and bootstrap sessions before any load", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ id: "bootstrap", hqUserId: null, currentAllianceId: "tenant" });
    expect((await GET(request())).status).toBe(403);
    mocks.session.mockResolvedValue({ id: "session", hqUserId: "user", currentAllianceId: null, allianceId: null });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("surfaces officer-access denial and validation errors from the read model", async () => {
    mocks.load.mockRejectedValue(new VsComplianceError("forbidden", 403));
    expect((await GET(request())).status).toBe(403);
    mocks.load.mockRejectedValue(new VsComplianceError("invalid_policy", 400));
    expect((await GET(request("?sort=total"))).status).toBe(400);
  });
});
