import { describe, expect, it } from "vitest";

import { buildOfficerIntelKeywordPattern } from "@/lib/officer-intel/retrieve-corpus.server";

describe("buildOfficerIntelKeywordPattern", () => {
  it("wraps the query in contains wildcards", () => {
    expect(buildOfficerIntelKeywordPattern("bank drop")).toBe("%bank drop%");
  });

  it("escapes SQL LIKE metacharacters", () => {
    expect(buildOfficerIntelKeywordPattern("100% loot")).toBe(
      "%100\\% loot%",
    );
    expect(buildOfficerIntelKeywordPattern("who_is_next")).toBe(
      "%who\\_is\\_next%",
    );
    expect(buildOfficerIntelKeywordPattern("path\\slash")).toBe(
      "%path\\\\slash%",
    );
  });

  it("returns a match-all pattern for blank input", () => {
    expect(buildOfficerIntelKeywordPattern("   ")).toBe("%");
  });
});
