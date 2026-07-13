import { describe, expect, it } from "vitest";

import {
  DEPOSIT_ALLIANCE_FILTER_ALL,
  DEPOSIT_ALLIANCE_FILTER_UNTAGGED,
  buildDepositAllianceSummary,
  filterSlipsByDepositAlliance,
  formatDepositAllianceReportPlaintext,
  uniqueDepositAllianceTags,
} from "@/lib/banks/deposit-alliance-report.shared";
import type { SerializedDepositSlip } from "@/lib/banks/types.shared";

function slip(
  overrides: Partial<SerializedDepositSlip> &
    Pick<
      SerializedDepositSlip,
      "id" | "amount" | "termDays" | "status" | "commanderName"
    >,
): SerializedDepositSlip {
  return {
    bankId: "bank-1",
    depositAt: "2026-07-01T12:00:00.000Z",
    maturesAt: "2026-07-04T12:00:00.000Z",
    outcomeAt: null,
    depositAllianceTag: null,
    depositAllianceId: null,
    commanderId: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("uniqueDepositAllianceTags", () => {
  it("returns sorted distinct non-empty tags and ignores blank", () => {
    expect(
      uniqueDepositAllianceTags([
        { depositAllianceTag: "Boom" },
        { depositAllianceTag: "  " },
        { depositAllianceTag: null },
        { depositAllianceTag: "aaa" },
        { depositAllianceTag: "Boom" },
        { depositAllianceTag: " Zoo " },
      ]),
    ).toEqual(["aaa", "Boom", "Zoo"]);
  });
});

describe("filterSlipsByDepositAlliance", () => {
  const slips = [
    slip({
      id: "1",
      amount: 100,
      termDays: 1,
      status: "locked",
      commanderName: "A",
      depositAllianceTag: "Boom",
    }),
    slip({
      id: "2",
      amount: 200,
      termDays: 3,
      status: "matured",
      commanderName: "B",
      depositAllianceTag: null,
    }),
    slip({
      id: "3",
      amount: 50,
      termDays: 5,
      status: "looted",
      commanderName: "C",
      depositAllianceTag: "boom",
    }),
  ];

  it("returns all slips for all", () => {
    expect(filterSlipsByDepositAlliance(slips, DEPOSIT_ALLIANCE_FILTER_ALL)).toHaveLength(
      3,
    );
  });

  it("returns only untagged slips", () => {
    expect(
      filterSlipsByDepositAlliance(slips, DEPOSIT_ALLIANCE_FILTER_UNTAGGED).map(
        (s) => s.id,
      ),
    ).toEqual(["2"]);
  });

  it("matches tags case-insensitively", () => {
    expect(
      filterSlipsByDepositAlliance(slips, "BOOM").map((s) => s.id),
    ).toEqual(["1", "3"]);
  });
});

describe("buildDepositAllianceSummary", () => {
  it("rolls up totals by term and status", () => {
    const summary = buildDepositAllianceSummary([
      slip({
        id: "1",
        amount: 100,
        termDays: 1,
        status: "locked",
        commanderName: "A",
      }),
      slip({
        id: "2",
        amount: 250,
        termDays: 1,
        status: "matured",
        commanderName: "B",
      }),
      slip({
        id: "3",
        amount: 50,
        termDays: 5,
        status: "looted",
        commanderName: "C",
      }),
    ]);

    expect(summary.total).toEqual({ count: 3, amount: 400 });
    expect(summary.byTerm[1]).toEqual({ count: 2, amount: 350 });
    expect(summary.byTerm[3]).toEqual({ count: 0, amount: 0 });
    expect(summary.byTerm[5]).toEqual({ count: 1, amount: 50 });
    expect(summary.byStatus.locked).toEqual({ count: 1, amount: 100 });
    expect(summary.byStatus.matured).toEqual({ count: 1, amount: 250 });
    expect(summary.byStatus.looted).toEqual({ count: 1, amount: 50 });
  });
});

describe("formatDepositAllianceReportPlaintext", () => {
  it("formats a pasteable report with rollups and slip lines", () => {
    const slips = [
      slip({
        id: "1",
        amount: 1000,
        termDays: 3,
        status: "locked",
        commanderName: "BabyMoo",
        depositAllianceTag: "Boom",
        depositAt: "2026-07-02T15:00:00.000Z",
      }),
    ];
    const text = formatDepositAllianceReportPlaintext({
      bankLabel: "#42 (X:1, Y:2)",
      allianceFilterLabel: "Boom",
      slips,
      summary: buildDepositAllianceSummary(slips),
      statusLabel: (status) => status.toUpperCase(),
      formatAmount: (n) => `$${n}`,
      formatDateTime: () => "Jul 2",
    });

    expect(text).toContain("Deposit report — #42 (X:1, Y:2)");
    expect(text).toContain("Alliance filter: Boom");
    expect(text).toContain("Totals: 1 deposits, $1000 CrystalGold");
    expect(text).toContain("3d — 1 · $1000");
    expect(text).toContain("LOCKED — 1 · $1000");
    expect(text).toContain(
      "$1000 · 3d · LOCKED · BabyMoo [Boom] · Jul 2",
    );
  });
});
