import { describe, expect, it } from "vitest";

import {
  eventProjectionValue,
  resolveEventMemberEvidence,
  type EventObservation,
} from "@/lib/hq-events/evidence-merge.shared";

let seq = 0;
function obs(partial: Partial<EventObservation>): EventObservation {
  seq += 1;
  return {
    id: `o${seq}`,
    memberId: "m1",
    kind: "leaderboard",
    realScore: null,
    stage: null,
    observedRank: null,
    provenance: "video",
    ...partial,
  };
}

function yes(id: string): EventObservation {
  return obs({ id, kind: "poll_yes" });
}
function no(id: string): EventObservation {
  return obs({ id, kind: "poll_no" });
}
function real(id: string, score: string, stage: number | null = null): EventObservation {
  return obs({ id, kind: "leaderboard", realScore: score, stage });
}
function legacy(id: string): EventObservation {
  return obs({ id, kind: "legacy_leaderboard", provenance: "legacy" });
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

describe("resolveEventMemberEvidence", () => {
  it("returns no evidence for an empty list", () => {
    const resolved = resolveEventMemberEvidence("m1", []);
    expect(resolved.class).toBe("none");
    expect(resolved.score).toBeNull();
  });

  it("collapses identical real tuples and resolves a real score", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      real("a", "9620844"),
      real("b", "9620844"),
      real("c", "9620844"),
    ]);
    expect(resolved.class).toBe("real");
    expect(resolved.score).toBe("9620844");
  });

  it("keeps differing real tuples as a conflict, never a max", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      real("a", "9620844"),
      real("b", "1"),
    ]);
    expect(resolved.class).toBe("conflict");
    expect(resolved.conflict).toBe("real_score_mismatch");
    expect(resolved.conflictingScores).toEqual(["1", "9620844"]);
  });

  it("lets real evidence survive a contradictory No and keeps the warning", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      real("a", "500"),
      no("b"),
    ]);
    expect(resolved.class).toBe("real");
    expect(resolved.score).toBe("500");
    expect(resolved.retainedWarnings).toEqual(["poll_no"]);
  });

  it("produces the same result for every ordering of leaderboard/Yes/No", () => {
    const base = [real("r", "42"), yes("y"), no("n"), legacy("l")];
    const results = permutations(base).map((order) =>
      resolveEventMemberEvidence("m1", order),
    );
    for (const resolved of results) {
      expect(resolved).toEqual(results[0]);
      expect(resolved.class).toBe("real");
      expect(resolved.score).toBe("42");
    }
  });

  it("resolves legacy participation when no real score exists", () => {
    const resolved = resolveEventMemberEvidence("m1", [legacy("l")]);
    expect(resolved.class).toBe("legacy_leaderboard");
  });

  it("treats a reviewed leaderboard row without a score as unranked participation", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      obs({ id: "l1", kind: "leaderboard", realScore: null }),
    ]);
    expect(resolved.class).toBe("legacy_leaderboard");
  });

  it("resolves consistent Yes and No-only", () => {
    expect(
      resolveEventMemberEvidence("m1", [yes("a"), yes("b")]).class,
    ).toBe("yes_only");
    expect(
      resolveEventMemberEvidence("m1", [no("a"), no("b")]).class,
    ).toBe("explicit_no");
  });

  it("marks Yes+No as a poll conflict regardless of order", () => {
    const base = [yes("y"), no("n")];
    for (const order of permutations(base)) {
      const resolved = resolveEventMemberEvidence("m1", order);
      expect(resolved.class).toBe("conflict");
      expect(resolved.conflict).toBe("poll_yes_no");
    }
  });

  it("ignores retracted and superseded observations", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      obs({ id: "old", kind: "poll_no", supersededBy: "new" }),
      yes("new"),
    ]);
    expect(resolved.class).toBe("yes_only");
    const retracted = resolveEventMemberEvidence("m1", [
      obs({ id: "old", kind: "poll_no", retracted: true }),
      yes("new"),
    ]);
    expect(retracted.class).toBe("yes_only");
  });

  it("collapses duplicate source fingerprints into one claim", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      obs({ id: "a", kind: "poll_yes", sourceKey: "job:row1" }),
      obs({ id: "b", kind: "poll_no", sourceKey: "job:row1" }),
    ]);
    expect(resolved.class).toBe("yes_only");
  });

  it("carries manual correction actor and reason without OCR provenance", () => {
    const resolved = resolveEventMemberEvidence("m1", [
      obs({
        id: "c1",
        kind: "leaderboard",
        realScore: "77",
        provenance: "manual",
        correction: { actorId: "officer-1", reason: "OCR misread" },
      }),
    ]);
    expect(resolved.class).toBe("real");
    expect(resolved.score).toBe("77");
    expect(resolved.corrections).toEqual([
      { actorId: "officer-1", reason: "OCR misread" },
    ]);
  });
});

describe("eventProjectionValue", () => {
  it("projects real > legacy 2000 > Yes 1000 > No 1 > nothing", () => {
    const member = "m1";
    expect(
      eventProjectionValue(
        resolveEventMemberEvidence(member, [real("a", "999")]),
      ),
    ).toBe("999");
    expect(
      eventProjectionValue(
        resolveEventMemberEvidence(member, [legacy("l")]),
      ),
    ).toBe("2000");
    expect(
      eventProjectionValue(resolveEventMemberEvidence(member, [yes("y")])),
    ).toBe("1000");
    expect(
      eventProjectionValue(resolveEventMemberEvidence(member, [no("n")])),
    ).toBe("1");
    expect(
      eventProjectionValue(resolveEventMemberEvidence(member, [])),
    ).toBeNull();
    expect(
      eventProjectionValue(
        resolveEventMemberEvidence(member, [yes("y"), no("n")]),
      ),
    ).toBeNull();
  });

  it("keeps a real 1000 or 2000 as a real score", () => {
    for (const score of ["1000", "2000"]) {
      const resolved = resolveEventMemberEvidence("m1", [
        real("a", score),
      ]);
      expect(resolved.class).toBe("real");
      expect(eventProjectionValue(resolved)).toBe(score);
    }
  });
});
