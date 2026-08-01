import { describe, expect, it } from "vitest";

import { filterAndSortDepositSlipReviewRows } from "@/lib/banks/deposit-slip-review-visible-rows.shared";

function row(
  overrides: Partial<{
    id: string;
    ocrName: string;
    score: string | null;
    powerLevel: string | null;
    profession: string | null;
    allianceRankTitle: string | null;
    frameIndex: number | null;
  }> & { id: string },
) {
  return {
    ocrName: "Alpha",
    score: "6000",
    powerLevel: "2026-07-11T10:00:00.000Z",
    profession: "locked",
    allianceRankTitle: "LFgo",
    ...overrides,
  };
}

describe("filterAndSortDepositSlipReviewRows", () => {
  it("filters on alliance tag / amount / status haystack, not only name", () => {
    const rows = [
      row({ id: "a", ocrName: "Alpha", allianceRankTitle: "LFgo" }),
      row({ id: "b", ocrName: "Beta", allianceRankTitle: "OTHR", score: "1200" }),
      row({
        id: "c",
        ocrName: "Gamma",
        profession: "matured",
        allianceRankTitle: "ZZ",
      }),
    ];
    expect(
      filterAndSortDepositSlipReviewRows(rows, {
        filterQuery: "lfgo",
        sortKey: "commander",
      }).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      filterAndSortDepositSlipReviewRows(rows, {
        filterQuery: "1200",
        sortKey: "commander",
      }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      filterAndSortDepositSlipReviewRows(rows, {
        filterQuery: "matured",
        sortKey: "commander",
      }).map((r) => r.id),
    ).toEqual(["c"]);
  });

  it("sorts deposit time mode by ascending frame order (in-game row order)", () => {
    const rows = [
      row({
        id: "later-frame",
        ocrName: "Zed",
        powerLevel: "2026-07-12T10:00:00.000Z",
        frameIndex: 20,
      }),
      row({
        id: "earlier-frame",
        ocrName: "Ann",
        powerLevel: "2026-07-10T10:00:00.000Z",
        frameIndex: 5,
      }),
    ];
    expect(
      filterAndSortDepositSlipReviewRows(rows, {
        filterQuery: "",
        sortKey: "depositAt",
      }).map((r) => r.id),
    ).toEqual(["earlier-frame", "later-frame"]);
    expect(
      filterAndSortDepositSlipReviewRows(rows, {
        filterQuery: "",
        sortKey: "commander",
      }).map((r) => r.id),
    ).toEqual(["earlier-frame", "later-frame"]);
  });

  it("tie-breaks equal frameIndex by id when sorting deposit time mode", () => {
    const rows = [
      row({
        id: "b-row",
        powerLevel: "2026-07-12T10:00:00.000Z",
        frameIndex: 5,
      }),
      row({
        id: "a-row",
        powerLevel: "2026-07-10T10:00:00.000Z",
        frameIndex: 5,
      }),
    ];
    expect(
      filterAndSortDepositSlipReviewRows(rows, {
        filterQuery: "",
        sortKey: "depositAt",
      }).map((r) => r.id),
    ).toEqual(["a-row", "b-row"]);
  });
});
