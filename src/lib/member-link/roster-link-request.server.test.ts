import { beforeEach, describe, expect, it, vi } from "vitest";

import { tryRouteRosterMissToOwnerApproval } from "./roster-link-request.server";

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
