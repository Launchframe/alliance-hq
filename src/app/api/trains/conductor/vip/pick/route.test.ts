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

vi.mock("@/lib/trains/pool", () => ({
  listPoolEntries: vi.fn(),
  listUnselectedPoolEntries: vi.fn(),
  markPoolMemberSelectedForDate: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
}));

vi.mock("@/lib/trains/service", () => ({
  ensureConductorPoolSeeded: vi.fn(),
  getServerCalendarDate: vi.fn().mockReturnValue("2026-07-27"),
}));

vi.mock("@/lib/trains/conductor-pool-claim-lock.server", () => ({
  withConductorPoolClaimLock: vi.fn(
    async (_key: unknown, run: () => Promise<unknown>) => run(),
  ),
}));

const BASE_BODY = {
  date: "2026-07-27",
  memberId: "m-alice",
  memberName: "Alice",
};

describe("VIP pick depleting event_top_x gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupEventTopXDay(opts?: {
    vipMemberId?: string | null;
    unselected?: string[];
    pool?: string[];
  }) {
    const { getConductorRecord, assignVipOnLockedConductor } = await import(
      "@/lib/trains/repository"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const {
      listPoolEntries,
      listUnselectedPoolEntries,
      markPoolMemberSelectedForDate,
      releasePoolSelectionForDate,
    } = await import("@/lib/trains/pool");
    const { ensureConductorPoolSeeded } = await import("@/lib/trains/service");

    vi.mocked(getConductorRecord).mockResolvedValue({
      lockedAt: new Date("2026-07-27T12:00:00Z"),
      conductorMemberId: "m-conductor",
      vipMemberId: opts?.vipMemberId ?? null,
    } as never);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      dayConfigId: "day-1",
      vipMechanism: "event_top_x_lottery",
      vipConfig: { eventKey: "capitol_war", topN: 10 },
      paintTemplate: "r4_event_vip",
    } as never);
    vi.mocked(listUnselectedPoolEntries).mockResolvedValue(
      (opts?.unselected ?? ["m-alice", "m-bob"]).map((memberId) => ({
        memberId,
      })) as never,
    );
    vi.mocked(listPoolEntries).mockResolvedValue(
      (opts?.pool ?? ["m-alice", "m-bob", "m-carol"]).map((memberId) => ({
        memberId,
      })) as never,
    );
    vi.mocked(assignVipOnLockedConductor).mockResolvedValue({
      lockedAt: new Date("2026-07-27T12:00:00Z"),
      vipMemberId: "m-alice",
    } as never);
    vi.mocked(markPoolMemberSelectedForDate).mockResolvedValue(true);

    return {
      ensureConductorPoolSeeded,
      markPoolMemberSelectedForDate,
      releasePoolSelectionForDate,
      assignVipOnLockedConductor,
    };
  }

  it("seeds the event_top_x pool and marks an unselected member", async () => {
    const {
      ensureConductorPoolSeeded,
      markPoolMemberSelectedForDate,
      assignVipOnLockedConductor,
    } = await setupEventTopXDay();

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(200);
    expect(ensureConductorPoolSeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        hqAllianceId: "ally-1",
        poolType: "event_top_x",
        date: "2026-07-27",
        useSequence: false,
        eventTopN: 10,
      }),
    );
    expect(markPoolMemberSelectedForDate).toHaveBeenCalledWith(
      "ally-1",
      "event_top_x",
      "m-alice",
      "2026-07-27",
    );
    expect(assignVipOnLockedConductor).toHaveBeenCalled();
  });

  it("rejects a member already awarded in the current generation", async () => {
    const { markPoolMemberSelectedForDate, assignVipOnLockedConductor } =
      await setupEventTopXDay({
        unselected: ["m-bob"],
        pool: ["m-alice", "m-bob"],
      });

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already selected/i);
    expect(markPoolMemberSelectedForDate).not.toHaveBeenCalled();
    expect(assignVipOnLockedConductor).not.toHaveBeenCalled();
  });

  it("rejects a member missing from the seeded event_top_x pool", async () => {
    const { markPoolMemberSelectedForDate, assignVipOnLockedConductor } =
      await setupEventTopXDay({
        unselected: ["m-bob"],
        pool: ["m-bob", "m-carol"],
      });

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not in the current conductor pool/i);
    expect(markPoolMemberSelectedForDate).not.toHaveBeenCalled();
    expect(assignVipOnLockedConductor).not.toHaveBeenCalled();
  });

  it("releases the prior VIP pool slot only after a successful assign", async () => {
    const {
      releasePoolSelectionForDate,
      markPoolMemberSelectedForDate,
      assignVipOnLockedConductor,
    } = await setupEventTopXDay({ vipMemberId: "m-prior" });

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(200);
    expect(markPoolMemberSelectedForDate).toHaveBeenCalled();
    expect(assignVipOnLockedConductor).toHaveBeenCalled();
    expect(releasePoolSelectionForDate).toHaveBeenCalledWith(
      "ally-1",
      "2026-07-27",
      "m-prior",
    );
    expect(
      vi.mocked(markPoolMemberSelectedForDate).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(assignVipOnLockedConductor).mock.invocationCallOrder[0]!,
    );
    expect(
      vi.mocked(assignVipOnLockedConductor).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(releasePoolSelectionForDate).mock.invocationCallOrder[0]!,
    );
  });

  it("does not release the prior VIP slot when the depleting gate rejects", async () => {
    const { releasePoolSelectionForDate } = await setupEventTopXDay({
      vipMemberId: "m-prior",
      unselected: ["m-bob"],
      pool: ["m-alice", "m-bob"],
    });

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(409);
    expect(releasePoolSelectionForDate).not.toHaveBeenCalled();
  });

  it("skips depleting pool gates for conductor_pick VIP days", async () => {
    const { getConductorRecord, assignVipOnLockedConductor } = await import(
      "@/lib/trains/repository"
    );
    const { resolveRollDayConfig } = await import(
      "@/lib/trains/day-config-resolve.server"
    );
    const { ensureConductorPoolSeeded } = await import("@/lib/trains/service");
    const { markPoolMemberSelectedForDate } = await import("@/lib/trains/pool");

    vi.mocked(getConductorRecord).mockResolvedValue({
      lockedAt: new Date("2026-07-27T12:00:00Z"),
      conductorMemberId: "m-conductor",
      vipMemberId: null,
    } as never);
    vi.mocked(resolveRollDayConfig).mockResolvedValue({
      dayConfigId: "day-1",
      vipMechanism: "conductor_pick",
      vipConfig: null,
      paintTemplate: "economy_week",
    } as never);
    vi.mocked(assignVipOnLockedConductor).mockResolvedValue({
      lockedAt: new Date("2026-07-27T12:00:00Z"),
      vipMemberId: "m-alice",
    } as never);

    const res = await POST(
      new Request("http://localhost/api/trains/conductor/vip/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_BODY),
      }),
    );

    expect(res.status).toBe(200);
    expect(ensureConductorPoolSeeded).not.toHaveBeenCalled();
    expect(markPoolMemberSelectedForDate).not.toHaveBeenCalled();
    expect(assignVipOnLockedConductor).toHaveBeenCalled();
  });
});
