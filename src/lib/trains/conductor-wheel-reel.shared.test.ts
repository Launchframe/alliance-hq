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

  it("ensures all three resting slots are unique when ≥3 candidates exist", () => {
    const candidates = [
      { memberId: "1", memberName: "Freddy" },
      { memberId: "2", memberName: "PoDzilla" },
      { memberId: "3", memberName: "SheRa" },
    ];
    const winner = { memberId: "2", memberName: "PoDzilla" };

    for (let i = 0; i < 50; i += 1) {
      const session = buildConductorWheelReelSession(candidates, winner);
      const visible = restingViewportNames(session);
      expect(visible).toHaveLength(3);
      expect(visible[1]).toBe("PoDzilla");
      const unique = new Set(visible);
      expect(unique.size).toBe(3);
    }
  });

  it("allows repeated alternate when only 2 candidates exist", () => {
    const candidates = [
      { memberId: "1", memberName: "Freddy" },
      { memberId: "2", memberName: "PoDzilla" },
    ];
    const winner = { memberId: "2", memberName: "PoDzilla" };

    for (let i = 0; i < 20; i += 1) {
      const session = buildConductorWheelReelSession(candidates, winner);
      const visible = restingViewportNames(session);
      expect(visible).toHaveLength(3);
      expect(visible[1]).toBe("PoDzilla");
      expect(visible[0]).toBe("Freddy");
      expect(visible[2]).toBe("Freddy");
    }
  });

  it("ensures dedup with many candidates (10+)", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      memberId: String(i),
      memberName: `Member${i}`,
    }));
    const winner = candidates[5]!;

    for (let i = 0; i < 30; i += 1) {
      const session = buildConductorWheelReelSession(candidates, winner);
      const visible = restingViewportNames(session);
      expect(visible).toHaveLength(3);
      expect(visible[1]).toBe(winner.memberName);
      const unique = new Set(visible);
      expect(unique.size).toBe(3);
    }
  });
});
