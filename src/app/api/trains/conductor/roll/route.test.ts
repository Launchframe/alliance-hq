import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeTrainsOfficerAudit: vi.fn(),
  getConductorRecord: vi.fn(),
  getConductorStats: vi.fn(),
  rollForConductor: vi.fn(),
  rollForVip: vi.fn(),
}));

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

vi.mock("@/lib/bff/officer-action-audit.server", () => ({
  writeTrainsOfficerAudit: mocks.writeTrainsOfficerAudit,
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: mocks.getConductorRecord,
  getConductorStats: mocks.getConductorStats,
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-09-09"),
  rollForConductor: mocks.rollForConductor,
  rollForVip: mocks.rollForVip,
  trainActionErrorResponse: () => ({ status: 400, body: { error: "fail" } }),
}));

vi.mock("@/lib/trains/roll-errors.server", () => ({
  trainRollErrorResponse: () => ({ status: 400, body: { error: "fail" } }),
}));

import { POST } from "./route";

describe("conductor roll POST audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeTrainsOfficerAudit.mockResolvedValue(undefined);
    mocks.getConductorStats.mockResolvedValue(null);
    mocks.rollForConductor.mockResolvedValue({
      memberId: "m-boggle",
      memberName: "BOGGLE",
    });
  });

  it("audits the first wheel landing as routine", async () => {
    mocks.getConductorRecord.mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-09-09" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.writeTrainsOfficerAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trains.conductor_roll",
        severity: "routine",
        metadata: expect.objectContaining({
          landedMemberId: "m-boggle",
          previousMemberId: null,
          overwritten: false,
          spinAgain: false,
          source: "wheel",
        }),
      }),
    );
  });

  it("audits a spin-again that overwrites the unlocked landing", async () => {
    mocks.getConductorRecord
      .mockResolvedValueOnce({
        conductorMemberId: "m-alice",
        conductorMemberName: "Alice",
        lockedAt: null,
      })
      .mockResolvedValueOnce({
        conductorMemberId: "m-boggle",
        conductorMemberName: "BOGGLE",
        lockedAt: null,
      });

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-09-09" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.writeTrainsOfficerAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trains.conductor_roll",
        severity: "update",
        metadata: expect.objectContaining({
          landedMemberId: "m-boggle",
          landedMemberName: "BOGGLE",
          previousMemberId: "m-alice",
          previousMemberName: "Alice",
          overwritten: true,
          spinAgain: true,
          source: "wheel",
        }),
      }),
    );
  });
});
