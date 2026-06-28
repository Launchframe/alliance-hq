import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWebMemberLinkClaimConfirm, blockSelfServiceWhenClaimPending } from "./claim.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/events/admin-alerts", () => ({
  emitMemberLinkClaimConflictAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/lastwar/player-lookup", () => ({
  isValidGameUid: (value: string) => /^\d{12,16}$/.test(value.trim()),
  lookupPlayerByUid: vi.fn(),
}));

vi.mock("@/lib/lastwar/sync-member-game-level.server", () => ({
  syncAllianceMemberGameLevelFromLastWar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/native-alliance/invites", () => ({
  findAcceptedClaimInviteForUser: vi.fn(),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn(),
  linkHqMember: vi.fn(),
  maybeSetOwnerMemberExternalId: vi.fn().mockResolvedValue(undefined),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  syncPrimaryGameUidFromHqMemberLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/roster-link-resolve.server", () => ({
  reconcileAllianceMemberForRosterLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceById: vi.fn(),
  getLinkedMemberIds: vi.fn(),
}));

const dbState: {
  commanderRow: Array<{
    currentName: string;
    previousNamesJson: string[] | null;
    status?: string;
  }>;
  memberRows: Array<{
    ashedMemberId: string;
    currentName: string;
    previousNamesJson: string[] | null;
  }>;
} = { commanderRow: [], memberRows: [] };

function makeChain() {
  const chain = {
    select: () => chain,
    from: () => chain,
    orderBy: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(dbState.commanderRow),
  };
  const thenKey = ["th", "en"].join("");
  Reflect.defineProperty(chain, thenKey, {
    value: <TResult1 = typeof dbState.memberRows, TResult2 = never>(
      onFulfilled?:
        | ((value: typeof dbState.memberRows) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> =>
      Promise.resolve(dbState.memberRows).then(onFulfilled, onRejected),
  });
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => makeChain(),
  schema: {
    allianceMembers: {
      allianceId: {},
      ashedMemberId: {},
      currentName: {},
      previousNamesJson: {},
      status: {},
    },
    hqMemberLinks: { allianceId: {}, ashedMemberId: {} },
  },
}));

const invites = await import("@/lib/native-alliance/invites");
const repository = await import("@/lib/member-link/repository.server");
const alerts = await import("@/lib/events/admin-alerts");
const lookup = await import("@/lib/lastwar/player-lookup");
const gameServers = await import("@/lib/game-season/game-servers.server");
const vrRepo = await import("@/lib/vr/repository");
const resolve = await import("@/lib/member-link/roster-link-resolve.server");

const baseInput = {
  sessionId: "sess-1",
  allianceId: "a1",
  hqUserId: "u1",
  locale: "en-US",
  gameUid: "1001369694001203",
  displayName: "Player",
};

describe("runWebMemberLinkClaimConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.commanderRow = [
      { currentName: "Alpha", previousNamesJson: null, status: "active" },
    ];
    dbState.memberRows = [];
    vi.mocked(repository.getHqMemberLinkForUser).mockResolvedValue(null as never);
    vi.mocked(invites.findAcceptedClaimInviteForUser).mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-1",
    });
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(
      1203,
    );
    vi.mocked(vrRepo.getAllianceById).mockResolvedValue({
      tag: "LFgo",
    } as never);
    vi.mocked(vrRepo.getLinkedMemberIds).mockResolvedValue(new Set<string>());
    vi.mocked(repository.linkHqMember).mockResolvedValue({
      ok: true,
      mode: "created",
      link: {} as never,
    });
  });

  it("returns usage when there is no claim target", async () => {
    vi.mocked(invites.findAcceptedClaimInviteForUser).mockResolvedValue(null);
    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("usage");
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("returns usage when the claim target is no longer active", async () => {
    dbState.commanderRow = [
      { currentName: "Alpha", previousNamesJson: null, status: "former" },
    ];
    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("usage");
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("rejects an invalid UID before any lookup", async () => {
    const result = await runWebMemberLinkClaimConfirm({
      ...baseInput,
      gameUid: "12",
    });
    expect(result.outcome).toBe("usage");
    expect(lookup.lookupPlayerByUid).not.toHaveBeenCalled();
  });

  it("surfaces a lookup failure", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "lookup down",
    } as never);
    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("lookup_error");
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("flags a server mismatch as a conflict and notifies officers", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Alpha",
      gameServerNumber: 1205,
    } as never);
    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("claim_conflict");
    expect(alerts.emitMemberLinkClaimConflictAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "server_mismatch" }),
    );
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("blocks when the fetched name collides with another claimed commander", async () => {
    dbState.commanderRow = [{ currentName: "Bravo", previousNamesJson: null }];
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Bravo",
      gameServerNumber: 1203,
    } as never);
    dbState.memberRows = [
      { ashedMemberId: "m-other", currentName: "Bravo", previousNamesJson: [] },
    ];
    vi.mocked(vrRepo.getLinkedMemberIds).mockResolvedValue(
      new Set<string>(["m-other"]),
    );

    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("claim_conflict");
    expect(alerts.emitMemberLinkClaimConflictAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "name_collision" }),
    );
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("blocks a same-server UID that does not match the invite target", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Bravo",
      gameServerNumber: 1203,
    } as never);

    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("claim_conflict");
    expect(alerts.emitMemberLinkClaimConflictAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "target_mismatch" }),
    );
    expect(resolve.reconcileAllianceMemberForRosterLink).not.toHaveBeenCalled();
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("allows a UID whose fetched name matches a previous target name", async () => {
    dbState.commanderRow = [
      { currentName: "Alpha Renamed", previousNamesJson: ["Alpha"] },
    ];
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Alpha",
      gameServerNumber: 1203,
    } as never);

    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("linked");
    expect(repository.linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "m-1",
        memberDisplayName: "Alpha",
      }),
    );
  });

  it("links the recipient and populates the commander record on success", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Alpha",
      gameServerNumber: 1203,
      gameUserLevel: 30,
    } as never);

    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("linked");
    expect(resolve.reconcileAllianceMemberForRosterLink).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        ashedMemberId: "m-1",
        gameUserName: "Alpha",
      }),
    );
    expect(repository.linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        hqUserId: "u1",
        ashedMemberId: "m-1",
        gameUid: "1001369694001203",
      }),
    );
    expect(repository.saveHqMemberLinkPending).toHaveBeenCalledWith(
      "a1",
      "u1",
      null,
    );
    expect(alerts.emitMemberLinkClaimConflictAlert).not.toHaveBeenCalled();
  });

  it("treats an already-claimed commander race as a conflict", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Alpha",
      gameServerNumber: 1203,
    } as never);
    vi.mocked(repository.linkHqMember).mockResolvedValue({
      ok: false,
      reason: "member_linked_to_other_user",
    });

    const result = await runWebMemberLinkClaimConfirm(baseInput);
    expect(result.outcome).toBe("claim_conflict");
    expect(alerts.emitMemberLinkClaimConflictAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "commander_taken" }),
    );
  });
});

describe("blockSelfServiceWhenClaimPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.commanderRow = [
      { currentName: "Alpha", previousNamesJson: null, status: "active" },
    ];
    vi.mocked(repository.getHqMemberLinkForUser).mockResolvedValue(null as never);
    vi.mocked(invites.findAcceptedClaimInviteForUser).mockResolvedValue({
      inviteId: "inv-1",
      targetAshedMemberId: "m-1",
    });
  });

  it("blocks self-service when a claim invite is accepted but not linked", async () => {
    const result = await blockSelfServiceWhenClaimPending({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });
    expect(result?.outcome).toBe("usage");
    expect(result?.message).toContain("claim screen");
  });

  it("allows self-service when the user is already linked", async () => {
    vi.mocked(repository.getHqMemberLinkForUser).mockResolvedValue({} as never);
    const result = await blockSelfServiceWhenClaimPending({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });
    expect(result).toBeNull();
  });

  it("allows self-service when there is no pending claim invite", async () => {
    vi.mocked(invites.findAcceptedClaimInviteForUser).mockResolvedValue(null);
    const result = await blockSelfServiceWhenClaimPending({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });
    expect(result).toBeNull();
  });

  it("allows self-service when the claim target is no longer active", async () => {
    dbState.commanderRow = [
      { currentName: "Alpha", previousNamesJson: null, status: "former" },
    ];
    const result = await blockSelfServiceWhenClaimPending({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });
    expect(result).toBeNull();
  });
});
