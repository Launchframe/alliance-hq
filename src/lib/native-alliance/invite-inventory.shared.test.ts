import { describe, expect, it } from "vitest";

import {
  classifyInviteLinkStatus,
  classifyJoinCodeStatus,
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
});
