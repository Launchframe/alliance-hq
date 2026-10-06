import { describe, expect, it } from "vitest";

import {
  buildConductorWheelReelSession,
  buildShareViewportForWinner,
  restingShareViewport,
  restingViewportNames,
  seededShuffle,
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

describe("restingShareViewport", () => {
  it("returns five unique names with the winner centered when enough pool members exist", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      memberId: String(i),
      memberName: `Member${i}`,
    }));
    const winner = candidates[4]!;
    const session = buildConductorWheelReelSession(candidates, winner);
    const viewport = restingShareViewport(session);
    expect(viewport.names).toHaveLength(5);
    expect(viewport.names[viewport.winnerIndex]).toBe(winner.memberName);
    expect(new Set(viewport.names).size).toBe(5);
  });

  it("does not clone a leftover name when the reel pad repeats it", () => {
    const session = {
      items: ["Milly", "Lovinlife", "Deanlinquent", "BOGGLE", "BOGGLE"],
      winnerIdx: 2,
      fastEndY: 0,
      targetY: 0,
      key: "dup-pad",
    };
    const viewport = restingShareViewport(session);
    expect(viewport.names[viewport.winnerIndex]).toBe("Deanlinquent");
    expect(viewport.names.filter((name) => name === "BOGGLE")).toHaveLength(1);
    expect(new Set(viewport.names).size).toBe(viewport.names.length);
  });

  it("keeps unique neighbors on a short reel instead of padding duplicates", () => {
    const session = {
      items: ["Alpha", "Winner", "Bravo"],
      winnerIdx: 1,
      fastEndY: 0,
      targetY: 0,
      key: "early",
    };
    const viewport = restingShareViewport(session);
    expect(viewport.names).toEqual(["Alpha", "Winner", "Bravo"]);
    expect(viewport.winnerIndex).toBe(1);
  });
});

describe("buildShareViewportForWinner", () => {
  it("centers the winner and fills surrounding slots from candidates", () => {
    const winner = { memberId: "w", memberName: "Winner" };
    const candidates = [
      { memberId: "a", memberName: "Alpha" },
      { memberId: "b", memberName: "Bravo" },
      winner,
      { memberId: "c", memberName: "Charlie" },
      { memberId: "d", memberName: "Delta" },
    ];
    const viewport = buildShareViewportForWinner(winner, candidates);
    expect(viewport.names).toHaveLength(5);
    expect(viewport.names[viewport.winnerIndex]).toBe("Winner");
    expect(viewport.names.filter((name) => name === "Winner")).toHaveLength(1);
    expect(new Set(viewport.names).size).toBe(viewport.names.length);
  });

  it("varies surrounding names by seed so different draws do not share one layout", () => {
    const winner = { memberId: "w", memberName: "Winner" };
    const candidates = [
      winner,
      ...Array.from({ length: 8 }, (_, i) => ({
        memberId: `m${i}`,
        memberName: `Member${i}`,
      })),
    ];
    const a = buildShareViewportForWinner(winner, candidates, {
      seed: "2026-07-29:w",
    });
    const b = buildShareViewportForWinner(winner, candidates, {
      seed: "2026-07-30:w",
    });
    expect(a.names[a.winnerIndex]).toBe("Winner");
    expect(b.names[b.winnerIndex]).toBe("Winner");
    expect(a.names).not.toEqual(b.names);
  });

  it("is stable for the same seed", () => {
    const winner = { memberId: "w", memberName: "Winner" };
    const candidates = [
      winner,
      { memberId: "a", memberName: "Alpha" },
      { memberId: "b", memberName: "Bravo" },
      { memberId: "c", memberName: "Charlie" },
      { memberId: "d", memberName: "Delta" },
    ];
    const first = buildShareViewportForWinner(winner, candidates, {
      seed: "2026-07-29:w",
    });
    const second = buildShareViewportForWinner(winner, candidates, {
      seed: "2026-07-29:w",
    });
    expect(second).toEqual(first);
  });

  it("does not invent duplicate names when the roster is thin", () => {
    const winner = { memberId: "w", memberName: "Solo" };
    const viewport = buildShareViewportForWinner(winner, [winner]);
    expect(viewport.names).toEqual(["Solo"]);
    expect(viewport.winnerIndex).toBe(0);
  });

  it("keeps a single unique neighbor instead of cloning them", () => {
    const winner = { memberId: "w", memberName: "Winner" };
    const viewport = buildShareViewportForWinner(winner, [
      winner,
      { memberId: "a", memberName: "Alpha" },
    ]);
    expect(viewport.names).toEqual(["Alpha", "Winner"]);
    expect(viewport.winnerIndex).toBe(1);
  });

  it("skips a second member who shares the winner display name", () => {
    const winner = { memberId: "w", memberName: "BOGGLE" };
    const viewport = buildShareViewportForWinner(winner, [
      winner,
      { memberId: "alt", memberName: "BOGGLE" },
      { memberId: "a", memberName: "Alpha" },
      { memberId: "b", memberName: "Bravo" },
    ]);
    expect(viewport.names.filter((name) => name === "BOGGLE")).toHaveLength(1);
    expect(viewport.names[viewport.winnerIndex]).toBe("BOGGLE");
  });
});

describe("seededShuffle", () => {
  it("returns a permutation stable for the same seed", () => {
    const input = ["a", "b", "c", "d", "e"];
    expect(seededShuffle(input, "draw-1")).toEqual(
      seededShuffle(input, "draw-1"),
    );
    expect(seededShuffle(input, "draw-2")).not.toEqual(
      seededShuffle(input, "draw-1"),
    );
  });
});
