import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb,
  };
});

import { isCommanderReservedByPendingClaim } from "./claim-seat-reservation.server";

describe("isCommanderReservedByPendingClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks other HQ users when an unlinked acceptor holds a pending claim", async () => {
    const inviteLimit = vi.fn().mockResolvedValue([{ hqUserId: "alice" }]);
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: inviteLimit,
          }),
          innerJoin: () => ({
            where: () => ({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })),
    });

    await expect(
      isCommanderReservedByPendingClaim({
        allianceId: "a1",
        ashedMemberId: "m-r5",
        allowedHqUserId: "bob",
      }),
    ).resolves.toBe(true);
  });

  it("allows the pending claim acceptor to link the reserved commander", async () => {
    const inviteLimit = vi.fn().mockResolvedValue([{ hqUserId: "alice" }]);
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: inviteLimit,
          }),
          innerJoin: () => ({
            where: () => ({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })),
    });

    await expect(
      isCommanderReservedByPendingClaim({
        allianceId: "a1",
        ashedMemberId: "m-r5",
        allowedHqUserId: "alice",
      }),
    ).resolves.toBe(false);
  });
});
