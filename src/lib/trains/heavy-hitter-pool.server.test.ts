import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPriceIsRightTicketSettings: vi.fn(),
  loadActiveAlliancePoolMembers: vi.fn(),
  getAllianceRanksAsOf: vi.fn(),
  getServerCalendarDate: vi.fn(() => "2026-06-13"),
  startNewPoolGeneration: vi.fn(),
  deleteWhere: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/trains/train-economy-threshold.server", () => ({
  loadPriceIsRightTicketSettings: mocks.loadPriceIsRightTicketSettings,
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadActiveAlliancePoolMembers: mocks.loadActiveAlliancePoolMembers,
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getAllianceRanksAsOf: mocks.getAllianceRanksAsOf,
}));

vi.mock("@/lib/trains/game-time", () => ({
  getServerCalendarDate: mocks.getServerCalendarDate,
}));

vi.mock("@/lib/trains/pool", () => ({
  startNewPoolGeneration: mocks.startNewPoolGeneration,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    delete: mocks.delete,
  }),
  schema: {
    conductorPoolEntries: {
      allianceId: "allianceId",
      poolType: "poolType",
    },
  },
}));

import {
  buildHeavyHitterPoolCandidates,
  syncHeavyHitterPool,
} from "@/lib/trains/heavy-hitter-pool.server";
import { PRICE_IS_RIGHT_MAX_TICKETS } from "@/lib/trains/train-price-is-right-tickets.shared";

describe("buildHeavyHitterPoolCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.startNewPoolGeneration.mockResolvedValue({ generation: 2, count: 1 });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([
      { ashedMemberId: "m1", currentName: "Alpha", allianceRank: 4 },
      { ashedMemberId: "m2", currentName: "Beta", allianceRank: 3 },
    ]);
    mocks.getAllianceRanksAsOf.mockResolvedValue([
      { ashedMemberId: "m1", allianceRank: 4 },
      { ashedMemberId: "m2", allianceRank: 3 },
    ]);
  });

  it("returns empty when no max-ticket overrides are configured", async () => {
    mocks.loadPriceIsRightTicketSettings.mockResolvedValue({
      weightingEnabled: true,
      cliffPoints: 9_000_000,
      hardCutoffEnabled: false,
      maxTicketMemberIds: [],
    });

    await expect(
      buildHeavyHitterPoolCandidates("ally-1", "2026-06-13"),
    ).resolves.toEqual([]);
  });

  it("skips override ids missing from the active roster", async () => {
    mocks.loadPriceIsRightTicketSettings.mockResolvedValue({
      weightingEnabled: true,
      cliffPoints: 9_000_000,
      hardCutoffEnabled: false,
      maxTicketMemberIds: ["m1", "ghost", "m2"],
    });

    await expect(
      buildHeavyHitterPoolCandidates("ally-1", "2026-06-13"),
    ).resolves.toEqual([
      {
        memberId: "m1",
        memberName: "Alpha",
        allianceRank: 4,
        ticketCount: PRICE_IS_RIGHT_MAX_TICKETS,
      },
      {
        memberId: "m2",
        memberName: "Beta",
        allianceRank: 3,
        ticketCount: PRICE_IS_RIGHT_MAX_TICKETS,
      },
    ]);
  });
});

describe("syncHeavyHitterPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.startNewPoolGeneration.mockResolvedValue({ generation: 2, count: 1 });
    mocks.loadActiveAlliancePoolMembers.mockResolvedValue([
      { ashedMemberId: "m1", currentName: "Alpha", allianceRank: 4 },
    ]);
    mocks.getAllianceRanksAsOf.mockResolvedValue([
      { ashedMemberId: "m1", allianceRank: 4 },
    ]);
  });

  it("clears the heavy-hitter pool when the override list is empty", async () => {
    mocks.loadPriceIsRightTicketSettings.mockResolvedValue({
      weightingEnabled: true,
      cliffPoints: 9_000_000,
      hardCutoffEnabled: false,
      maxTicketMemberIds: [],
    });

    await syncHeavyHitterPool("ally-1");

    expect(mocks.delete).toHaveBeenCalled();
    expect(mocks.deleteWhere).toHaveBeenCalled();
    expect(mocks.startNewPoolGeneration).not.toHaveBeenCalled();
  });

  it("reseeds the heavy-hitter pool from current overrides", async () => {
    mocks.loadPriceIsRightTicketSettings.mockResolvedValue({
      weightingEnabled: true,
      cliffPoints: 9_000_000,
      hardCutoffEnabled: false,
      maxTicketMemberIds: ["m1"],
    });

    await syncHeavyHitterPool("ally-1");

    expect(mocks.startNewPoolGeneration).toHaveBeenCalledWith(
      "ally-1",
      "heavy_hitter",
      [
        {
          memberId: "m1",
          memberName: "Alpha",
          allianceRank: 4,
          ticketCount: PRICE_IS_RIGHT_MAX_TICKETS,
        },
      ],
    );
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
