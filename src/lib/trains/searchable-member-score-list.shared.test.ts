import { describe, expect, it } from "vitest";

import {
  filterMemberScoreRowsByName,
  paginateMemberScoreRows,
} from "@/lib/trains/searchable-member-score-list.shared";

const rows = [
  { memberId: "a", memberName: "Alpha" },
  { memberId: "b", memberName: "Bravo" },
  { memberId: "c", memberName: "Charlie" },
  { memberId: "d", memberName: "Delta" },
];

describe("filterMemberScoreRowsByName", () => {
  it("returns all rows when the query is blank", () => {
    expect(filterMemberScoreRowsByName(rows, "  ")).toEqual(rows);
  });

  it("matches names case-insensitively", () => {
    expect(filterMemberScoreRowsByName(rows, "al")).toEqual([
      { memberId: "a", memberName: "Alpha" },
    ]);
  });
});

describe("paginateMemberScoreRows", () => {
  it("clamps an out-of-range page onto the last page", () => {
    const result = paginateMemberScoreRows(rows, 9, 2);
    expect(result.pageCount).toBe(2);
    expect(result.safePage).toBe(1);
    expect(result.pageRows.map((row) => row.memberId)).toEqual(["c", "d"]);
  });

  it("returns an empty page when there are no rows", () => {
    const result = paginateMemberScoreRows([], 3, 8);
    expect(result.pageCount).toBe(1);
    expect(result.safePage).toBe(0);
    expect(result.pageRows).toEqual([]);
  });
});
