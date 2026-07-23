import { describe, expect, it } from "vitest";

import {
  diffKeysForDepositSlipRows,
  formatDepositSlipReviewRowSummary,
} from "@/lib/banks/deposit-slip-review-row-summary.shared";

describe("formatDepositSlipReviewRowSummary", () => {
  it("joins commander, tag, amount, term, deposit time, and status", () => {
    expect(
      formatDepositSlipReviewRowSummary({
        ocrName: "Alpha",
        allianceRankTitle: "LFgo",
        score: "6000",
        memberLevel: 3,
        powerLevel: "2026-07-11T10:30:00.000Z",
        profession: "locked",
      }),
    ).toBe("Alpha · LFgo · 6000 · 3d · 2026-7-11 10:30:00 · locked");
  });

  it("uses em dashes for missing fields", () => {
    expect(
      formatDepositSlipReviewRowSummary({
        ocrName: "",
        allianceRankTitle: null,
        score: null,
        memberLevel: null,
        powerLevel: null,
        profession: null,
      }),
    ).toBe("— · — · — · — · — · —");
  });
});

describe("diffKeysForDepositSlipRows", () => {
  it("flags fields that disagree across rows", () => {
    const diff = diffKeysForDepositSlipRows([
      {
        ocrName: "Alpha",
        score: "6000",
        memberLevel: 1,
        powerLevel: "2026-07-11T10:00:00.000Z",
        profession: "locked",
      },
      {
        ocrName: "Alpha",
        score: "5000",
        memberLevel: 1,
        powerLevel: "2026-07-11T10:00:00.000Z",
        profession: "locked",
      },
    ]);
    expect(diff).toEqual(new Set(["score"]));
  });

  it("returns an empty set for a single row", () => {
    expect(
      diffKeysForDepositSlipRows([
        {
          ocrName: "Solo",
          score: "100",
        },
      ]).size,
    ).toBe(0);
  });
});
