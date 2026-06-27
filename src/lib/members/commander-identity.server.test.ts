import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectCallIndex: 0,
  insertOrder: 0,
  insertedCommanders: [] as Record<string, unknown>[],
  insertedMemberships: [] as Record<string, unknown>[],
  insertedHqUserCommanders: [] as Record<string, unknown>[],
  updatedCommanders: [] as Record<string, unknown>[],
  updatedMemberships: [] as Record<string, unknown>[],
  updatedHqUserCommanders: [] as Record<string, unknown>[],
}));

const mockDb = vi.hoisted(() => {
  function makeChain() {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.from = passthrough;
    chain.innerJoin = passthrough;
    chain.leftJoin = passthrough;
    chain.where = passthrough;
    chain.limit = passthrough;
    chain.orderBy = passthrough;
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    chain.then = (resolve: (value: unknown) => void) => {
      const result = mockState.selectResults[mockState.selectCallIndex] ?? [];
      mockState.selectCallIndex += 1;
      resolve(result);
    };
    return chain;
  }

  return {
    select: () => makeChain(),
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
  };
});

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  schema: {
    allianceMembers: {
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      commanderSyncStatus: "commanderSyncStatus",
      commanderConflictJson: "commanderConflictJson",
    },
    alliances: { id: "id", gameServerNumber: "gameServerNumber" },
    commanders: {
      id: "id",
      gameUid: "gameUid",
      primaryNameNormalized: "primaryNameNormalized",
      gameServerNumber: "gameServerNumber",
    },
    commanderAllianceMemberships: {
      id: "id",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      commanderId: "commanderId",
      leftAt: "leftAt",
    },
    hqUserCommanders: { hqUserId: "hqUserId", commanderId: "commanderId" },
    hqMemberLinks: { allianceId: "allianceId", ashedMemberId: "ashedMemberId", gameUid: "gameUid" },
    discordMemberLinks: { allianceId: "allianceId", ashedMemberId: "ashedMemberId", gameUid: "gameUid" },
  },
}));

import {
  linkHqUserToCommander,
  resolveCommanderByUid,
  syncCommanderFromAllianceMember,
  syncCommanderIdentityFromMemberLink,
  upsertCommanderFromLink,
} from "@/lib/members/commander-identity.server";

describe("commander-identity.server", () => {
  beforeEach(() => {
    mockState.selectResults = [];
    mockState.selectCallIndex = 0;
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
    const aliceMember = {
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
    };
    mockState.selectResults.push(
      [{ gameServerNumber: 100 }],
      [aliceMember],
      [],
      [aliceMember],
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
    mockState.selectResults.push(
      [{ gameServerNumber: 100 }],
      [{ currentName: "Renamed", status: "active" }],
      [],
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

  it("syncCommanderFromAllianceMember creates orphan commander when UID is unknown", async () => {
    const ghostMember = {
      currentName: "Ghost",
      status: "active",
      gameUid: null,
    };
    mockState.selectResults.push(
      [ghostMember],
      [],
      [],
      [{ gameServerNumber: 100 }],
      [],
      [],
      [],
      [ghostMember],
      [ghostMember],
      [],
    );

    const result = await syncCommanderFromAllianceMember({
      allianceId: "alliance-a",
      ashedMemberId: "member-ghost",
    });

    expect(result.status).toBe("synced");
    expect(mockState.insertedCommanders[0]).toMatchObject({
      gameUid: null,
      primaryName: "Ghost",
      gameServerNumber: 100,
    });
    expect(mockState.insertedMemberships[0]).toMatchObject({
      allianceId: "alliance-a",
      ashedMemberId: "member-ghost",
    });
  });

  it("syncCommanderFromAllianceMember defers when game server is unset", async () => {
    mockState.selectResults.push(
      [{ currentName: "Ghost", status: "active", gameUid: null }],
      [],
      [],
      [{ gameServerNumber: null }],
    );

    const result = await syncCommanderFromAllianceMember({
      allianceId: "alliance-a",
      ashedMemberId: "member-ghost",
    });

    expect(result.status).toBe("deferred");
    if (result.status === "deferred") {
      expect(result.reason).toBe("missing_server");
    }
    expect(mockState.insertedCommanders).toHaveLength(0);
  });

  it("syncCommanderFromAllianceMember mirrors roster row when UID is known", async () => {
    const memberRow = {
      currentName: "Carol",
      status: "active",
      gameUid: "1111222233334444",
      ashedAllianceId: "aa-3",
      allianceRank: 2,
      allianceRankTitle: "R2",
      heroPowerM: 8.2,
      memberLevel: 22,
    };
    mockState.selectResults.push(
      [memberRow],
      [{ gameServerNumber: 100 }],
      [{ gameServerNumber: 100 }],
      [memberRow],
      [],
      [memberRow],
      [],
      [memberRow],
      [],
    );

    await syncCommanderFromAllianceMember({
      allianceId: "alliance-a",
      ashedMemberId: "member-3",
    });

    expect(mockState.insertedCommanders[0]).toMatchObject({
      gameUid: "1111222233334444",
      primaryName: "Carol",
      memberLevel: 22,
    });
    expect(mockState.insertedMemberships[0]).toMatchObject({
      allianceId: "alliance-a",
      ashedMemberId: "member-3",
      status: "active",
    });
  });

  it("syncCommanderFromAllianceMember syncs UID-known rows without an alliance server", async () => {
    const memberRow = {
      currentName: "Serverless",
      status: "active",
      gameUid: "2222333344445555",
      ashedAllianceId: "aa-4",
    };
    mockState.selectResults.push(
      [memberRow],
      [{ gameServerNumber: null }],
      [{ gameServerNumber: null }],
      [memberRow],
      [memberRow],
      [],
      [memberRow],
      [],
    );

    const result = await syncCommanderFromAllianceMember({
      allianceId: "alliance-a",
      ashedMemberId: "member-serverless",
    });

    expect(result.status).toBe("synced");
    expect(mockState.insertedCommanders[0]).toMatchObject({
      gameUid: "2222333344445555",
      gameServerNumber: null,
      primaryName: "Serverless",
    });
    expect(mockState.insertedMemberships[0]).toMatchObject({
      allianceId: "alliance-a",
      ashedMemberId: "member-serverless",
    });
  });

  it("syncCommanderFromAllianceMember syncs UID-known rows with a blank roster name", async () => {
    const memberRow = {
      currentName: "",
      status: "active",
      gameUid: "3333444455556666",
      ashedAllianceId: "aa-5",
    };
    mockState.selectResults.push(
      [memberRow],
      [{ gameServerNumber: 100 }],
      [{ gameServerNumber: 100 }],
      [memberRow],
      [memberRow],
      [],
      [memberRow],
      [],
    );

    const result = await syncCommanderFromAllianceMember({
      allianceId: "alliance-a",
      ashedMemberId: "member-blank-name",
    });

    expect(result.status).toBe("synced");
    expect(mockState.insertedCommanders[0]).toMatchObject({
      gameUid: "3333444455556666",
      primaryName: "",
    });
    expect(mockState.insertedMemberships[0]).toMatchObject({
      allianceId: "alliance-a",
      ashedMemberId: "member-blank-name",
    });
  });

  it("syncCommanderIdentityFromMemberLink writes membership and HQ ownership", async () => {
    const bobMember = {
      currentName: "Bob",
      status: "active",
      ashedAllianceId: "aa-2",
      allianceRank: 3,
      allianceRankTitle: "R3",
    };
    mockState.selectResults.push(
      [{ gameServerNumber: 100 }],
      [bobMember],
      [],
      [bobMember],
      [],
      [bobMember],
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
