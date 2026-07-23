import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDiscordRosterMissLinkRequest,
  tryBootstrapOwnerColdStartMember,
  tryRouteRosterMissToOwnerApproval,
} from "./roster-link-request.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/events/admin-alerts", () => ({
  emitMemberLinkUidTakenAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/lastwar/sync-member-game-level.server", () => ({
  syncAllianceMemberGameLevelFromLastWar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
  linkAllianceToGameServer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/game-season/sync", () => ({
  applySeasonSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/server-eligibility.server", () => ({
  resolveMemberLinkServerEligibilityForUid: vi.fn(),
}));

vi.mock("@/lib/native-alliance/operating-mode", () => ({
  isNativeAlliance: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  linkHqMember: vi.fn(),
  maybeSetOwnerMemberExternalId: vi.fn().mockResolvedValue(undefined),
  syncPrimaryGameUidFromHqMemberLink: vi.fn(),
}));

vi.mock("@/lib/member-link/roster-link-inbox.server", () => ({
  materializeRosterLinkInboxItem: vi.fn().mockResolvedValue("inbox-1"),
  satisfyRosterLinkInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/roster-link-owner-email.server", () => ({
  sendRosterLinkOwnerApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendRosterLinkInviteeResolvedEmail: vi.fn().mockResolvedValue(undefined),
  resolveAllianceOwnerEmail: vi.fn().mockResolvedValue("owner@example.com"),
}));

