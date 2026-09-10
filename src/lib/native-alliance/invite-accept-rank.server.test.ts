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

import { ROLE_IDS } from "@/lib/rbac/constants";

import {
  HYBRID_OFFICER_RANK_STALE_MESSAGE,
  HYBRID_OWNER_RANK_STALE_MESSAGE,
  assertHybridClaimInviteRankAtAccept,
} from "./invite-accept-rank.server";

function mockSelectResult(result: unknown) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => result),
        })),
      })),
    })),
  };
}

describe("assertHybridClaimInviteRankAtAccept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BUG REPRO: refuses owner+claim accept when commander was demoted from R5", async () => {
    // Create-time gate allowed R5; accept must re-check. Rank 4 must fail closed.
    getDb.mockReturnValue(
      mockSelectResult([{ allianceRank: 4, status: "active" }]) as never,
    );

    await expect(
      assertHybridClaimInviteRankAtAccept({
        allianceId: "alliance-1",
        roleId: ROLE_IDS.owner,
        targetAshedMemberId: "commander-was-r5",
      }),
    ).rejects.toThrow(HYBRID_OWNER_RANK_STALE_MESSAGE);
  });

  it("allows owner+claim accept when commander is still R5", async () => {
    getDb.mockReturnValue(
      mockSelectResult([{ allianceRank: 5, status: "active" }]) as never,
    );

    await expect(
      assertHybridClaimInviteRankAtAccept({
        allianceId: "alliance-1",
        roleId: ROLE_IDS.owner,
        targetAshedMemberId: "commander-r5",
      }),
    ).resolves.toBeUndefined();
  });

  it("skips rank checks for member invites with a claim target", async () => {
    getDb.mockReturnValue(mockSelectResult([]) as never);

    await expect(
      assertHybridClaimInviteRankAtAccept({
        allianceId: "alliance-1",
        roleId: ROLE_IDS.member,
        targetAshedMemberId: "commander-any",
      }),
    ).resolves.toBeUndefined();

    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses hybrid officer+claim accept when issuer is officer and rank dropped", async () => {
    let selectCalls = 0;
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              selectCalls += 1;
              if (selectCalls === 1) {
                // commander rank
                return [{ allianceRank: 3, status: "active" }];
              }
              // issuer membership — HQ officer (hybrid path)
              return [{ roleId: ROLE_IDS.officer }];
            }),
          })),
        })),
      })),
    } as never);

    await expect(
      assertHybridClaimInviteRankAtAccept({
        allianceId: "alliance-1",
        roleId: ROLE_IDS.officer,
        targetAshedMemberId: "commander-was-r4",
        invitedByHqUserId: "officer-issuer",
      }),
    ).rejects.toThrow(HYBRID_OFFICER_RANK_STALE_MESSAGE);
  });

  it("allows owner-issued officer+claim accept without requiring R4", async () => {
    let selectCalls = 0;
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              selectCalls += 1;
              if (selectCalls === 1) {
                return [{ allianceRank: 2, status: "active" }];
              }
              // issuer is alliance owner — base assignable officer invite
              return [{ roleId: ROLE_IDS.owner }];
            }),
          })),
        })),
      })),
    } as never);

    await expect(
      assertHybridClaimInviteRankAtAccept({
        allianceId: "alliance-1",
        roleId: ROLE_IDS.officer,
        targetAshedMemberId: "commander-r2",
        invitedByHqUserId: "owner-issuer",
      }),
    ).resolves.toBeUndefined();
  });
});
