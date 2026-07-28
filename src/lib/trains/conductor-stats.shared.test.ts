import { describe, expect, it } from "vitest";

import { resolveConductorLastConductedDate } from "@/lib/trains/conductor-stats.shared";

describe("resolveConductorLastConductedDate", () => {
  it("returns the newest locked date when no beforeDate is set", () => {
    expect(
      resolveConductorLastConductedDate([
        "2026-07-28",
        "2026-07-10",
        "2026-06-01",
      ]),
    ).toBe("2026-07-28");
  });

  it("excludes the current assignment day so Last is not self-referential", () => {
    expect(
      resolveConductorLastConductedDate(
        ["2026-07-28", "2026-07-10", "2026-06-01"],
        "2026-07-28",
      ),
    ).toBe("2026-07-10");
  });

  it("returns null when the only locked day is the excluded current day", () => {
    expect(
      resolveConductorLastConductedDate(["2026-07-28"], "2026-07-28"),
    ).toBeNull();
  });

  it("returns null for an empty history", () => {
    expect(resolveConductorLastConductedDate([])).toBeNull();
  });
});
