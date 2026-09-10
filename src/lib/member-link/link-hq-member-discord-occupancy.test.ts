import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  }),
  schema: {
    hqMemberLinks: {
      id: "hqMemberLinks.id",
      allianceId: "hqMemberLinks.allianceId",
      hqUserId: "hqMemberLinks.hqUserId",
      ashedMemberId: "hqMemberLinks.ashedMemberId",
      gameUid: "hqMemberLinks.gameUid",
    },
    discordMemberLinks: {
      allianceId: "discordMemberLinks.allianceId",
      gameUid: "discordMemberLinks.gameUid",
      discordUserId: "discordMemberLinks.discordUserId",
      ashedMemberId: "discordMemberLinks.ashedMemberId",
    },
    discordHqLinks: {
      discordUserId: "discordHqLinks.discordUserId",
      hqUserId: "discordHqLinks.hqUserId",
    },
    hqMemberLinkPending: {},
    alliances: {
      id: "alliances.id",
      ownerMemberExternalId: "alliances.ownerMemberExternalId",
    },
  },
}));

vi.mock("@/lib/members/member-tenure.server", () => ({
  denormalizeGameUidOnMember: vi.fn(),
  openMemberAllianceTenure: vi.fn(),
}));

vi.mock("@/lib/members/commander-identity.server", () => ({
  syncCommanderIdentityFromMemberLink: vi.fn(),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  inheritHqMemberLinkToDiscordIfLinked: vi.fn(),
}));

import { linkHqMember } from "./repository.server";

/**
 * Select call order in linkHqMember:
 * 1. HQ game_uid claims — from.where → []
 * 2. Discord game_uid claims — from.leftJoin.where → []
 * 3. HQ seat by ashed_member — from.where.limit → []
 * 4. Discord seat occupants — from.leftJoin.where → occupants
 * 5. HQ link for user — from.where.limit → []
 */
function mockSelectSequence(discordOccupants: Array<{
  discordUserId: string;
  hqUserId: string | null;
}>) {
  let call = 0;
  selectMock.mockImplementation(() => {
    call += 1;
    if (call === 1 || call === 3 || call === 5) {
      const whereResult = Object.assign(Promise.resolve([]), {
        limit: vi.fn().mockResolvedValue([]),
      });
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(whereResult),
          leftJoin: vi.fn(),
          limit: vi.fn().mockResolvedValue([]),
        }),
      };
    }
    // Discord game_uid (2) or Discord ashed_member occupants (4)
    const occupants = call === 4 ? discordOccupants : [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(Promise.resolve([]), {
            limit: vi.fn().mockResolvedValue([]),
          }),
        ),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(occupants),
        }),
        limit: vi.fn().mockResolvedValue([]),
      }),
    };
  });
}

describe("linkHqMember Discord ashed_member occupancy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects HQ claim when Discord already occupies the seat for another account", async () => {
    mockSelectSequence([
      { discordUserId: "discord-alice", hqUserId: "hq-alice" },
    ]);

    const result = await linkHqMember({
      allianceId: "ally-1",
      hqUserId: "hq-bob",
      ashedMemberId: "member-c",
      gameUid: "2222222222221203",
      memberDisplayName: "Charlie",
    });

    expect(result).toEqual({
      ok: false,
      reason: "member_linked_to_other_user",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects HQ claim when Discord occupies the seat without an HQ link", async () => {
    mockSelectSequence([
      { discordUserId: "discord-alice", hqUserId: null },
    ]);

    const result = await linkHqMember({
      allianceId: "ally-1",
      hqUserId: "hq-bob",
      ashedMemberId: "member-c",
      gameUid: "2222222222221203",
    });

    expect(result).toEqual({
      ok: false,
      reason: "member_linked_to_other_user",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("allows HQ claim when Discord occupancy is the same HQ account", async () => {
    mockSelectSequence([
      { discordUserId: "discord-alice", hqUserId: "hq-alice" },
    ]);
    insertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: "link-1",
            allianceId: "ally-1",
            hqUserId: "hq-alice",
            ashedMemberId: "member-c",
            gameUid: "1111111111111203",
          },
        ]),
      }),
    });

    const result = await linkHqMember({
      allianceId: "ally-1",
      hqUserId: "hq-alice",
      ashedMemberId: "member-c",
      gameUid: "1111111111111203",
      memberDisplayName: "Charlie",
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });
});
