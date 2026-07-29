import { describe, expect, it } from "vitest";

import {
  applyDepositSlipScoreDefault,
  applyDepositSlipScoreDefaults,
  depositSlipScoreDefaultedRowIds,
  DEPOSIT_SLIP_DEFAULT_CRYSTAL_GOLD_AMOUNT,
} from "@/lib/banks/deposit-slip-score-default.shared";

describe("deposit-slip-score-default", () => {
  it("fills null score with default amount", () => {
    expect(
      applyDepositSlipScoreDefault({
        id: "r1",
        score: null,
        deleted: 0,
      } as { id: string; score: string | null; deleted: number }),
    ).toEqual({
      id: "r1",
      score: String(DEPOSIT_SLIP_DEFAULT_CRYSTAL_GOLD_AMOUNT),
      deleted: 0,
      scoreDefaulted: true,
    });
  });

  it("does not default deleted rows", () => {
    expect(
      applyDepositSlipScoreDefault({
        score: null,
        deleted: 1,
      }),
    ).toEqual({
      score: null,
      deleted: 1,
      scoreDefaulted: false,
    });
  });

  it("collects defaulted row ids", () => {
    const rows = applyDepositSlipScoreDefaults([
      { id: "a", score: null, deleted: 0 },
      { id: "b", score: "5000", deleted: 0 },
      { id: "c", score: null, deleted: 1 },
    ]);
    expect(depositSlipScoreDefaultedRowIds(rows)).toEqual(new Set(["a"]));
  });
});
