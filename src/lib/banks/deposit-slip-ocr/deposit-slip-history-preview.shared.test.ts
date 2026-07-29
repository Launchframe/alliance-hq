import { describe, expect, it } from "vitest";

import { countReviewRowsMatchingBankHistory } from "@/lib/banks/deposit-slip-ocr/deposit-slip-history-preview.shared";
import type { DepositSlipReviewValidationRow } from "@/lib/banks/deposit-slip-review-validation.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";

function row(
  overrides: Partial<DepositSlipReviewValidationRow> & { id: string },
): DepositSlipReviewValidationRow {
  return {
    ocrName: "Blue Investor",
    score: "6000",
    powerLevel: "2026-07-10T12:14:34.000Z",
    memberLevel: 3,
    profession: "locked",
    deleted: false,
    ...overrides,
  };
}

function historySlip(
  overrides: Partial<SerializedDepositSlip> & { id: string },
): SerializedDepositSlip {
  return {
    bankId: "bank-1",
    depositAt: "2026-07-10T12:14:34.000Z",
    termDays: 3,
    maturesAt: "2026-07-13T12:14:34.000Z",
    status: "locked",
    outcomeAt: null,
    amount: 6000,
    outcomeAmount: null,
    depositAllianceTag: "Roar",
    depositAllianceId: null,
    commanderName: "Blue Investor",
    commanderId: null,
    allianceMemberId: null,
    createdAt: "2026-07-10T12:15:00.000Z",
    updatedAt: "2026-07-10T12:15:00.000Z",
    ...overrides,
  };
}

describe("countReviewRowsMatchingBankHistory", () => {
  it("counts rows that would be skipped as history duplicates", () => {
    const history = [
      historySlip({
        id: "stored",
        commanderName: "Banla QC",
        allianceMemberId: "am-bania",
      }),
    ];
    const counts = countReviewRowsMatchingBankHistory(
      [
        row({
          id: "new",
          ocrName: "Bania QC",
          memberId: "ashed-bania",
          memberName: "Banla QC",
        }),
        row({ id: "fresh", ocrName: "Someone Else" }),
      ],
      history,
    );

    expect(counts).toEqual({ skipCount: 1, updateCount: 0 });
  });

  it("counts rows that would update a locked slip with a terminal outcome", () => {
    const history = [
      historySlip({
        id: "locked",
        status: "locked",
        depositAt: "2026-07-10T12:00:00.000Z",
      }),
    ];
    const counts = countReviewRowsMatchingBankHistory(
      [
        row({
          id: "matured",
          ocrName: "Blue Investor",
          profession: "matured",
          powerLevel: "2026-07-13T12:05:00.000Z",
        }),
      ],
      history,
    );

    expect(counts).toEqual({ skipCount: 0, updateCount: 1 });
  });
});
