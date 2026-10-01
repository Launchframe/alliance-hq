import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lastwar/player-lookup.server", () => ({
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
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const hqUpdateReturning = vi.fn();
const hqUpdateWhere = vi.fn(() => ({ returning: hqUpdateReturning }));
const hqUpdateSet = vi.fn(() => ({ where: hqUpdateWhere }));

function dbForTable(table: { id?: string; hqUserId?: string }) {
  return table.hqUserId != null
    ? { set: hqUpdateSet }
    : { set: updateSet };
}

vi.mock("@/lib/db", () => ({
  getDb: () => {
    const db = {
      select: () => ({ from: selectFrom }),
      update: dbForTable,
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    };
    return db;
  },
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

import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup.server";
import { denormalizeGameUidOnMember } from "@/lib/members/member-tenure.server";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { hydrateDiscordMemberLink } from "@/lib/vr/discord-link-live-identity.server";

const frozenLink = {
  id: "link-1",
  allianceId: "a1",
  discordUserId: "d1",
  discordUsername: null,
  ashedMemberId: "old-swift",
  memberDisplayName: "gRAHmps",
  gameUid: "1111222233334444",
  linkedAt: new Date("2026-07-08"),
  updatedAt: new Date("2026-07-08"),
};

describe("hydrateDiscordMemberLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockReset();
    updateReturning.mockReset();
    hqUpdateReturning.mockReset();
    hqUpdateReturning.mockResolvedValue([]);
  });

  it("uses the current HQ roster name instead of the frozen Discord snapshot", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          ashedMemberId: "old-swift",
          currentName: "tihsrah",
          status: "active",
          gameUid: "1111222233334444",
        },
      ]);

    const result = await hydrateDiscordMemberLink(frozenLink);
    expect(result.memberDisplayName).toBe("tihsrah");
    expect(result.ashedMemberId).toBe("old-swift");
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
  });

  it("follows a former seat via roster game_uid before Last War lookup", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          ashedMemberId: "old-swift",
          currentName: "JBeazy Swift",
          status: "former",
          gameUid: "1111222233334444",
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
    updateReturning.mockResolvedValue([
      {
        ...frozenLink,
        ashedMemberId: "new-tihsrah",
        memberDisplayName: "tihsrah",
      },
    ]);
    hqUpdateReturning.mockResolvedValue([{ hqUserId: "hq-user-1" }]);

    const result = await hydrateDiscordMemberLink(frozenLink, {
      rematerializeFormer: true,
    });
    expect(result.ashedMemberId).toBe("new-tihsrah");
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
    expect(syncCommanderIdentityFromMemberLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "new-tihsrah",
        hqUserId: "hq-user-1",
      }),
    );
  });

  it("follows a former seat onto the live roster via Last War's current name", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          ashedMemberId: "old-swift",
          currentName: "JBeazy Swift",
          status: "former",
          gameUid: "1111222233334444",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ashedMemberId: "new-tihsrah",
          currentName: "tihsrah",
          previousNamesJson: ["rah"],
          status: "active",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "tihsrah",
    });
    updateReturning.mockResolvedValue([
      {
        ...frozenLink,
        ashedMemberId: "new-tihsrah",
        memberDisplayName: "tihsrah",
      },
    ]);
    hqUpdateReturning.mockResolvedValue([{ hqUserId: "hq-user-1" }]);

    const result = await hydrateDiscordMemberLink(frozenLink, {
      rematerializeFormer: true,
    });
    expect(result.ashedMemberId).toBe("new-tihsrah");
    expect(result.memberDisplayName).toBe("tihsrah");
    expect(denormalizeGameUidOnMember).toHaveBeenCalledWith({
      allianceId: "a1",
      ashedMemberId: "new-tihsrah",
      gameUid: "1111222233334444",
    });
    expect(syncCommanderIdentityFromMemberLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "new-tihsrah",
        memberDisplayName: "tihsrah",
        hqUserId: "hq-user-1",
      }),
    );
  });

  it("does not steal a live seat already linked to another Discord user", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          ashedMemberId: "old-swift",
          currentName: "JBeazy Swift",
          status: "former",
          gameUid: "1111222233334444",
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

    const result = await hydrateDiscordMemberLink(frozenLink, {
      rematerializeFormer: true,
    });
    expect(result.ashedMemberId).toBe("old-swift");
    expect(result.memberDisplayName).toBe("JBeazy Swift");
    expect(syncCommanderIdentityFromMemberLink).not.toHaveBeenCalled();
  });

  it("does not steal a live seat already claimed by another HQ user", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          ashedMemberId: "old-swift",
          currentName: "JBeazy Swift",
          status: "former",
          gameUid: "1111222233334444",
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
      .mockResolvedValueOnce([{ gameUid: "9999888877776666" }]);

    const result = await hydrateDiscordMemberLink(frozenLink, {
      rematerializeFormer: true,
    });
    expect(result.ashedMemberId).toBe("old-swift");
    expect(result.memberDisplayName).toBe("JBeazy Swift");
    expect(updateSet).not.toHaveBeenCalled();
    expect(hqUpdateSet).not.toHaveBeenCalled();
    expect(syncCommanderIdentityFromMemberLink).not.toHaveBeenCalled();
  });

  it("does not follow the UID when Discord or HQ seat writes fail together", async () => {
    selectLimit
      .mockResolvedValueOnce([
        {
          ashedMemberId: "old-swift",
          currentName: "JBeazy Swift",
          status: "former",
          gameUid: "1111222233334444",
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
    updateReturning.mockResolvedValue([
      {
        ...frozenLink,
        ashedMemberId: "new-tihsrah",
        memberDisplayName: "tihsrah",
      },
    ]);
    hqUpdateReturning.mockRejectedValue(new Error("unique_violation"));

    const result = await hydrateDiscordMemberLink(frozenLink, {
      rematerializeFormer: true,
    });
    expect(result.ashedMemberId).toBe("old-swift");
    expect(result.memberDisplayName).toBe("JBeazy Swift");
    expect(denormalizeGameUidOnMember).not.toHaveBeenCalled();
    expect(syncCommanderIdentityFromMemberLink).not.toHaveBeenCalled();
  });

  it("skips Last War rematerialize when rematerializeFormer is false", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        ashedMemberId: "old-swift",
        currentName: "JBeazy Swift",
        status: "former",
        gameUid: "1111222233334444",
      },
    ]);

    const result = await hydrateDiscordMemberLink(frozenLink, {
      rematerializeFormer: false,
    });
    expect(result.memberDisplayName).toBe("JBeazy Swift");
    expect(result.ashedMemberId).toBe("old-swift");
    expect(lookupPlayerByUid).not.toHaveBeenCalled();
  });
});
