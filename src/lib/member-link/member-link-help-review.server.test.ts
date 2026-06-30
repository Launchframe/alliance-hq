import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  linkMemberLinkHelpRequest,
  unlinkHqMemberLinkBreakGlass,
} from "./member-link-help-review.server";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/member-link-help-queue.server", () => ({
  getMemberLinkHelpRequestById: vi.fn(),
  satisfyHelpInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/roster-link-resolve.server", () => ({
  reconcileAllianceMemberForRosterLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  linkHqMember: vi.fn(),
  maybeSetOwnerMemberExternalId: vi.fn().mockResolvedValue(undefined),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  syncPrimaryGameUidFromHqMemberLink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds: vi.fn(),
}));

const helpQueue = await import("@/lib/member-link/member-link-help-queue.server");
const repository = await import("@/lib/member-link/repository.server");
const vrRepository = await import("@/lib/vr/repository");

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

describe("member-link-help-review break-glass stub", () => {
  it("unlinkHqMemberLinkBreakGlass is not implemented yet", async () => {
    const result = await unlinkHqMemberLinkBreakGlass({
      allianceId: "a1",
      ashedMemberId: "m1",
      sessionId: "s1",
      resolvedByHqUserId: "u1",
    });
    expect(result).toEqual({ ok: false, reason: "not_implemented" });
  });
});

describe("linkMemberLinkHelpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpQueue.getMemberLinkHelpRequestById).mockResolvedValue(
      openHelpRow as never,
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

  it("rejects when target member is already claimed", async () => {
    vi.mocked(vrRepository.getLinkedMemberIds).mockResolvedValue(
      new Set(["m1"]),
    );
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
