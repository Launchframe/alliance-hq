import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const updateMock = vi.fn(() => ({ set: updateSet }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
    update: updateMock,
  }),
  schema: {
    hqMemberLinkHelpRequests: {
      id: "hqMemberLinkHelpRequests.id",
      status: "hqMemberLinkHelpRequests.status",
      resolvedByHqUserId: "hqMemberLinkHelpRequests.resolvedByHqUserId",
      linkedAshedMemberId: "hqMemberLinkHelpRequests.linkedAshedMemberId",
    },
    inboxReminderItems: {
      kind: "inboxReminderItems.kind",
      resourceId: "inboxReminderItems.resourceId",
      active: "inboxReminderItems.active",
    },
  },
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/member-link-help-inbox.shared", () => ({
  MEMBER_LINK_HELP_INBOX_KIND: "member_link_help",
}));

import { writeAuditLog } from "@/lib/bff/audit";
import {
  claimOpenMemberLinkHelpRequest,
  resolveMemberLinkHelpRequest,
  revertResolvedMemberLinkHelpClaim,
} from "./member-link-help-queue.server";

const openRow = {
  id: "help-1",
  allianceId: "ally-1",
  hqUserId: "user-1",
  origin: "web",
  context: "onboarding_form",
  status: "open",
  linkedAshedMemberId: null,
  resolutionNote: null,
  resolvedAt: null,
  resolvedByHqUserId: null,
};

describe("claimOpenMemberLinkHelpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the claimed row when status is still open", async () => {
    const claimed = { ...openRow, status: "resolved", linkedAshedMemberId: "m-1" };
    updateReturning.mockResolvedValueOnce([claimed]);

    const result = await claimOpenMemberLinkHelpRequest({
      requestId: "help-1",
      status: "resolved",
      resolvedByHqUserId: "officer-1",
      linkedAshedMemberId: "m-1",
    });

    expect(result).toEqual({ ok: true, request: claimed });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "resolved",
        linkedAshedMemberId: "m-1",
        resolvedByHqUserId: "officer-1",
      }),
    );
  });

  it("fails closed when a concurrent dismiss already closed the row", async () => {
    updateReturning.mockResolvedValueOnce([]);
    selectLimit.mockResolvedValueOnce([{ ...openRow, status: "dismissed" }]);

    const result = await claimOpenMemberLinkHelpRequest({
      requestId: "help-1",
      status: "resolved",
      resolvedByHqUserId: "officer-2",
      linkedAshedMemberId: "m-2",
    });

    expect(result).toEqual({
      ok: false,
      reason: "already_closed",
      request: expect.objectContaining({ status: "dismissed" }),
    });
  });
});

describe("resolveMemberLinkHelpRequest CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not audit or satisfy inbox when dismiss loses the open CAS", async () => {
    // getMemberLinkHelpRequestById — still open at read time
    selectLimit.mockResolvedValueOnce([openRow]);
    // claim UPDATE … RETURNING — empty (link won)
    updateReturning.mockResolvedValueOnce([]);
    // re-read after lost claim
    selectLimit.mockResolvedValueOnce([
      { ...openRow, status: "resolved", linkedAshedMemberId: "m-1" },
    ]);

    const result = await resolveMemberLinkHelpRequest({
      requestId: "help-1",
      resolvedByHqUserId: "officer-dismiss",
      sessionId: "sess-1",
      action: "dismiss",
    });

    expect(result).toEqual({ ok: false, reason: "already_closed" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("claims dismiss before side effects when still open", async () => {
    selectLimit.mockResolvedValueOnce([openRow]);
    updateReturning.mockResolvedValueOnce([
      { ...openRow, status: "dismissed" },
    ]);
    // First where() is claim (.returning()); second is inbox satisfy (await where).
    updateWhere
      .mockImplementationOnce(() => ({ returning: updateReturning }))
      .mockImplementationOnce(() => Promise.resolve(undefined) as never);

    const result = await resolveMemberLinkHelpRequest({
      requestId: "help-1",
      resolvedByHqUserId: "officer-1",
      sessionId: "sess-1",
      action: "dismiss",
    });

    expect(result).toEqual({ ok: true });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dismissed" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_link_help_resolved",
        resourceId: "help-1",
      }),
    );
  });
});

describe("revertResolvedMemberLinkHelpClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhere.mockImplementation(() => Promise.resolve(undefined) as never);
  });

  it("restores open only for the claiming officer's resolved row", async () => {
    await revertResolvedMemberLinkHelpClaim({
      requestId: "help-1",
      resolvedByHqUserId: "officer-1",
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "open",
        linkedAshedMemberId: null,
        resolvedByHqUserId: null,
      }),
    );
  });
});
