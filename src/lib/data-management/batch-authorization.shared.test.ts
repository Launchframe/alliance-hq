import { describe, expect, it } from "vitest";

import {
  batchActionFlags,
  canManageAnyDataBatch,
  canManageDataBatch,
  canManageDataDate,
  canViewDataManagement,
  dateActionFlags,
} from "./batch-authorization.shared";

function ctx(input: {
  roleName?: string | null;
  hqUserId?: string;
  permissions?: string[];
}) {
  return {
    roleName: input.roleName ?? null,
    hqUserId: input.hqUserId ?? "user-1",
    permissions: new Set(input.permissions ?? []),
  };
}

describe("batch authorization", () => {
  it("gates page view on data:read", () => {
    expect(canViewDataManagement(new Set())).toBe(false);
    expect(canViewDataManagement(new Set(["data:read"]))).toBe(true);
  });

  it("treats owner and maintainer as alliance-wide batch admins", () => {
    expect(canManageAnyDataBatch(ctx({ roleName: "owner" }))).toBe(true);
    expect(canManageAnyDataBatch(ctx({ roleName: "maintainer" }))).toBe(true);
    expect(canManageAnyDataBatch(ctx({ roleName: "officer" }))).toBe(false);
    expect(
      canManageAnyDataBatch(
        ctx({ roleName: "officer", permissions: ["alliance:admin"] }),
      ),
    ).toBe(true);
  });

  it("lets officers manage only their own active batches", () => {
    const officer = ctx({ roleName: "officer", hqUserId: "officer-1" });
    const own = { createdByHqUserId: "officer-1", status: "active" };
    const other = { createdByHqUserId: "officer-2", status: "active" };

    expect(canManageDataBatch(officer, own)).toBe(true);
    expect(canManageDataBatch(officer, other)).toBe(false);
    expect(batchActionFlags(officer, own)).toEqual({
      canMove: true,
      canDelete: true,
    });
    expect(batchActionFlags(officer, other)).toEqual({
      canMove: false,
      canDelete: false,
    });
  });

  it("blocks destructive actions on non-active batches", () => {
    const owner = ctx({ roleName: "owner" });
    expect(
      batchActionFlags(owner, {
        createdByHqUserId: "anyone",
        status: "deleted",
      }),
    ).toEqual({ canMove: false, canDelete: false });
  });

  it("lets officers manage a date only when all ledger batches on that date are theirs", () => {
    const officer = ctx({ roleName: "officer", hqUserId: "officer-1" });
    const ownBatches = [
      { createdByHqUserId: "officer-1", status: "active" },
    ];
    const mixedBatches = [
      { createdByHqUserId: "officer-1", status: "active" },
      { createdByHqUserId: "officer-2", status: "active" },
    ];

    expect(canManageDataDate(officer, ownBatches, false)).toBe(true);
    expect(dateActionFlags(officer, ownBatches, false)).toEqual({
      canMove: true,
      canDelete: true,
    });
    expect(canManageDataDate(officer, mixedBatches, false)).toBe(false);
    expect(dateActionFlags(officer, mixedBatches, false)).toEqual({
      canMove: false,
      canDelete: false,
    });
  });

  it("blocks officers from deleting Ashed-only dates without ledger batches", () => {
    const officer = ctx({ roleName: "officer", hqUserId: "officer-1" });
    expect(canManageDataDate(officer, [], true)).toBe(false);
  });
});
