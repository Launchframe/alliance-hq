import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityIdentityChangedError } from "@/lib/activity/ownership.server";

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  deleteCalls: 0,
  updateSets: [] as unknown[],
  assessMergeHqUsers: vi.fn(),
  loadHqUserIdByEmail: vi.fn(),
  mergeHqUsersIntoCanonical: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => {
        const rows = state.selectRows.shift() ?? [];
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({ limit: async () => rows }),
              limit: async () => rows,
            }),
          }),
        };
      },
      delete: () => ({
        where: async () => {
          state.deleteCalls += 1;
        },
      }),
      update: () => ({
        set: (value: unknown) => {
          state.updateSets.push(value);
          return { where: async () => undefined };
        },
      }),
    }),
  };
});

vi.mock("@/lib/auth/merge-hq-users.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/merge-hq-users.server")>();
  return {
    ...actual,
    assessMergeHqUsers: (...args: unknown[]) => state.assessMergeHqUsers(...args),
    loadHqUserIdByEmail: (...args: unknown[]) =>
      state.loadHqUserIdByEmail(...args),
    mergeHqUsersIntoCanonical: (...args: unknown[]) =>
      state.mergeHqUsersIntoCanonical(...args),
  };
});

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

import { MergeHqUsersError } from "@/lib/auth/merge-hq-users.server";

import { confirmAccountMerge } from "./account-merge-proof.server";

const VERIFIED_RECORD = {
  id: "merge-pending-1",
  canonicalHqUserId: "canonical",
  sourceHqUserId: "source",
  codeHash: createHash("sha256")
    .update("canonical:source:424242")
    .digest("hex"),
  failedAttempts: 0,
  verifiedAt: new Date("2026-09-29T12:00:00.000Z"),
  expiresAt: new Date(Date.now() + 600_000),
  createdAt: new Date("2026-09-29T11:55:00.000Z"),
};

function queueConfirmSelects(record: unknown = VERIFIED_RECORD) {
  state.selectRows.push(
    [{ id: "source", email: "source@alliance-hq.test" }],
    [record],
    [{ id: "source", email: "source@alliance-hq.test" }],
    [record],
  );
}

describe("confirmAccountMerge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectRows = [];
    state.deleteCalls = 0;
    state.updateSets = [];
    state.loadHqUserIdByEmail.mockResolvedValue("source");
  });

  it("maps an exhausted ActivityIdentityChangedError to a retryable proof error and keeps the proof", async () => {
    queueConfirmSelects();
    state.mergeHqUsersIntoCanonical.mockRejectedValue(
      new ActivityIdentityChangedError(),
    );

    await expect(
      confirmAccountMerge({
        canonicalHqUserId: "canonical",
        sourceEmailRaw: "source@alliance-hq.test",
        codeRaw: "424242",
      }),
    ).rejects.toMatchObject({
      name: "AccountMergeProofError",
      code: "identity_changed",
      message: "activity_identity_changed",
    });
    expect(state.deleteCalls).toBe(0);

    queueConfirmSelects();
    state.mergeHqUsersIntoCanonical.mockResolvedValue({ merged: true });

    const result = await confirmAccountMerge({
      canonicalHqUserId: "canonical",
      sourceEmailRaw: "source@alliance-hq.test",
      codeRaw: "424242",
    });
    expect(result).toEqual({ merged: true });
    expect(state.deleteCalls).toBe(1);
  });

  it("still maps MergeHqUsersError codes onto proof errors", async () => {
    queueConfirmSelects();
    state.mergeHqUsersIntoCanonical.mockRejectedValue(
      new MergeHqUsersError("conflict", "commander_conflict"),
    );

    await expect(
      confirmAccountMerge({
        canonicalHqUserId: "canonical",
        sourceEmailRaw: "source@alliance-hq.test",
        codeRaw: "424242",
      }),
    ).rejects.toMatchObject({
      name: "AccountMergeProofError",
      code: "commander_conflict",
    });
    expect(state.deleteCalls).toBe(0);
  });

  it("rethrows unrelated merge failures unchanged", async () => {
    queueConfirmSelects();
    const failure = new Error("db blew up");
    state.mergeHqUsersIntoCanonical.mockRejectedValue(failure);

    await expect(
      confirmAccountMerge({
        canonicalHqUserId: "canonical",
        sourceEmailRaw: "source@alliance-hq.test",
        codeRaw: "424242",
      }),
    ).rejects.toBe(failure);
    expect(state.deleteCalls).toBe(0);
  });
});
