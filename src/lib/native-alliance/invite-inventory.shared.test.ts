import { describe, expect, it } from "vitest";

import {
  classifyInviteLinkStatus,
  classifyJoinCodeStatus,
  matchesInventoryDateRange,
} from "@/lib/native-alliance/invite-inventory.shared";

describe("invite inventory classification", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");
  const future = new Date("2026-08-01T12:00:00.000Z");
  const past = new Date("2026-06-01T12:00:00.000Z");

  it("marks join codes with remaining uses as valid", () => {
    expect(
      classifyJoinCodeStatus({
        revokedAt: null,
        expiresAt: future,
        redemptionCount: 2,
        maxRedemptions: 10,
        now,
      }),
    ).toEqual({ status: "valid", depletedReason: null });
  });

  it("marks exhausted join codes as depleted", () => {
    expect(
      classifyJoinCodeStatus({
        revokedAt: null,
        expiresAt: future,
        redemptionCount: 1,
        maxRedemptions: 1,
        now,
      }),
    ).toEqual({ status: "depleted", depletedReason: "uses_exhausted" });
  });

  it("marks pending invite links as valid", () => {
    expect(
      classifyInviteLinkStatus({
        acceptedAt: null,
        expiresAt: future,
        now,
      }),
    ).toEqual({ status: "valid", depletedReason: null });
  });

  it("marks accepted invite links as depleted", () => {
    expect(
      classifyInviteLinkStatus({
        acceptedAt: past,
        expiresAt: future,
        now,
      }),
    ).toEqual({ status: "depleted", depletedReason: "accepted" });
  });

  it("marks revoked invite links as depleted", () => {
    expect(
      classifyInviteLinkStatus({
        acceptedAt: null,
        expiresAt: future,
        revokedAt: past,
        now,
      }),
    ).toEqual({ status: "depleted", depletedReason: "revoked" });
  });
});

describe("matchesInventoryDateRange", () => {
  it("passes when no bounds are set", () => {
    expect(matchesInventoryDateRange("2026-07-15T10:00:00.000Z", null, null)).toBe(
      true,
    );
  });

  it("filters by inclusive from/to date strings", () => {
    expect(
      matchesInventoryDateRange("2026-07-15T10:00:00.000Z", "2026-07-15", "2026-07-15"),
    ).toBe(true);
    expect(
      matchesInventoryDateRange("2026-07-14T10:00:00.000Z", "2026-07-15", null),
    ).toBe(false);
    expect(
      matchesInventoryDateRange("2026-07-16T10:00:00.000Z", null, "2026-07-15"),
    ).toBe(false);
  });
});
