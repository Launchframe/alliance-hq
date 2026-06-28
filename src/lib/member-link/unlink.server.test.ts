import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  unlinkCommanderDiscordLinks,
  unlinkCommanderHqAccount,
} from "./unlink.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const dbState: {
  limitResults: unknown[][];
  returningResults: unknown[][];
} = { limitResults: [], returningResults: [] };

function makeChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    set: () => chain,
    delete: () => chain,
    update: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(dbState.limitResults.shift() ?? []),
    returning: () => Promise.resolve(dbState.returningResults.shift() ?? []),
    then: <T>(
      onFulfilled: (value: undefined) => T,
      onRejected?: (reason: unknown) => T,
    ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => makeChain(),
  schema: {
    hqMemberLinks: { id: {}, allianceId: {}, ashedMemberId: {}, hqUserId: {}, gameUid: {} },
    hqUserCommanders: { commanderId: {}, hqUserId: {} },
    alliances: { id: {}, ownerMemberExternalId: {} },
    hqUsers: { id: {}, primaryGameUid: {}, updatedAt: {} },
    commanderAllianceMemberships: { commanderId: {}, allianceId: {}, ashedMemberId: {} },
    discordMemberLinks: { id: {}, allianceId: {}, ashedMemberId: {} },
  },
}));

const audit = await import("@/lib/bff/audit");

const baseInput = {
  sessionId: "sess-1",
  actorHqUserId: "owner-1",
  allianceId: "a1",
  ashedMemberId: "m-1",
};

describe("unlinkCommanderHqAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.limitResults = [];
    dbState.returningResults = [];
  });

  it("returns not_linked when no HQ link exists", async () => {
    dbState.limitResults = [[]];
    const result = await unlinkCommanderHqAccount(baseInput);
    expect(result).toEqual({ ok: false, reason: "not_linked" });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it("unlinks the HQ account and writes an audit entry", async () => {
    dbState.limitResults = [
      [{ id: "link-1", hqUserId: "u-prev", gameUid: "1001369694001203" }],
      [{ commanderId: "cmd-1" }],
    ];
    const result = await unlinkCommanderHqAccount(baseInput);
    expect(result).toEqual({ ok: true, target: "hq", removed: 1 });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_link.hq_unlinked",
        allianceId: "a1",
        hqUserId: "owner-1",
        metadata: expect.objectContaining({
          ashedMemberId: "m-1",
          previousHqUserId: "u-prev",
        }),
      }),
    );
  });
});

describe("unlinkCommanderDiscordLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.limitResults = [];
    dbState.returningResults = [];
  });

  it("returns not_linked when there are no Discord links", async () => {
    dbState.returningResults = [[]];
    const result = await unlinkCommanderDiscordLinks(baseInput);
    expect(result).toEqual({ ok: false, reason: "not_linked" });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it("removes all Discord links for the commander and audits the count", async () => {
    dbState.returningResults = [[{ id: "d1" }, { id: "d2" }]];
    const result = await unlinkCommanderDiscordLinks(baseInput);
    expect(result).toEqual({ ok: true, target: "discord", removed: 2 });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_link.discord_unlinked",
        metadata: expect.objectContaining({ ashedMemberId: "m-1", removed: 2 }),
      }),
    );
  });
});
