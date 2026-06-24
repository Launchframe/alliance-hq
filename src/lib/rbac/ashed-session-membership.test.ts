import { beforeEach, describe, expect, it, vi } from "vitest";

import * as sessionModule from "@/lib/session";

import {
  ashedSourcedMembershipIsActiveForSession,
  sessionHasConflictingAshedCredentialForHqUser,
} from "./ashed-session-membership";

const selectMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
  }),
  schema: {
    hqUsers: { id: "hqUsers.id", ashedUserId: "hqUsers.ashedUserId" },
  },
}));

function chainSelectWithLimit(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe("ashedSourcedMembershipIsActiveForSession", () => {
  it("always allows manual memberships", () => {
    expect(ashedSourcedMembershipIsActiveForSession("manual", false)).toBe(true);
  });

  it("requires an active Ashed credential for ashed-sourced memberships", () => {
    expect(ashedSourcedMembershipIsActiveForSession("ashed", false)).toBe(false);
    expect(ashedSourcedMembershipIsActiveForSession("ashed", true)).toBe(true);
  });
});

describe("sessionHasConflictingAshedCredentialForHqUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when the session has no Ashed credential", async () => {
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue(null);

    await expect(
      sessionHasConflictingAshedCredentialForHqUser("sess-1", "hq-1"),
    ).resolves.toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns false when the credential matches the HQ user's Ashed id", async () => {
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue({
      ashedUserId: "ashed-a",
    } as never);
    selectMock.mockReturnValueOnce(
      chainSelectWithLimit([{ ashedUserId: "ashed-a" }]),
    );

    await expect(
      sessionHasConflictingAshedCredentialForHqUser("sess-1", "hq-1"),
    ).resolves.toBe(false);
  });

  it("returns true when the credential belongs to a different Ashed user", async () => {
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue({
      ashedUserId: "ashed-other",
    } as never);
    selectMock.mockReturnValueOnce(
      chainSelectWithLimit([{ ashedUserId: "ashed-a" }]),
    );

    await expect(
      sessionHasConflictingAshedCredentialForHqUser("sess-1", "hq-1"),
    ).resolves.toBe(true);
  });

  it("returns true when the HQ user has no linked Ashed id but a credential is present", async () => {
    vi.spyOn(sessionModule, "getAshedCredentialRecord").mockResolvedValue({
      ashedUserId: "ashed-a",
    } as never);
    selectMock.mockReturnValueOnce(chainSelectWithLimit([{ ashedUserId: null }]));

    await expect(
      sessionHasConflictingAshedCredentialForHqUser("sess-1", "hq-1"),
    ).resolves.toBe(true);
  });
});
