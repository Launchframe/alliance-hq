import { describe, expect, it } from "vitest";

import { reviewRosterGapCode } from "./review-roster-gap.shared";

describe("reviewRosterGapCode", () => {
  it("continues when every member is already on the roster", () => {
    expect(
      reviewRosterGapCode({
        missingCount: 0,
        operatingMode: "ashed",
        hasAshedSeat: true,
      }),
    ).toBeNull();
  });

  it("asks a native alliance to save the new members", () => {
    expect(
      reviewRosterGapCode({
        missingCount: 1,
        operatingMode: "native",
        hasAshedSeat: false,
      }),
    ).toBe("roster_save_members");
  });

  it("asks an officer without an Ashed seat to get a refresh", () => {
    expect(
      reviewRosterGapCode({
        missingCount: 2,
        operatingMode: "ashed",
        hasAshedSeat: false,
      }),
    ).toBe("roster_ask_ashed_officer");
  });

  it("tells an officer with an Ashed seat that a refresh might fix the save", () => {
    expect(
      reviewRosterGapCode({
        missingCount: 1,
        operatingMode: "ashed",
        hasAshedSeat: true,
      }),
    ).toBe("roster_refresh_ashed");
  });
});
