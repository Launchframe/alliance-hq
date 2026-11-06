import { describe, expect, it } from "vitest";

import {
  massFormerNeedsConfirm,
  normalizeAllianceNameInput,
  normalizeAllianceTagInput,
} from "@/lib/alliance/rename-in-place.shared";

describe("massFormerNeedsConfirm", () => {
  it("requires confirm at or above the default 30% threshold", () => {
    expect(
      massFormerNeedsConfirm({
        wouldFormerCount: 3,
        confirmedActiveCount: 10,
      }),
    ).toBe(true);
    expect(
      massFormerNeedsConfirm({
        wouldFormerCount: 2,
        confirmedActiveCount: 10,
      }),
    ).toBe(false);
  });

  it("never confirms an empty absence pass", () => {
    expect(
      massFormerNeedsConfirm({
        wouldFormerCount: 0,
        confirmedActiveCount: 100,
      }),
    ).toBe(false);
  });
});

describe("normalizeAlliance*Input", () => {
  it("trims tag and name", () => {
    expect(normalizeAllianceTagInput("  FUze ")).toBe("FUze");
    expect(normalizeAllianceNameInput("  Short Fuse ")).toBe("Short Fuse");
  });
});
