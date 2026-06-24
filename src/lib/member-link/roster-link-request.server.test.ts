import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  tryBootstrapOwnerColdStartMember,
  tryRouteRosterMissToOwnerApproval,
} from "./roster-link-request.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/lastwar/sync-member-game-level.server", () => ({
  syncAllianceMemberGameLevelFromLastWar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  linkHqMember: vi.fn(),
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
const repository = await import("@/lib/member-link/repository.server");
const dbModule = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue([]);

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    chain,
    insert,
    insertValues,
    update,
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
    hqRosterLinkRequests: { allianceId: "a", hqUserId: "u", status: "status", id: "id" },
    hqRosterLinkActionTokens: { requestId: "request_id", usedAt: "used_at" },
    allianceMembers: {},
  },
}));

describe("tryBootstrapOwnerColdStartMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbModule.chain.limit.mockResolvedValue([]);
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

  it("auto-links owner invite on empty roster when name and server match", async () => {
    dbModule.chain.limit.mockResolvedValue([
      { id: "inv-1", roleId: "role-owner", acceptedAt: new Date() },
    ]);

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
  });

  it("returns null for non-owner invite", async () => {
    dbModule.chain.limit.mockResolvedValue([
      { id: "inv-1", roleId: "role-member", acceptedAt: new Date() },
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
  });

  it("returns null when reported name does not match game name", async () => {
    dbModule.chain.limit.mockResolvedValue([
      { id: "inv-1", roleId: "role-owner", acceptedAt: new Date() },
    ]);

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

  it("returns wrong_server when alliance server mismatches", async () => {
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

    expect(result?.outcome).toBe("wrong_server");
  });
});

describe("tryRouteRosterMissToOwnerApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbModule.chain.limit.mockResolvedValue([]);
    vi.mocked(gameServers.resolveAllianceGameServerNumber).mockResolvedValue(1203);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });

  it("returns wrong_server when player server cannot be parsed", async () => {
    const result = await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander" },
    });

    expect(result?.outcome).toBe("wrong_server");
  });

  it("returns wrong_server when alliance server mismatches", async () => {
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

    expect(result?.outcome).toBe("wrong_server");
  });

  it("returns null when no accepted invite exists", async () => {
    const result = await tryRouteRosterMissToOwnerApproval({
      allianceId: "a1",
      allianceTag: "LFgo",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      lookup: { ok: true, gameUserName: "Commander", gameServerNumber: 1203 },
    });

    expect(result).toBeNull();
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
