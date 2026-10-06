import { describe, expect, it } from "vitest";

import { dedupeWarzoneEvidence } from "@/lib/video/event-evidence-dedup.shared";
import type { WarzoneFrameResult } from "@/lib/video/warzone-evidence.shared";

function frameResult(frame: WarzoneFrameResult["frame"], index = 0): WarzoneFrameResult {
  return {
    frameIndex: index,
    videoTimestampSeconds: null,
    frame,
    safeCrop: null,
    formatMismatch: false,
  };
}

describe("dedupeWarzoneEvidence", () => {
  it("collapses identical leaderboard tuples across overlapping frames", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [
          { name: "ST1tCH", allianceTag: "LFgo", actualScore: "9574146", observedRank: 54, crop: null },
          { name: "Richiè", allianceTag: "LFgo", actualScore: "7938672", observedRank: 77, crop: null },
        ],
      }),
      frameResult(
        {
          kind: "leaderboard",
          entries: [
            { name: "Richiè", allianceTag: "LFgo", actualScore: "7938672", observedRank: 77, crop: null },
            { name: "ARKEN", allianceTag: "LFgo", actualScore: "7882603", observedRank: 78, crop: null },
          ],
        },
        1,
      ),
    ]);
    expect(rows.map((row) => row.ocrName)).toEqual(["ST1tCH", "Richiè", "ARKEN"]);
  });

  it("keeps differing tuples for one name and flags a conflict", () => {
    const { rows, conflicts } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [
          { name: "ST1tCH", allianceTag: "LFgo", actualScore: "9574146", observedRank: 54, crop: null },
        ],
      }),
      frameResult(
        {
          kind: "leaderboard",
          entries: [
            { name: "ST1tCH", allianceTag: "LFgo", actualScore: "9574000", observedRank: 54, crop: null },
          ],
        },
        1,
      ),
    ]);
    expect(rows).toHaveLength(2);
    expect(conflicts).toHaveLength(1);
  });

  it("never merges a Yes and a No for the same member", () => {
    const { rows, pollConflicts } = dedupeWarzoneEvidence([
      frameResult({
        kind: "poll",
        option: 1,
        entries: [{ name: "ST1tCH", crop: null }],
      }),
      frameResult(
        { kind: "poll", option: 2, entries: [{ name: "ST1tCH", crop: null }] },
        1,
      ),
    ]);
    expect(rows).toHaveLength(2);
    expect(pollConflicts).toHaveLength(1);
  });

  it("dedupes same-option poll repeats but keeps unresolved rows separate from resolved", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "poll",
        option: 1,
        entries: [{ name: "ST1tCH", crop: null }],
      }),
      frameResult(
        { kind: "poll", option: 1, entries: [{ name: "ST1tCH", crop: null }] },
        1,
      ),
      frameResult(
        { kind: "poll", option: null, entries: [{ name: "ST1tCH", crop: null }] },
        2,
      ),
    ]);
    // option-1 deduped to one row; the unresolved row stays distinct.
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.unresolvedOption)).toBe(true);
  });

  it("never synthesizes scores for poll rows", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "poll",
        option: 1,
        entries: [{ name: "ST1tCH", crop: null }],
      }),
    ]);
    expect(rows[0].realScore).toBeNull();
    expect(rows[0].kind).toBe("poll_yes");
    expect(rows[0].pollOption).toBe(1);
  });

  it("ignores unknown-layout frames", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({ kind: "unknown", reason: "layout_not_detected" }),
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("dedupeWarzoneEvidence fragment merging", () => {
  const lb = (
    name: string,
    score: string | null,
    rank: number | null = null,
  ): {
    name: string;
    allianceTag: string | null;
    actualScore: string | null;
    observedRank: number | null;
    crop: null;
  } => ({
    name,
    allianceTag: "LFgo",
    actualScore: score,
    observedRank: rank,
    crop: null,
  });

  it("merges name fragments sharing one score into a single row", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({ kind: "leaderboard", entries: [lb("2Bogs", "78091")] }),
      frameResult(
        { kind: "leaderboard", entries: [lb("TIEq c2Bogs", "78091")] },
        1,
      ),
      frameResult({ kind: "leaderboard", entries: [lb("Bogs pe", "78091")] }, 2),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.realScore).toBe("78091");
  });

  it("merges a long-name two-edit misread on leaderboard rows", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [lb("orhsorbsorhs", "10158126")],
      }),
      frameResult(
        { kind: "leaderboard", entries: [lb("orbsorbsorbs", null, 46)] },
        1,
      ),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.realScore).toBe("10158126");
    expect(rows[0]!.observedRank).toBe(46);
  });

  it("absorbs a ? row onto the named cluster carrying its score", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({ kind: "leaderboard", entries: [lb("?", "9574146")] }),
      frameResult(
        { kind: "leaderboard", entries: [lb("STIHCH", "9574146")] },
        1,
      ),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ocrName).toBe("STIHCH");
    expect(rows[0]!.realScore).toBe("9574146");
  });

  it("drops name-only sightings that carry no score, rank, or tag", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [
          {
            name: "BEES",
            allianceTag: null,
            actualScore: null,
            observedRank: null,
            crop: null,
          },
          lb("ST1tCH", "9574146", 54),
        ],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ocrName).toBe("ST1tCH");
  });

  it("never emits a rank on a review-flagged row", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [
          {
            name: "CRAZYNHO",
            allianceTag: "LFgo",
            actualScore: "1405985",
            observedRank: 7,
            crop: null,
            reviewReason: "score_not_monotonic",
          },
        ],
      }),
    ]);
    expect(rows[0]!.needsReview).toBe(true);
    expect(rows[0]!.observedRank).toBeNull();
  });

  it("nulls a rank-only inconsistency without flagging the row", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [
          {
            name: "Richie",
            allianceTag: "LFgo",
            actualScore: "7938672",
            observedRank: 4,
            crop: null,
            reviewReason: "rank_not_increasing",
          },
        ],
      }),
      frameResult(
        {
          kind: "leaderboard",
          entries: [lb("Richie", "7938672", 77)],
        },
        1,
      ),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.observedRank).toBeNull();
    expect(rows[0]!.needsReview).toBe(false);
    expect(rows[0]!.reviewReason).toBeNull();
  });

  it("flags two distinct names claiming the same score", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({ kind: "leaderboard", entries: [lb("Anytime KO", "8664604")] }),
      frameResult({ kind: "leaderboard", entries: [lb("res MIN", "8664604")] }, 1),
    ]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.needsReview).toBe(true);
      expect(row.reviewReason).toBe("duplicate_score");
    }
  });
});

