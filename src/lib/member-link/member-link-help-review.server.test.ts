import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  linkMemberLinkHelpRequest,
  resolveClaimNameReview,
  unlinkHqMemberLinkBreakGlass,
} from "./member-link-help-review.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/member-link-help-queue.server", () => ({
  getMemberLinkHelpRequestById: vi.fn(),
  resolveMemberLinkHelpRequest: vi.fn().mockResolvedValue({ ok: true }),
  satisfyHelpInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/roster-link-resolve.server", () => ({
  reconcileAllianceMemberForRosterLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkByAllianceAndMember: vi.fn(),
  linkHqMember: vi.fn(),
  maybeSetOwnerMemberExternalId: vi.fn().mockResolvedValue(undefined),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  syncPrimaryGameUidFromHqMemberLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds: vi.fn(),
}));

vi.mock("@/lib/member-link/unlink.server", () => ({
  unlinkCommanderHqAccount: vi.fn(),
  unlinkCommanderDiscordLinks: vi.fn(),
}));

const helpQueue = await import("@/lib/member-link/member-link-help-queue.server");
const repository = await import("@/lib/member-link/repository.server");
const vrRepository = await import("@/lib/vr/repository");
const unlinkServer = await import("@/lib/member-link/unlink.server");
const audit = await import("@/lib/bff/audit");

const dbModule = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    innerJoin: vi.fn(),
    then(
      onFulfilled?: (value: unknown[]) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.limit.mockResolvedValue([]);

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    chain,
    update,
    updateSet,
    updateWhere,
    getDb: vi.fn(() => ({
      select: vi.fn(() => chain),
      update,
    })),
  };
});

vi.mock("@/lib/db", () => ({
  getDb: dbModule.getDb,
  schema: {
    hqMemberLinks: {},
    hqUsers: {},
    discordMemberLinks: {},
    alliances: { id: "id", tag: "tag", name: "name" },
    allianceMembers: {
      allianceId: "alliance_id",
      ashedMemberId: "ashed_member_id",
      status: "status",
      currentName: "current_name",
      previousNamesJson: "previous_names_json",
    },
    hqMemberLinkHelpRequests: { id: "id" },
  },
}));

const rosterResolve = await import("@/lib/member-link/roster-link-resolve.server");

const openHelpRow = {
  id: "req-1",
  allianceId: "a1",
  hqUserId: "u1",
  origin: "web",
  context: "onboarding_form",
  reportedName: "Alpha",
  gameUid: "1001369694001203",
  gameUserName: "Commander Alpha",
  requesterHandle: "alpha@example.com",
  status: "open",
  discordUsername: null,
  discordUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  resolutionNote: null,
  resolvedAt: null,
  resolvedByHqUserId: null,
  linkedAshedMemberId: null,
};

const nameReviewHelpRow = {
  ...openHelpRow,
  context: "claim_conflict",
  claimConflictReason: "target_mismatch",
  reportedName: "Roster Alpha",
  gameUserName: "Last War Bravo",
  linkedAshedMemberId: "m-1",
};

describe("resolveClaimNameReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpQueue.getMemberLinkHelpRequestById).mockResolvedValue(
      nameReviewHelpRow as never,
    );
    vi.mocked(helpQueue.resolveMemberLinkHelpRequest).mockResolvedValue({
      ok: true,
    });
    vi.mocked(repository.getHqMemberLinkByAllianceAndMember).mockResolvedValue({
      id: "link-1",
      hqUserId: "u1",
      gameUid: "1001369694001203",
    } as never);
    vi.mocked(repository.linkHqMember).mockResolvedValue({
      ok: true,
      link: {} as never,
      mode: "updated",
    });
  });

  it("rejects non-name-review help requests", async () => {
    vi.mocked(helpQueue.getMemberLinkHelpRequestById).mockResolvedValue(
      openHelpRow as never,
    );

    const result = await resolveClaimNameReview({
      requestId: "req-1",
      chosen: "lookup",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
    });

    expect(result).toEqual({ ok: false, reason: "not_name_review" });
  });

  it("syncs Last War name with optional Ashed connection when lookup is chosen", async () => {
    const ashedConnection = { appId: "app", token: "tok", originUrl: "https://x" };

    const result = await resolveClaimNameReview({
      requestId: "req-1",
      chosen: "lookup",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
      ashedConnection,
    });

    expect(result).toEqual({ ok: true, memberName: "Last War Bravo" });
    expect(rosterResolve.reconcileAllianceMemberForRosterLink).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        ashedMemberId: "m-1",
        gameUserName: "Last War Bravo",
        ashedConnection,
      }),
    );
    expect(repository.linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({
        memberDisplayName: "Last War Bravo",
        gameUid: "1001369694001203",
      }),
    );
    expect(helpQueue.resolveMemberLinkHelpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve",
        resolutionNote: "name:lookup",
      }),
    );
  });

  it("keeps roster name without reconcile when roster is chosen", async () => {
    const result = await resolveClaimNameReview({
      requestId: "req-1",
      chosen: "roster",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
    });

    expect(result).toEqual({ ok: true, memberName: "Roster Alpha" });
    expect(rosterResolve.reconcileAllianceMemberForRosterLink).not.toHaveBeenCalled();
    expect(repository.linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberDisplayName: "Roster Alpha" }),
    );
  });
});

