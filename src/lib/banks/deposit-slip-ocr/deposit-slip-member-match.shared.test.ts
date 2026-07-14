import { describe, expect, it } from "vitest";

import {
  depositSlipReviewMatchConfidence,
  isDepositSlipAutoLinkedMatchMethod,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-member-match.shared";

describe("depositSlipReviewMatchConfidence", () => {
  it("passes through name confidence when the tag is exact", () => {
    expect(depositSlipReviewMatchConfidence(1, "exact", 1)).toBe(1);
    expect(depositSlipReviewMatchConfidence(0.9, "exact", 1)).toBe(0.9);
  });

  it("caps at fuzzy-tag similarity so exact name cannot look like 100%", () => {
    expect(depositSlipReviewMatchConfidence(1, "fuzzy", 0.75)).toBe(0.75);
    expect(depositSlipReviewMatchConfidence(0.9, "fuzzy", 0.8)).toBe(0.8);
    expect(depositSlipReviewMatchConfidence(0.7, "fuzzy", 0.8)).toBe(0.7);
  });

  it("does not cap for missing or ambiguous tags", () => {
    expect(depositSlipReviewMatchConfidence(1, "none", 0)).toBe(1);
    expect(depositSlipReviewMatchConfidence(1, "ambiguous", 0)).toBe(1);
  });
});

describe("isDepositSlipAutoLinkedMatchMethod", () => {
  it("treats none/empty as not auto-linked", () => {
    expect(isDepositSlipAutoLinkedMatchMethod("none")).toBe(false);
    expect(isDepositSlipAutoLinkedMatchMethod(null)).toBe(false);
    expect(isDepositSlipAutoLinkedMatchMethod("")).toBe(false);
  });

  it("treats exact/fuzzy/previous_name as auto-linked", () => {
    expect(isDepositSlipAutoLinkedMatchMethod("exact")).toBe(true);
    expect(isDepositSlipAutoLinkedMatchMethod("fuzzy")).toBe(true);
    expect(isDepositSlipAutoLinkedMatchMethod("previous_name")).toBe(true);
  });
});
