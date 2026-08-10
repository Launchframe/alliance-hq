import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

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

vi.mock("@/lib/trains/repository", () => ({
  listMemberLastLockedConducts: vi.fn(),
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-08-10"),
}));

describe("conductor pick-hints GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403s when train officer permission is denied", async () => {
    const { requireTrainOfficer } = await import("@/lib/rbac/require-permission");
    vi.mocked(requireTrainOfficer).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await GET(
      new Request("http://localhost/api/trains/conductor/pick-hints"),
    );

    expect(res.status).toBe(403);
  });

  it("scopes hints to the session alliance and requested date", async () => {
    const { listMemberLastLockedConducts } = await import(
      "@/lib/trains/repository"
    );
    vi.mocked(listMemberLastLockedConducts).mockResolvedValue([
      {
        memberId: "mem-1",
        date: "2026-08-05",
        conductorMechanism: "r3_lottery",
      },
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/trains/conductor/pick-hints?date=2026-08-10",
      ),
    );
    const body = (await res.json()) as {
      members: Record<
        string,
        { lastConductedDate: string; conductorMechanism: string | null }
      >;
      referenceDate: string;
    };

    expect(res.status).toBe(200);
    expect(listMemberLastLockedConducts).toHaveBeenCalledWith(
      "ally-1",
      "2026-08-10",
    );
    expect(body.referenceDate).toBe("2026-08-10");
    expect(body.members["mem-1"]).toEqual({
      lastConductedDate: "2026-08-05",
      conductorMechanism: "r3_lottery",
    });
  });
});
