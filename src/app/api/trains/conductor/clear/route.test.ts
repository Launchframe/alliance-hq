import { NextResponse } from "next/server";
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

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: vi.fn(),
  clearConductorAssignment: vi.fn(),
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-08-10"),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const PENDING_RECORD = {
  id: "rec-1",
  conductorMemberId: "mem-1",
  conductorMemberName: "Alice",
  lockedAt: null,
};

describe("conductor clear POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403s when train officer permission is denied", async () => {
    const { requireTrainOfficer } = await import("@/lib/rbac/require-permission");
    vi.mocked(requireTrainOfficer).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10" }),
      }),
    );

    expect(res.status).toBe(403);
  });

  it("409s when the day is already locked", async () => {
    const { getConductorRecord, clearConductorAssignment } = await import(
      "@/lib/trains/repository"
    );
    vi.mocked(getConductorRecord).mockResolvedValueOnce({
      ...PENDING_RECORD,
      lockedAt: new Date("2026-08-10T12:00:00.000Z"),
    } as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10" }),
      }),
    );

    expect(res.status).toBe(409);
    expect(clearConductorAssignment).not.toHaveBeenCalled();
  });

  it("clears an unlocked pending conductor", async () => {
    const { getConductorRecord, clearConductorAssignment } = await import(
      "@/lib/trains/repository"
    );
    const { writeAuditLog } = await import("@/lib/bff/audit");
    vi.mocked(getConductorRecord).mockResolvedValueOnce(PENDING_RECORD as never);
    vi.mocked(clearConductorAssignment).mockResolvedValueOnce({
      ...PENDING_RECORD,
      conductorMemberId: null,
      conductorMemberName: null,
    } as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(clearConductorAssignment).toHaveBeenCalledWith(
      "ally-1",
      "2026-08-10",
      "1",
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "trains.conductor_clear" }),
    );
  });
});
