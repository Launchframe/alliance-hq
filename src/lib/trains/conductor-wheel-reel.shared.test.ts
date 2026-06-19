import { describe, expect, it } from "vitest";

import {
  buildConductorWheelReelSession,
  restingViewportNames,
  uniqueWheelCandidateNames,
} from "@/lib/trains/conductor-wheel-reel.shared";

describe("uniqueWheelCandidateNames", () => {
  it("dedupes by member id", () => {
    expect(
      uniqueWheelCandidateNames([
        { memberId: "a", memberName: "Caipira" },
        { memberId: "a", memberName: "Caipira" },
        { memberId: "b", memberName: "SheRa" },
      ]),
    ).toEqual(["Caipira", "SheRa"]);
  });
});

describe("buildConductorWheelReelSession", () => {
  it("does not repeat the winner in all three resting slots when alternates exist", () => {
    const candidates = [
      { memberId: "1", memberName: "SheRa" },
      { memberId: "2", memberName: "Caipira" },
    ];
    const winner = { memberId: "2", memberName: "Caipira" };

    for (let i = 0; i < 20; i += 1) {
      const session = buildConductorWheelReelSession(candidates, winner);
      const visible = restingViewportNames(session);
      expect(visible).toHaveLength(3);
      expect(visible[1]).toBe("Caipira");
      expect(visible.filter((name) => name === "Caipira").length).toBeLessThan(3);
    }
  });
});
