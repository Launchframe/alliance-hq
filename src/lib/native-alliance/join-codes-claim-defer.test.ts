import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, provisionAllianceMembership } = vi.hoisted(() => ({
  getDb: vi.fn(),
  provisionAllianceMembership: vi.fn(),
}));

vi.mock("./provision-membership", () => ({
  provisionAllianceMembership,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb,
  };
});

import { ROLE_IDS } from "@/lib/rbac/constants";

import { redeemAllianceJoinCode } from "./join-codes";

function joinCodeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "jc-1",
    allianceId: "a1",
    roleId: ROLE_IDS.owner,
    targetAshedMemberId: "m-r5",
    codeHash: "hash",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    redemptionCount: 0,
    maxRedemptions: 1,
    ...overrides,
  };
}

describe("redeemAllianceJoinCode claim-bound RBAC defer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provisionAllianceMembership.mockResolvedValue({
      allianceId: "a1",
      allianceTag: "LFgo",
      allianceName: "Test",
      hqUserId: "u1",
      roleName: "member",
    });
  });

  it("provisions member (not invite role) when a claim target is pending", async () => {
    const joinCode = joinCodeRow();
    const txInsert = vi.fn().mockResolvedValue(undefined);
    const selectResults = [
      [joinCode],
      [] as unknown[],
      [{ email: "u1@example.com" }],
    ];
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectResults.shift() ?? []),
          }),
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          update: vi.fn(() => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve([{ id: joinCode.id }]),
              }),
            }),
          })),
          insert: () => ({ values: txInsert }),
        };
        await fn(tx);
      }),
    });

    await redeemAllianceJoinCode({
      code: "LFGO-TESTCODE",
      hqUserId: "u1",
      sessionId: "sess-1",
    });

    expect(provisionAllianceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: ROLE_IDS.member,
        ownerEmail: null,
      }),
    );
  });
});
