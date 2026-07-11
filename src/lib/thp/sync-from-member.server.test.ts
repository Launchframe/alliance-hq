import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertCommanderThp, getCommanderIdForMember } = vi.hoisted(() => ({
  upsertCommanderThp: vi.fn(async () => true),
  getCommanderIdForMember: vi.fn(),
}));

vi.mock("@/lib/thp/repository", () => ({
  getCommanderIdForMember,
  upsertCommanderThp,
}));

import {
  seedCommanderThpHistoryFromAshed,
  syncCommanderThpAfterAshedStats,
  syncCommanderThpForMemberIfLinked,
  syncCommanderThpFromAllianceMember,
} from "@/lib/thp/sync-from-member.server";

describe("syncCommanderThpFromAllianceMember", () => {
  beforeEach(() => {
    upsertCommanderThp.mockClear();
    getCommanderIdForMember.mockReset();
  });

  it("skips invalid totals", async () => {
    const changed = await syncCommanderThpFromAllianceMember({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 0,
      source: "ashed_sync",
    });
    expect(changed).toBe(false);
    expect(upsertCommanderThp).not.toHaveBeenCalled();
  });

  it("upserts valid totals", async () => {
    upsertCommanderThp.mockClear();
    const changed = await syncCommanderThpFromAllianceMember({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 163_460_435,
      source: "ashed_sync",
    });
    expect(changed).toBe(true);
    expect(upsertCommanderThp).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: "cmd1",
        total: 163_460_435,
        source: "ashed_sync",
      }),
    );
  });
});

describe("syncCommanderThpAfterAshedStats", () => {
  it("derives total from currentTotalHeroPower", async () => {
    upsertCommanderThp.mockClear();
    await syncCommanderThpAfterAshedStats({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedStats: {
        currentTotalHeroPower: 163_460_435,
      },
      source: "roster_import",
    });
    expect(upsertCommanderThp).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 163_460_435,
        source: "roster_import",
      }),
    );
  });
});

describe("seedCommanderThpHistoryFromAshed", () => {
  it("returns zero when history is empty", async () => {
    const inserted = await seedCommanderThpHistoryFromAshed({
      commanderId: "cmd1",
      allianceId: "a1",
      history: [],
    });
    expect(inserted).toBe(0);
  });
});

describe("syncCommanderThpForMemberIfLinked", () => {
  beforeEach(() => {
    upsertCommanderThp.mockClear();
    getCommanderIdForMember.mockReset();
  });

  it("no-ops when commander is not linked", async () => {
    getCommanderIdForMember.mockResolvedValue(null);
    await syncCommanderThpForMemberIfLinked({
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      ashedStats: { currentTotalHeroPower: 100 },
      source: "ashed_sync",
    });
    expect(upsertCommanderThp).not.toHaveBeenCalled();
  });
});
