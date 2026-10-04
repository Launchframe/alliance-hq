import { describe, expect, it } from "vitest";

import { shouldRejectCancelOfNonScheduled } from "@/lib/battle-plan/cancel-after-confirm.shared";

describe("shouldRejectCancelOfNonScheduled", () => {
  it("allows cancel while the event is still scheduled", () => {
    expect(shouldRejectCancelOfNonScheduled("cancelled", "scheduled")).toBe(
      false,
    );
  });

  it("rejects cancel after confirm-capture completed (concurrent overwrite)", () => {
    expect(shouldRejectCancelOfNonScheduled("cancelled", "completed")).toBe(
      true,
    );
  });

  it("rejects cancel when already cancelled", () => {
    expect(shouldRejectCancelOfNonScheduled("cancelled", "cancelled")).toBe(
      true,
    );
  });

  it("does not reject non-cancel status writes on completed events", () => {
    expect(shouldRejectCancelOfNonScheduled("completed", "completed")).toBe(
      false,
    );
    expect(shouldRejectCancelOfNonScheduled("scheduled", "completed")).toBe(
      false,
    );
    expect(shouldRejectCancelOfNonScheduled(undefined, "completed")).toBe(
      false,
    );
  });
});
