import { describe, expect, it } from "vitest";

import {
  conductorLockBlockedByPendingConfirmation,
  isConductorConfirmationSatisfied,
} from "@/lib/trains/conductor-record.shared";

describe("isConductorConfirmationSatisfied", () => {
  it("allows lock when confirmation is disabled", () => {
    expect(isConductorConfirmationSatisfied(false, "pending_confirmation")).toBe(
      true,
    );
  });

  it("allows lock for confirmed, fallback, or unset status when enabled", () => {
    expect(isConductorConfirmationSatisfied(true, "confirmed")).toBe(true);
    expect(isConductorConfirmationSatisfied(true, "fallback_r4")).toBe(true);
    expect(isConductorConfirmationSatisfied(true, null)).toBe(true);
    expect(isConductorConfirmationSatisfied(true, undefined)).toBe(true);
  });

  it("blocks lock while pending confirmation when enabled", () => {
    expect(isConductorConfirmationSatisfied(true, "pending_confirmation")).toBe(
      false,
    );
  });
});

describe("conductorLockBlockedByPendingConfirmation", () => {
  it("is true only for pending_confirmation with confirmation enabled", () => {
    expect(
      conductorLockBlockedByPendingConfirmation(true, "pending_confirmation"),
    ).toBe(true);
    expect(
      conductorLockBlockedByPendingConfirmation(false, "pending_confirmation"),
    ).toBe(false);
    expect(conductorLockBlockedByPendingConfirmation(true, "confirmed")).toBe(
      false,
    );
  });
});