const gameServers = await import("@/lib/game-season/game-servers.server");
const seasonSync = await import("@/lib/game-season/sync");
const serverEligibility = await import("@/lib/member-link/server-eligibility.server");
const operatingMode = await import("@/lib/native-alliance/operating-mode");
const repository = await import("@/lib/member-link/repository.server");
const dbModule = vi.hoisted(() => {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (
      onFulfilled?: (value: unknown[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then(onFulfilled, onRejected) {
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue([]);

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    chain,
    insert,
    insertValues,
    update,
    updateSet,
    updateWhere,
    getDb: vi.fn(() => ({
      select: vi.fn(() => chain),
      insert,
      update,
    })),
  };
});

vi.mock("@/lib/db", () => ({
  getDb: dbModule.getDb,
  schema: {
    hqInvites: { allianceId: "alliance_id", acceptedByHqUserId: "accepted_by", kind: "kind", acceptedAt: "accepted_at" },
    hqRosterLinkRequests: {
      allianceId: "a",
      hqUserId: "u",
      discordUserId: "discord_user_id",
      status: "status",
      id: "id",
    },
    hqRosterLinkActionTokens: { requestId: "request_id", usedAt: "used_at" },
    alliances: { id: "id", ownerHqUserId: "owner_hq_user_id" },
    allianceMembers: {},
  },
}));

describe("tryBootstrapOwnerColdStartMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbModule.chain.limit.mockResolvedValue([]);
    vi.mocked(operatingMode.isNativeAlliance).mockResolvedValue(true);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(1203);
    vi.mocked(repository.linkHqMember).mockResolvedValue({
      ok: true,
      mode: "created",
      link: {
        id: "link-1",
        allianceId: "a1",
        hqUserId: "u1",
        ashedMemberId: "member-1",
        memberDisplayName: "Commander",
        gameUid: "1234567890121203",
        linkedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });

  it("returns null when roster is non-empty", async () => {
    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 3,
    });

    expect(result).toBeNull();
  });

  it("auto-links join-code owner on empty roster when name and server match", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);

    const auditBag: { ashedMemberId?: string } = {};
    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
      sessionId: "sess-1",
      auditBag,
    });

    expect(result?.outcome).toBe("linked");
    expect(result?.linkedMemberName).toBe("Commander");
    expect(auditBag.ashedMemberId).toBeTruthy();
    expect(repository.linkHqMember).toHaveBeenCalled();
    expect(gameServers.linkAllianceToGameServer).not.toHaveBeenCalled();
  });

  it("persists ownerMemberExternalId after successful cold-start link", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);

    await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(repository.maybeSetOwnerMemberExternalId).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "a1", hqUserId: "u1" }),
    );
  });

  it("adopts alliance server from owner lookup when alliance has no server yet", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(null);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result?.outcome).toBe("linked");
    expect(gameServers.linkAllianceToGameServer).toHaveBeenCalledWith("a1", 1203);
    expect(seasonSync.applySeasonSync).toHaveBeenCalledWith("a1");
  });

  it("auto-links email-invite owner when ownerHqUserId is not set yet", async () => {
    dbModule.chain.limit
      .mockResolvedValueOnce([{ ownerHqUserId: null }])
      .mockResolvedValueOnce([
        { id: "inv-1", roleId: "role-owner", acceptedAt: new Date() },
      ]);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result?.outcome).toBe("linked");
  });

  it("auto-links officer invite on empty roster when ownerHqUserId is not set yet", async () => {
    dbModule.chain.limit
      .mockResolvedValueOnce([{ ownerHqUserId: null }])
      .mockResolvedValueOnce([
        { id: "inv-officer", roleId: "role-officer", acceptedAt: new Date() },
      ]);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result?.outcome).toBe("linked");
    expect(repository.maybeSetOwnerMemberExternalId).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "a1", hqUserId: "u1" }),
    );
  });

  it("returns null for non-native alliance", async () => {
    vi.mocked(operatingMode.isNativeAlliance).mockResolvedValue(false);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result).toBeNull();
  });

  it.each(["role-member", "role-viewer", "role-data-entry"])(
    "returns null for %s invite",
    async (roleId) => {
      dbModule.chain.limit
        .mockResolvedValueOnce([{ ownerHqUserId: null }])
        .mockResolvedValueOnce([
          { id: "inv-1", roleId, acceptedAt: new Date() },
        ]);

      const result = await tryBootstrapOwnerColdStartMember({
        allianceId: "a1",
        hqUserId: "u1",
        locale: "en-US",
        reportedName: "Commander",
        gameUid: "1234567890121203",
        lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
        rosterCount: 0,
      });

      expect(result).toBeNull();
    },
  );

  it("returns null when reported name does not match game name", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Wrong Name",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result).toBeNull();
  });

  it("returns confirm_server when lookup has no game server number", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "123456780000",
      lookup: { ok: true, gameUserName: "Commander" },
      rosterCount: 0,
    });

    expect(result?.outcome).toBe("confirm_server");
    expect(result?.serverConfirmReason).toBe("missing");
    expect(gameServers.linkAllianceToGameServer).not.toHaveBeenCalled();
  });

  it("adopts owner-provided server when lookup server is missing", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(null);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "123456780000",
      lookup: { ok: true, gameUserName: "Commander" },
      rosterCount: 0,
      ownerProvidedServerNumber: 1203,
    });

    expect(result?.outcome).toBe("linked");
    expect(gameServers.linkAllianceToGameServer).toHaveBeenCalledWith("a1", 1203);
  });

  it("returns confirm_server when alliance server mismatches lookup", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(9999);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result?.outcome).toBe("confirm_server");
    expect(result?.serverConfirmReason).toBe("mismatch");
    expect(result?.lookupServerNumber).toBe(1203);
    expect(result?.allianceServerNumber).toBe(9999);
  });

  it("overrides alliance server when owner provides a different number", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(9999);

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
      ownerProvidedServerNumber: 1203,
    });

    expect(result?.outcome).toBe("linked");
    expect(gameServers.linkAllianceToGameServer).toHaveBeenCalledWith("a1", 1203);
  });

  it("returns member_taken when roster member link already exists", async () => {
    dbModule.chain.limit.mockResolvedValueOnce([{ ownerHqUserId: "u1" }]);
    vi.mocked(repository.linkHqMember).mockResolvedValue({
      ok: false,
      reason: "member_linked_to_other_user",
    });

    const result = await tryBootstrapOwnerColdStartMember({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      rosterCount: 0,
    });

    expect(result?.outcome).toBe("member_taken");
  });
});

describe("tryRouteRosterMissToOwnerApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbModule.chain.limit.mockResolvedValue([]);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(1203);
    vi.mocked(serverEligibility.resolveMemberLinkServerEligibilityForUid).mockImplementation(
      async (input) => {
        const allianceServer = await gameServers.resolveAllianceGameServerNumber(
          input.allianceId,
        );
        const lookupServer = input.lookupServer ?? null;
        if (input.userClaimedLookupAsHome) {
          return {
            kind: "rejected",
            reason: "user_claimed_lookup_home",
            allianceServer,
            knownCommanderHomeServer: null,
          };
        }
        if (allianceServer != null && lookupServer != null && lookupServer !== allianceServer) {
          return {
            kind: "confirm_home",
            lookupServer,
            allianceServer,
            knownCommanderHomeServer: null,
          };
        }
        if (lookupServer == null) {
          return {
            kind: "rejected",
            reason: "missing_server",
            allianceServer,
            knownCommanderHomeServer: null,
          };
        }
        return {
          kind: "eligible",
          reason: "lookup_matches",
          allianceServer,
          knownCommanderHomeServer: null,
        };
      },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });

  it("returns wrong_server when player server cannot be parsed", async () => {
    const result = await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890120000",
      lookup: { ok: true, gameUserName: "Commander" },
    });

    expect(result?.outcome).toBe("wrong_server");
  });

  it("returns confirm_home_server when alliance server mismatches lookup position", async () => {
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(9999);

    const result = await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
    });

    expect(result?.outcome).toBe("confirm_home_server");
    expect(result?.lookupServerNumber).toBe(1203);
    expect(result?.allianceServerNumber).toBe(9999);
  });

  it("returns position_not_home when user claims lookup position as home", async () => {
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(9999);

    const result = await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
      userClaimedLookupAsHome: true,
    });

    expect(result?.outcome).toBe("position_not_home");
  });

  it("creates awaiting_owner request when roster name misses without invite", async () => {
    const result = await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
    });

    expect(result?.outcome).toBe("awaiting_owner");
    expect(result?.pending?.kind).toBe("link_awaiting_owner");
    if (result?.pending?.kind === "link_awaiting_owner") {
      expect(result.pending.requestId).toBeTruthy();
    }
  });

  it("persists the substring suggestion fields on the request row", async () => {
    await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Mew2407",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Mew2407", gameServerNumber: 1203 },
      suggestedTargetAshedMemberId: "member-mew",
      suggestionMethod: "substring",
      suggestedMatchedRosterName: "Mew",
    });

    expect(dbModule.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedTargetAshedMemberId: "member-mew",
        suggestionMethod: "substring",
        suggestedMatchedRosterName: "Mew",
      }),
    );
  });

  it("stores null suggestion fields when no suggestion is supplied", async () => {
    await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
    });

    expect(dbModule.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedTargetAshedMemberId: null,
        suggestionMethod: null,
        suggestedMatchedRosterName: null,
      }),
    );
  });
});

describe("createDiscordRosterMissLinkRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbModule.chain.limit.mockResolvedValue([]);
    dbModule.chain.then = (
      onFulfilled?: (value: unknown[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve([]).then(onFulfilled, onRejected);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "" }),
    );
  });

  it("creates a discord-origin request with a null hq user when unlinked", async () => {
    const requestId = await createDiscordRosterMissLinkRequest({
      allianceId: "a1",
      allianceTag: "LFgo",
      discordUserId: "discord-1",
      discordUsername: "cmdr#1",
      hqUserId: null,
      reportedName: "Mew2407",
      gameUid: "1234567890121203",
      gameUserName: "Mew2407",
      gameServerNumber: 1203,
      suggestedTargetAshedMemberId: "member-mew",
      suggestionMethod: "substring",
      suggestedMatchedRosterName: "Mew",
    });

    expect(requestId).toBeTruthy();
    expect(dbModule.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "discord",
        hqUserId: null,
        discordUserId: "discord-1",
        suggestedTargetAshedMemberId: "member-mew",
        suggestedMatchedRosterName: "Mew",
      }),
    );
    // No HQ pending state is written for an unlinked Discord user.
    expect(repository.saveHqMemberLinkPending).not.toHaveBeenCalled();
  });

  it("supersedes prior discord-only pending when the same user links HQ and retries", async () => {
    dbModule.chain.then = (
      onFulfilled?: (value: unknown[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve([{ id: "prior-req" }]).then(onFulfilled, onRejected);

    await createDiscordRosterMissLinkRequest({
      allianceId: "a1",
      allianceTag: "LFgo",
      discordUserId: "discord-1",
      discordUsername: "cmdr#1",
      hqUserId: "hq-1",
      reportedName: "Mew2407",
      gameUid: "1234567890121203",
      gameUserName: "Mew2407",
      gameServerNumber: 1203,
    });

    expect(dbModule.update).toHaveBeenCalled();
    expect(dbModule.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "superseded" }),
    );
  });
});

describe("processRosterLinkActionToken", () => {
  it("rejects empty tokens", async () => {
    const { processRosterLinkActionToken } = await import(
      "./roster-link-request.server"
    );
    const result = await processRosterLinkActionToken("   ");
    expect(result.ok).toBe(false);
    expect(result.title).toBe("Invalid link");
  });
});
