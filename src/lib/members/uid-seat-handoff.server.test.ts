import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lastwar/player-lookup", () => ({
  lookupPlayerByUid: vi.fn(),
}));

vi.mock("@/lib/members/member-tenure.server", () => ({
  denormalizeGameUidOnMember: vi.fn(),
}));

vi.mock("@/lib/members/commander-identity.server", () => ({
  syncCommanderIdentityFromMemberLink: vi.fn(),
}));

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const hqUpdateReturning = vi.fn();
const hqUpdateWhere = vi.fn(() => ({ returning: hqUpdateReturning }));
const hqUpdateSet = vi.fn(() => ({ where: hqUpdateWhere }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: selectFrom }),
    update: () => ({ set: hqUpdateSet }),
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        update: () => ({ set: hqUpdateSet }),
      }),
  }),
  schema: {
    allianceMembers: {
      ashedMemberId: "ashed_member_id",
      currentName: "current_name",
      status: "status",
      gameUid: "game_uid",
      allianceId: "alliance_id",
      previousNamesJson: "previous_names_json",
    },
    discordMemberLinks: {
      id: "id",
      allianceId: "alliance_id",
      ashedMemberId: "ashed_member_id",
      discordUserId: "discord_user_id",
    },
    hqMemberLinks: {
      allianceId: "alliance_id",
      gameUid: "game_uid",
      ashedMemberId: "ashed_member_id",
      hqUserId: "hq_user_id",
    },
  },
}));

import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { denormalizeGameUidOnMember } from "@/lib/members/member-tenure.server";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { rematerializeFormerSeatLinksForAlliance } from "@/lib/members/uid-seat-handoff.server";

describe("rematerializeFormerSeatLinksForAlliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockReset();
    hqUpdateReturning.mockReset();
  });

  it("is a no-op when the alliance has no former seats", async () => {
    selectLimit.mockResolvedValueOnce([]);
    await rematerializeFormerSeatLinksForAlliance("a1");
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
    expect(denormalizeGameUidOnMember).not.toHaveBeenCalled();
  });

  it("retargets an HQ-only former seat onto the live roster", async () => {
    selectLimit
      .mockResolvedValueOnce([{ ashedMemberId: "old-swift" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "hq-1",
          allianceId: "a1",
          hqUserId: "hq-1",
          ashedMemberId: "old-swift",
          memberDisplayName: "JBeazy Swift",
          gameUid: "1111222233334444",
          linkedAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          ashedMemberId: "new-tihsrah",
          currentName: "tihsrah",
          status: "active",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    hqUpdateReturning.mockResolvedValue([{ hqUserId: "hq-1" }]);

    await rematerializeFormerSeatLinksForAlliance("a1");

    expect(lookupPlayerByUid).not.toHaveBeenCalled();
    expect(denormalizeGameUidOnMember).toHaveBeenCalledWith({
      allianceId: "a1",
      ashedMemberId: "new-tihsrah",
      gameUid: "1111222233334444",
    });
    expect(syncCommanderIdentityFromMemberLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "new-tihsrah",
        hqUserId: "hq-1",
      }),
    );
  });

  it("does not steal a live seat already claimed on Discord", async () => {
    selectLimit
      .mockResolvedValueOnce([{ ashedMemberId: "old-swift" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "hq-1",
          allianceId: "a1",
          hqUserId: "hq-1",
          ashedMemberId: "old-swift",
          memberDisplayName: "JBeazy Swift",
          gameUid: "1111222233334444",
          linkedAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          ashedMemberId: "new-tihsrah",
          currentName: "tihsrah",
          status: "active",
        },
      ])
      .mockResolvedValueOnce([{ discordUserId: "someone-else" }]);

    await rematerializeFormerSeatLinksForAlliance("a1");

    expect(denormalizeGameUidOnMember).not.toHaveBeenCalled();
    expect(syncCommanderIdentityFromMemberLink).not.toHaveBeenCalled();
  });
});
