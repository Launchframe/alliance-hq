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

type Row = { hqUserId: string; at: Date };

function mockReservations(input: { invite: Row[]; join: Row[] }) {
  getDb.mockReturnValue({
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: vi.fn().mockResolvedValue(input.invite),
          }),
        }),
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: vi.fn().mockResolvedValue(input.join),
            }),
          }),
        }),
      }),
    })),
  });
}

describe("isCommanderReservedByPendingClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks other HQ users when an unlinked acceptor holds a pending claim", async () => {
    mockReservations({
      invite: [{ hqUserId: "alice", at: new Date("2026-01-01") }],
      join: [],
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
    mockReservations({
      invite: [{ hqUserId: "alice", at: new Date("2026-01-01") }],
      join: [],
    });

    await expect(
      isCommanderReservedByPendingClaim({
        allianceId: "a1",
        ashedMemberId: "m-r5",
        allowedHqUserId: "alice",
      }),
    ).resolves.toBe(false);
  });

  it("gives the seat to the earliest acceptor across invites and join codes", async () => {
    mockReservations({
      invite: [{ hqUserId: "bob", at: new Date("2026-02-01") }],
      join: [{ hqUserId: "alice", at: new Date("2026-01-01") }],
    });

    await expect(
      isCommanderReservedByPendingClaim({
        allianceId: "a1",
        ashedMemberId: "m-r5",
        allowedHqUserId: "alice",
      }),
    ).resolves.toBe(false);
    await expect(
      isCommanderReservedByPendingClaim({
        allianceId: "a1",
        ashedMemberId: "m-r5",
        allowedHqUserId: "bob",
      }),
    ).resolves.toBe(true);
  });

  it("is free when no pending claim exists", async () => {
    mockReservations({ invite: [], join: [] });

    await expect(
      isCommanderReservedByPendingClaim({
        allianceId: "a1",
        ashedMemberId: "m-r5",
        allowedHqUserId: null,
      }),
    ).resolves.toBe(false);
  });
});
