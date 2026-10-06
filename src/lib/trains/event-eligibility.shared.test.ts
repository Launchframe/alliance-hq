import { describe, expect, it } from "vitest";

import {
  resolveEventMemberEvidence,
  type EventObservation,
  type ResolvedEventMember,
} from "@/lib/hq-events/evidence-merge.shared";
import {
  buildEventEligibility,
  type EventEligibilityInput,
} from "@/lib/trains/event-eligibility.shared";

let seq = 0;
function obs(memberId: string, partial: Partial<EventObservation>): EventObservation {
  seq += 1;
  return {
    id: `o${seq}`,
    memberId,
    kind: "leaderboard",
    realScore: null,
    stage: null,
    observedRank: null,
    provenance: "video",
    ...partial,
  };
}

function realMember(memberId: string, score: string, stage: number | null = null): ResolvedEventMember {
  return resolveEventMemberEvidence(memberId, [
    obs(memberId, { kind: "leaderboard", realScore: score, stage }),
  ]);
}
function legacyMember(memberId: string): ResolvedEventMember {
  return resolveEventMemberEvidence(memberId, [
    obs(memberId, { kind: "legacy_leaderboard", provenance: "legacy" }),
  ]);
}
function yesMember(memberId: string): ResolvedEventMember {
  return resolveEventMemberEvidence(memberId, [
    obs(memberId, { kind: "poll_yes" }),
  ]);
}
function noMember(memberId: string): ResolvedEventMember {
  return resolveEventMemberEvidence(memberId, [
    obs(memberId, { kind: "poll_no" }),
  ]);
}
function conflictMember(memberId: string): ResolvedEventMember {
  return resolveEventMemberEvidence(memberId, [
    obs(memberId, { kind: "poll_yes" }),
    obs(memberId, { kind: "poll_no" }),
  ]);
}

function input(partial: Partial<EventEligibilityInput>): EventEligibilityInput {
  return {
    sourceIdentity: {
      target: "warzone-duel",
      seriesId: "s1",
      occurrenceId: "ev-1",
      boardKeys: ["main"],
      teamScope: null,
    },
    role: "conductor",
    eligibility: "scored",
    topN: 10,
    fallback: "none",
    results: [],
    activeMemberIds: [],
    bound: true,
    readyRevisionsBound: true,
    readyRevisions: [{ boardId: "main", readyVersion: 1 }],
    emptyBoardConfirmed: false,
    ...partial,
  };
}

describe("buildEventEligibility binding", () => {
  it("rejects unbound and not-ready inputs", () => {
    expect(
      buildEventEligibility(input({ bound: false })),
    ).toEqual({ ok: false, reason: "unbound" });
    expect(
      buildEventEligibility(input({ readyRevisionsBound: false })),
    ).toEqual({ ok: false, reason: "not_ready" });
  });
});

