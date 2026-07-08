import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

vi.mock("@/lib/ashed/rebind-session", () => ({
  revokeAshedMembershipsForHqUser: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  inheritHqMemberLinksToDiscord: vi.fn().mockResolvedValue({
    inherited: 0,
    skipped: 0,
  }),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  assessMergeHqUsers,
} from "./merge-hq-users.server";

describe("assessMergeHqUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when canonical and source are the same account", async () => {
    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "user-1",
        sourceHqUserId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "same_account" });
  });

  it("rejects when source user row is missing", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValueOnce([
                {
                  id: "canonical",
                  email: "a@example.com",
                  ashedUserId: null,
                  isPlatformMaintainer: 0,
                },
              ])
              .mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never);

    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "canonical",
        sourceHqUserId: "source",
      }),
    ).rejects.toMatchObject({ code: "source_not_found" });
  });
});
