import { describe, expect, it } from "vitest";

import { freddyDemotionTargetRank } from "@/lib/vs-compliance/vs-compliance-enforcement.shared";

describe("vs-compliance-enforcement.shared", () => {
  describe("freddyDemotionTargetRank", () => {
    it("maps strike 1 → R2 and strike 2 → R1", () => {
      expect(freddyDemotionTargetRank(1)).toBe(2);
      expect(freddyDemotionTargetRank(2)).toBe(1);
    });

    it("returns null at kick threshold (default 3) and above", () => {
      expect(freddyDemotionTargetRank(3)).toBeNull();
      expect(freddyDemotionTargetRank(5)).toBeNull();
    });

    it("honors a custom missStrikesBeforeKick", () => {
      expect(freddyDemotionTargetRank(3, 4)).toBe(1);
      expect(freddyDemotionTargetRank(4, 4)).toBeNull();
    });

    it("returns null for invalid strike counts", () => {
      expect(freddyDemotionTargetRank(0)).toBeNull();
      expect(freddyDemotionTargetRank(-1)).toBeNull();
      expect(freddyDemotionTargetRank(Number.NaN)).toBeNull();
    });
  });
});
