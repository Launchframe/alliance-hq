import { describe, expect, it } from "vitest";

import {
  detectBatchNameConflicts,
  normalizeCommanderName,
} from "@/lib/members/commander-identity-conflicts.shared";

describe("commander-identity-conflicts.shared", () => {
  it("normalizeCommanderName trims, collapses, and lowercases", () => {
    expect(normalizeCommanderName("  Big   Daddy  ")).toBe("big daddy");
  });

  it("detectBatchNameConflicts flags duplicate normalized names in a batch", () => {
    const conflicts = detectBatchNameConflicts(
      [
        { extractedName: "Alpha", rowIndex: 0 },
        { extractedName: "Beta", rowIndex: 1 },
        { extractedName: " alpha ", rowIndex: 2 },
      ],
      1203,
    );

    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((c) => c.code === "duplicate_in_batch")).toBe(true);
    expect(conflicts.map((c) => c.rowIndex).sort()).toEqual([0, 2]);
  });

  it("detectBatchNameConflicts returns empty when names are distinct", () => {
    expect(
      detectBatchNameConflicts(
        [
          { extractedName: "One", rowIndex: 0 },
          { extractedName: "Two", rowIndex: 1 },
        ],
        1203,
      ),
    ).toEqual([]);
  });
});
