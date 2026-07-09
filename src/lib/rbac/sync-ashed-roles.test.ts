import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveRosterHqUserId } from "@/lib/rbac/sync-ashed-roles-roster.server";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    hqUsers: { id: "id", email: "email" },
  },
}));

vi.mock("@/lib/access/invite-gate", () => ({
  isAshedInviteRequired: vi.fn(() => false),
  hqUserHasAccessGrant: vi.fn(),
}));

describe("resolveRosterHqUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for unknown roster emails without inserting hq_users", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const insert = vi.fn();

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select, insert } as never);

    await expect(
      resolveRosterHqUserId("officer@example.com"),
    ).resolves.toBeNull();

    expect(insert).not.toHaveBeenCalled();
  });

  it("returns the existing hq user id when the roster email is already registered", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "existing-user" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      resolveRosterHqUserId(" Owner@Example.com "),
    ).resolves.toBe("existing-user");
  });

  it("returns null when invite gate is on and the hq user has no access grant", async () => {
    const { isAshedInviteRequired, hqUserHasAccessGrant } = await import(
      "@/lib/access/invite-gate"
    );
    vi.mocked(isAshedInviteRequired).mockReturnValue(true);
    vi.mocked(hqUserHasAccessGrant).mockResolvedValue(false);

    const limit = vi.fn().mockResolvedValue([{ id: "invite-gated-user" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const insert = vi.fn();

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select, insert } as never);

    await expect(
      resolveRosterHqUserId("officer@example.com"),
    ).resolves.toBeNull();

    expect(insert).not.toHaveBeenCalled();
    expect(hqUserHasAccessGrant).toHaveBeenCalledWith("invite-gated-user");
  });
});
