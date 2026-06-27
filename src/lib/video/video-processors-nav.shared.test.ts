import { describe, expect, it } from "vitest";

import { shouldShowVideoProcessorsNav } from "@/lib/video/video-processors-nav.shared";

describe("shouldShowVideoProcessorsNav", () => {
  it("is hidden without alliance context", () => {
    expect(
      shouldShowVideoProcessorsNav({
        allianceId: null,
        hasActiveMembership: true,
        isPlatformMaintainer: false,
      }),
    ).toBe(false);
  });

  it("is visible for active members and platform maintainers", () => {
    expect(
      shouldShowVideoProcessorsNav({
        allianceId: "a1",
        hasActiveMembership: true,
        isPlatformMaintainer: false,
      }),
    ).toBe(true);
    expect(
      shouldShowVideoProcessorsNav({
        allianceId: "a1",
        hasActiveMembership: false,
        isPlatformMaintainer: true,
      }),
    ).toBe(true);
  });
});