describe("unlinkHqMemberLinkBreakGlass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpQueue.getMemberLinkHelpRequestById).mockResolvedValue(
      openHelpRow as never,
    );
    vi.mocked(repository.getHqMemberLinkByAllianceAndMember).mockResolvedValue({
      id: "link-1",
      hqUserId: "other-user",
    } as never);
    vi.mocked(unlinkServer.unlinkCommanderHqAccount).mockResolvedValue({
      ok: true,
      target: "hq",
      removed: 1,
    });
    vi.mocked(unlinkServer.unlinkCommanderDiscordLinks).mockResolvedValue({
      ok: true,
      target: "discord",
      removed: 1,
    });
    dbModule.chain.limit.mockResolvedValue([
      { ashedMemberId: "m-claimed", currentName: "Claimed Alpha" },
    ]);
  });

  it("unlinks HQ and Discord bindings and records help-context audit", async () => {
    const result = await unlinkHqMemberLinkBreakGlass({
      requestId: "req-1",
      targetAshedMemberId: "m-claimed",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
      notifiedClaimant: true,
    });

    expect(result).toEqual({
      ok: true,
      memberName: "Claimed Alpha",
      removedHq: true,
      removedDiscord: true,
    });
    expect(unlinkServer.unlinkCommanderHqAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        actorHqUserId: "officer-1",
        allianceId: "a1",
        ashedMemberId: "m-claimed",
      }),
    );
    expect(unlinkServer.unlinkCommanderDiscordLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "m-claimed",
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_link_help_break_glass_unlink",
        resourceId: "req-1",
      }),
    );
  });

  it("succeeds when only a Discord link remains", async () => {
    vi.mocked(unlinkServer.unlinkCommanderHqAccount).mockResolvedValue({
      ok: false,
      reason: "not_linked",
    });

    const result = await unlinkHqMemberLinkBreakGlass({
      requestId: "req-1",
      targetAshedMemberId: "m-claimed",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
      notifiedClaimant: true,
    });

    expect(result).toEqual({
      ok: true,
      memberName: "Claimed Alpha",
      removedHq: false,
      removedDiscord: true,
    });
  });

  it("rejects when the roster member has no HQ or Discord link", async () => {
    vi.mocked(unlinkServer.unlinkCommanderHqAccount).mockResolvedValue({
      ok: false,
      reason: "not_linked",
    });
    vi.mocked(unlinkServer.unlinkCommanderDiscordLinks).mockResolvedValue({
      ok: false,
      reason: "not_linked",
    });

    const result = await unlinkHqMemberLinkBreakGlass({
      requestId: "req-1",
      targetAshedMemberId: "m-claimed",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
      notifiedClaimant: true,
    });

    expect(result).toEqual({ ok: false, reason: "not_linked" });
  });
});

describe("linkMemberLinkHelpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpQueue.getMemberLinkHelpRequestById).mockResolvedValue(
      openHelpRow as never,
    );
    vi.mocked(repository.getHqMemberLinkByAllianceAndMember).mockResolvedValue(
      null as never,
    );
    vi.mocked(vrRepository.getLinkedMemberIds).mockResolvedValue(new Set());
    vi.mocked(repository.linkHqMember).mockResolvedValue({
      ok: true,
      link: {} as never,
      mode: "created",
    });
    dbModule.chain.limit
      .mockResolvedValueOnce([
        { ashedMemberId: "m1", currentName: "Commander Alpha" },
      ])
      .mockResolvedValueOnce([{ currentName: "Commander Alpha" }]);
  });

  it("rejects discord-only requests without hq user", async () => {
    vi.mocked(helpQueue.getMemberLinkHelpRequestById).mockResolvedValue({
      ...openHelpRow,
      hqUserId: null,
    } as never);

    const result = await linkMemberLinkHelpRequest({
      requestId: "req-1",
      targetAshedMemberId: "m1",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
    });

    expect(result).toEqual({ ok: false, reason: "hq_user_required" });
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("rejects when target member already has an HQ link", async () => {
    vi.mocked(repository.getHqMemberLinkByAllianceAndMember).mockResolvedValue({
      id: "link-1",
      hqUserId: "other-user",
    } as never);
    dbModule.chain.limit.mockReset();
    dbModule.chain.limit.mockResolvedValueOnce([
      { ashedMemberId: "m1", currentName: "Commander Alpha" },
    ]);

    const result = await linkMemberLinkHelpRequest({
      requestId: "req-1",
      targetAshedMemberId: "m1",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("member_already_claimed");
    }
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });

  it("links when the roster member only has a Discord binding", async () => {
    vi.mocked(vrRepository.getLinkedMemberIds).mockResolvedValue(
      new Set(["m1"]),
    );
    vi.mocked(repository.getHqMemberLinkByAllianceAndMember).mockResolvedValue(
      null as never,
    );

    const result = await linkMemberLinkHelpRequest({
      requestId: "req-1",
      targetAshedMemberId: "m1",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
    });

    expect(result).toEqual({ ok: true, memberName: "Commander Alpha" });
    expect(repository.linkHqMember).toHaveBeenCalled();
  });

  it("syncs owner external id and primary game uid after successful link", async () => {
    const result = await linkMemberLinkHelpRequest({
      requestId: "req-1",
      targetAshedMemberId: "m1",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      allianceId: "a1",
    });

    expect(result).toEqual({ ok: true, memberName: "Commander Alpha" });
    expect(repository.linkHqMember).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        hqUserId: "u1",
        ashedMemberId: "m1",
        gameUid: openHelpRow.gameUid,
      }),
    );
    expect(repository.maybeSetOwnerMemberExternalId).toHaveBeenCalledWith({
      allianceId: "a1",
      hqUserId: "u1",
      ashedMemberId: "m1",
    });
    expect(repository.syncPrimaryGameUidFromHqMemberLink).toHaveBeenCalledWith(
      "u1",
      openHelpRow.gameUid,
    );
    expect(repository.saveHqMemberLinkPending).toHaveBeenCalledWith(
      "a1",
      "u1",
      null,
    );
    expect(helpQueue.satisfyHelpInboxItem).toHaveBeenCalledWith("req-1");
  });
});
