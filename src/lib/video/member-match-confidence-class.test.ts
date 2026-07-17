import { describe, expect, it } from "vitest";

import { memberMatchConfidenceBorderClass } from "./member-match-confidence-class";

describe("memberMatchConfidenceBorderClass", () => {
  it("marks unmatched and zero confidence as danger", () => {
    expect(memberMatchConfidenceBorderClass(null)).toBe("border-hq-danger");
    expect(memberMatchConfidenceBorderClass(undefined)).toBe("border-hq-danger");
    expect(memberMatchConfidenceBorderClass(0)).toBe("border-hq-danger");
    expect(memberMatchConfidenceBorderClass(-0.1)).toBe("border-hq-danger");
  });

  it("marks sub-threshold positive confidence as danger", () => {
    expect(memberMatchConfidenceBorderClass(0.59)).toBe("border-hq-danger");
    expect(memberMatchConfidenceBorderClass(0.4)).toBe("border-hq-danger");
  });

  it("marks high-confidence matches as solid green", () => {
    expect(memberMatchConfidenceBorderClass(0.9)).toBe("border-hq-green");
    expect(memberMatchConfidenceBorderClass(1)).toBe("border-hq-green");
  });

  it("marks partial matches as dashed green", () => {
    expect(memberMatchConfidenceBorderClass(0.71)).toBe(
      "border-hq-green border-dashed",
    );
    expect(memberMatchConfidenceBorderClass(0.6)).toBe(
      "border-hq-green border-dashed",
    );
    expect(memberMatchConfidenceBorderClass(0.899)).toBe(
      "border-hq-green border-dashed",
    );
  });
});
