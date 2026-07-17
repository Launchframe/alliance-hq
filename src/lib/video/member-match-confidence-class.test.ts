import { describe, expect, it } from "vitest";

import { memberMatchConfidenceBorderClass } from "./member-match-confidence-class";

describe("memberMatchConfidenceBorderClass", () => {
  it("marks unmatched and zero confidence as danger", () => {
    expect(memberMatchConfidenceBorderClass(null)).toBe("border-hq-danger");
    expect(memberMatchConfidenceBorderClass(undefined)).toBe("border-hq-danger");
    expect(memberMatchConfidenceBorderClass(0)).toBe("border-hq-danger");
  });

  it("marks partial and exact matches as green", () => {
    expect(memberMatchConfidenceBorderClass(0.71)).toBe("border-hq-green");
    expect(memberMatchConfidenceBorderClass(0.6)).toBe("border-hq-green");
    expect(memberMatchConfidenceBorderClass(1)).toBe("border-hq-green");
  });
});
