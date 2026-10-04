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
