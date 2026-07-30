import { describe, expect, it } from "vitest";

import { demotedAllianceRank } from "@/lib/vs-compliance/vs-compliance-enforcement.shared";

describe("vs-compliance-enforcement.shared", () => {
  describe("demotedAllianceRank", () => {
    it("decrements R2–R5 by one", () => {
      expect(demotedAllianceRank(5)).toBe(4);
      expect(demotedAllianceRank(4)).toBe(3);
      expect(demotedAllianceRank(3)).toBe(2);
      expect(demotedAllianceRank(2)).toBe(1);
    });

    it("returns null at R1 or below", () => {
      expect(demotedAllianceRank(1)).toBeNull();
      expect(demotedAllianceRank(0)).toBeNull();
    });

    it("returns null for non-finite input", () => {
      expect(demotedAllianceRank(Number.NaN)).toBeNull();
    });
  });
});