describe("dedupeWarzoneEvidence foreign-tag filtering", () => {
  const lbTag = (
    name: string,
    score: string | null,
    tag: string | null,
  ): {
    name: string;
    allianceTag: string | null;
    actualScore: string | null;
    observedRank: number | null;
    crop: null;
  } => ({ name, allianceTag: tag, actualScore: score, observedRank: null, crop: null });

  it("drops foreign-tag rows only when the own tag was observed", () => {
    const result = dedupeWarzoneEvidence(
      [
        frameResult({
          kind: "leaderboard",
          entries: [
            lbTag("CAIPIRA", "15421010", "LFgo"),
            lbTag("Enemy Two", "9000000", "FOE"),
            lbTag("NoTag Member", "8000000", null),
          ],
        }),
      ],
      { allianceTag: "LFgo" },
    );
    expect(result.ownTagObserved).toBe(true);
    expect(result.tagFilteredRows).toBe(1);
    expect(result.rows.map((r) => r.ocrName)).toEqual([
      "CAIPIRA",
      "NoTag Member",
    ]);
  });

  it("keeps every row when the own tag is never observed (stored tag stale)", () => {
    const result = dedupeWarzoneEvidence(
      [
        frameResult({
          kind: "leaderboard",
          entries: [
            lbTag("CAIPIRA", "15421010", "LFgo"),
            lbTag("Freddy", "11808745", "LFgo"),
          ],
        }),
      ],
      { allianceTag: "WZSM" },
    );
    expect(result.ownTagObserved).toBe(false);
    expect(result.tagFilteredRows).toBe(0);
    expect(result.rows).toHaveLength(2);
  });

  it("keeps every row when no own tag is configured", () => {
    const result = dedupeWarzoneEvidence(
      [
        frameResult({
          kind: "leaderboard",
          entries: [
            lbTag("CAIPIRA", "15421010", "LFgo"),
            lbTag("Enemy Two", "9000000", "FOE"),
          ],
        }),
      ],
      { allianceTag: null },
    );
    expect(result.ownTagObserved).toBe(false);
    expect(result.tagFilteredRows).toBe(0);
    expect(result.rows).toHaveLength(2);
  });
});

describe("dedupeWarzoneEvidence implausible ranks", () => {
  const lb = (
    name: string,
    score: string | null,
    rank: number | null = null,
  ): {
    name: string;
    allianceTag: string | null;
    actualScore: string | null;
    observedRank: number | null;
    crop: null;
  } => ({ name, allianceTag: "LFgo", actualScore: score, observedRank: rank, crop: null });

  it("nulls a rank above the in-game top-100 without flagging", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [lb("Bat Pig", "7605222", 817)],
      }),
    ]);
    expect(rows[0]!.observedRank).toBeNull();
    expect(rows[0]!.needsReview).toBe(false);
  });

  it("nulls a rank below the member's position among our scored rows", () => {
    const entries = [
      lb("P1", "100", null),
      lb("P2", "90", null),
      lb("P3", "80", null),
      lb("P4", "70", null),
      lb("P5", "60", null),
      lb("P6", "50", null),
      lb("P7", "40", null),
      lb("XxxTwiztedxxX", "30", 2),
    ];
    const { rows } = dedupeWarzoneEvidence([
      frameResult({ kind: "leaderboard", entries }),
    ]);
    const row = rows.find((r) => r.ocrName === "XxxTwiztedxxX")!;
    expect(row.observedRank).toBeNull();
    expect(row.needsReview).toBe(false);
  });

  it("keeps a plausible rank", () => {
    const { rows } = dedupeWarzoneEvidence([
      frameResult({
        kind: "leaderboard",
        entries: [
          lb("P1", "100", null),
          lb("DENIZ 1", "90", 12),
        ],
      }),
    ]);
    const row = rows.find((r) => r.ocrName === "DENIZ 1")!;
    expect(row.observedRank).toBe(12);
  });
});
