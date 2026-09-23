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

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeSettings: vi.fn().mockResolvedValue({
    trainConductorLeadTimeDays: 0,
    trainConductorConfirmationEnabled: false,
    canManage: false,
  }),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn().mockResolvedValue({ seasonKey: "1" }),
}));

vi.mock("@/lib/trains/repository", () => ({
  getConductorRecord: vi.fn(),
  lockConductorRecord: vi.fn(),
  restampConductorRules: vi.fn(),
  upsertConductorDraft: vi.fn(),
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: vi.fn().mockResolvedValue({
    conductorRule: null,
    vipRule: null,
    dayConfigId: "dc-1",
  }),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: vi.fn().mockResolvedValue([
    { ashedMemberId: "mem-1" },
  ]),
}));

vi.mock("@/lib/trains/boarding.server", async () => ({ lockConductorWithBoarding: (await import("@/lib/trains/repository")).lockConductorRecord }));

vi.mock("@/lib/trains/rank-history", () => ({
  getMemberRankAsOf: vi.fn().mockResolvedValue({ id: "rank-1" }),
  resolveMemberAllianceRankAsOf: vi.fn().mockResolvedValue({ rank: 4 }),
}));

vi.mock("@/lib/trains/discord-bot.server", () => ({
  maybeAnnounceTrainReady: vi.fn().mockResolvedValue({ posted: 1, skipped: 0 }),
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-08-10"),
  refreshExhaustedPoolsForDay: vi.fn().mockResolvedValue([]),
  syncDepletingPoolSelectionForConductorDay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/trains/train-ownership.server", () => ({
  resolveTrainActorHqUserId: vi.fn().mockResolvedValue("hq-1"),
}));

vi.mock("@/lib/bff/officer-action-audit.server", () => ({
  writeTrainsOfficerAudit: vi.fn().mockResolvedValue(undefined),
}));

const LOCKED_RECORD = {
  id: "rec-1",
  conductorMemberId: "mem-1",
  conductorMemberName: "Alice",
  vipMemberName: "Bob",
  conductorNominationStatus: null,
};

describe("conductor lock POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403s when train officer permission is denied", async () => {
    const { requireTrainOfficer } = await import("@/lib/rbac/require-permission");
    vi.mocked(requireTrainOfficer).mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10" }),
      }),
    );

    expect(res.status).toBe(403);
  });

  it("skips Discord announce when announce is false", async () => {
    const { getConductorRecord, lockConductorRecord } = await import(
      "@/lib/trains/repository"
    );
    const { maybeAnnounceTrainReady } = await import(
      "@/lib/trains/discord-bot.server"
    );
    vi.mocked(getConductorRecord).mockResolvedValue(LOCKED_RECORD as never);
    vi.mocked(lockConductorRecord).mockResolvedValue(LOCKED_RECORD as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10", announce: false }),
      }),
    );

    expect(res.status).toBe(200);
    expect(maybeAnnounceTrainReady).not.toHaveBeenCalled();
    expect(lockConductorRecord).toHaveBeenCalledWith(
      "rec-1",
      "ally-1",
      "hq-1",
    );
  });

  it("409s when confirmation is pending and alliance confirmation is enabled", async () => {
    const { getConductorRecord, lockConductorRecord } = await import(
      "@/lib/trains/repository"
    );
    const { loadAllianceTrainLeadTimeSettings } = await import(
      "@/lib/trains/alliance-train-lead-time.server"
    );
    vi.mocked(loadAllianceTrainLeadTimeSettings).mockResolvedValueOnce({
      trainConductorLeadTimeDays: 1,
      trainConductorConfirmationEnabled: true,
      canManage: true,
    });
    vi.mocked(getConductorRecord).mockResolvedValue({
      ...LOCKED_RECORD,
      conductorNominationStatus: "pending_confirmation",
    } as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10" }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("conductor_confirmation_pending");
    expect(lockConductorRecord).not.toHaveBeenCalled();
  });

  it("passes officer locale through to Discord announce", async () => {
    const { getConductorRecord, lockConductorRecord } = await import(
      "@/lib/trains/repository"
    );
    const { maybeAnnounceTrainReady } = await import(
      "@/lib/trains/discord-bot.server"
    );
    vi.mocked(getConductorRecord).mockResolvedValue(LOCKED_RECORD as never);
    vi.mocked(lockConductorRecord).mockResolvedValue(LOCKED_RECORD as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10", locale: "pt-BR" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(maybeAnnounceTrainReady).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "ally-1",
        date: "2026-08-10",
        conductorName: "Alice",
        vipName: "Bob",
        locale: "pt-BR",
      }),
    );
  });

  it("restamps a leftover snapshot on lock when the member is eligible today", async () => {
    const { getConductorRecord, lockConductorRecord, restampConductorRules } =
      await import("@/lib/trains/repository");
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    vi.mocked(resolveRollDayConfig).mockResolvedValueOnce({
      conductorRule: null,
      vipRule: { kind: "none" },
      dayConfigId: "dc-1",
    } as never);
    vi.mocked(getConductorRecord).mockResolvedValue({
      ...LOCKED_RECORD,
      conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
    } as never);
    vi.mocked(restampConductorRules).mockResolvedValue({
      ...LOCKED_RECORD,
      conductorRule: null,
    } as never);
    vi.mocked(lockConductorRecord).mockResolvedValue(LOCKED_RECORD as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10", announce: false }),
      }),
    );

    expect(res.status).toBe(200);
    expect(restampConductorRules).toHaveBeenCalledWith(
      expect.objectContaining({
        conductorRule: null,
        vipRule: { kind: "none" },
      }),
    );
  });

  it("does not restamp an ineligible leftover onto weekday Price Is Freight at lock", async () => {
    const { getConductorRecord, lockConductorRecord, restampConductorRules } =
      await import("@/lib/trains/repository");
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    vi.mocked(resolveRollDayConfig).mockResolvedValueOnce({
      conductorRule: { kind: "price_is_freight", board: "weekday" },
      vipRule: null,
      dayConfigId: "dc-1",
    } as never);
    vi.mocked(getConductorRecord).mockResolvedValue({
      ...LOCKED_RECORD,
      conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
    } as never);
    vi.mocked(lockConductorRecord).mockResolvedValue(LOCKED_RECORD as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10", announce: false }),
      }),
    );

    expect(res.status).toBe(200);
    expect(restampConductorRules).not.toHaveBeenCalled();
  });
});
