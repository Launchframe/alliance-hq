import { describe, expect, it } from "vitest";

import {
  compareDepositSlipOcrQuality,
  matchDepositSlipRows,
  type DepositSlipCompareRow,
} from "@/lib/banks/deposit-slip-ocr/compare-deposit-slip-ocr-quality.shared";

function row(overrides: Partial<DepositSlipCompareRow>): DepositSlipCompareRow {
  return {
    commanderName: "Bat Pig",
    depositAt: "2026-07-14T13:18:00.000Z",
    termDays: 3,
    amount: 5000,
    status: "locked",
    ...overrides,
  };
}

describe("matchDepositSlipRows", () => {
  it("matches rows by name + close depositAt, preferring the closer timestamp", () => {
    const primary = [row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:00.000Z" })];
    const shadow = [
      row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:19:30.000Z" }),
      row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:05.000Z" }),
    ];

    const matches = matchDepositSlipRows(primary, shadow);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.shadowIdx).toBe(1);
  });

  it("does not match rows whose depositAt is far apart even with an identical name", () => {
    const primary = [row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:00.000Z" })];
    const shadow = [row({ commanderName: "Bat Pig", depositAt: "2026-07-14T14:05:00.000Z" })];

    const matches = matchDepositSlipRows(primary, shadow);

    expect(matches).toHaveLength(0);
  });

  it("still matches on name alone when one side is missing depositAt (the case this pass targets)", () => {
    const primary = [row({ commanderName: "Bat Pig", depositAt: null })];
    const shadow = [row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:00.000Z" })];

    const matches = matchDepositSlipRows(primary, shadow);

    expect(matches).toHaveLength(1);
  });

  it("does not cross-match two different commanders even at the same time", () => {
    const primary = [row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:00.000Z" })];
    const shadow = [row({ commanderName: "Totally Different", depositAt: "2026-07-14T13:18:00.000Z" })];

    const matches = matchDepositSlipRows(primary, shadow);

    expect(matches).toHaveLength(0);
  });

  it("resolves ambiguity so the same shadow row is not double-matched", () => {
    const primary = [
      row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:00.000Z" }),
      row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:19:00.000Z" }),
    ];
    const shadow = [row({ commanderName: "Bat Pig", depositAt: "2026-07-14T13:18:30.000Z" })];

    const matches = matchDepositSlipRows(primary, shadow);

    expect(matches).toHaveLength(1);
    const usedPrimaryIdx = new Set(matches.map((m) => m.primaryIdx));
    expect(usedPrimaryIdx.size).toBe(1);
  });
});

describe("compareDepositSlipOcrQuality", () => {
  it("reports perfect agreement for identical row sets", () => {
    const rows = [
      row({ commanderName: "Bat Pig" }),
      row({ commanderName: "Totally Different Commander", depositAt: "2026-07-14T15:00:00.000Z", amount: 9000 }),
    ];

    const metrics = compareDepositSlipOcrQuality(rows, rows);

    expect(metrics.primaryRowCount).toBe(2);
    expect(metrics.shadowRowCount).toBe(2);
    expect(metrics.matchedRowCount).toBe(2);
    expect(metrics.rowRecall).toBe(1);
    expect(metrics.rowPrecision).toBe(1);
    expect(metrics.depositAtAgreement).toBe(1);
    expect(metrics.amountAgreement).toBe(1);
    expect(metrics.termDaysAgreement).toBe(1);
    expect(metrics.statusAgreement).toBe(1);
    expect(metrics.primaryMissingDepositAtRate).toBe(0);
    expect(metrics.shadowMissingDepositAtRate).toBe(0);
  });

  it("surfaces improved timestamp recovery when shadow fills in a missing primary depositAt", () => {
    const primary = [row({ depositAt: null })];
    const shadow = [row({ depositAt: "2026-07-14T13:18:00.000Z" })];

    const metrics = compareDepositSlipOcrQuality(primary, shadow);

    expect(metrics.matchedRowCount).toBe(1);
    expect(metrics.primaryMissingDepositAtRate).toBe(1);
    expect(metrics.shadowMissingDepositAtRate).toBe(0);
    // Both sides must have a value to compute agreement; primary's is null here.
    expect(metrics.depositAtAgreement).toBeNull();
  });

  it("counts unmatched rows on each side", () => {
    const primary = [
      row({ commanderName: "Bat Pig" }),
      row({ commanderName: "Only In Primary", depositAt: "2026-07-14T16:00:00.000Z" }),
    ];
    const shadow = [
      row({ commanderName: "Bat Pig" }),
      row({ commanderName: "Only In Shadow", depositAt: "2026-07-14T17:00:00.000Z" }),
    ];

    const metrics = compareDepositSlipOcrQuality(primary, shadow);

    expect(metrics.matchedRowCount).toBe(1);
    expect(metrics.onlyInPrimary).toBe(1);
    expect(metrics.onlyInShadow).toBe(1);
    expect(metrics.rowRecall).toBe(0.5);
    expect(metrics.rowPrecision).toBe(0.5);
  });

  it("handles empty inputs without dividing by zero", () => {
    const metrics = compareDepositSlipOcrQuality([], []);
    expect(metrics).toMatchObject({
      primaryRowCount: 0,
      shadowRowCount: 0,
      matchedRowCount: 0,
      rowRecall: 0,
      rowPrecision: 0,
      primaryMissingDepositAtRate: 0,
      shadowMissingDepositAtRate: 0,
    });
  });

  it("flags amount/status disagreement on matched rows", () => {
    const primary = [row({ amount: 5000, status: "locked" })];
    const shadow = [row({ amount: 6000, status: "matured" })];

    const metrics = compareDepositSlipOcrQuality(primary, shadow);

    expect(metrics.matchedRowCount).toBe(1);
    expect(metrics.amountAgreement).toBe(0);
    expect(metrics.statusAgreement).toBe(0);
  });
});
