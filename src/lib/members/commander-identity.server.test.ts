import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  limitResults: [] as unknown[][],
  insertOrder: 0,
  insertedCommanders: [] as Record<string, unknown>[],
  insertedMemberships: [] as Record<string, unknown>[],
  insertedHqUserCommanders: [] as Record<string, unknown>[],
  updatedCommanders: [] as Record<string, unknown>[],
  updatedMemberships: [] as Record<string, unknown>[],
  updatedHqUserCommanders: [] as Record<string, unknown>[],
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mockState.limitResults.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mockState.insertOrder += 1;
        if (mockState.insertOrder === 1 && !values.commanderId) {
          mockState.insertedCommanders.push(values);
        } else if (values.commanderId && values.allianceId) {
          mockState.insertedMemberships.push(values);
        } else if (values.hqUserId) {
          mockState.insertedHqUserCommanders.push(values);
        } else {
          mockState.insertedCommanders.push(values);
        }
        return {
          returning: async () => [{ id: "commander-new" }],
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if ("primaryName" in values || "profession" in values) {
            mockState.updatedCommanders.push(values);
          } else if ("isPrimary" in values && Object.keys(values).length <= 2) {
            mockState.updatedHqUserCommanders.push(values);
          } else {
            mockState.updatedMemberships.push(values);
          }
        },
      }),
    }),
  }),
  schema: {
    allianceMembers: { allianceId: "allianceId", ashedMemberId: "ashedMemberId" },
    commanders: { id: "id", gameUid: "gameUid" },
    commanderAllianceMemberships: {
      id: "id",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      commanderId: "commanderId",
      leftAt: "leftAt",
    },
    hqUserCommanders: { hqUserId: "hqUserId", commanderId: "commanderId" },
  },
}));

import {
  linkHqUserToCommander,
  resolveCommanderByUid,
  syncCommanderIdentityFromMemberLink,
  upsertCommanderFromLink,
} from "@/lib/members/commander-identity.server";

describe("commander-identity.server", () => {
  beforeEach(() => {
    mockState.limitResults = [];
    mockState.insertOrder = 0;
    mockState.insertedCommanders = [];
    mockState.insertedMemberships = [];
    mockState.insertedHqUserCommanders = [];
    mockState.updatedCommanders = [];
    mockState.updatedMemberships = [];
    mockState.updatedHqUserCommanders = [];
  });

  it("resolveCommanderByUid returns null for blank UID", async () => {
    await expect(resolveCommanderByUid("   ")).resolves.toBeNull();
  });

  it("upsertCommanderFromLink creates a commander from roster stats", async () => {
    mockState.limitResults.push(
      [
        {
          currentName: "Alice",
          profession: "Engineer",
          professionalLevel: 3,
          memberLevel: 30,
          heroPowerM: 12.5,
          powerLevel: "12.5M",
          currentKills: 100,
          currentTotalHeroPower: 200,
          currentSquadPowerJson: { a: 1 },
          status: "active",
          ashedAllianceId: "aa-1",
          allianceRank: 4,
          allianceRankTitle: "R4",
        },
      ],
      [],
    );

    const result = await upsertCommanderFromLink({
      gameUid: "12345678901234",
      allianceId: "alliance-a",
      ashedMemberId: "member-1",
      memberDisplayName: "Alice",
    });

    expect(result.commanderId).toBe("commander-new");
    expect(mockState.insertedCommanders[0]).toMatchObject({
      gameUid: "12345678901234",
      primaryName: "Alice",
      profession: "Engineer",
      memberLevel: 30,
    });
  });

  it("upsertCommanderFromLink updates an existing commander", async () => {
    mockState.limitResults.push(
      [{ currentName: "Renamed", status: "active" }],
      [{ id: "commander-existing", gameUid: "12345678901234" }],
    );

    const result = await upsertCommanderFromLink({
      gameUid: "12345678901234",
      allianceId: "alliance-a",
      ashedMemberId: "member-1",
    });

    expect(result.commanderId).toBe("commander-existing");
    expect(mockState.updatedCommanders[0]).toMatchObject({
      primaryName: "Renamed",
    });
    expect(mockState.insertedCommanders).toHaveLength(0);
  });

  it("syncCommanderIdentityFromMemberLink writes membership and HQ ownership", async () => {
    mockState.limitResults.push(
      [
        {
          currentName: "Bob",
          status: "active",
          ashedAllianceId: "aa-2",
          allianceRank: 3,
          allianceRankTitle: "R3",
        },
      ],
      [],
      [
        {
          currentName: "Bob",
          status: "active",
          ashedAllianceId: "aa-2",
          allianceRank: 3,
          allianceRankTitle: "R3",
        },
      ],
      [],
    );

    await syncCommanderIdentityFromMemberLink({
      allianceId: "alliance-a",
      ashedMemberId: "member-2",
      gameUid: "98765432109876",
      memberDisplayName: "Bob",
      hqUserId: "hq-user-1",
    });

    expect(mockState.insertedCommanders).toHaveLength(1);
    expect(mockState.insertedMemberships[0]).toMatchObject({
      allianceId: "alliance-a",
      ashedMemberId: "member-2",
      status: "active",
      rosterNameAtMembership: "Bob",
    });
    expect(mockState.insertedHqUserCommanders[0]).toMatchObject({
      hqUserId: "hq-user-1",
      isPrimary: true,
    });
  });

  it("linkHqUserToCommander clears other primaries before linking", async () => {
    await linkHqUserToCommander({
      hqUserId: "hq-user-1",
      commanderId: "commander-2",
    });

    expect(mockState.updatedHqUserCommanders).toHaveLength(1);
    expect(mockState.insertedHqUserCommanders[0]).toMatchObject({
      hqUserId: "hq-user-1",
      commanderId: "commander-2",
      isPrimary: true,
    });
  });
});
