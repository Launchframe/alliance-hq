import { describe, expect, it } from "vitest";

import {
  shouldShowVideoProcessorRoleHint,
  videoProcessorEligibilityModeForOperatingMode,
} from "@/lib/video/processor-slots.shared";

describe("videoProcessorEligibilityModeForOperatingMode", () => {
  it("uses native R4/R5 candidates in native mode", () => {
    expect(videoProcessorEligibilityModeForOperatingMode("native")).toBe(
      "native_r4_r5",
    );
  });

  it("defaults to Ashed-connected officers otherwise", () => {
    expect(videoProcessorEligibilityModeForOperatingMode("ashed")).toBe(
      "ashed_connected_officers",
    );
    expect(videoProcessorEligibilityModeForOperatingMode(null)).toBe(
      "ashed_connected_officers",
    );
  });
});

describe("shouldShowVideoProcessorRoleHint", () => {
  it("shows for Ashed-connected officers without a processor slot", () => {
    expect(
      shouldShowVideoProcessorRoleHint({
        ashedConnected: true,
        canProcess: false,
        roleName: "officer",
      }),
    ).toBe(true);
  });

  it("hides when the officer can already process", () => {
    expect(
      shouldShowVideoProcessorRoleHint({
        ashedConnected: true,
        canProcess: true,
        roleName: "officer",
      }),
    ).toBe(false);
  });

  it("hides when Ashed is not connected", () => {
    expect(
      shouldShowVideoProcessorRoleHint({
        ashedConnected: false,
        canProcess: false,
        roleName: "officer",
      }),
    ).toBe(false);
  });

  it("hides for owners, maintainers, and non-officer roles", () => {
    for (const roleName of ["owner", "maintainer", "data_entry", "viewer", null]) {
      expect(
        shouldShowVideoProcessorRoleHint({
          ashedConnected: true,
          canProcess: false,
          roleName,
        }),
      ).toBe(false);
    }
  });
});
