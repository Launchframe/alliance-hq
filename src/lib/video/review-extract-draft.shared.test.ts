import { describe, expect, it } from "vitest";

import {
  buildVideoReviewDraft,
  computeVideoReviewRowSignature,
  isVideoReviewDraftApplicable,
  mergeVideoReviewDraftRows,
  parseVideoReviewDraft,
  restoreVideoReviewDraftIfPresent,
} from "./review-extract-draft.shared";

const baseRow = {
  id: "r1",
  ocrName: "Alpha",
  score: "100",
  rank: 1,
  memberId: "m1",
  memberName: "Alpha",
  matchConfidence: 1,
  matchMethod: "exact",
  scoreConflict: 0,
  deleted: 0,
};

describe("computeVideoReviewRowSignature", () => {
  it("sorts row ids for a stable signature", () => {
    expect(
      computeVideoReviewRowSignature([{ id: "b" }, { id: "a" }]),
    ).toBe("a,b");
  });
});

describe("parseVideoReviewDraft", () => {
  it("parses a valid draft payload", () => {
    const draft = buildVideoReviewDraft({
      jobId: "job-1",
      viewMode: "review",
      rows: [baseRow],
      form: {
        eventId: "ev-1",
        hqEventId: "",
        boardKey: "kills",
        team: "A",
        recordedDate: "2026-06-26",
      },
    });
    expect(parseVideoReviewDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("rejects malformed payloads", () => {
    expect(parseVideoReviewDraft("{")).toBeNull();
    expect(parseVideoReviewDraft(JSON.stringify({ version: 2 }))).toBeNull();
  });
});

describe("isVideoReviewDraftApplicable", () => {
  it("requires matching job, view mode, and row signature", () => {
    const draft = buildVideoReviewDraft({
      jobId: "job-1",
      viewMode: "review",
      rows: [baseRow],
      form: {
        eventId: "",
        hqEventId: "",
        boardKey: "",
        team: "A",
        recordedDate: "2026-06-26",
      },
    });
    expect(
      isVideoReviewDraftApplicable(
        draft,
        "job-1",
        "review",
        computeVideoReviewRowSignature([baseRow]),
      ),
    ).toBe(true);
    expect(
      isVideoReviewDraftApplicable(
        draft,
        "job-2",
        "review",
        computeVideoReviewRowSignature([baseRow]),
      ),
    ).toBe(false);
  });
});

describe("mergeVideoReviewDraftRows", () => {
  it("overlays draft edits onto server rows by id", () => {
    const merged = mergeVideoReviewDraftRows(
      [{ ...baseRow, score: "50" }],
      [{ ...baseRow, score: "999" }],
    );
    expect(merged[0]?.score).toBe("999");
  });
});

describe("restoreVideoReviewDraftIfPresent", () => {
  it("returns server rows when no draft exists", () => {
    const serverRows = [baseRow];
    const result = restoreVideoReviewDraftIfPresent(
      "missing-job",
      "review",
      serverRows,
    );
    expect(result.restored).toBe(false);
    expect(result.rows).toEqual(serverRows);
    expect(result.savedAt).toBeNull();
  });
});