describe("scored Top X", () => {
  it("7 real + 20 Yes → conductor Top 10 = 7, VIP participants = 27", () => {
    const realIds = Array.from({ length: 7 }, (_, i) => `r${i}`);
    const yesIds = Array.from({ length: 20 }, (_, i) => `y${i}`);
    const roster = [...realIds, ...yesIds];
    const results = [
      ...realIds.map((id, i) => realMember(id, `${(i + 1) * 100}`)),
      ...yesIds.map((id) => yesMember(id)),
    ];
    const conductor = buildEventEligibility(
      input({ results, activeMemberIds: roster, role: "conductor", topN: 10 }),
    );
    expect(conductor.ok).toBe(true);
    if (conductor.ok) {
      expect(conductor.candidates).toEqual([...realIds].sort());
      expect(conductor.drawableCount).toBe(7);
      expect(conductor.shortBoard).toBe(true);
      expect(conductor.groupCounts).toMatchObject({
        real: 7,
        yesOnly: 20,
      });
    }
    const vip = buildEventEligibility(
      input({
        results,
        activeMemberIds: roster,
        role: "vip",
        eligibility: "participants",
        topN: "all",
      }),
    );
    expect(vip.ok).toBe(true);
    if (vip.ok) {
      expect(vip.candidates).toEqual([...roster].sort());
      expect(vip.drawableCount).toBe(27);
    }
  });

  it("includes every member tied at the cutoff", () => {
    const ids = ["a", "b", "c", "d"];
    // a=b=100 (tie straddling the Top-1 boundary), c=50, d=10.
    const results = [
      realMember("a", "100"),
      realMember("b", "100"),
      realMember("c", "50"),
      realMember("d", "10"),
    ];
    const result = buildEventEligibility(
      input({ results, activeMemberIds: ids, topN: 1 }),
    );
    expect(result.ok && result.candidates).toEqual(["a", "b"]);
    expect(result.ok && result.cutoff).toEqual({
      applied: true,
      score: "100",
      stage: null,
      tieExpanded: 1,
    });
  });

  it("orders beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const base = BigInt(Number.MAX_SAFE_INTEGER);
    const results = [
      realMember("low", "5"),
      realMember("big", `${base + BigInt(2)}`),
      realMember("bigger", `${base + BigInt(10)}`),
    ];
    const result = buildEventEligibility(
      input({ results, activeMemberIds: ["low", "big", "bigger"], topN: 1 }),
    );
    expect(result.ok && result.candidates).toEqual(["bigger"]);
  });

  it("keeps synthetic legacy 2000 out of numeric Top X but inside All", () => {
    const results = [
      realMember("real1", "2"),
      realMember("real2", "3"),
      legacyMember("old"),
    ];
    const roster = ["real1", "real2", "old"];
    const top3 = buildEventEligibility(
      input({ results, activeMemberIds: roster, topN: 3 }),
    );
    expect(top3.ok && top3.candidates).toEqual(["real1", "real2"]);
    const all = buildEventEligibility(
      input({ results, activeMemberIds: roster, topN: "all" }),
    );
    expect(all.ok && all.candidates).toEqual(["old", "real1", "real2"]);
  });

  it("never includes poll-only or conflict members in scored draws", () => {
    const results = [
      realMember("real", "50"),
      yesMember("y"),
      noMember("n"),
      conflictMember("c"),
    ];
    const result = buildEventEligibility(
      input({ results, activeMemberIds: ["real", "y", "n", "c"], topN: 5 }),
    );
    expect(result.ok && result.candidates).toEqual(["real"]);
    expect(result.ok && result.groupCounts).toMatchObject({
      yesOnly: 1,
      noOnly: 1,
      conflict: 1,
    });
  });

  it("does not promote #11 when a Top-10 member is unavailable", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `m${i}`);
    const results = ids.map((id, i) => realMember(id, `${100 - i}`));
    const result = buildEventEligibility(
      input({
        results,
        activeMemberIds: ids,
        topN: 10,
        exclusions: [{ memberId: "m0", reason: "time_off" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // m0 was qualifying but excluded; #11 (m10) must NOT be promoted.
      expect(result.candidates).not.toContain("m0");
      expect(result.candidates).not.toContain("m10");
      expect(result.candidates).toHaveLength(9);
      expect(result.scoredBoardSize).toBe(10);
      expect(result.drawableCount).toBe(9);
      expect(result.exclusionReasons).toEqual({ time_off: 1 });
    }
  });

  it("flags a short board when fewer than N qualify", () => {
    const result = buildEventEligibility(
      input({
        results: [realMember("a", "10"), realMember("b", "20")],
        activeMemberIds: ["a", "b"],
        topN: 5,
      }),
    );
    expect(result.ok && result.shortBoard).toBe(true);
    expect(result.ok && result.candidates).toEqual(["a", "b"]);
  });

  it("excludes the locked conductor from VIP candidates", () => {
    const roster = ["a", "b", "c"];
    const results = roster.map((id, i) => realMember(id, `${10 + i}`));
    const result = buildEventEligibility(
      input({
        results,
        activeMemberIds: roster,
        role: "vip",
        eligibility: "participants",
        topN: "all",
        lockedConductorId: "a",
      }),
    );
    expect(result.ok && result.candidates).toEqual(["b", "c"]);
    expect(result.ok && result.exclusionReasons).toEqual({
      locked_conductor: 1,
    });
  });

  it("counts roster members with nothing resolved as no evidence", () => {
    const result = buildEventEligibility(
      input({
        results: [realMember("a", "10")],
        activeMemberIds: ["a", "gone-proof"],
      }),
    );
    expect(result.ok && result.groupCounts.noEvidence).toBe(1);
  });
});

describe("non-Warzone targets", () => {
  it("ranks Frontline stage-first, then score", () => {
    const results = [
      realMember("lowStage", "999999", 3),
      realMember("highStage", "50", 7),
    ];
    const result = buildEventEligibility(
      input({
        sourceIdentity: {
          target: "frontline-breakthrough",
          seriesId: "s1",
          occurrenceId: "ev-1",
          boardKeys: ["main"],
          teamScope: null,
        },
        results,
        activeMemberIds: ["lowStage", "highStage"],
        topN: 1,
      }),
    );
    expect(result.ok && result.candidates).toEqual(["highStage"]);
  });

  it("drops Frontline rows missing a stage or at score 0", () => {
    const results = [
      realMember("noStage", "999999", null),
      realMember("zero", "0", 4),
      realMember("ok", "5", 4),
    ];
    const result = buildEventEligibility(
      input({
        sourceIdentity: {
          target: "frontline-breakthrough",
          seriesId: "s1",
          occurrenceId: "ev-1",
          boardKeys: ["main"],
          teamScope: null,
        },
        results,
        activeMemberIds: ["noStage", "zero", "ok"],
        topN: 10,
      }),
    );
    expect(result.ok && result.candidates).toEqual(["ok"]);
  });

  it("resolves Storm Both as per-team max, never a sum", () => {
    // Member scores 60 on A and 70 on B → one candidacy at 70, not 130.
    const a = [realMember("m", "60"), realMember("x", "30")];
    const b = [realMember("m", "70"), realMember("y", "5")];
    const result = buildEventEligibility(
      input({
        sourceIdentity: {
          target: "desert-storm",
          seriesId: "s1",
          occurrenceId: "ev-1",
          boardKeys: ["board-a", "board-b"],
          teamScope: "both",
        },
        results: a,
        secondaryResults: b,
        activeMemberIds: ["m", "x", "y"],
        topN: "all",
      }),
    );
    expect(result.ok && result.candidates).toEqual(["m", "x", "y"]);
    expect(result.ok && result.drawableCount).toBe(3);
    // B-only ordering: y (5) still qualifies (>0).
    const single = buildEventEligibility(
      input({
        sourceIdentity: {
          target: "desert-storm",
          seriesId: "s1",
          occurrenceId: "ev-1",
          boardKeys: ["board-a"],
          teamScope: "A",
        },
        results: a,
        activeMemberIds: ["m", "x", "y"],
        topN: "all",
      }),
    );
    expect(single.ok && single.candidates).toEqual(["m", "x"]);
    expect(single.ok && single.groupCounts.noEvidence).toBe(1);
  });
});

describe("poll fallback", () => {
  it("stays unavailable when departed members still hold board scores", () => {
    // Scorer left the roster: the event was not empty, so poll Yes must not
    // silently become drawable even with empty-board confirmation set.
    const results = [realMember("departed", "500"), yesMember("y1")];
    const result = buildEventEligibility(
      input({
        results,
        activeMemberIds: ["y1"],
        fallback: "confirmed_poll_yes",
        emptyBoardConfirmed: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fallback.available).toBe(false);
      expect(result.groupCounts.real).toBe(0);
    }
  });

  it("is available only on an empty board with explicit confirmation", () => {
    const roster = ["y1", "y2"];
    const results = roster.map((id) => yesMember(id));
    const open = buildEventEligibility(
      input({
        results,
        activeMemberIds: roster,
        fallback: "confirmed_poll_yes",
        emptyBoardConfirmed: true,
      }),
    );
    expect(open.ok && open.fallback.available).toBe(true);
    expect(open.ok && open.fallback.candidates).toEqual(["y1", "y2"]);

    // Same board without the explicit confirmation offers nothing.
    const unconfirmed = buildEventEligibility(
      input({
        results,
        activeMemberIds: roster,
        fallback: "confirmed_poll_yes",
      }),
    );
    expect(unconfirmed.ok && unconfirmed.fallback.available).toBe(false);
  });

  it("is never available when the board is exhausted or legacy-only", () => {
    const exhausted = buildEventEligibility(
      input({
        results: [realMember("a", "50"), ...[yesMember("y1")]],
        activeMemberIds: ["a", "y1"],
        fallback: "confirmed_poll_yes",
        emptyBoardConfirmed: true,
        exclusions: [{ memberId: "a", reason: "drawn_today" }],
      }),
    );
    expect(exhausted.ok && exhausted.fallback.available).toBe(false);

    const legacyOnly = buildEventEligibility(
      input({
        results: [legacyMember("old"), yesMember("y1")],
        activeMemberIds: ["old", "y1"],
        fallback: "confirmed_poll_yes",
        emptyBoardConfirmed: true,
      }),
    );
    expect(legacyOnly.ok && legacyOnly.fallback.available).toBe(false);
  });

  it("applies the same exclusions to fallback candidates", () => {
    const result = buildEventEligibility(
      input({
        results: [yesMember("y1"), yesMember("y2")],
        activeMemberIds: ["y1", "y2"],
        fallback: "confirmed_poll_yes",
        emptyBoardConfirmed: true,
        exclusions: [{ memberId: "y1", reason: "time_off" }],
      }),
    );
    expect(result.ok && result.fallback.candidates).toEqual(["y2"]);
  });
});

describe("fingerprint input", () => {
  it("is deterministic and changes with the inputs", () => {
    const base = input({
      results: [realMember("a", "10"), realMember("b", "20")],
      activeMemberIds: ["a", "b"],
    });
    const first = buildEventEligibility(base);
    const second = buildEventEligibility({ ...base });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.fingerprintInput).toEqual(second.fingerprintInput);
    }
    const changed = buildEventEligibility({
      ...base,
      results: [realMember("a", "10"), realMember("b", "20"), yesMember("c")],
      activeMemberIds: ["a", "b", "c"],
      eligibility: "participants",
      topN: "all",
    });
    if (first.ok && changed.ok) {
      expect(first.fingerprintInput).not.toEqual(changed.fingerprintInput);
    }
  });

  it("changes when the Yes set changes even if candidates do not", () => {
    // The poll-fallback acknowledgement binds to the fingerprint, so the
    // fallback candidate set must be part of it.
    const base = input({
      results: [realMember("a", "10"), yesMember("y1")],
      activeMemberIds: ["a", "y1"],
      fallback: "confirmed_poll_yes",
      topN: 1,
    });
    const first = buildEventEligibility(base);
    const second = buildEventEligibility({
      ...base,
      results: [realMember("a", "10"), yesMember("y2")],
      activeMemberIds: ["a", "y2"],
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.candidates).toEqual(second.candidates);
      expect(first.fingerprintInput).not.toEqual(second.fingerprintInput);
      expect(first.fingerprintInput.fallbackCandidates).toEqual(["y1"]);
      expect(second.fingerprintInput.fallbackCandidates).toEqual(["y2"]);
    }
  });

  it("changes with source identity and ready revisions", () => {
    const base = input({
      results: [realMember("a", "10")],
      activeMemberIds: ["a"],
      readyRevisions: [
        { boardId: "z", readyVersion: 2 },
        { boardId: "a", readyVersion: 1 },
      ],
    });
    const first = buildEventEligibility(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.fingerprintInput.readyRevisions).toEqual([
      { boardId: "a", readyVersion: 1 },
      { boardId: "z", readyVersion: 2 },
    ]);
    for (const partial of [
      {
        sourceIdentity: {
          ...base.sourceIdentity,
          occurrenceId: "ev-2",
        },
      },
      { readyRevisions: [{ boardId: "main", readyVersion: 2 }] },
      { lockedConductorId: "a", role: "vip" as const },
    ]) {
      const changed = buildEventEligibility({ ...base, ...partial });
      expect(changed.ok).toBe(true);
      if (changed.ok) {
        expect(changed.fingerprintInput).not.toEqual(first.fingerprintInput);
      }
    }
  });

  it("carries the Frontline cutoff stage alongside the score", () => {
    const result = buildEventEligibility(
      input({
        sourceIdentity: {
          target: "frontline-breakthrough",
          seriesId: "s1",
          occurrenceId: "ev-1",
          boardKeys: ["main"],
          teamScope: null,
        },
        results: [
          realMember("low", "999999", 3),
          realMember("high", "50", 7),
        ],
        activeMemberIds: ["low", "high"],
        topN: 1,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cutoff).toEqual({
        applied: true,
        score: "50",
        stage: 7,
        tieExpanded: 0,
      });
      expect(result.fingerprintInput.cutoffStage).toBe(7);
    }
  });
});
