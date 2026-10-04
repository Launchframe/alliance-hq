import { describe, expect, it } from "vitest";

import {
  issueIndexForId,
  stepIssueId,
  wrapProblemIndex,
} from "@/lib/video/use-review-issue-nav";

describe("wrapProblemIndex", () => {
  it("wraps out-of-range indices after the problem list shrinks", () => {
    expect(wrapProblemIndex(9, 3)).toBe(0);
    expect(wrapProblemIndex(10, 3)).toBe(1);
    expect(wrapProblemIndex(-1, 3)).toBe(2);
  });

  it("returns 0 for an empty problem list", () => {
    expect(wrapProblemIndex(5, 0)).toBe(0);
  });
});

describe("issueIndexForId", () => {
  it("stays on the current id when the list is rebuilt in the same order", () => {
    expect(issueIndexForId("b", ["a", "b", "c"])).toBe(1);
  });

  it("falls back to 0 when the current id leaves the list", () => {
    expect(issueIndexForId("gone", ["a", "b", "c"])).toBe(0);
    expect(issueIndexForId(null, ["a", "b", "c"])).toBe(0);
    expect(issueIndexForId("a", [])).toBe(0);
  });
});

describe("stepIssueId", () => {
  it("advances and wraps without resetting to the first id", () => {
    expect(stepIssueId(null, ["a", "b", "c"], 1)).toBe("b");
    expect(stepIssueId("a", ["a", "b", "c"], 1)).toBe("b");
    expect(stepIssueId("c", ["a", "b", "c"], 1)).toBe("a");
    expect(stepIssueId("b", ["a", "b", "c"], -1)).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(stepIssueId("a", [], 1)).toBeNull();
  });
});
