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
  lockConductorRecord: vi.fn(),
  upsertConductorDraft: vi.fn(),
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getMemberRankAsOf: vi.fn().mockResolvedValue({ id: "rank-1" }),
}));

vi.mock("@/lib/trains/discord-bot.server", () => ({
  maybeAnnounceTrainReady: vi.fn().mockResolvedValue({ posted: 1, skipped: 0 }),
}));

vi.mock("@/lib/trains/service", () => ({
  getServerCalendarDate: vi.fn().mockReturnValue("2026-08-10"),
  refreshExhaustedPoolsForDay: vi.fn().mockResolvedValue([]),
  syncDepletingPoolSelectionForConductorDay: vi.fn().mockResolvedValue(undefined),
}));

const LOCKED_RECORD = {
  id: "rec-1",
  conductorMemberId: "mem-1",
  conductorMemberName: "Alice",
  vipMemberName: "Bob",
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
});
