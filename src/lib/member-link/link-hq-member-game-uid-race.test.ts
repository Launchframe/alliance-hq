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

import { HQ_MEMBER_LINK_GAME_UID_UNIQUE } from "./member-link-game-uid-unique.shared";
import { linkHqMember } from "./repository.server";

/**
 * Drizzle chains used by linkHqMember:
 * - claim load: select.from.where → Promise<[]>
 * - claim load discord: select.from.leftJoin.where → Promise<[]>
 * - existing links: select.from.where.limit → Promise<[]>
 */
function emptySelectChain() {
  const whereResult = Object.assign(Promise.resolve([]), {
    limit: vi.fn().mockResolvedValue([]),
  });
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult),
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
      limit: vi.fn().mockResolvedValue([]),
    }),
  };
}

describe("linkHqMember game_uid unique race", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockImplementation(() => emptySelectChain());
  });

  it("returns member_linked_to_other_user when concurrent insert hits game_uid unique", async () => {
    insertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue({
          code: "23505",
          constraint: HQ_MEMBER_LINK_GAME_UID_UNIQUE,
        }),
      }),
    });

    const result = await linkHqMember({
      allianceId: "ally-1",
      hqUserId: "user-b",
      ashedMemberId: "member-b",
      gameUid: "123456789012",
      memberDisplayName: "Bravo",
    });

    expect(result).toEqual({
      ok: false,
      reason: "member_linked_to_other_user",
    });
  });

  it("still surfaces non-unique DB errors", async () => {
    insertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(new Error("connection lost")),
      }),
    });

    await expect(
      linkHqMember({
        allianceId: "ally-1",
        hqUserId: "user-b",
        ashedMemberId: "member-b",
        gameUid: "123456789012",
      }),
    ).rejects.toThrow("connection lost");
  });
});
